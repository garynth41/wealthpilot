// Staging-database tests (0.25.0): the real app and the real database rules — sign-in, row-level security, triggers and functions —
// against the staging Supabase project, never production. CI runs it after the smoke suite (`npm run e2e:db`), with the app built
// into dist-staging against staging. Needs STAGING_URL, STAGING_KEY and STAGING_E2E_PASSWORD; the two test users and e2e_cleanup()
// come from supabase/staging/e2e.sql. Every run starts and ends with no test households.
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { createServer } from 'node:http'; import { readFileSync, statSync, mkdirSync } from 'node:fs'; import { join, extname } from 'node:path'; import { fileURLToPath } from 'node:url'

const URL_ = process.env.STAGING_URL, KEY = process.env.STAGING_KEY, PW = process.env.STAGING_E2E_PASSWORD
if (!URL_ || !KEY || !PW) { console.log('staging secrets not set — skipped'); process.exit(0) }
if (/dshswfcpovdpxcidolqb/.test(URL_)) { console.error('refusing to run the database tests against production'); process.exit(1) }
const OWNER = 'e2e-owner@wealthpilot.test', VIEWER = 'e2e-viewer@wealthpilot.test'
let F = 0; const ok = (c, m) => { if (!c) F++; console.log((c ? 'PASS ' : 'FAIL ') + m) }
const client = async email => { const c = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } }); const { error } = await c.auth.signInWithPassword({ email, password: PW }); if (error) throw new Error(`${email}: ${error.message}`); return c }
const refused = async p => { const { error, data, count } = await p; return !!error || (Array.isArray(data) && data.length === 0 && !count) }

const owner = await client(OWNER), viewer = await client(VIEWER)
await owner.rpc('e2e_cleanup')
// a fresh household, the viewer invited read-only
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ''); const NAME = `E2E ${stamp}`
const { data: hh, error: he } = await owner.rpc('create_household', { p_name: NAME }); ok(!he && !!hh, 'an owner creates a household ' + (he?.message || ''))
const { data: ownerUser } = await owner.auth.getUser()
await owner.from('household_invites').insert({ household_id: hh, email: VIEWER, role: 'viewer', read_only: true })
const { data: n } = await viewer.rpc('accept_invites'); ok(n >= 1, 'the viewer accepts the invitation')

// --- the database rules ---
const { data: acct, error: ae } = await owner.from('accounts').insert({ household_id: hh, name: 'E2E Checking', kind: 'checking', balance: 1000, balance_as_of: new Date().toISOString().slice(0, 10), include_in_cash: true, include_in_net_worth: true, status: 'Active', sort_order: 1 }).select('*').single()
ok(!ae && acct, 'the owner adds an account ' + (ae?.message || ''))
await owner.from('accounts').update({ balance: 1234.5 }).eq('id', acct.id)
const { data: hist } = await owner.from('balance_history').select('as_of, balance, source').eq('account_id', acct.id)
ok(hist?.length === 1 && +hist[0].balance === 1234.5 && hist[0].source === 'book', 'every balance change is kept — one row per account per day (trigger)')
ok(await refused(owner.from('balance_history').insert({ household_id: hh, account_id: acct.id, as_of: '2020-01-01', balance: 1, source: 'book' })), 'balance history cannot be written by hand')
ok((await viewer.from('accounts').select('id').eq('household_id', hh)).data?.length === 1, 'the viewer can read the household')
ok(await refused(viewer.from('transactions').insert({ household_id: hh, date: '2026-01-02', kind: 'expense', amount: 5, account_id: acct.id, status: 'cleared', source: 'manual' }).select('id')), 'a read-only viewer cannot add a transaction (RLS)')
ok(await refused(viewer.from('accounts').update({ balance: 1 }).eq('id', acct.id).select('id')), 'a read-only viewer cannot change a balance (RLS)')
ok(!!(await viewer.rpc('request_household_deletion', { p_household: hh, p_confirm: NAME })).error, 'only an owner can delete the household')
const { data: other } = await viewer.from('accounts').select('id').neq('household_id', hh); ok((other || []).length === 0, 'nobody sees another household\'s rows')
const { error: se } = await owner.from('credit_scores').insert({ household_id: hh, person: 'Me', date: '2026-10-01', score: 731, bureau: 'Experian', model: 'FICO 8' }); ok(!se, 'credit scores save ' + (se?.message || ''))
const { data: log } = await owner.from('activity_log').select('action, table_name').eq('household_id', hh); ok((log || []).some(l => l.table_name === 'credit_scores'), 'changes are written to the activity log (audit trigger)')
// 0.29.0 feedback: anyone can send a note (signed in or not), a tester reads back only their own and cannot triage it or see the tester numbers.
// Five notes in ten minutes is the limit, so a rerun that hits it still counts as the rule working.
const fbArgs = m => ({ p_kind: 'idea', p_message: m, p_rating: 4, p_page: '/start', p_app_version: 'e2e', p_platform: 'web', p_device: 'CI', p_screen: '1x1', p_look: null, p_demo: false, p_email: null, p_tester: 'e2e' })
const limited = e => /too many|try again|limit/i.test(e?.message || '')
const { data: fbId, error: fe } = await owner.rpc('submit_feedback', fbArgs(`[e2e] owner note ${stamp}`)); ok(!fe || limited(fe), 'a signed-in tester sends feedback ' + (fe?.message || ''))
if (fbId) {
  const { data: mine } = await owner.from('feedback').select('id, status, tester').eq('id', fbId); ok(mine?.length === 1 && mine[0].status === 'new' && mine[0].tester === 'e2e', 'the tester reads back their own note, marked new')
  ok(((await viewer.from('feedback').select('id').eq('id', fbId)).data || []).length === 0, 'another person cannot read it')
  const { data: tri } = await owner.from('feedback').update({ status: 'fixed' }).eq('id', fbId).select('id'); ok(!tri?.length, 'a tester cannot mark their own note fixed (only the operator triages)') }
