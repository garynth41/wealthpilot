// delete-account (0.25.1) — a signed-in person deletes their own WealthPilot account (Apple guideline 5.1.1(v), Google Play's account
// deletion policy). POST JSON with the caller's JWT:
//   { action: "preview" }               what deleting would do: households deleted with the account (they are its only member),
//                                       households left (others carry on), households that block it (they are the only owner and
//                                       others are members — make someone else an owner first, or delete that household)
//   { action: "delete", password }       checks the password (and that the session passed two-factor when it is on), deletes the
//                                       households that are only theirs — files, nightly backups and every row — removes them from every
//                                       other household's records (forget_user, migration 0019) and deletes the sign-in. Immediate and final.
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin = createClient(url, service, { auth: { persistSession: false } })

type H = { id: string; name: string }
async function plan(userId: string) {
  const { data: mine, error } = await admin.from('household_members').select('household_id, role').eq('user_id', userId); if (error) throw error
  const ids = (mine || []).map(m => m.household_id as string); if (!ids.length) return { solo: [] as H[], shared: [] as Array<H & { role: string }>, blocked: [] as H[] }
  const [{ data: hh }, { data: members }] = await Promise.all([admin.from('households').select('id, name').in('id', ids), admin.from('household_members').select('household_id, user_id, role').in('household_id', ids)])
  const name = (id: string) => (hh || []).find(h => h.id === id)?.name || 'Household'
  const solo: H[] = [], shared: Array<H & { role: string }> = [], blocked: H[] = []
  for (const m of mine || []) {
    const id = m.household_id as string, all = (members || []).filter(x => x.household_id === id), others = all.filter(x => x.user_id !== userId)
    if (!others.length) solo.push({ id, name: name(id) })
    else if (m.role === 'owner' && !others.some(x => x.role === 'owner')) blocked.push({ id, name: name(id) })
    else shared.push({ id, name: name(id), role: m.role as string })
  }
  return { solo, shared, blocked }
}

/** Every file under <household_id>/ in a bucket (folders are walked four levels deep). */
async function listAll(bucket: string, prefix: string, depth = 0): Promise<string[]> {
  const out: string[] = []; if (depth > 4) return out
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset }); if (error) throw error
    for (const f of data || []) { const p = `${prefix}/${f.name}`; if (f.id == null) out.push(...await listAll(bucket, p, depth + 1)); else out.push(p) }
    if (!data || data.length < 1000) break
  }
  return out
}
/** The household's rows go first — that is the deletion that matters, and it takes every table with it — then its files, which nobody
 *  can open once the household is gone (the storage rules go by membership). A file that fails to go is logged in app_errors (source
 *  'account', with the household's id) for removal by hand, instead of leaving the household half-deleted (0.25.1 review). */
async function deleteHousehold(h: H, userId: string) {
  const buckets = ['attachments', 'backups'], lists = await Promise.all(buckets.map(b => listAll(b, h.id)))
  const { error } = await admin.from('households').delete().eq('id', h.id); if (error) throw new Error(`Could not delete ${h.name}: ${error.message}`)
  let removed = 0; const left: string[] = []
  for (const [k, bucket] of buckets.entries()) for (let i = 0; i < lists[k].length; i += 100) {
    const chunk = lists[k].slice(i, i + 100); const { error: re } = await admin.storage.from(bucket).remove(chunk)
    if (re) left.push(`${bucket}: ${chunk.length} file(s) — ${re.message}`); else removed += chunk.length
  }
  await admin.from('deleted_households').upsert({ id: h.id, name: h.name, requested_by: null, requested_at: new Date().toISOString(), files_removed: removed })
  if (left.length) await admin.from('app_errors').insert({ source: 'account', message: `delete-account: files of a deleted household were left in storage — remove the ${h.id}/ folders by hand`.slice(0, 2000), context: { user: userId, household: h.id, left } })
}
const claims = (jwt: string): Record<string, unknown> => { try { const p = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(atob(p.padEnd(Math.ceil(p.length / 4) * 4, '='))) } catch { return {} } }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  let b: { action?: string; password?: string }; try { b = await req.json() } catch { return json(400, { error: 'JSON body expected' }) }
  const auth = req.headers.get('Authorization') || ''; if (!auth.startsWith('Bearer ')) return json(401, { error: 'Sign in first' })
  const jwt = auth.slice(7)
  const { data: { user } } = await createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } }).auth.getUser()
  if (!user) return json(401, { error: 'Sign in first' })
  try {
    if (b.action === 'preview') return json(200, await plan(user.id))
    if (b.action !== 'delete') return json(400, { error: 'Unknown action' })
    if (!user.email || !b.password) return json(400, { error: 'Type your password to confirm' })
    // the password, checked without touching the caller's own session
    const check = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const { error: pe } = await check.auth.signInWithPassword({ email: user.email, password: String(b.password) })
    if (pe) return json(403, { error: /invalid/i.test(pe.message) ? 'That password is not right' : pe.message })
    // scope local: end only the session this check opened (the default, global, would also sign the person out of the app)
    await check.auth.signOut({ scope: 'local' }).catch(() => { /* the check session is thrown away either way */ })
    // with two-factor on, the session asking must itself have passed it — and when the check itself fails, nothing is deleted
    const { data: f, error: me } = await admin.auth.admin.mfa.listFactors({ userId: user.id })
    if (me) throw new Error('Checking two-factor sign-in failed: ' + me.message)
    const twoFactor = [...(user.factors || []), ...(f?.factors || [])].some(x => x.status === 'verified')
    if (twoFactor && claims(jwt).aal !== 'aal2') return json(403, { error: 'Two-factor is on: sign out, sign in again with your code, then delete the account' })
    const p = await plan(user.id)
    if (p.blocked.length) return json(409, { error: `You are the only owner of ${p.blocked.map(h => h.name).join(', ')}, which other people use. Make one of them an owner in Settings → Members, or delete that household, then try again.`, blocked: p.blocked })
    for (const h of p.solo) await deleteHousehold(h, user.id)
    const { error: fe } = await admin.rpc('forget_user', { p_user: user.id }); if (fe) throw new Error('Clearing your name from shared households failed: ' + fe.message)
    const { error: de } = await admin.auth.admin.deleteUser(user.id); if (de) throw new Error('Deleting the sign-in failed: ' + de.message)
    return json(200, { ok: true, households_deleted: p.solo.length, households_left: p.shared.length })
  } catch (e) {
    try { await admin.from('app_errors').insert({ source: 'account', message: ('delete-account: ' + ((e as Error).message || String(e))).slice(0, 2000), context: { user: user.id } }) } catch { /* */ }
    return json(500, { error: ((e as Error).message || 'Something went wrong') + ' — try again; anything already deleted stays deleted, and your sign-in is kept until everything else is gone' })
  }
})
