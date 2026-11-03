// sync-simplefin — automatic bank sync through SimpleFIN Bridge. Actions (POST JSON, signed-in user's JWT):
//   connect    { household_id, setup_token }  owner: claims the access URL (stored server-side only), reads the account list, first sync
//   sync       { household_id }               owner/editor: balances + new transactions for the accounts mapped on Bank Connections
//   disconnect { household_id }               owner: forgets the access URL and the connection
// Daily run: pg_cron (migration 0005) POSTs { action: "sync_all" } with header x-cron-secret = the Vault secret 'wealthpilot_cron_secret' (checked by cron_secret_ok).
// The access URL contains the SimpleFIN credentials: it is only ever in sync_secrets (no browser access), never logged, never returned.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { claimUrlFromToken, splitAccessUrl, redactUrl, syncWindows, mergeResponses, normaliseResponse, balanceFor, toNewTxns, dropKnown, type SfinResponse } from './simplefin.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin = createClient(url, service, { auth: { persistSession: false } })

type Trigger = 'manual' | 'daily' | 'connect'
interface Result { ok: boolean; accounts: number; added: number; skipped: number; unmapped: number; message: string }

async function fetchAccounts(accessUrl: string, lastSyncUnix: number | null, withTxns: boolean): Promise<SfinResponse> {
  const { base, authorization } = splitAccessUrl(accessUrl)
  const get = async (q: string) => {
    const r = await fetch(`${base}/accounts${q}`, { headers: { Authorization: authorization, Accept: 'application/json' } })
    if (r.status === 403) throw new Error('SimpleFIN refused the access URL (403) — the token may have been revoked; reconnect from Bank Connections')
    if (r.status === 402) throw new Error('SimpleFIN says payment is required (402) — check your SimpleFIN Bridge subscription')
    if (!r.ok) throw new Error(`SimpleFIN replied ${r.status}`)
    return await r.json() as SfinResponse
  }
  if (!withTxns) return await get('?balances-only=1')
  // at most 44 days per request (SimpleFIN's recommended maximum is 45); the first sync takes two requests
  const out: SfinResponse[] = []
  for (const w of syncWindows(lastSyncUnix, Math.floor(Date.now() / 1000))) out.push(await get(`?start-date=${w.start}&end-date=${w.end}`))
  return mergeResponses(out)
}

