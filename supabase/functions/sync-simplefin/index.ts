// sync-simplefin — automatic bank sync through SimpleFIN Bridge. Actions (POST JSON, signed-in user's JWT):
//   connect    { household_id, setup_token }  owner: claims the access URL (stored server-side only), reads the account list, first sync
//   sync       { household_id }               owner/editor: balances + new transactions for the accounts mapped on Bank Connections
//   disconnect { household_id }               owner: forgets the access URL and the connection
//   backfill   { household_id, from }         owner: re-read history back to `from` (SimpleFIN keeps about 90 days), then merge duplicates
//   dedupe     { household_id }               owner/editor: merge clear-cut duplicate transactions now (see dedupe.ts)
// Limits (0.25.0): sync and backfill at most once every 15 minutes and 12 times in 24 hours per household (claim_sync_slot, 429 with
// retry_at otherwise); the daily run is not counted. A household scheduled for deletion is not synced and cannot be changed.
// Daily run: pg_cron (migration 0005) POSTs { action: "sync_all" } with header x-cron-secret = the Vault secret 'wealthpilot_cron_secret' (checked by cron_secret_ok).
// Maintenance (pg_cron secret): { action: "maintenance_all", backfill_from?: "YYYY-MM-DD", dry_run?: true } — backfill (optional) and de-duplicate every household; dry_run only previews the merge plan.
// The access URL contains the SimpleFIN credentials: it is only ever in sync_secrets (no browser access), never logged, never returned.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { planDedupe, type DAccount, type DTxn, type DedupeOptions } from './dedupe.ts'
import { verifiedBalance, type RTxn } from './reconcile.ts'
import { syncLimitMessage, SYNC_GAP_MINUTES, SYNC_DAILY, type SyncSlot } from './syncLimit.ts'
import { claimUrlFromToken, splitAccessUrl, redactUrl, syncWindows, mergeResponses, normaliseResponse, balanceFor, toNewTxns, dropKnown, type SfinResponse } from './simplefin.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin = createClient(url, service, { auth: { persistSession: false } })

type Trigger = 'manual' | 'daily' | 'connect' | 'backfill'
interface Result { ok: boolean; accounts: number; added: number; skipped: number; unmapped: number; merged: number; review: number; earliest: Record<string, string>; message: string }

async function fetchAccounts(accessUrl: string, lastSyncUnix: number | null, withTxns: boolean, backDays?: number): Promise<SfinResponse> {
  const { base, authorization } = splitAccessUrl(accessUrl)
  const get = async (q: string, attempt = 1): Promise<SfinResponse> => {
    let r: Response
    try { r = await fetch(`${base}/accounts${q}`, { headers: { Authorization: authorization, Accept: 'application/json' }, signal: AbortSignal.timeout(45000) }) }
    catch (e) { if (attempt < 3) { await new Promise(res => setTimeout(res, 1500 * attempt)); return get(q, attempt + 1) } throw new Error(`Could not reach SimpleFIN after ${attempt} attempts: ${(e as Error).message}`) }
    if (r.status >= 500 && attempt < 3) { await new Promise(res => setTimeout(res, 1500 * attempt)); return get(q, attempt + 1) }
    if (r.status === 403) throw new Error('SimpleFIN refused the access URL (403) — the token may have been revoked; reconnect from Bank Connections')
    if (r.status === 402) throw new Error('SimpleFIN says payment is required (402) — check your SimpleFIN Bridge subscription')
    if (!r.ok) throw new Error(`SimpleFIN replied ${r.status}`)
    return await r.json() as SfinResponse
  }
  if (!withTxns) return await get('?balances-only=1')
  // at most 44 days per request (SimpleFIN's recommended maximum is 45); the first sync takes two requests
  const out: SfinResponse[] = []
  const now = Math.floor(Date.now() / 1000); const windows = backDays ? syncWindows(null, now, 0, backDays) : syncWindows(lastSyncUnix, now)
  for (const w of windows) out.push(await get(`?start-date=${w.start}&end-date=${w.end}`))
  return mergeResponses(out)
}

const audit = (hh: string, kind: string, summary: string, detail: Record<string, unknown> = {}, account_id: string | null = null) =>
  admin.from('audit_events').insert({ household_id: hh, account_id, kind, summary: summary.slice(0, 300), detail, user_email: 'bank sync' }).then(({ error }) => { if (error && !/audit_events/.test(error.message)) console.error(error.message) })