const anon = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const { error: ane } = await anon.rpc('submit_feedback', fbArgs(`[e2e] demo note ${stamp}`)); ok(!ane || limited(ane), 'someone trying the demo, not signed in, can send feedback ' + (ane?.message || ''))
ok(((await anon.from('feedback').select('id')).data || []).length === 0, 'the public cannot read any feedback')
ok(!!(await owner.rpc('tester_stats')).error, 'tester numbers are for the operator only')
ok(!!(await anon.rpc('submit_feedback', fbArgs(' '))).error, 'an empty note is refused')

// --- 0.25.1: membership is the owner's call, limited access, invitations, deleting an account ---
const { data: { user: viewerUser } } = await viewer.auth.getUser(); const VID = viewerUser.id
await viewer.from('household_members').update({ role: 'owner', read_only: false }).eq('household_id', hh).eq('user_id', VID)
const { data: vm } = await owner.from('household_members').select('role, read_only').eq('household_id', hh).eq('user_id', VID).single()
ok(vm?.role === 'viewer' && vm?.read_only === true, 'a member cannot make themselves an owner (membership guard)')
await owner.from('household_members').update({ modules: ['transactions'] }).eq('household_id', hh).eq('user_id', VID)
ok(((await viewer.from('activity_log').select('id').eq('household_id', hh)).data || []).length === 0, 'a member limited to some sections cannot read the activity log')
ok(((await viewer.from('accounts').select('id').eq('household_id', hh)).data || []).length === 0, '…nor a section they were not given')
await owner.from('household_members').update({ modules: null }).eq('household_id', hh).eq('user_id', VID)
ok(((await viewer.from('activity_log').select('id').eq('household_id', hh)).data || []).length > 0, 'given full view again, they can read it')
const inv = await owner.functions.invoke('invite-member', { body: { household_id: hh, email: 'e2e-invitee@wealthpilot.test', role: 'viewer' } })
ok(!inv.error && inv.data?.pending === true && !inv.data?.temp_password && !inv.data?.user_id, 'an invitation creates no account and no password — it waits ' + (inv.error?.message || ''))
const { data: pend } = await owner.from('household_invites').select('accepted_at').eq('household_id', hh).eq('email', 'e2e-invitee@wealthpilot.test')
ok(pend?.length === 1 && !pend[0].accepted_at, '…as a pending invitation until that person signs in')
ok(!!(await viewer.functions.invoke('invite-member', { body: { household_id: hh, email: 'e2e-someone@wealthpilot.test', role: 'owner' } })).error, 'only an owner can invite')
const op = await owner.functions.invoke('delete-account', { body: { action: 'preview' } })
ok(!op.error && (op.data?.blocked || []).some(h => h.id === hh), 'the only owner of a shared household must hand it over before deleting their account')
// a throwaway user: an editor here, with a household of its own, then deleted
// (inside try: if the throwaway user cannot be made — e.g. the staging helper is missing — the rest of the run still finishes and cleans up)
const FILE = `${hh}/e2e-${stamp}-receipt.png`, PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
const notifyOf = async () => (await owner.from('households').select('settings').eq('id', hh).single()).data?.settings?.notify || {}
// what the app does (lib/memberNotify.ts): read the stored settings, change one member's alert row, write them back
const saveRow = async (c, uid, row) => { const { data: cur } = await c.from('households').select('settings').eq('id', hh).single(); const s = cur?.settings || {}; const nt = s.notify || {}
  return c.from('households').update({ settings: { ...s, notify: { ...nt, members: { ...(nt.members || {}), [uid]: row } } } }).eq('id', hh).select('id') }