async function runSync(hh: string, trigger: Trigger): Promise<Result> {
  const started = new Date().toISOString()
  const fail = async (message: string): Promise<Result> => {
    const m = redactUrl(message).slice(0, 400)
    await admin.from('sync_connections').update({ status: 'error', last_error: m }).eq('household_id', hh)
    await admin.from('sync_log').insert({ household_id: hh, started_at: started, finished_at: new Date().toISOString(), trigger, ok: false, message: m })
    return { ok: false, accounts: 0, added: 0, skipped: 0, unmapped: 0, message: m }
  }
  try {
    const { data: sec } = await admin.from('sync_secrets').select('access_url').eq('household_id', hh).maybeSingle()
    const { data: conn } = await admin.from('sync_connections').select('*').eq('household_id', hh).maybeSingle()
    if (!sec || !conn) return { ok: false, accounts: 0, added: 0, skipped: 0, unmapped: 0, message: 'Not connected' }
    const last = conn.last_sync_at ? Math.floor(new Date(conn.last_sync_at).getTime() / 1000) : null
    const resp = await fetchAccounts(sec.access_url, last, true)
    const { accounts: bank, errors } = normaliseResponse(resp)
    const map = (conn.account_map || {}) as Record<string, string>
    const { data: locals } = await admin.from('accounts').select('id, kind').eq('household_id', hh)
    const kindOf = new Map((locals || []).map(a => [a.id as string, a.kind as string]))
    let added = 0, skipped = 0, unmapped = 0, synced = 0
    for (const sf of bank) {
      const localId = map[sf.id]; const kind = localId ? kindOf.get(localId) : undefined
      if (!localId || !kind) { unmapped++; continue }
      synced++
      const incoming = toNewTxns(sf, { id: localId, kind })
      if (incoming.length) {
        const dates = incoming.map(t => t.date).sort()
        const { data: ex } = await admin.from('transactions').select('account_id, date, kind, amount, external_id').eq('household_id', hh).eq('account_id', localId).gte('date', dates[0]).lte('date', dates[dates.length - 1])
        const { data: byId } = await admin.from('transactions').select('external_id').eq('household_id', hh).in('external_id', incoming.map(t => t.external_id))
        const existing = [...(ex || []).map(e => ({ account_id: e.account_id as string, date: e.date as string, kind: e.kind as string, amount: Number(e.amount), external_id: e.external_id as string | null })), ...(byId || []).map(e => ({ account_id: null, date: '', kind: '', amount: 0, external_id: e.external_id as string }))]
        const { fresh, skipped: sk } = dropKnown(incoming, localId, existing); skipped += sk
        for (let i = 0; i < fresh.length; i += 200) {
          const rows = fresh.slice(i, i + 200).map(t => ({ ...t, household_id: hh, account_id: localId }))
          const { error } = await admin.from('transactions').insert(rows); if (error) throw new Error('Saving transactions failed: ' + error.message)
        }
        added += fresh.length
      }
      await admin.from('accounts').update({ balance: balanceFor(sf, kind), balance_as_of: sf.balanceDate }).eq('id', localId)
    }
    const discovered = bank.map(a => ({ id: a.id, name: a.name, org: a.org, last4: a.last4, balance: a.balance }))
    const message = [`${synced} account${synced === 1 ? '' : 's'} synced`, `${added} new transaction${added === 1 ? '' : 's'}`, skipped ? `${skipped} already present` : '', unmapped ? `${unmapped} account${unmapped === 1 ? '' : 's'} not mapped` : '', errors.length ? `bank notes: ${errors.join('; ')}` : ''].filter(Boolean).join(' · ')
    await admin.from('sync_connections').update({ status: 'connected', last_error: errors.length ? errors.join('; ').slice(0, 400) : null, last_sync_at: new Date().toISOString(), discovered }).eq('household_id', hh)
    await admin.from('sync_log').insert({ household_id: hh, started_at: started, finished_at: new Date().toISOString(), trigger, ok: true, accounts: synced, added, skipped, message })
    return { ok: true, accounts: synced, added, skipped, unmapped, message }
  } catch (e) { return await fail((e as Error).message) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  let b: { action?: string; household_id?: string; setup_token?: string }
  try { b = await req.json() } catch { return json(400, { error: 'Bad JSON' }) }

  // scheduled daily run
  if (b.action === 'sync_all') {
    // the caller secret lives in Vault (migration 0005); a CRON_SECRET function secret is still accepted for manual setups
    const given = req.headers.get('x-cron-secret') || '', envSecret = Deno.env.get('CRON_SECRET')
    const ok = (!!envSecret && given === envSecret) || (given.length >= 32 && (await admin.rpc('cron_secret_ok', { p: given })).data === true)
    if (!ok) return json(401, { error: 'Not allowed' })
    const { data: conns } = await admin.from('sync_connections').select('household_id').eq('provider', 'simplefin')
    const out: Array<{ household_id: string; ok: boolean; message: string }> = []
    for (const c of conns || []) { const r = await runSync(c.household_id as string, 'daily'); out.push({ household_id: c.household_id as string, ok: r.ok, message: r.message }) }
    return json(200, { ok: true, results: out })
  }

  const auth = req.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return json(401, { error: 'Sign in first' })
  const { data: { user } } = await createClient(url, anon, { global: { headers: { Authorization: auth } } }).auth.getUser()
  if (!user) return json(401, { error: 'Sign in first' })
  const hh = String(b.household_id || ''); if (!hh) return json(400, { error: 'household_id required' })
  const { data: me } = await admin.from('household_members').select('role, read_only, modules').eq('household_id', hh).eq('user_id', user.id).maybeSingle()
  if (!me) return json(403, { error: 'Not a member of this household' })
  const inModule = me.role === 'owner' || me.modules == null || (me.modules as string[]).includes('connections')
  if (!inModule) return json(403, { error: 'You do not have access to Bank connections' })
  const isOwner = me.role === 'owner', canEdit = isOwner || (me.role === 'editor' && !me.read_only)

  if (b.action === 'connect') {
    if (!isOwner) return json(403, { error: 'Only an owner can connect a bank' })
    let claim: string; try { claim = claimUrlFromToken(String(b.setup_token || '')) } catch (e) { return json(400, { error: (e as Error).message }) }
    let accessUrl = ''
    try {
      const r = await fetch(claim, { method: 'POST' })
      if (r.status === 403) return json(400, { error: 'SimpleFIN says this setup token was already used or has expired — create a new one in SimpleFIN Bridge' })
      if (!r.ok) return json(400, { error: `SimpleFIN replied ${r.status} when claiming the token` })
      accessUrl = (await r.text()).trim(); splitAccessUrl(accessUrl)   // validates
    } catch (e) { return json(400, { error: redactUrl((e as Error).message) }) }
    await admin.from('sync_secrets').upsert({ household_id: hh, access_url: accessUrl })
    // list the bank's accounts without transactions so the owner can map them before anything is imported
    let discovered: unknown[] = []
    try { const resp = await fetchAccounts(accessUrl, null, false); discovered = normaliseResponse(resp).accounts.map(a => ({ id: a.id, name: a.name, org: a.org, last4: a.last4, balance: a.balance })) } catch (e) { discovered = []; console.error(redactUrl((e as Error).message)) }
    await admin.from('sync_connections').upsert({ household_id: hh, provider: 'simplefin', status: 'connected', last_error: null, last_sync_at: null, account_map: {}, discovered, created_by: user.id })
    await admin.from('sync_log').insert({ household_id: hh, finished_at: new Date().toISOString(), trigger: 'connect', ok: true, message: `Connected — ${discovered.length} account${discovered.length === 1 ? '' : 's'} found at the bank` })
    await admin.from('activity_log').insert({ household_id: hh, user_id: user.id, user_email: user.email, action: 'connect', table_name: 'sync_connections', record_id: hh, summary: 'SimpleFIN connected' })
    return json(200, { ok: true, discovered })
  }
  if (b.action === 'sync') {
    if (!canEdit) return json(403, { error: 'Your access is read-only' })
    const r = await runSync(hh, 'manual'); return json(r.ok ? 200 : 502, r)
  }
  if (b.action === 'disconnect') {
    if (!isOwner) return json(403, { error: 'Only an owner can disconnect' })
    await admin.from('sync_secrets').delete().eq('household_id', hh); await admin.from('sync_connections').delete().eq('household_id', hh)
    await admin.from('activity_log').insert({ household_id: hh, user_id: user.id, user_email: user.email, action: 'disconnect', table_name: 'sync_connections', record_id: hh, summary: 'SimpleFIN disconnected' })
    return json(200, { ok: true })
  }
  return json(400, { error: 'Unknown action' })
})
