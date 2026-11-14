// Operator account switch (0.29.0), the whole app in a real browser. Someone who is not the operator is signed in; they are signed out in
// another tab; the operator then signs in while the address is #/feedback. The page must wait for the operator check ("Checking that this
// is your page…") and then open Feedback & testers — not send the operator to the Dashboard with the previous person's "no".
//
// The built app points at production Supabase (.env.example), so EVERY request to *.supabase.co is answered here by a small stand-in
// server and nothing is ever passed through; anything else that is not this local site is refused. The two people are test fixtures that
// exist only inside this file.
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFileSync, statSync, mkdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 4175, SITE = `http://localhost:${PORT}/`
const root = fileURLToPath(new URL('../dist', import.meta.url)); mkdirSync('e2e/shots', { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2' }
const isFile = f => { try { return statSync(f).isFile() } catch { return false } }
const srv = createServer((req, res) => { let p = join(root, decodeURIComponent(req.url.split('?')[0].split('#')[0])); if (!isFile(p)) p = join(root, 'index.html'); res.setHeader('Content-Type', types[extname(p)] || 'application/octet-stream'); res.end(readFileSync(p)) }).listen(PORT)
let F = 0; const ok = (c, m) => { if (!c) F++; console.log((c ? 'PASS ' : 'FAIL ') + m) }

// --- the stand-in server ---
const TESTER = { id: '00000000-0000-4000-8000-00000000a001', email: 'tester@cresari.test' }
const OPERATOR = { id: '00000000-0000-4000-8000-00000000a002', email: 'operator@cresari.test' }
const HH = '00000000-0000-4000-8000-0000000000b1'
const now = () => Math.floor(Date.now() / 1000)
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const token = u => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', aal: 'aal1', amr: [{ method: 'password', timestamp: now() }], session_id: 's-' + u.id, iat: now(), exp: now() + 86400 })}.test`
const userObj = u => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: '2026-11-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {}, factors: [], created_at: '2026-11-01T00:00:00Z' })
const session = u => ({ access_token: token(u), token_type: 'bearer', expires_in: 86400, expires_at: now() + 86400, refresh_token: 'refresh-' + u.id, user: userObj(u) })
const whoIs = auth => { try { const sub = JSON.parse(Buffer.from((auth.split(' ')[1] || '').split('.')[1] || '', 'base64url').toString()).sub; return [TESTER, OPERATOR].find(u => u.id === sub) || null } catch { return null } }
const HOUSEHOLD = { id: HH, name: 'Test household', currency: 'USD', settings: {}, created_at: '2026-11-01T00:00:00Z' }
const NOTE = { id: '00000000-0000-4000-8000-0000000000c1', created_at: '2026-11-13T20:00:00Z', updated_at: '2026-11-13T20:00:00Z', kind: 'bug', rating: 3, message: 'Stand-in note: the budget total looks off', page: '/budget', app_version: '0.29.0', platform: 'web', device: 'Mac · Safari', screen: '1440×900', look: 'graphite light', demo: false, user_id: TESTER.id, email: null, tester: 'church', status: 'new', admin_note: null, issue_url: null, notified_at: null }
const OPERATOR_CHECK_MS = 2000   // the operator check answers slowly, so the "checking" state can be seen
const hits = []

async function standIn(route) {
  const req = route.request(), url = new URL(req.url()), p = url.pathname, method = req.method(), who = whoIs(req.headers()['authorization'] || '')
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
  const json = (body, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
  hits.push(`${method} ${p}`)
  const body = (() => { try { return JSON.parse(req.postData() || '{}') } catch { return {} } })()
  const wantsOne = /vnd\.pgrst\.object/.test(req.headers()['accept'] || '')
  if (p === '/auth/v1/token') { const u = [TESTER, OPERATOR].find(x => x.email === body.email); return u ? json(session(u)) : json({ code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400) }
  if (p === '/auth/v1/user') return who ? json(userObj(who)) : json({ code: 'bad_jwt', msg: 'not signed in' }, 401)
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors })
  if (p.startsWith('/auth/v1/') || p.startsWith('/functions/v1/')) return json({})
  if (p === '/rest/v1/rpc/is_app_admin') { if (who?.id === OPERATOR.id) { await new Promise(r => setTimeout(r, OPERATOR_CHECK_MS)); return json(true) } return json(false) }
  if (p === '/rest/v1/rpc/feedback_inbox') return who?.id === OPERATOR.id ? json(body.p_before ? [] : [NOTE]) : json({ code: '42501', message: 'Only the app operator can open the feedback inbox' }, 403)
  if (p === '/rest/v1/rpc/tester_stats') return who?.id === OPERATOR.id ? json([{ tester: 'church', signed_up: 1, active_7d: 1, households: 1, feedback: 1 }]) : json({ code: '42501', message: 'operator only' }, 403)
  if (p.startsWith('/rest/v1/rpc/')) return json(null)
  if (p === '/rest/v1/household_members' && method === 'GET') return json([{ household_id: HH, user_id: who?.id, role: 'owner', read_only: false, modules: null, households: { name: HOUSEHOLD.name } }])
  if (p === '/rest/v1/households' && method === 'GET') return json(wantsOne ? HOUSEHOLD : [HOUSEHOLD])
  if (method === 'GET' || method === 'HEAD') return wantsOne ? json({ code: 'PGRST116', message: 'no rows' }, 406) : json([])
  return json([], 201)   // writes (last seen, error reports) are accepted and dropped
}

const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 }, serviceWorkers: 'block', timezoneId: 'America/New_York' })
await ctx.route(u => /\.supabase\.co$/.test(u.hostname), standIn)                                           // answered here, never passed on
await ctx.route(u => u.origin !== `http://localhost:${PORT}` && !/\.supabase\.co$/.test(u.hostname), r => r.abort())   // nothing else leaves
await ctx.routeWebSocket(/supabase\.co/, () => {})                                                         // realtime: accepted, silent
const errors = []; const watch = pg => { pg.on('pageerror', e => errors.push(e.message)) }
const signIn = async (pg, u) => { await pg.locator('#email').waitFor({ timeout: 15000 }); await pg.fill('#email', u.email); await pg.fill('#pw', 'test-fixture-only'); await pg.locator('form button[type=submit]').click() }
const heading = pg => pg.locator('h1').first().textContent().catch(() => '')

