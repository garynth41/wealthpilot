// backup-household — nightly JSON backup of every household into the private `backups` storage bucket (migration 0009).
//   POST { action: "backup_all" }            header x-cron-secret (pg_cron, Vault secret checked by cron_secret_ok): every household
//   POST { action: "backup", household_id }  signed-in owner/editor: back up one household now (the "Back up now" button)
// A backup is the same shape as Settings → Backup → Export ({ app, exported_at, household, ...tables }) at <household_id>/<YYYY-MM-DD>.json;
// files older than 30 days are removed. Failures are written to app_errors (source 'backup') so they show in Settings → Security → Errors.
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin = createClient(url, service, { auth: { persistSession: false } })
const KEEP_DAYS = 30
// collection name in the export → table (mirrors TABLE in src/app/data/types.ts)
const TABLES: Record<string, string> = { accounts: 'accounts', statements: 'statements', categories: 'categories', paySchedules: 'pay_schedules', periods: 'budget_periods', lines: 'budget_lines', transactions: 'transactions', recurring: 'recurring', occurrences: 'bill_occurrences', goals: 'goals', contributions: 'goal_contributions', planned: 'planned_items', snapshots: 'net_worth_snapshots', hardship: 'hardship_outreach', emailItems: 'email_items', holdings: 'holdings', reconciliations: 'reconciliations',
  // 0.22.0: every table the app restores (splits, receipts' file rows, comments and scenarios were missing before)
  splits: 'transaction_splits', attachments: 'attachments', comments: 'transaction_comments', scenarios: 'scenarios', lots: 'holding_lots', insurance: 'insurance_policies', estate: 'estate_items' }

async function logError(household_id: string | null, message: string, context: Record<string, unknown> = {}) {
  try { await admin.from('app_errors').insert({ household_id, source: 'backup', message: message.slice(0, 2000), context }) } catch { /* never fail the run over logging */ }
}

async function backupOne(household_id: string): Promise<{ ok: boolean; path?: string; bytes?: number; message?: string }> {
  try {
    const { data: household, error: he } = await admin.from('households').select('*').eq('id', household_id).single(); if (he) throw he
    const out: Record<string, unknown> = { app: 'WealthPilot', exported_at: new Date().toISOString(), backup: 'nightly', household }
    for (const [k, t] of Object.entries(TABLES)) {
      const rows: unknown[] = []; let from = 0
      for (;;) { const { data, error } = await admin.from(t).select('*').eq('household_id', household_id).range(from, from + 999); if (error) throw error; rows.push(...(data || [])); if (!data || data.length < 1000) break; from += 1000 }
      out[k] = rows
    }
    const day = new Date().toISOString().slice(0, 10); const path = `${household_id}/${day}.json`
    const body = new TextEncoder().encode(JSON.stringify(out))
    const { error: ue } = await admin.storage.from('backups').upload(path, body, { contentType: 'application/json', upsert: true }); if (ue) throw ue
    // trim: anything older than KEEP_DAYS
    const { data: files } = await admin.storage.from('backups').list(household_id, { limit: 1000 })
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10)
    const old = (files || []).map(f => f.name).filter(n => /^\d{4}-\d{2}-\d{2}\.json$/.test(n) && n.slice(0, 10) < cutoff).map(n => `${household_id}/${n}`)
    if (old.length) await admin.storage.from('backups').remove(old)
    return { ok: true, path, bytes: body.byteLength }
  } catch (e) { const message = (e as Error).message || String(e); await logError(household_id, message); return { ok: false, message } }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  let b: { action?: string; household_id?: string }; try { b = await req.json() } catch { return json(400, { error: 'JSON body expected' }) }
  if (b.action === 'backup_all') {
    const given = req.headers.get('x-cron-secret') || '', envSecret = Deno.env.get('CRON_SECRET')
    const ok = (!!envSecret && given === envSecret) || (given.length >= 32 && (await admin.rpc('cron_secret_ok', { p: given })).data === true)
    if (!ok) return json(401, { error: 'cron secret required' })
    const { data: hhs, error } = await admin.from('households').select('id'); if (error) return json(500, { error: error.message })
    const out: Array<{ household_id: string; ok: boolean; path?: string; bytes?: number; message?: string }> = []
    for (const h of hhs || []) out.push({ household_id: h.id, ...(await backupOne(h.id)) })
    return json(200, { ok: out.every(x => x.ok), results: out })
  }
  if (b.action === 'backup') {
    const auth = req.headers.get('Authorization') || ''; if (!auth.startsWith('Bearer ')) return json(401, { error: 'sign in first' })
    const user = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
    const { data: me } = await user.auth.getUser(); if (!me?.user) return json(401, { error: 'sign in first' })
    const hh = String(b.household_id || ''); if (!hh) return json(400, { error: 'household_id required' })
    const { data: m } = await admin.from('household_members').select('role').eq('household_id', hh).eq('user_id', me.user.id).maybeSingle()
    if (!m || !['owner', 'editor'].includes(m.role)) return json(403, { error: 'owner or editor only' })
    return json(200, await backupOne(hh))
  }
  return json(400, { error: 'unknown action' })
})
