// price-feed (0.20.0) — daily market prices for auto-priced holdings. Rules in ./prices.ts (a copy of src/lib/prices.ts, kept identical
// by scripts/sync-engines.mjs).
//   POST { action: "run" }                          x-cron-secret: every household (pg_cron 22:30 UTC, Mon–Fri)
//   POST { action: "household", household_id }      signed-in editor: just this household ("Update prices now" on Investments)
// Quotes: Yahoo's chart endpoint first, Stooq's CSV second. Every quote is stored in `prices` (history), then holdings are updated through
// apply_price_updates() so the audit log gets one summary line per household instead of one row per holding.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { planPriceUpdates, symbolsToFetch, parseYahooChart, parseStooqCsv, yahooUrl, stooqUrl, type Quote, type PHolding } from './prices.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin = createClient(url, service, { auth: { persistSession: false } })
const UA = 'Mozilla/5.0 (compatible; WealthPilot price feed)'
const MAX_SYMBOLS = 250
async function logError(household_id: string | null, message: string, context: Record<string, unknown> = {}) { try { await admin.from('app_errors').insert({ household_id, source: 'price-feed', message: message.slice(0, 2000), context }) } catch { /* */ } }

async function fetchQuote(sym: string): Promise<Quote | null> {
  try { const r = await fetch(yahooUrl(sym), { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) }); if (r.ok) { const q = parseYahooChart(sym, await r.json()); if (q) return q } } catch { /* fall through */ }
  if (/-USD$|\^|=/.test(sym)) return null   // crypto pairs and indices: Stooq's US quote does not cover them
  try { const r = await fetch(stooqUrl(sym), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) }); if (r.ok) return parseStooqCsv(sym, await r.text()) } catch { /* */ }
  return null
}
async function quotesFor(symbols: string[]) {
  const out: Record<string, Quote> = {}; const missing: string[] = []; let i = 0
  const worker = async () => { while (i < symbols.length) { const s = symbols[i++]; const q = await fetchQuote(s); if (q) out[s] = q; else missing.push(s) } }
  await Promise.all(Array.from({ length: Math.min(4, symbols.length) }, worker))
  return { quotes: out, missing: missing.sort() }
}

async function run(householdId: string | null) {
  let q = admin.from('holdings').select('id, household_id, symbol, asset_class, price, price_as_of, price_source').eq('price_source', 'auto').not('symbol', 'is', null)
  if (householdId) q = q.eq('household_id', householdId)
  const { data: rows, error } = await q; if (error) throw error
  const holdings = (rows || []).map(r => ({ ...r, price: Number(r.price) })) as PHolding[]
  const symbols = symbolsToFetch(holdings).slice(0, MAX_SYMBOLS)
  if (!symbols.length) return { symbols: 0, quoted: 0, updated: 0, missing: [] as string[] }
  const { quotes, missing } = await quotesFor(symbols)
  const hist = Object.values(quotes).map(x => ({ symbol: x.symbol, date: x.date, price: x.price, currency: x.currency || 'USD', source: x.source, fetched_at: new Date().toISOString() }))
  if (hist.length) { const { error: e } = await admin.from('prices').upsert(hist, { onConflict: 'symbol,date' }); if (e) await logError(householdId, 'prices upsert: ' + e.message) }
  const patches = planPriceUpdates(holdings, quotes)
  let households = 0
  if (patches.length) { const { data: n, error: e } = await admin.rpc('apply_price_updates', { p: patches.map(x => ({ id: x.id, price: x.price, price_as_of: x.price_as_of })) }); if (e) throw e; households = Number(n) || 0 }
  if (missing.length) await logError(householdId, `no quote for ${missing.length} symbol${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 20).join(', ')}`, { missing })
  return { symbols: symbols.length, quoted: Object.keys(quotes).length, updated: patches.length, households, missing }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  let b: { action?: string; household_id?: string }; try { b = await req.json() } catch { return json(400, { error: 'JSON body expected' }) }
  if (b.action === 'run') {
    const given = req.headers.get('x-cron-secret') || '', envSecret = Deno.env.get('CRON_SECRET')
    const ok = (!!envSecret && given === envSecret) || (given.length >= 32 && (await admin.rpc('cron_secret_ok', { p: given })).data === true)
    if (!ok) return json(401, { error: 'cron secret required' })
    try { return json(200, { ok: true, ...(await run(null)) }) } catch (e) { await logError(null, (e as Error).message, { action: 'run' }); return json(500, { error: (e as Error).message }) }
  }
  if (b.action === 'household') {
    const auth = req.headers.get('Authorization') || ''; if (!auth.startsWith('Bearer ')) return json(401, { error: 'sign in first' })
    const user = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
    const { data: me } = await user.auth.getUser(); if (!me?.user) return json(401, { error: 'sign in first' })
    const hh = String(b.household_id || ''); if (!hh) return json(400, { error: 'household_id required' })
    const { data: m } = await admin.from('household_members').select('role, read_only').eq('household_id', hh).eq('user_id', me.user.id).maybeSingle()
    if (!m || m.role === 'viewer' || m.read_only) return json(403, { error: 'only editors can update prices' })
    try { return json(200, { ok: true, ...(await run(hh)) }) } catch (e) { await logError(hh, (e as Error).message, { action: 'household' }); return json(500, { error: (e as Error).message }) }
  }
  return json(400, { error: 'unknown action' })
})