try {
  const TMP = 'e2e-tmp-delete@wealthpilot.test'; const { error: mue } = await owner.rpc('e2e_make_user', { p_email: TMP }); ok(!mue, 'a throwaway test user ' + (mue?.message || ''))
  await owner.from('household_invites').insert({ household_id: hh, email: TMP, role: 'editor', read_only: false })
  const tmp = await client(TMP); await tmp.rpc('accept_invites'); const { data: { user: tmpUser } } = await tmp.auth.getUser()
  const { data: solo } = await tmp.rpc('create_household', { p_name: `E2E solo ${stamp}` })
  const { error: tue } = await tmp.from('accounts').update({ balance: 777 }).eq('id', acct.id); ok(!tue, 'an editor changes a balance (an audit-trail row in their name)')
  const { data: txn } = await owner.from('transactions').insert({ household_id: hh, date: '2026-01-03', kind: 'expense', amount: 7, account_id: acct.id, status: 'cleared', source: 'manual', payee: 'E2E' }).select('id').single()
  const { error: tce } = await tmp.from('transaction_comments').insert({ household_id: hh, transaction_id: txn.id, body: 'e2e comment', author_email: TMP }); ok(!tce, '…and comments on a transaction ' + (tce?.message || ''))
  const { error: upe } = await tmp.storage.from('attachments').upload(FILE, PNG, { contentType: 'image/png' }); ok(!upe, '…and attaches a receipt (a file in their name) ' + (upe?.message || ''))
  // alert settings (0.25.1): an editor saves their own row; an address an owner typed for them stays when they change something else
  const T = tmpUser.id, OTHER = 'e2e-tmp-elsewhere@wealthpilot.test'
  const { error: own } = await saveRow(tmp, T, { email: true }); ok(!own, 'an editor saves their own alert choices ' + (own?.message || ''))
  await saveRow(owner, T, { email: true, email_to: OTHER })
  const { error: keep } = await saveRow(tmp, T, { email: true, email_to: OTHER, digest: false }); ok(!keep, '…and changes one while keeping the address an owner typed for them ' + (keep?.message || ''))
  ok(await refused(saveRow(tmp, T, { email: true, email_to: 'e2e-someone-else@wealthpilot.test' })), '…but cannot send their alerts to someone else\'s address')
  ok(await refused(saveRow(tmp, ownerUser.user.id, { email: false })), '…nor change another member\'s')
  { const { data: cur } = await tmp.from('households').select('settings').eq('id', hh).single(); ok(await refused(tmp.from('households').update({ settings: { ...cur.settings, notify: { ...(cur.settings.notify || {}), large: 1 } } }).eq('id', hh).select('id')), '…nor the household\'s alert switches') }
  const tp = await tmp.functions.invoke('delete-account', { body: { action: 'preview' } })
  ok(!tp.error && tp.data?.solo?.some(h => h.id === solo) && tp.data?.shared?.some(h => h.id === hh), 'the preview lists the household deleted with the account and the one left behind')
  ok(!!(await tmp.functions.invoke('delete-account', { body: { action: 'delete', password: 'not the password' } })).error, 'a wrong password deletes nothing')
  const del = await tmp.functions.invoke('delete-account', { body: { action: 'delete', password: PW } })
  ok(!del.error && del.data?.ok === true && del.data.households_deleted === 1, 'deleting the account works ' + (del.error ? await del.error.context?.text?.() : ''))
  const relog = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } }); ok(!!(await relog.auth.signInWithPassword({ email: TMP, password: PW })).error, '…its sign-in is gone')
  const { data: trail } = await owner.from('audit_events').select('user_id, user_email').eq('account_id', acct.id).eq('user_email', 'a former member')
  ok((trail || []).length >= 1 && trail.every(t => t.user_id === null), 'the shared household keeps its history, with "a former member" in place of the person')
  const { data: cm } = await owner.from('transaction_comments').select('author_email, created_by').eq('transaction_id', txn.id)
  ok(cm?.length === 1 && cm[0].author_email === 'a former member' && cm[0].created_by === null, '…and their comment stays, unsigned')
  ok(((await owner.from('household_members').select('user_id').eq('household_id', hh)).data || []).every(m => m.user_id !== tmpUser.id), '…and they are no longer a member')
  const { data: kept, error: ke } = await owner.storage.from('attachments').download(FILE); ok(!ke && kept?.size > 0, '…the receipt they attached stays with the household ' + (ke?.message || ''))
  const nt = await notifyOf(); ok(!(T in (nt.members || {})), '…and their alert choices are gone')
} catch (e) { ok(false, 'account deletion checks stopped: ' + (e?.message || e)) }
await owner.storage.from('attachments').remove([FILE]).catch(() => { /* nothing was uploaded */ })
// an account with balance history (and audit rows) can be deleted (before 0019 the immutable audit trail refused)
const { data: acct2 } = await owner.from('accounts').insert({ household_id: hh, name: 'E2E Old card', kind: 'credit_card', balance: 10, balance_as_of: new Date().toISOString().slice(0, 10), include_in_cash: false, include_in_net_worth: true, status: 'Active' }).select().single()
await owner.from('accounts').update({ balance: 20 }).eq('id', acct2.id)
const { error: dae } = await owner.from('accounts').delete().eq('id', acct2.id); ok(!dae, 'an account with balance history can be deleted ' + (dae?.message || ''))