type Brief = { date: string; amount: number; kind: string; payee: string | null; source: string | null; account_id: string | null }
/** Merge every clear-cut duplicate in the household (same rules as the app). Returns merged rows and pairs left for review; dryRun only previews. */
async function dedupeHousehold(hh: string, dryRun = false): Promise<{ merged: number; review: number; preview?: unknown }> {
  const since = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10)
  const { data, error } = await admin.from('transactions').select('*').eq('household_id', hh).gte('date', since).limit(20000)
  if (error) throw new Error('Reading transactions for de-duplication failed: ' + error.message)
  const rows = (data || []).map(t => ({ ...t, amount: Number(t.amount) })) as DTxn[]
  // the accounts' kinds let the two bank rows of a card or loan payment (out of checking, onto the card) become one transfer (0.25.1)
  const { data: accts, error: ae } = await admin.from('accounts').select('id, kind, name, institution').eq('household_id', hh)
  if (ae) throw new Error('Reading accounts for de-duplication failed: ' + ae.message)
  // the household's choices (0.27.0): what merges on its own, whether transfers, checks and near-matches are looked for
  const { data: hhRow } = await admin.from('households').select('settings').eq('id', hh).maybeSingle()
  const plan = planDedupe(rows, (accts || []) as DAccount[], ((hhRow?.settings as { dedupe?: DedupeOptions } | null)?.dedupe) || null); let merged = 0
  if (dryRun) {
    const byId = new Map(rows.map(t => [t.id, t])); const brief = (id: string): Brief => { const t = byId.get(id)!; return { date: t.date, amount: t.amount, kind: t.kind, payee: t.payee ?? null, source: t.external_id?.startsWith('sfin:') ? 'bank' : t.source ?? null, account_id: t.account_id ?? t.to_account_id ?? null } }
    return { merged: plan.auto.reduce((n, g) => n + g.dups.length, 0), review: plan.review.length, preview: { auto: plan.auto.map(g => ({ keep: brief(g.keeper), merge: g.dups.map(brief), confidence: g.confidence, reason: g.reason, patch: g.patch })), review: plan.review.slice(0, 60).map(p => ({ a: brief(p.a), b: brief(p.b), reason: p.reason })) } }
  }
  for (const g of plan.auto) {
    if (Object.keys(g.patch).length) { const { error: e1 } = await admin.from('transactions').update(g.patch).eq('id', g.keeper).eq('household_id', hh); if (e1) throw new Error('Merging duplicates failed: ' + e1.message) }
    const { error: e2 } = await admin.from('transactions').update({ duplicate_of: g.keeper }).in('id', g.dups).eq('household_id', hh); if (e2) throw new Error('Merging duplicates failed: ' + e2.message)
    merged += g.dups.length
  }
  return { merged, review: plan.review.length }
}

