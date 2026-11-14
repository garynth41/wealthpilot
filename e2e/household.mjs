// Signing in and switching households (0.29.1), the whole app in a real browser. On Nov 14 a sign-in showed "Welcome — Create household"
// for the few seconds it took to read the household list; one click there made a second, empty household and opened it instead of the
// real one. Here the invite step answers slowly on purpose, and the create button must never appear for someone who has a household.
// Also: someone with two households opens the other from Settings; a person who owes a two-factor code gets the code prompt, not the
// welcome screen; a brand-new person still gets the create form.
//
// The built app points at production Supabase (.env.example), so EVERY request to *.supabase.co is answered here by a small stand-in
// server and nothing is ever passed through; anything else that is not this local site is refused. Everyone here is a test fixture that
// exists only inside this file.
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFileSync, statSync, mkdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 4176, SITE = `http://localhost:${PORT}/`
const root = fileURLToPath(new URL('../dist', import.meta.url)); mkdirSync('e2e/shots', { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2' }
const isFile = f => { try { return statSync(f).isFile() } catch { return false } }
const srv = createServer((req, res) => { let p = join(root, decodeURIComponent(req.url.split('?')[0].split('#')[0])); if (!isFile(p)) p = join(root, 'index.html'); res.setHeader('Content-Type', types[extname(p)] || 'application/octet-stream'); res.end(readFileSync(p)) }).listen(PORT)
let F = 0; const ok = (c, m) => { if (!c) F++; console.log((c ? 'PASS ' : 'FAIL ') + m) }

// --- the stand-in server ---
const TWO = { id: '00000000-0000-4000-8000-00000000d001', email: 'two-households@cresari.test' }
const CODE = { id: '00000000-0000-4000-8000-00000000d002', email: 'two-factor@cresari.test', totp: true }
const FRESH = { id: '00000000-0000-4000-8000-00000000d003', email: 'brand-new@cresari.test' }
const SHAKY = { id: '00000000-0000-4000-8000-00000000d004', email: 'shaky@cresari.test' }   // their household fails to load once
const PEOPLE = [TWO, CODE, FRESH, SHAKY]
let shakyFails = 1
const HH = { first: { id: '00000000-0000-4000-8000-0000000000e1', name: 'Fixture Main household' }, second: { id: '00000000-0000-4000-8000-0000000000e2', name: 'Fixture Rental household' } }
const memberOf = u => u?.id === TWO.id ? [HH.first, HH.second] : u?.id === CODE.id || u?.id === SHAKY.id ? [HH.first] : []
const INVITES_MS = 2500   // accepting invites answers slowly, as it can on a busy day — the window the bad click landed in
const now = () => Math.floor(Date.now() / 1000)
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const token = u => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', aal: 'aal1', amr: [{ method: 'password', timestamp: now() }], session_id: 's-' + u.id, iat: now(), exp: now() + 86400 })}.c2ln`   // a well-formed (unsigned) token: the library checks the shape before it reads the two-factor level
const userObj = u => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: '2026-11-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-11-01T00:00:00Z',
  factors: u.totp ? [{ id: 'factor-' + u.id, factor_type: 'totp', status: 'verified', friendly_name: 'phone', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' }] : [] })
const session = u => ({ access_token: token(u), token_type: 'bearer', expires_in: 86400, expires_at: now() + 86400, refresh_token: 'refresh-' + u.id, user: userObj(u) })
const whoIs = auth => { try { const sub = JSON.parse(Buffer.from((auth.split(' ')[1] || '').split('.')[1] || '', 'base64url').toString()).sub; return PEOPLE.find(u => u.id === sub) || null } catch { return null } }
const household = h => ({ id: h.id, name: h.name, currency: 'USD', settings: {}, created_at: '2026-11-01T00:00:00Z' })
const hits = []

async function standIn(route) {
  const req = route.request(), url = new URL(req.url()), p = url.pathname, method = req.method(), who = whoIs(req.headers()['authorization'] || '')
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
  const json = (body, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
  hits.push(`${method} ${p}`)
  const body = (() => { try { return JSON.parse(req.postData() || '{}') } catch { return {} } })()
  const wantsOne = /vnd\.pgrst\.object/.test(req.headers()['accept'] || '')
  const eq = k => (url.searchParams.get(k) || '').replace(/^eq\./, '')
  if (p === '/auth/v1/token') { const u = PEOPLE.find(x => x.email === body.email); return u ? json(session(u)) : json({ code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400) }
  if (p === '/auth/v1/user') return who ? json(userObj(who)) : json({ code: 'bad_jwt', msg: 'not signed in' }, 401)
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors })
  if (p.startsWith('/auth/v1/') || p.startsWith('/functions/v1/')) return json({})
  if (p === '/rest/v1/rpc/accept_invites') { await new Promise(r => setTimeout(r, INVITES_MS)); return json(0) }
  if (p === '/rest/v1/rpc/create_household') return json('00000000-0000-4000-8000-0000000000ff')   // recorded in hits; must not happen for someone with a household
  if (p.startsWith('/rest/v1/rpc/')) return json(null)
  if (p === '/rest/v1/household_members' && method === 'GET') {
    const mine = memberOf(who), hid = eq('household_id')
    if (hid) return json(mine.some(h => h.id === hid) ? [{ household_id: hid, user_id: who.id, role: 'owner', read_only: false, modules: null }] : [])
    return json(mine.map(h => ({ household_id: h.id, role: 'owner', households: { name: h.name } })))
  }
  if (p === '/rest/v1/households' && method === 'GET' && who?.id === SHAKY.id && shakyFails > 0) { shakyFails--; return json({ code: 'XX000', message: 'the database is busy' }, 500) }
  if (p === '/rest/v1/households' && method === 'GET') { const h = memberOf(who).find(x => x.id === eq('id')); return h ? json(wantsOne ? household(h) : [household(h)]) : json({ code: 'PGRST116', message: 'no rows' }, 406) }
  if (method === 'GET' || method === 'HEAD') return wantsOne ? json({ code: 'PGRST116', message: 'no rows' }, 406) : json([])
  return json([], 201)   // writes (last seen, error reports) are accepted and dropped
}

const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const errors = []
const fresh = async () => {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 950 }, serviceWorkers: 'block', timezoneId: 'America/New_York' })
  await ctx.route(u => /\.supabase\.co$/.test(u.hostname), standIn)                                           // answered here, never passed on
  await ctx.route(u => u.origin !== `http://localhost:${PORT}` && !/\.supabase\.co$/.test(u.hostname), r => r.abort())   // nothing else leaves
  await ctx.routeWebSocket(/supabase\.co/, () => {})                                                         // realtime: accepted, silent
  const pg = await ctx.newPage(); pg.on('pageerror', e => errors.push(e.message)); return { ctx, pg }
}
const signIn = async (pg, u) => { await pg.locator('#email').waitFor({ timeout: 15000 }); await pg.fill('#email', u.email); await pg.fill('#pw', 'test-fixture-only'); await pg.locator('form button[type=submit]').click() }
const eyebrow = pg => pg.locator('.topbar .eyebrow').first().textContent().catch(() => '')
const onDashboard = pg => pg.waitForFunction(() => document.querySelector('h1')?.textContent === 'Dashboard', null, { timeout: 20000 }).then(() => true, () => false)

try {
  // 1. someone with households signs in while the invite step is slow: never a create button, then their household opens
  { const { ctx, pg } = await fresh(); await pg.goto(SITE); await signIn(pg, TWO)
    let sawCreate = false, sawOpening = false; const until = Date.now() + INVITES_MS + 15000
    while (Date.now() < until) {
      if (await pg.locator('button', { hasText: /Create (household|this household)/ }).count()) sawCreate = true
      if (await pg.getByText('Opening your household').count()) sawOpening = true
      if (await pg.locator('h1', { hasText: 'Dashboard' }).count()) break
      await pg.waitForTimeout(100)
    }
    ok(sawOpening && !sawCreate, `while the household list is read, the screen says "Opening your household…" and offers no Create household (opening ${sawOpening}, create ${sawCreate})`)
    ok(await onDashboard(pg) && (await eyebrow(pg)).includes(HH.first.name), `then the household opens on the Dashboard (${await eyebrow(pg)})`)
    ok(!hits.includes('POST /rest/v1/rpc/create_household'), 'no household was created')

    // 2. the other household opens from Settings → General, and stays the one opened next time
    await pg.evaluate(() => { location.hash = '#/settings' }); await pg.locator('h1', { hasText: 'Settings' }).waitFor({ timeout: 15000 })
    const other = pg.locator('button', { hasText: `Open ${HH.second.name}` })
    ok(await other.count() === 1 && await pg.locator('button', { hasText: `Open ${HH.first.name}` }).count() === 0, 'Settings → General offers the other household (and not the one already open)')
    await pg.screenshot({ path: 'e2e/shots/household_switch.png' })
    await other.click()
    ok(await onDashboard(pg) && (await eyebrow(pg)).includes(HH.second.name), `opening it goes to its Dashboard (${await eyebrow(pg)})`)
    await pg.reload(); await onDashboard(pg)
    ok((await eyebrow(pg)).includes(HH.second.name), `a reload opens the household used last (${await eyebrow(pg)})`)
    await pg.evaluate(() => { location.hash = '#/settings' }); await pg.locator('h1', { hasText: 'Settings' }).waitFor({ timeout: 15000 })
    await pg.locator('button', { hasText: `Open ${HH.first.name}` }).click()
    ok(await onDashboard(pg) && (await eyebrow(pg)).includes(HH.first.name), 'and the first one opens again the same way')
    await ctx.close() }

  // 3. someone who owes a two-factor code gets the code prompt — not the welcome screen
  { const { ctx, pg } = await fresh(); await pg.goto(SITE); await signIn(pg, CODE)
    const prompt = await pg.locator('h2', { hasText: 'Two-factor code' }).waitFor({ timeout: 15000 }).then(() => true, () => false)
    const seen = prompt ? '' : ` — saw: ${(await pg.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160)}`
    ok(prompt && await pg.getByText('Welcome').count() === 0 && await pg.locator('button', { hasText: /Create/ }).count() === 0, 'a two-factor account is asked for its code, with no welcome screen or Create household' + seen)
    await ctx.close() }

  // 4. a brand-new person still gets the create form, once the (empty) list is read
  { const { ctx, pg } = await fresh(); await pg.goto(SITE); await signIn(pg, FRESH)
    const form = await pg.locator('button', { hasText: 'Create household' }).waitFor({ timeout: INVITES_MS + 15000 }).then(() => true, () => false)
    ok(form && (await pg.locator('h2').first().textContent()).startsWith('Welcome'), 'someone with no household yet sees Welcome and Create household')
    await pg.screenshot({ path: 'e2e/shots/household_welcome.png' })
    await ctx.close() }

  // 5. a household that fails to open keeps a way forward: Try again opens it (and Sign out is there)
  { const { ctx, pg } = await fresh(); await pg.goto(SITE); await signIn(pg, SHAKY)
    const err = await pg.getByRole('alert').filter({ hasText: 'the database is busy' }).waitFor({ timeout: INVITES_MS + 15000 }).then(() => true, () => false)
    ok(err && await pg.locator('button', { hasText: 'Try again' }).count() === 1 && await pg.locator('button', { hasText: 'Sign out' }).count() === 1, 'a household that cannot be opened shows why, with Try again and Sign out')
    await pg.locator('button', { hasText: 'Try again' }).click()
    ok(await onDashboard(pg) && (await eyebrow(pg)).includes(HH.first.name), 'Try again opens it once the database answers')
    await ctx.close() }

  ok(hits.includes('POST /rest/v1/rpc/accept_invites') && !hits.includes('POST /rest/v1/rpc/create_household'), `the app talked only to the stand-in server (${hits.length} requests answered here) and created nothing`)
} finally {
  ok(!errors.length, 'no page errors ' + errors.slice(0, 3).join(' | '))
  console.log('household fails', F); await b.close(); srv.close()
}
process.exit(F ? 1 : 0)