// --- deleting a household ---
ok(!!(await owner.rpc('request_household_deletion', { p_household: hh, p_confirm: 'not the name' })).error, 'deletion needs the household\'s exact name')
const { data: when, error: de } = await owner.rpc('request_household_deletion', { p_household: hh, p_confirm: NAME.toLowerCase() })
ok(!de && Math.round((Date.parse(when) - Date.now()) / 86400000) === 7, 'deletion is scheduled 7 days out ' + (de?.message || ''))
ok(await refused(owner.from('transactions').insert({ household_id: hh, date: '2026-01-02', kind: 'expense', amount: 5, account_id: acct.id, status: 'cleared', source: 'manual' }).select('id')), 'while a deletion is pending even an owner cannot change data')
await owner.from('households').update({ deletion_scheduled_for: new Date().toISOString() }).eq('id', hh)   // refused (no error: the row is simply not writable)
const { data: still } = await owner.from('households').select('deletion_scheduled_for').eq('id', hh).single()
ok(Date.parse(still?.deletion_scheduled_for) === Date.parse(when), 'the deletion date cannot be moved up by hand')

// --- the app in a browser ---
const root = fileURLToPath(new URL('../dist-staging', import.meta.url)); const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png' }
const isFile = f => { try { return statSync(f).isFile() } catch { return false } }
const srv = createServer((req, res) => { let p = join(root, req.url.split('?')[0].split('#')[0]); if (!isFile(p)) p = join(root, 'index.html'); res.setHeader('Content-Type', types[extname(p)] || 'text/plain'); res.end(readFileSync(p)) }).listen(4176)
mkdirSync('e2e/shots', { recursive: true })
const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}); const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } }); const p = await ctx.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message))
try {
  await p.goto('http://localhost:4176/'); await p.waitForTimeout(800); await p.evaluate(h => { localStorage.clear(); localStorage.setItem('wealthpilot.household', h) }, hh); await p.reload(); await p.waitForTimeout(600)
  await p.fill('#email', OWNER); await p.fill('#pw', PW); await p.click('button:has-text("Sign in")'); await p.waitForTimeout(4500)
  ok((await p.locator('h1').first().textContent()) === 'Dashboard', 'the owner signs in and opens the household')
  ok(/permanently deleted on/.test(await p.locator('[data-testid="deletion-banner"]').textContent().catch(() => '')), 'every member sees the deletion date')
  await p.click('[data-testid="deletion-banner"] button:has-text("Cancel the deletion")'); await p.waitForTimeout(2000)
  ok((await p.locator('[data-testid="deletion-banner"]').count()) === 0, 'an owner cancels the deletion from the banner')
  ok(!(await owner.from('households').select('deletion_scheduled_for').eq('id', hh).single()).data?.deletion_scheduled_for, '…and the database agrees')
  await p.goto('http://localhost:4176/#/transactions'); await p.waitForTimeout(1500); const n0 = await p.locator('table.tbl tbody tr').count()
  await p.click('text=+ Add transaction'); await p.waitForTimeout(400); await p.fill('input[placeholder="0.00"]', '19.99'); await p.fill('input[placeholder="Kroger, Landlord, Employer…"]', 'E2E payee'); await p.click('.modal button:has-text("Save")'); await p.waitForTimeout(2500)
  await p.reload(); await p.waitForTimeout(4000); const n1 = await p.locator('table.tbl tbody tr').count(); ok(n1 === n0 + 1, `a transaction saved in the app is still there after a reload (${n0} → ${n1})`)
  await p.goto('http://localhost:4176/#/accounts'); await p.waitForTimeout(1500); await p.click('button[aria-label="Balance history for E2E Checking"]'); await p.waitForTimeout(900)
  ok(/Balance history — E2E Checking/.test(await p.locator('.modal').textContent()), 'the History dialog reads the database\'s balance history'); await p.keyboard.press('Escape')
  // offline: the copy this device kept opens read-only, then the app comes back by itself. The database is cut off rather than the
  // whole network: on https the service worker serves the app itself offline, but browsers only run it on https, and this server is http.
  await p.goto('http://localhost:4176/#/'); await p.waitForTimeout(2500)
  const cut = r => r.abort('internetdisconnected'); await p.route('**/*.supabase.co/**', cut); await p.reload()
  await p.locator('[data-testid="offline-banner"]').waitFor({ timeout: 20000 }).catch(() => {})   // the sign-in check retries before giving up
  const ob = await p.locator('[data-testid="offline-banner"]').count(), oh = await p.locator('h1').first().textContent().catch(() => '(no heading)')
  ok(ob === 1 && oh === 'Dashboard', `with no connection the app opens from this device's copy, read-only (banner ${ob}, page ${oh})`)
  await p.unroute('**/*.supabase.co/**', cut); await p.evaluate(() => window.dispatchEvent(new Event('online')))
  await p.locator('[data-testid="offline-banner"]').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
  ok((await p.locator('[data-testid="offline-banner"]').count()) === 0, 'back online, the banner goes and the data reloads')
  await p.screenshot({ path: 'e2e/shots/staging_dashboard.png' })
  // signing out clears the copy
  await p.evaluate(async () => { const r = indexedDB.open('wealthpilot-offline'); await new Promise(res => { r.onsuccess = res; r.onerror = res }) })
} finally {
  ok(!errors.length, 'no page errors ' + errors.join(' | '))
  await b.close(); srv.close()
  // deleting the household row takes every table with it (the nightly purge does the same, as the service role)
  const { data: gone, error: ce } = await owner.rpc('e2e_cleanup'); ok(!ce && gone >= 1, `deleting a household removes it and everything in it (${gone ?? 0}) ${ce?.message || ''}`)
}
console.log('db fails', F); process.exit(F ? 1 : 0)
