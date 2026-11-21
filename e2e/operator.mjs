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
const hits = [], asks = [], sorts = []
// 0.34.0: two categories and two transactions nobody can place — one of them a payment to a person — for Ask AI on Review uncategorized
const ST = { household_id: HH, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z' }
const CATS = [{ ...ST, id: '00000000-0000-4000-8000-0000000000d1', name: 'Gifts', kind: 'expense' }, { ...ST, id: '00000000-0000-4000-8000-0000000000d2', name: 'Side income', kind: 'income' }]
  .map((c, i) => ({ ...c, ref: null, group: null, priority: 'want', cost_type: 'variable', default_budget: 0, budget_cadence: 'monthly', rollover: false, color: null, icon: null, sort_order: i, archived: false, notes: null }))
const TXNS = [{ id: '00000000-0000-4000-8000-0000000000e1', payee: 'ZELLE TO J MARTINEZ 4471', amount: 60, kind: 'expense' }, { id: '00000000-0000-4000-8000-0000000000e2', payee: 'QZX HOLDINGS', amount: 310, kind: 'expense' }]
  .map(t => ({ ...ST, ...t, ref: null, date: '2026-11-10', account_id: null, to_account_id: null, category_id: null, memo: 'private note', tags: [], status: 'cleared', source: 'import', recurring_id: null, pay_schedule_id: null, goal_id: null, email_item_id: null, external_id: 'fx:' + t.id, exclude_from_budget: false, duplicate_of: null }))

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
  // Ask Cresari (0.32.0): the tester has access (20 a day, 16 used); the function answers three questions and refuses the fourth at the limit
  if (p === '/functions/v1/ask-cresari' && body.task === 'categorize') { sorts.push(body); return json({ picks: [{ item: body.items.findIndex(i => /ZELLE/.test(i.text)), category: 0, sure: false }, { item: 9, category: 0, sure: true }], limit: 20, used: 16 }) }
  if (p === '/functions/v1/ask-cresari') { asks.push(body); return asks.length <= 3 ? json({ answer: 'You spent **$412** on dining out.\n\n1. Set a weekly limit\n2. Review it on Sunday', limit: 20, used: 16 + asks.length }) : json({ error: 'That is your 20 questions for today — more are available tomorrow', limit: 20, used: 20 }, 429) }
  if (p.startsWith('/auth/v1/') || p.startsWith('/functions/v1/')) return json({})
  if (p === '/rest/v1/rpc/ai_status') return json(who?.id === TESTER.id ? { allowed: true, limit: 20, used: 16 } : { allowed: who?.id === OPERATOR.id, limit: 20, used: 0 })
  if (p === '/rest/v1/rpc/ai_admin_overview') return who?.id === OPERATOR.id ? json({ access: 'testers', daily_limit: 20, global_daily: 500, model: 'claude-sonnet-5-5', used_24h: 19, used_30d: 140, tokens_30d: 512000, people: [{ user_id: TESTER.id, email: TESTER.email, daily_limit: null, added_at: '2026-11-20T00:00:00Z', used_24h: 19, used_30d: 60 }] }) : json({ code: '42501', message: 'operator only' }, 403)
  if (p === '/rest/v1/rpc/is_app_admin') { if (who?.id === OPERATOR.id) { await new Promise(r => setTimeout(r, OPERATOR_CHECK_MS)); return json(true) } return json(false) }
  if (p === '/rest/v1/rpc/feedback_inbox') return who?.id === OPERATOR.id ? json(body.p_before ? [] : [NOTE]) : json({ code: '42501', message: 'Only the app operator can open the feedback inbox' }, 403)
  if (p === '/rest/v1/rpc/tester_stats') return who?.id === OPERATOR.id ? json([{ tester: 'church', signed_up: 1, active_7d: 1, households: 1, feedback: 1 }]) : json({ code: '42501', message: 'operator only' }, 403)
  if (p.startsWith('/rest/v1/rpc/')) return json(null)
  if (p === '/rest/v1/categories' && method === 'GET' && who?.id === TESTER.id) return json(CATS)
  if (p === '/rest/v1/transactions' && method === 'GET' && who?.id === TESTER.id) return json(TXNS)
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

  // 1a. Ask AI on Review uncategorized (0.34.0): nothing leaves on the first press — the notice lists what would; the second press sends it
  await one.evaluate(() => { location.hash = '#/transactions?review=1' }); const rv = one.locator('.modal[role=dialog]'); await rv.waitFor({ timeout: 10000 }).catch(() => {})
  await rv.locator('button', { hasText: 'Ask AI about' }).waitFor({ timeout: 8000 }).catch(() => {})
  ok(/Ask AI about the 2/.test(await rv.locator('button', { hasText: 'Ask AI about' }).innerText().catch(() => '')) && await rv.locator('.ru-item').count() === 2, 'Review uncategorized offers Ask AI for the two merchants the app could not place')
  await rv.locator('button', { hasText: 'Ask AI about' }).click(); const notice = await rv.locator('[data-ru=ai-notice]').innerText().catch(() => '')
  ok(sorts.length === 0 && /Claude, made by Anthropic/.test(notice) && /payments to people/.test(notice) && /a person's name in one is sent/.test(notice) && /ZELLE TO J MARTINEZ/.test(await rv.locator('[data-ru=ai-sent]').innerText()), 'the first press sends nothing: it names the AI service, says payments to people are included, and lists the descriptions')
  await rv.locator('button', { hasText: 'Send these' }).click(); await rv.locator('[data-ru=ai-msg]').waitFor({ timeout: 8000 }).catch(() => {})
  const sb0 = sorts[0] || {}, sent0 = JSON.stringify(sb0)
  ok(sorts.length === 1 && sb0.household_id === HH && sb0.items?.length === 2 && sb0.items.some(i => i.text === 'ZELLE TO J MARTINEZ 4471' && i.kind === 'expense' && i.amount === 60) && sb0.categories?.length === 2 && !/private note|2026-11-10|0000000000[de]\d|cresari\.test/.test(sent0),
    'what went: two descriptions (the payment to a person among them) with side and amount, and the category names — no ids, dates, notes or email address')
  const zel = rv.locator('.ru-item', { hasText: 'ZELLE' }), qzx = rv.locator('.ru-item', { hasText: 'QZX' })
  ok(/suggested a category for 1 of 2/.test(await rv.locator('[data-ru=ai-msg]').innerText().catch(() => '')) && /AI/.test(await zel.locator('.pill').innerText().catch(() => '')) && /Gifts/.test(await zel.locator('select').evaluate(el => el.options[el.selectedIndex].text)) && /not sure/.test(await zel.innerText()) && /your pick/i.test(await qzx.innerText()) && await qzx.locator('button', { hasText: 'Accept' }).isDisabled() && await rv.locator('button', { hasText: 'Ask AI about' }).count() === 0,
    'the reply fills in a suggestion marked AI (Gifts, "not sure") and files nothing; a pick for something that was not sent is ignored; the other merchant stays yours and is not offered to the AI again')
  await one.screenshot({ path: 'e2e/shots/review_ai.png' })
  await rv.locator('button', { hasText: 'Done' }).click(); await one.waitForTimeout(200)

  // 1b. Ask Cresari (0.32.0): open to this tester — agree once, ask, read the answer, and be told plainly at the daily limit
  await one.evaluate(() => { location.hash = '#/' }); await one.locator('[data-testid=ask-btn], [data-testid=ask-icon]').first().waitFor({ timeout: 10000 }).catch(() => {})
  ok((await one.locator('[data-testid=ask-btn]:visible, [data-testid=ask-icon]:visible').count()) >= 1, 'a tester the advisor is open to sees the Ask button')
  await one.locator('[data-testid=ask-btn]:visible, [data-testid=ask-icon]:visible').first().click(); const dlg = one.locator('.modal[role=dialog]'); await dlg.waitFor({ timeout: 5000 })
  ok(/not licensed financial/.test(await dlg.innerText()) && await dlg.locator('[data-ask=consent]').count() === 1 && await dlg.locator('textarea').count() === 0 && /Claude, made by Anthropic/.test(await dlg.locator('[data-ask=consent]').innerText()), 'before the first question the screen says it is guidance, names the AI service, and asks for agreement — no question box yet')
  await dlg.locator('[data-ask=consent] button').click(); await dlg.locator('textarea').waitFor({ timeout: 3000 })
  ok(/4 of 20 questions left today/.test(await dlg.locator('[data-ask=left]').innerText()) && await dlg.locator('.chipbtn').count() >= 3, 'after agreeing: the question box, starter questions and what is left of today\'s limit')
  await dlg.locator('textarea').fill('How much do I spend on eating out?'); await dlg.locator('.ask-form button[type=submit]').click(); await dlg.locator('[data-ask=answer]').waitFor({ timeout: 8000 }).catch(() => {})
  const a1 = dlg.locator('[data-ask=answer]').first()
  ok(await a1.locator('b').innerText().catch(() => '') === '$412' && await a1.locator('ol li').count() === 2 && !/\*\*/.test(await a1.innerText()) && /3 of 20/.test(await dlg.locator('[data-ask=left]').innerText()), 'the answer is shown with its bold figure and numbered steps, and the count goes down')
  const sentBody = asks[0] || {}, ctxSent = (() => { try { return JSON.parse(sentBody.context) } catch { return null } })()
  ok(sentBody.household_id === HH && sentBody.question === 'How much do I spend on eating out?' && sentBody.detail === false && ctxSent && Array.isArray(ctxSent.accounts) && ctxSent.transactions === undefined && !JSON.stringify(sentBody).includes('cresari.test') && !JSON.stringify(sentBody).includes('Test household'),
    'what went to the function: the question and the summary — no email address, no household name, no transactions unless switched on')
  // the transactions switch, switched off, starts the conversation over — the earlier answer is not sent along as history. On this screen:
  await dlg.locator('[data-ask=detail]').check(); const hadAnswer = await dlg.locator('[data-ask=answer]').count()
  await dlg.locator('[data-ask=detail]').uncheck(); await one.waitForTimeout(150)
  const clearedHere = hadAnswer === 1 && await dlg.locator('[data-ask=answer]').count() === 0 && /started over/.test(await dlg.locator('.ask-sent').innerText())
  await dlg.locator('textarea').fill('And on groceries?'); await dlg.locator('.ask-form button[type=submit]').click(); await dlg.locator('[data-ask=answer]').waitFor({ timeout: 8000 }).catch(() => {})
  ok(clearedHere && asks.length === 2 && Array.isArray(asks[1].history) && asks[1].history.length === 0 && asks[1].detail === false, 'switching transactions off on the Ask screen starts the conversation over: the next question goes with no earlier turns')
  // …and in Settings → This device
  await dlg.getByRole('button', { name: 'Done' }).click(); await one.evaluate(() => { location.hash = '#/settings' })
  const sw = one.locator('label:has-text("Ask Cresari — include my recent transactions") input'); await sw.waitFor({ timeout: 8000 }).catch(() => {})
  await sw.check(); await sw.uncheck(); await one.waitForTimeout(150)
  await one.locator('[data-testid=ask-btn]:visible, [data-testid=ask-icon]:visible').first().click(); await dlg.locator('textarea').waitFor({ timeout: 5000 }).catch(() => {})
  const clearedThere = await dlg.locator('[data-ask=answer]').count() === 0
  await dlg.locator('textarea').fill('What about fuel?'); await dlg.locator('.ask-form button[type=submit]').click(); await dlg.locator('[data-ask=answer]').waitFor({ timeout: 8000 }).catch(() => {})
  ok(clearedThere && asks.length === 3 && Array.isArray(asks[2].history) && asks[2].history.length === 0, 'switching it off in Settings does the same: the conversation is gone when Ask is opened again, and the next question goes alone')
  await dlg.locator('textarea').fill('And on rent?'); await dlg.locator('.ask-form button[type=submit]').click(); await dlg.locator('.ask-err').waitFor({ timeout: 8000 }).catch(() => {})
  ok(/20 questions for today/.test(await dlg.locator('.ask-err').innerText().catch(() => '')) && await dlg.locator('[data-ask=answer]').count() === 1 && /0 of 20/.test(await dlg.locator('[data-ask=left]').innerText()) && await dlg.locator('textarea').isDisabled() && (asks[3]?.history || []).length === 2,
    'at the daily limit the reason is shown, the question is kept in the box, the earlier answer stays, and the conversation so far was sent along')
  await one.screenshot({ path: 'e2e/shots/ask_live.png' })
  await dlg.locator('button', { hasText: 'Done' }).click(); await one.waitForTimeout(200)

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
  const card = one.locator('.card', { hasText: 'who can use the advisor' }); await card.getByText(TESTER.email).waitFor({ timeout: 8000 }).catch(() => {})
  ok(await card.getByText(TESTER.email).count() === 1 && /19/.test(await card.locator('.kpi').first().innerText()) && await card.locator('#ai-model').inputValue() === 'claude-sonnet-5-5', 'the operator sees who has Ask Cresari, today\'s use, the limits and the model')
  await one.screenshot({ path: 'e2e/shots/operator_feedback.png', fullPage: true })

  ok(hits.includes('POST /rest/v1/rpc/feedback_inbox') && hits.includes('POST /rest/v1/rpc/is_app_admin'), `the app talked only to the stand-in server (${hits.length} requests answered here)`)
} finally {
  ok(!errors.length, 'no page errors ' + errors.slice(0, 3).join(' | '))
  console.log('operator fails', F); await b.close(); srv.close()
}
process.exit(F ? 1 : 0)
