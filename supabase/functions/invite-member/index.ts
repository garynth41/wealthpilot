// invite-member — creates (or finds) the invited person's account, adds them to the household with the chosen access,
// issues a one-time temporary password for new accounts and, when RESEND_API_KEY + INVITE_FROM are set, emails the invitation.
// The temporary password is returned to the inviting owner exactly once (so they can send it themselves) and is never stored.
// Deploy: supabase functions deploy invite-member   (or the Supabase MCP deploy_edge_function tool)
// Secrets (optional): RESEND_API_KEY, INVITE_FROM ("WealthPilot <invites@yourdomain>")
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const ROLES = ['owner', 'editor', 'viewer']
const MODULES = ['transactions', 'budget', 'bills', 'income', 'accounts', 'connections', 'investments', 'tax', 'goals', 'hardship']   // keep in step with src/lib/access.ts GRANTABLE
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
function tempPassword() { const b = crypto.getRandomValues(new Uint8Array(12)); const g = (o: number) => [...b.slice(o, o + 4)].map(x => ALPHABET[x % ALPHABET.length]).join(''); return `WP-${g(0)}-${g(4)}-${g(8)}` }

interface Body { household_id: string; email: string; role?: string; read_only?: boolean; modules?: string[] | null; display_name?: string | null; subject?: string; body?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  const auth = req.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return json(401, { error: 'Sign in first' })
  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const asUser = createClient(url, anon, { global: { headers: { Authorization: auth } } })
  const { data: { user }, error: uErr } = await asUser.auth.getUser()
  if (uErr || !user) return json(401, { error: 'Sign in first' })

  let b: Body
  try { b = await req.json() } catch { return json(400, { error: 'Bad JSON' }) }
  const email = String(b.email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: 'Enter a valid email address' })
  if (!b.household_id) return json(400, { error: 'household_id required' })
  const role = ROLES.includes(String(b.role)) ? String(b.role) : 'viewer'
  const read_only = role === 'viewer' ? true : !!b.read_only
  const modules = Array.isArray(b.modules) ? [...new Set(b.modules.filter(m => MODULES.includes(String(m))))].sort() : null
  if (Array.isArray(b.modules) && modules!.length === 0) return json(400, { error: 'Pick at least one module for limited access' })
  if (email === (user.email || '').toLowerCase()) return json(400, { error: 'That is your own email' })

  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: me } = await admin.from('household_members').select('role, email').eq('household_id', b.household_id).eq('user_id', user.id).maybeSingle()
  if (!me || me.role !== 'owner') return json(403, { error: 'Only an owner can invite members' })
  const { data: hh } = await admin.from('households').select('name').eq('id', b.household_id).single()

  // existing account?
  const { data: existingId } = await admin.rpc('user_id_by_email', { p_email: email })
  let userId: string | null = (existingId as string | null) || null, temp: string | null = null, existing = !!userId
  if (!userId) {
    temp = tempPassword()
    const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password: temp, email_confirm: true, user_metadata: { must_change_password: true, display_name: b.display_name || null, invited_by: user.email || null } })
    if (cErr || !created.user) return json(500, { error: cErr?.message || 'Could not create the account' })
    userId = created.user.id
  }
  const { error: mErr } = await admin.from('household_members').upsert({ household_id: b.household_id, user_id: userId, email, display_name: b.display_name || null, role, read_only, modules }, { onConflict: 'household_id,user_id' })
  if (mErr) return json(500, { error: mErr.message })
  const inviteRow = { household_id: b.household_id, email, role, read_only, modules, display_name: b.display_name || null, invited_by: user.id, invited_user_id: userId, accepted_at: new Date().toISOString(), temp_password_issued_at: temp ? new Date().toISOString() : null, sent_at: null as string | null }

  // optional automatic email
  let sent = false, sendError: string | null = null
  const key = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('INVITE_FROM')
  if (key && from && b.subject && b.body) {
    const text = b.body.replace('{{TEMP_PASSWORD}}', temp || '')
    try {
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [email], reply_to: user.email || undefined, subject: b.subject, text }) })
      if (r.ok) { sent = true; inviteRow.sent_at = new Date().toISOString() } else sendError = `Email provider replied ${r.status}`
    } catch (e) { sendError = (e as Error).message }
  }
  await admin.from('household_invites').upsert(inviteRow, { onConflict: 'household_id,email' })
  await admin.from('activity_log').insert({ household_id: b.household_id, user_id: user.id, user_email: user.email, action: 'invite', table_name: 'household_members', record_id: userId, summary: `${email} · ${role}${read_only ? ' read-only' : ''}${modules ? ' · ' + modules.join(',') : ''}${existing ? ' (existing account)' : ' (temporary password issued)'}` })
  return json(200, { ok: true, user_id: userId, existing, temp_password: temp, sent, send_error: sendError, household: hh?.name || null, can_send: !!(key && from) })
})