async function runSync(hh: string, trigger: Trigger, fromDate?: string): Promise<Result> {
  const started = new Date().toISOString()
  const fail = async (message: string): Promise<Result> => {
    const m = redactUrl(message).slice(0, 400)
    await admin.from('sync_connections').update({ status: 'error', last_error: m }).eq('household_id', hh)
    await admin.from('sync_log').insert({ household_id: hh, started_at: started, finished_at: new Date().toISOString(), trigger, ok: false, message: m })
    await audit(hh, 'sync_failure', 'Bank sync failed: ' + m, { trigger, error: m })   // balances are left exactly as they were
    try { await admin.from('app_errors').insert({ household_id: hh, source: 'sync', message: m, context: { trigger } }) } catch { /* 0009 not applied yet */ }
    return { ok: false, accounts: 0, added: 0, skipped: 0, unmapped: 0, merged: 0, review: 0, earliest: {}, message: m }
  }
  try {
    const { data: sec } = await admin.from('sync_secrets').select('access_url').eq('household_id', hh).maybeSingle()
    const { data: conn } = await admin.from('sync_connections').select('*').eq('household_id', hh).maybeSingle()
    if (!sec || !conn) return { ok: false, accounts: 0, added: 0, skipped: 0, unmapped: 0, merged: 0, review: 0, earliest: {}, message: 'Not connected' }
    const last = conn.last_sync_at ? Math.floor(new Date(conn.last_sync_at).getTime() / 1000) : null
    const backDays = fromDate ? Math.min(400, Math.max(1, Math.ceil((Date.now() - Date.parse(fromDate + 'T00:00:00Z')) / 86400000))) : undefined
    const resp = await fetchAccounts(sec.access_url, last, true, backDays)
    const { accounts: bank, errors } = normaliseResponse(resp)
    const map = (conn.account_map || {}) as Record<string, string>
    const { data: locals } = await admin.from('accounts').select('id, kind, balance').eq('household_id', hh)
    const kindOf = new Map((locals || []).map(a => [a.id as string, a.kind as string]))
    let added = 0, skipped = 0, unmapped = 0, synced = 0; const earliest: Record<string, string> = {}
    for (const sf of bank) {
      const localId = map[sf.id]; const kind = localId ? kindOf.get(localId) : undefined
      if (!localId || !kind) { unmapped++; continue }
      synced++
      const first = sf.txns.map(t => t.date).sort()[0]; if (first) earliest[localId] = first
      const incoming = toNewTxns(sf, { id: localId, kind })
      if (incoming.length) {
        const dates = incoming.map(t => t.date).sort()
        const { data: ex } = await admin.from('transactions').select('account_id, date, kind, amount, external_id').eq('household_id', hh).eq('account_id', localId).gte('date', dates[0]).lte('date', dates[dates.length - 1])
        const { data: byId } = await admin.from('transactions').select('external_id').eq('household_id', hh).in('external_id', incoming.map(t => t.external_id))
        const existing = [...(ex || []).map(e => ({ account_id: e.account_id as string, date: e.date as string, kind: e.kind as string, amount: Number(e.amount), external_id: e.external_id as string | null })), ...(byId || []).map(e => ({ account_id: null, date: '', kind: '', amount: 0, external_id: e.external_id as string }))]
        const { fresh, skipped: sk } = dropKnown(incoming, localId, existing); skipped += sk
        for (let i = 0; i < fresh.length; i += 200) {
          const rows = fresh.slice(i, i + 200).map(t => ({ ...t, household_id: hh }))   // toNewTxns sets the account (a card payment is a transfer into it)
          const { error } = await admin.from('transactions').insert(rows); if (error) throw new Error('Saving transactions failed: ' + error.message)
        }
        added += fresh.length
      }
      // the bank's figure is the verified balance; the book follows it plus whatever the household recorded that the bank has not shown yet
      const bankBal = balanceFor(sf, kind)
      const { data: open } = await admin.from('transactions').select('id, date, kind, amount, account_id, to_account_id, status, external_id, duplicate_of').eq('household_id', hh).or(`account_id.eq.${localId},to_account_id.eq.${localId}`).eq('status', 'pending').is('duplicate_of', null).is('external_id', null)
      const book = verifiedBalance({ id: localId, kind, balance: bankBal, bank_balance: bankBal }, (open || []).map(t => ({ ...t, amount: Number(t.amount) })) as RTxn[])
      const { error: ue } = await admin.from('accounts').update({ bank_balance: bankBal, bank_balance_as_of: sf.balanceDate, balance: book, balance_as_of: sf.balanceDate }).eq('id', localId)
      if (ue && /bank_balance/.test(ue.message)) await admin.from('accounts').update({ balance: bankBal, balance_as_of: sf.balanceDate }).eq('id', localId)   // migration 0008 not applied yet
    }
    const discovered = bank.map(a => ({ id: a.id, name: a.name, org: a.org, last4: a.last4, balance: a.balance }))
    const dd = await dedupeHousehold(hh)
    const oldest = Object.values(earliest).sort()[0]
    const message = [`${synced} account${synced === 1 ? '' : 's'} synced`, `${added} new transaction${added === 1 ? '' : 's'}`, skipped ? `${skipped} already present` : '', dd.merged ? `${dd.merged} duplicate${dd.merged === 1 ? '' : 's'} merged` : '', dd.review ? `${dd.review} possible duplicate${dd.review === 1 ? '' : 's'} to review` : '', fromDate && oldest ? `history from ${fromDate} requested; the bank feed reaches back to ${oldest}` : '', unmapped ? `${unmapped} account${unmapped === 1 ? '' : 's'} not mapped` : '', errors.length ? `bank notes: ${errors.join('; ')}` : ''].filter(Boolean).join(' · ')
    await admin.from('sync_connections').update({ status: 'connected', last_error: errors.length ? errors.join('; ').slice(0, 400) : null, last_sync_at: new Date().toISOString(), discovered }).eq('household_id', hh)
    await admin.from('sync_log').insert({ household_id: hh, started_at: started, finished_at: new Date().toISOString(), trigger, ok: true, accounts: synced, added, skipped, message })
    await audit(hh, 'sync', `Bank sync (${trigger}): ${message}`, { trigger, accounts: synced, added, skipped, merged: dd.merged })
    return { ok: true, accounts: synced, added, skipped, unmapped, merged: dd.merged, review: dd.review, earliest, message }
  } catch (e) { return await fail((e as Error).message) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  let b: { action?: string; household_id?: string; setup_token?: string; from?: string; backfill_from?: string; dry_run?: boolean }
  try { b = await req.json() } catch { return json(400, { error: 'Bad JSON' }) }

  // scheduled daily run
  if (b.action === 'sync_all') {
    // the caller secret lives in Vault (migration 0005); a CRON_SECRET function secret is still accepted for manual setups
    const given = req.headers.get('x-cron-secret') || '', envSecret = Deno.env.get('CRON_SECRET')
    const ok = (!!envSecret && given === envSecret) || (given.length >= 32 && (await admin.rpc('cron_secret_ok', { p: given })).data === true)
    if (!ok) return json(401, { error: 'Not allowed' })
    const { data: conns } = await admin.from('sync_connections').select('household_id').eq('provider', 'simplefin')
    const { data: leaving } = await admin.from('households').select('id').not('deletion_scheduled_for', 'is', null); const skip = new Set((leaving || []).map(h => h.id as string))
    const out: Array<{ household_id: string; ok: boolean; message: string }> = []
    for (const c of conns || []) { if (skip.has(c.household_id as string)) { out.push({ household_id: c.household_id as string, ok: true, message: 'scheduled for deletion — skipped' }); continue } const r = await runSync(c.household_id as string, 'daily'); out.push({ household_id: c.household_id as string, ok: r.ok, message: r.message }) }
    return json(200, { ok: true, results: out })
  }
  if (b.action === 'maintenance_all') {
    const given = req.headers.get('x-cron-secret') || ''
    if (!(given.length >= 32 && (await admin.rpc('cron_secret_ok', { p: given })).data === true)) return json(401, { error: 'Not allowed' })
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(b.backfill_from || '')) ? String(b.backfill_from) : undefined, dry = b.dry_run === true
    const { data: conns } = await admin.from('sync_connections').select('household_id').eq('provider', 'simplefin'); const connected = new Set((conns || []).map(c => c.household_id as string))
    const { data: hhs } = await admin.from('households').select('id')
    const out: Array<Record<string, unknown>> = []
    for (const h of hhs || []) { const id = h.id as string
      try { if (dry) { out.push({ household_id: id, ok: true, ...(await dedupeHousehold(id, true)) }) } else if (from && connected.has(id)) { const r = await runSync(id, 'backfill', from); out.push({ household_id: id, ok: r.ok, message: r.message, earliest: r.earliest }) } else { const d = await dedupeHousehold(id); out.push({ household_id: id, ok: true, ...d }) } }
      catch (e) { out.push({ household_id: id, ok: false, message: (e as Error).message }) } }
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
  const isOwner = me.role === 'owner'
  const { data: hrow } = await admin.from('households').select('deletion_scheduled_for').eq('id', hh).maybeSingle(); const leaving = !!hrow?.deletion_scheduled_for
  const canEdit = !leaving && (isOwner || (me.role === 'editor' && !me.read_only))
  if (leaving && b.action !== 'disconnect') return json(403, { error: 'This household is scheduled for deletion and is read-only — cancel the deletion in Settings to sync again' })
  /** One manual sync or backfill: the database checks the limit and records the request in one locked step. */
  const claim = async (trigger: 'manual' | 'backfill') => {
    const { data, error } = await admin.rpc('claim_sync_slot', { p_household: hh, p_user: user.id, p_trigger: trigger, p_gap_minutes: SYNC_GAP_MINUTES, p_daily: SYNC_DAILY })
    if (error) { if (/claim_sync_slot/.test(error.message)) return null; throw new Error(error.message) }   // migration 0018 not applied: no limit
    const r = data as { ok: boolean; reason?: 'gap' | 'daily'; retry_at?: string; used: number; limit: number }
    if (r.ok) return null
    const slot: SyncSlot = { ok: false, reason: r.reason, retryAt: r.retry_at ? new Date(r.retry_at).toISOString() : undefined, used: r.used, limit: r.limit }
    return json(429, { ok: false, error: syncLimitMessage(slot), message: syncLimitMessage(slot), retry_at: slot.retryAt, reason: r.reason, used: r.used, limit: r.limit })
  }

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
    const limited = await claim('manual'); if (limited) return limited
    const r = await runSync(hh, 'manual'); return json(r.ok ? 200 : 502, r)
  }
  if (b.action === 'backfill') {
    if (!isOwner) return json(403, { error: 'Only an owner can load bank history' })
    const from = String(b.from || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return json(400, { error: 'from must be a date (YYYY-MM-DD)' })
    const limited = await claim('backfill'); if (limited) return limited
    const r = await runSync(hh, 'backfill', from); return json(r.ok ? 200 : 502, r)
  }
  if (b.action === 'dedupe') {
    if (!canEdit) return json(403, { error: 'Your access is read-only' })
    try { return json(200, { ok: true, ...(await dedupeHousehold(hh)) }) } catch (e) { return json(500, { error: (e as Error).message }) }
  }
  if (b.action === 'disconnect') {
    if (!isOwner) return json(403, { error: 'Only an owner can disconnect' })
    await admin.from('sync_secrets').delete().eq('household_id', hh); await admin.from('sync_connections').delete().eq('household_id', hh)
    await admin.from('activity_log').insert({ household_id: hh, user_id: user.id, user_email: user.email, action: 'disconnect', table_name: 'sync_connections', record_id: hh, summary: 'SimpleFIN disconnected' })
    return json(200, { ok: true })
  }
  return json(400, { error: 'Unknown action' })
})
