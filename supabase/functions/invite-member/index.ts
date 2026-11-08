// invite-member — an owner invites someone to the household with the chosen access (0.25.1: rewritten for safety).
// The invitation is recorded (household_invites); the person joins the next time they sign in — or, if they have no account yet, once
// they sign up with that address and confirm it. Before 0.25.1 this function created a confirmed account for any address and returned
// a temporary password to the inviter, so anyone could claim a stranger's email address; it no longer creates accounts at all.
// When RESEND_API_KEY + INVITE_FROM are set it also emails the invitation: a fixed message (the inviter may add a short plain-text
// note), and it never says whether the address already has an account. Limits, over the last 24 hours: 20 invitations per household,
// 30 per person inviting (across all their households), and 3 to any one address (from anyone) — each invitation is logged before
// anything is sent, and nothing is sent when it cannot be logged.
// Secrets (optional): RESEND_API_KEY, INVITE_FROM ("Cresari <invites@yourdomain>"), APP_URL
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const ROLES = ['owner', 'editor', 'viewer']
const MODULES = ['transactions', 'budget', 'bills', 'income', 'accounts', 'connections', 'investments', 'tax', 'goals', 'protection', 'hardship']   // keep in step with src/lib/access.ts GRANTABLE (a test checks)
const DAILY = 20, PER_INVITER = 30, PER_ADDRESS = 3
const APP_URL = Deno.env.get('APP_URL') || 'https://garynth41.github.io/wealthpilot/'

interface Body { household_id: string; email: string; role?: string; read_only?: boolean; modules?: string[] | null; display_name?: string | null; note?: string; send?: boolean }
const clean = (s: unknown, n: number) => String(s ?? '').replace(/[<>]/g, '').replace(/\s+\n/g, '\n').trim().slice(0, n)

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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json(400, { error: 'Enter a valid email address' })
  if (!b.household_id) return json(400, { error: 'household_id required' })
  const role = ROLES.includes(String(b.role)) ? String(b.role) : 'viewer'
  const read_only = role === 'viewer' ? true : !!b.read_only
  const modules = role === 'owner' ? null : Array.isArray(b.modules) ? [...new Set(b.modules.filter(m => MODULES.includes(String(m))))].sort() : null
  if (Array.isArray(b.modules) && role !== 'owner' && modules!.length === 0) return json(400, { error: 'Pick at least one section for limited access' })
  if (email === (user.email || '').toLowerCase()) return json(400, { error: 'That is your own email' })

  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: me } = await admin.from('household_members').select('role').eq('household_id', b.household_id).eq('user_id', user.id).maybeSingle()
  if (!me || me.role !== 'owner') return json(403, { error: 'Only an owner can invite members' })
  const { data: hh } = await admin.from('households').select('name, deletion_scheduled_for').eq('id', b.household_id).single()
  if (hh?.deletion_scheduled_for) return json(403, { error: 'This household is scheduled for deletion' })
  const since = new Date(Date.now() - 86400000).toISOString()
  const invites = () => admin.from('activity_log').select('id', { count: 'exact', head: true }).eq('action', 'invite').gte('created_at', since)
  const [hhN, mineN, toN] = await Promise.all([invites().eq('household_id', b.household_id), invites().eq('user_id', user.id), invites().eq('record_id', email)])
  if (hhN.error || mineN.error || toN.error) return json(500, { error: 'Could not check the invitation limits — try again' })
  if ((hhN.count || 0) >= DAILY) return json(429, { error: `That is ${DAILY} invitations for this household today — try again tomorrow` })
  if ((mineN.count || 0) >= PER_INVITER) return json(429, { error: `That is ${PER_INVITER} invitations from you today — try again tomorrow` })
  if ((toN.count || 0) >= PER_ADDRESS) return json(429, { error: 'That address has had several invitations today — try again tomorrow' })

  const display_name = clean(b.display_name, 80) || null
  const inviteRow = { household_id: b.household_id, email, role, read_only, modules, display_name, invited_by: user.id, invited_user_id: null, accepted_at: null, temp_password_issued_at: null, sent_at: null as string | null }
  // logged first: the log is what the limits count, so an invitation that cannot be logged is not made (or sent)
  const summary = `${email} · ${role}${read_only ? ' read-only' : ''}${modules ? ' · ' + modules.join(',') : ''}`
  const { data: logRow, error: lErr } = await admin.from('activity_log').insert({ household_id: b.household_id, user_id: user.id, user_email: user.email, action: 'invite', table_name: 'household_invites', record_id: email, summary }).select('id').single()
  if (lErr || !logRow) return json(500, { error: 'Could not record the invitation — try again' })

  // optional automatic email: a fixed message, so the function cannot be used to send anything else
  let sent = false, sendError: string | null = null
  const key = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('INVITE_FROM')
  if (key && from && b.send) {
    const access = role === 'owner' ? 'owner' : `${read_only ? 'read-only' : 'full'} access${modules ? ' to ' + modules.join(', ') : ''}`
    const note = clean(b.note, 500)
    const text = [`Hi${display_name ? ' ' + display_name : ''},`, '', `${user.email} has invited you to the "${clean(hh?.name, 80) || 'Household'}" household on Cresari (${access}).`, '',
      `To join, open ${APP_URL} and sign in with this email address — or create your account with it if you do not have one yet. The household appears as soon as you are signed in.`,
      ...(note ? ['', `A note from ${user.email}:`, note] : []), '', 'If you were not expecting this, you can ignore it.'].join('\n')
    try {
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [email], subject: `You're invited to a household on Cresari`, text }) })
      if (r.ok) { sent = true; inviteRow.sent_at = new Date().toISOString() } else sendError = `Email provider replied ${r.status}`
    } catch (e) { sendError = (e as Error).message }
  }
  const { error: iErr } = await admin.from('household_invites').upsert(inviteRow, { onConflict: 'household_id,email' })
  if (iErr) { if (!sent) await admin.from('activity_log').delete().eq('id', logRow.id); return json(500, { error: iErr.message }) }   // an email already sent stays counted
  if (sent) await admin.from('activity_log').update({ summary: summary + ' · emailed' }).eq('id', logRow.id)
  return json(200, { ok: true, user_id: null, existing: false, pending: true, temp_password: null, sent, send_error: sendError, household: hh?.name || null, can_send: !!(key && from) })
})