try {
  // 1. a tester (not the operator) signs in; Feedback & testers is not theirs
  const one = await ctx.newPage(); watch(one)
  await one.goto(SITE); await signIn(one, TESTER)
  await one.waitForFunction(() => document.querySelector('h1')?.textContent === 'Dashboard', null, { timeout: 20000 }).catch(() => {})
  ok(await heading(one) === 'Dashboard', `a tester signs in and lands on the Dashboard (${await heading(one)})`)
  await one.evaluate(() => { location.hash = '#/feedback' })
  await one.waitForFunction(() => location.hash === '#/' || location.hash === '', null, { timeout: 10000 }).catch(() => {})
  ok(await one.evaluate(() => location.hash) !== '#/feedback' && (await one.locator('a[href="#/feedback"]').count()) === 0, 'for the tester, Feedback & testers is not in the menu and its address goes back to the Dashboard')

  // 2. signed out in another tab
  const two = await ctx.newPage(); watch(two)
  await two.goto(SITE); await two.waitForFunction(() => document.querySelector('h1')?.textContent === 'Dashboard', null, { timeout: 20000 }).catch(() => {})
  if (await two.locator('.app.rail-collapsed').count()) await two.click('.railToggle')   // the Terminal look keeps Sign out in the icon rail
  await two.locator('button:has-text("Sign out")').first().click()
  await one.locator('#email').waitFor({ timeout: 15000 }).catch(() => {})
  ok((await one.locator('#email').count()) === 1, 'signing out in another tab signs this tab out too (the sign-in form is back)')
  await two.close()

  // 3. the operator signs in here, with the address on Feedback & testers
  await one.evaluate(() => { location.hash = '#/feedback' })
  await signIn(one, OPERATOR)
  const checking = await one.getByText('Checking that this is your page').waitFor({ timeout: 15000 }).then(() => true, () => false)
  ok(checking && await one.evaluate(() => location.hash) === '#/feedback', 'while the operator check is out, the page waits on Feedback & testers instead of leaving for the Dashboard')
  await one.getByText(NOTE.message).waitFor({ timeout: OPERATOR_CHECK_MS + 15000 }).catch(() => {})
  const h = await heading(one), hash = await one.evaluate(() => location.hash)
  ok(h === 'Feedback & testers' && hash === '#/feedback' && (await one.getByText(NOTE.message).count()) === 1, `once the check says yes, Feedback & testers opens with the inbox (${h}, ${hash})`)
  ok((await one.locator('a[href="#/feedback"]').count()) >= 1, 'and the page is in the operator\'s menu')
  await one.screenshot({ path: 'e2e/shots/operator_feedback.png', fullPage: true })

  ok(hits.includes('POST /rest/v1/rpc/feedback_inbox') && hits.includes('POST /rest/v1/rpc/is_app_admin'), `the app talked only to the stand-in server (${hits.length} requests answered here)`)
} finally {
  ok(!errors.length, 'no page errors ' + errors.slice(0, 3).join(' | '))
  console.log('operator fails', F); await b.close(); srv.close()
}
process.exit(F ? 1 : 0)
