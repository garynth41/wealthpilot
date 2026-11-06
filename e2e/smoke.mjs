// Smoke: serve dist, open the offline demo, visit every page, click through core flows, catch console/page errors, screenshot each page.
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFileSync, statSync, mkdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../dist', import.meta.url)); mkdirSync('e2e/shots', { recursive: true })   // fileURLToPath: works on Windows too (URL.pathname gives "/C:/…")
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' }
const isFile = f => { try { return statSync(f).isFile() } catch { return false } }   // a directory path must fall back to index.html too (Windows: readFileSync on a dir throws EISDIR)
const srv = createServer((req, res) => { let p = join(root, decodeURIComponent(req.url.split('?')[0].split('#')[0])); if (!isFile(p)) p = join(root, 'index.html'); res.setHeader('Content-Type', types[extname(p)] || 'application/octet-stream'); res.end(readFileSync(p)) }).listen(4173)
let F = 0; const ok = (c, m) => { if (!c) F++; console.log((c ? 'PASS ' : 'FAIL ') + m) }
const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
for (const W of [1400, 390]) {
  const p = await b.newPage({ viewport: { width: W, height: W === 390 ? 844 : 950 }, timezoneId: 'America/New_York' }); const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|net::ERR|fonts.googleapis|Failed to load resource/.test(m.text())) errors.push(m.text()) })
  await p.goto('http://localhost:4173/'); await p.waitForTimeout(800); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(600)
  // 0.19.2: show/hide eye on the sign-in password box (hidden by default, toggles both ways, the eye never submits the form)
  if (await p.locator('#pw').count()) { await p.fill('#pw', 'hunter22'); const t0 = await p.getAttribute('#pw', 'type'); await p.click('.pwtoggle'); const t1 = await p.getAttribute('#pw', 'type'); await p.click('.pwtoggle'); const t2 = await p.getAttribute('#pw', 'type'); ok(t0 === 'password' && t1 === 'text' && t2 === 'password' && await p.inputValue('#pw') === 'hunter22', `${W}: password eye toggles hidden → shown → hidden (${t0}/${t1}/${t2})`); ok((await p.locator('.msg.crit').count()) === 0, `${W}: toggling the eye did not submit the form`); await p.fill('#pw', '') }
  await p.click('text=Open the offline demo'); await p.waitForTimeout(1200)
  ok(await p.locator('h1').first().textContent() === 'Dashboard', `${W}: demo opens on the Dashboard`)
  const pages = ['/forecast', '/budget', '/transactions', '/bills', '/income', '/accounts', '/debts', '/investments', '/goals', '/plan', '/tax', '/reports', '/insights', '/connections', '/trends', '/hardship', '/email', '/settings', '/']
  for (const path of pages) { await p.goto('http://localhost:4173/#' + path); await p.waitForTimeout(900); const h = await p.locator('h1').first().textContent(); const sw = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(h && sw <= 1, `${W}: ${path} renders "${h}" (sideways overflow ${sw}px)`); await p.screenshot({ path: `e2e/shots/${W}_${path.replace('/', '') || 'home'}.png`, fullPage: true }) }
  if (W === 1400) {
    // add a transaction
    await p.goto('http://localhost:4173/#/transactions'); await p.waitForTimeout(700); const before = await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.transactions.length)
    await p.click('text=+ Add transaction'); await p.waitForTimeout(300); await p.fill('input[placeholder="0.00"]', '42.50'); await p.fill('input[placeholder="Kroger, Landlord, Employer…"]', 'Test grocer'); await p.selectOption('.modal select >> nth=2', { label: 'Food › Groceries' }); await p.click('.modal button:has-text("Save")'); await p.waitForTimeout(600)
    const after = await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.transactions.length); ok(after === before + 1, 'adding a transaction stores it')
    const chk = await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.accounts.find(a => a.name === 'Huntington Checking').balance); ok(Math.abs(chk - (3184.22 - 42.5)) < 0.01, `checking balance moved by the expense (${chk})`)
    // budget: plan edit
    await p.goto('http://localhost:4173/#/budget'); await p.waitForTimeout(800); const inp = p.locator('table.tbl input.num').first(); await inp.fill('999'); await inp.blur(); await p.waitForTimeout(500)
    ok(await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.lines.some(l => l.planned === 999)), 'editing a planned amount saves the budget line')
    // bills: mark paid
    await p.goto('http://localhost:4173/#/bills'); await p.waitForTimeout(800); const nTx = await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.transactions.length)
    const mp = p.locator('button:has-text("Mark paid")').first(); if (await mp.count()) { await mp.click(); await p.waitForTimeout(300); await p.click('.modal button:has-text("Save")'); await p.waitForTimeout(600); ok(await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.transactions.length) === nTx + 1, 'Mark paid logs a transaction'); ok(await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.occurrences.some(o => o.status === 'paid')), 'and records the occurrence as paid') }
    // debts: record payment on Chase
    await p.goto('http://localhost:4173/#/debts'); await p.waitForTimeout(800); const bal0 = await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.accounts.find(a => a.name === 'Chase Freedom').balance)
    const rows = p.locator('table.tbl tr:has-text("Chase Freedom") button:has-text("Record payment")'); await rows.first().click(); await p.waitForTimeout(300); await p.click('.modal button:has-text("Minimum")'); await p.click('.modal button:has-text("Save payment")'); await p.waitForTimeout(600)
    const bal1 = await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.accounts.find(a => a.name === 'Chase Freedom').balance); ok(Math.abs(bal0 - bal1 - 41) < 0.01, `card balance reduced by the payment (${bal0} → ${bal1})`)
    // email: paste tester → review → apply
    await p.goto('http://localhost:4173/#/email'); await p.waitForTimeout(800); await p.click('text=Paste an email to test'); await p.waitForTimeout(300); await p.click('.modal button:has-text("Parse")'); await p.waitForTimeout(400)
    ok((await p.locator('.modal pre').textContent()).includes('"kind": "bill"'), 'paste tester parses a statement'); await p.click('.modal button:has-text("Close")'); await p.waitForTimeout(300)
    ok(await p.locator('.gm-row').count() === 1, 'review shows the proposal'); await p.click('button:has-text("Apply selected")'); await p.waitForTimeout(800)
    const chase = await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.accounts.find(a => a.name === 'Chase Freedom')); ok(chase.statement_balance === 1410.2 && chase.minimum_payment === 44, `applying the statement updated the card (${chase.statement_balance} / ${chase.minimum_payment})`)
    ok(await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.emailItems.length) === 1, 'email item filed')
    // goals: contribute
    await p.goto('http://localhost:4173/#/goals'); await p.waitForTimeout(800); const c0 = await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.contributions.length); await p.locator('button:has-text("+ Contribute")').first().click(); await p.waitForTimeout(300); await p.click('.modal button:has-text("Save")'); await p.waitForTimeout(600)
    ok(await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.contributions.length) === c0 + 1, 'goal contribution recorded')
    // settings: switch to pay periods then budget page follows
    await p.goto('http://localhost:4173/#/settings'); await p.waitForTimeout(600); await p.selectOption('select.inp >> nth=0', 'pay'); await p.click('button:has-text("Save settings")'); await p.waitForTimeout(600)
    await p.goto('http://localhost:4173/#/budget'); await p.waitForTimeout(800); ok((await p.locator('.card b').first().textContent()).startsWith('Pay period'), 'budget switches to pay periods'); await p.click('button:has-text("Start Pay period")').catch(() => {}); await p.waitForTimeout(700); ok(await p.locator('text=Spending plan').count() === 1, 'a pay-period budget starts from the previous period')
    await p.screenshot({ path: 'e2e/shots/1400_budget_pay.png', fullPage: true })
    // dark mode + back/forward
    // insights: scores render and the waste table links to transactions
    await p.goto('http://localhost:4173/#/insights'); await p.waitForTimeout(900); ok(/\/ 100/.test(await p.locator('.card').first().textContent()), 'insights shows a cash-flow score'); ok((await p.locator('table.tbl').count()) >= 2, 'insights renders merchant and subscription tables')
    // connections: import a CSV with one new row and one duplicate of an existing transaction
    const dupTx = await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.transactions.find(t => t.kind === 'expense' && t.payee && t.account_id))
    const chkId = await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.accounts.find(a => a.name === 'Huntington Checking').id)
    await p.goto('http://localhost:4173/#/connections'); await p.waitForTimeout(800); await p.selectOption('select.inp', chkId)
    const csv = `Date,Description,Amount\n${dupTx.date},${dupTx.payee},-${dupTx.amount}\n2026-10-02,SMOKE TEST GROCER,-12.34\n`
    await p.setInputFiles('input[type=file]', { name: 'stmt.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }); await p.waitForTimeout(600)
    ok((await p.locator('button:has-text("Review")').count()) === 1, 'csv columns auto-detected'); await p.click('button:has-text("Review")'); await p.waitForTimeout(400)
    ok(/Duplicates[^0-9]*1/.test(await p.locator('.kpis').last().textContent()), 'import review flags the duplicate'); const nBefore = await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.transactions.length)
    const chkBefore = await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.accounts.find(a => a.name === 'Huntington Checking').balance)
    await p.click('button:has-text("Import 1 transaction")'); await p.waitForTimeout(900)
    ok(await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.transactions.length) === nBefore + 1, 'import adds only the new row')
    ok(Math.abs(await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.accounts.find(a => a.name === 'Huntington Checking').balance) - (chkBefore - 12.34)) < 0.01, 'imported expense moved the checking balance')
    ok(await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.transactions.some(t => t.source === 'import' && t.external_id && t.external_id.startsWith('csv:'))), 'imported row carries a csv external id')
    // rules: adding a categorised transaction learns a rule; the Settings tab lists it; Auto-categorize applies it to an uncategorised row
    await p.goto('http://localhost:4173/#/transactions'); await p.waitForTimeout(700)
    await p.click('text=+ Add transaction'); await p.waitForTimeout(300); await p.fill('input[placeholder="0.00"]', '9.99'); await p.fill('input[placeholder="Kroger, Landlord, Employer…"]', 'Smoke Rule Mart'); await p.selectOption('.modal select >> nth=2', { label: 'Food › Groceries' }); await p.click('.modal button:has-text("Save")'); await p.waitForTimeout(600)
    const learned = await p.evaluate(() => (JSON.parse(localStorage.getItem('wealthpilot.demo')).household.settings.rules || []).find(r => r.pattern === 'smoke rule mart')); ok(!!learned && learned.source === 'learned', 'setting a category learns a payee rule')
    await p.click('text=+ Add transaction'); await p.waitForTimeout(300); await p.fill('input[placeholder="0.00"]', '4.44'); await p.fill('input[placeholder="Kroger, Landlord, Employer…"]', 'SMOKE RULE MART #2'); await p.locator('input[placeholder="Kroger, Landlord, Employer…"]').blur(); await p.waitForTimeout(200)
    ok((await p.locator('.modal').textContent()).includes('category set by your rule'), 'the add form applies the learned rule on payee blur'); await p.click('.modal button:has-text("Save")'); await p.waitForTimeout(500)
    await p.goto('http://localhost:4173/#/settings'); await p.waitForTimeout(500); await p.click('button:has-text("Payee rules")'); await p.waitForTimeout(400); ok((await p.locator('table.tbl input').evaluateAll(els => els.map(e => e.value))).includes('smoke rule mart'), 'Settings → Payee rules lists the learned rule')
    // table extras: export buttons + column picker exist on the ledger
    await p.goto('http://localhost:4173/#/transactions'); await p.waitForTimeout(700); ok((await p.locator('.tblhead button:has-text("CSV")').count()) >= 1 && (await p.locator('.tblhead button:has-text("Excel")').count()) >= 1, 'tables offer CSV and Excel export')
    await p.click('.tblhead button:has-text("Columns")'); await p.waitForTimeout(200); ok((await p.locator('.colpicker input[type=checkbox]').count()) > 3, 'column picker opens'); await p.click('.colpicker label:has-text("Memo") input'); await p.waitForTimeout(200); ok(!(await p.locator('table.tbl thead').textContent()).includes('Memo'), 'hiding a column removes it from the header'); await p.click('.tblhead button:has-text("Columns")')
    const [dlCsv] = await Promise.all([p.waitForEvent('download'), p.click('.tblhead button:has-text("CSV")')]); ok(/\.csv$/.test(dlCsv.suggestedFilename()), 'CSV export downloads a .csv')
    const [dlX] = await Promise.all([p.waitForEvent('download'), p.click('.tblhead button:has-text("Excel")')]); ok(/\.xlsx$/.test(dlX.suggestedFilename()), 'Excel export downloads a .xlsx')
    // 0.6.0: investments — holdings table, allocation pies, planner, Monte Carlo in a worker
    await p.goto('http://localhost:4173/#/investments'); await p.waitForTimeout(1500); const inv = await p.locator('main').textContent()
    ok(/Portfolio value/.test(inv) && /Retirement planner/.test(inv) && /Safe withdrawal/.test(inv), 'investments page renders portfolio, planner and SWR'); ok((await p.locator('.js-plotly-plot').count()) >= 4, 'allocation pies and projection chart render')
    ok((await p.locator('table.tbl input').evaluateAll(els => els.map(e => e.value))).some(v => /^(VTI|AAPL|FFFHX)$/.test(v)), 'holdings table lists demo positions')
    await p.click('button:has-text("Run simulation")'); await p.waitForFunction(() => /Success rate/.test(document.querySelector('main').textContent), null, { timeout: 20000 }); ok(/Success rate/.test(await p.locator('main').textContent()), 'Monte Carlo runs in a worker and reports a success rate')
    // 0.5.0: liquidity + allocation on Accounts; milestones + what-if on Goals
    await p.goto('http://localhost:4173/#/accounts'); await p.waitForTimeout(900); const acctText = await p.locator('main').textContent(); ok(/Months of essentials/.test(acctText) && /Goal allocation/i.test(acctText), 'Accounts shows liquidity and goal allocation'); ok(/Available/.test(await p.locator('table.tbl thead:has-text("Balance owed")').first().textContent()), 'cards table has an Available column')
    await p.goto('http://localhost:4173/#/goals'); await p.waitForTimeout(900); ok((await p.locator('.milestones').count()) >= 1, 'goal cards show milestones'); await p.click('button:has-text("What if")'); await p.waitForTimeout(300); ok((await p.locator('.modal input[type=range]').count()) === 2, 'what-if opens with two sliders'); await p.keyboard.press('Escape'); await p.waitForTimeout(200); const m = p.locator('.modal button:has-text("Close")'); if (await m.count()) await m.click()
    // 0.7.0 tax: estimate renders from the demo pay schedule; provisioning slider changes the projection
    await p.goto('http://localhost:4173/#/tax'); await p.waitForTimeout(900); const tx0 = await p.locator('.kpis').first().textContent(); ok(/Totaltax20\d\d\$[\d,]+/i.test(tx0.replace(/\s+/g, '')), 'tax page shows a total tax estimate')
    ok((await p.locator('main').textContent()).includes('Underpayment risk monitor'), 'tax page shows the risk monitor'); const after0 = await p.locator('.kpi:has-text("After changes") .v').textContent()
    const sl = p.locator('input[type=range]').nth(1); await sl.evaluate(el => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, '600'); el.dispatchEvent(new Event('input', { bubbles: true })) }); await p.locator('input[type=range]').nth(0).evaluate(el => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, '10'); el.dispatchEvent(new Event('input', { bubbles: true })) }); await p.waitForTimeout(300)
    ok((await p.locator('.kpi:has-text("After changes") .v').textContent()) !== after0, 'withholding slider changes the projected balance')
    // 0.8.0 reports + navigation
    await p.goto('http://localhost:4173/#/reports'); await p.waitForTimeout(1200); const rp = await p.locator('main').textContent(); ok(/monthly report/i.test(rp) && /Spending by category/.test(rp) && /Net worth/.test(rp), 'reports page builds a monthly report with every section')
    // 0.18.0: report packs, custom ranges and the ten new sections
    await p.click('.noprint .opts button:has-text("Everything")'); await p.waitForTimeout(900); const rpAll = await p.locator('main').textContent()
    ok(['Cash flow statement', 'Income', 'Top payees', 'Budget vs actual', 'Bills & subscriptions', '12-month trend', 'Account activity', 'Debt', 'Savings goals', 'Transaction detail'].every(t => rpAll.includes(t)) && (await p.locator('.report .card').count()) === 16, 'the "Everything" pack builds all 16 sections')
    await p.click('.seg button:has-text("Custom range")'); await p.waitForTimeout(300); await p.click('.noprint button:has-text("Last 90 days")'); await p.waitForTimeout(900)
    ok(/custom-range report/i.test(await p.locator('main').textContent()) && (await p.locator('input[type=date]').count()) === 2, 'a custom date range with quick picks builds a custom-range report')
    await p.click('.noprint .opts button:has-text("Monthly review")'); await p.waitForTimeout(600); ok((await p.locator('.report .card').count()) === 7, 'the "Monthly review" pack picks seven sections')
    const [dlR] = await Promise.all([p.waitForEvent('download'), p.click('.noprint button:has-text("CSV")')]); ok(/\.csv$/.test(dlR.suggestedFilename()), 'report CSV downloads'); const [dlRx] = await Promise.all([p.waitForEvent('download'), p.click('.noprint button:has-text("Excel")')]); ok(/\.xlsx$/.test(dlRx.suggestedFilename()), 'report Excel downloads')
    await p.click('button:has-text("Annual")'); await p.waitForTimeout(500); ok(/annual report/i.test(await p.locator('main').textContent()), 'switching to an annual report rebuilds it')
    const zones = (await p.locator('.nav .zone .zt').allTextContents()); ok(['Spending Intelligence', 'Account Balances', 'Cash & Account Operations', 'Investments & Retirement', 'Tax Planning & Compliance', 'Goals & Financial Planning', 'Reports & Analytics', 'Security & Settings'].every(z => zones.map(x => x.toLowerCase()).includes(z.toLowerCase())), 'navigation has the eight primary sections')
    await p.goto('http://localhost:4173/#/accounts'); await p.waitForTimeout(800); ok((await p.locator('main').textContent()).includes('Account balances as last updated'), 'accounts page lists balances as last updated')
    // 0.9.0: treemap + heat map on Trends; sinking funds on Budget; manifest + service worker shipped
    await p.goto('http://localhost:4173/#/trends'); await p.waitForTimeout(900); ok((await p.locator('svg[aria-label="Treemap of spending by category"] rect').count()) >= 5, 'trends shows a category treemap'); ok((await p.locator('svg[aria-label="Heat map of daily spending"] rect').count()) > 100, 'trends shows a daily spending heat map')
    await p.goto('http://localhost:4173/#/budget'); await p.waitForTimeout(900); ok(/Sinking funds/.test(await p.locator('main').textContent()) && /Home maintenance/.test(await p.locator('main').textContent()), 'budget shows sinking funds')
    ok((await (await p.request.get('http://localhost:4173/manifest.webmanifest')).json()).name === 'WealthPilot', 'web app manifest is served'); ok((await (await p.request.get('http://localhost:4173/sw.js')).text()).includes('wealthpilot-v'), 'service worker is served')
    // 0.11.0: bank sync card on Bank Connections explains itself in the demo (no real connection possible there)
    await p.goto('http://localhost:4173/#/connections'); await p.waitForTimeout(700); const cx = await p.locator('main').textContent()
    ok(/Automatic bank sync/.test(cx) && /not available in the offline demo/.test(cx), 'Bank Connections shows the automatic-sync card with the demo notice')
    // 0.11.1: full bank-sync screen against the pretend bank — connect, auto-prefilled matching (existing accounts matched, the rest created), enabled combined button, sync adds items once
    await p.evaluate(() => localStorage.setItem('wealthpilot.simSync', '1')); await p.goto('http://localhost:4173/#/settings'); await p.goto('http://localhost:4173/#/connections'); await p.reload(); await p.waitForTimeout(900)
    ok(await p.locator('button:has-text("Connect")').isDisabled(), 'Connect stays disabled until a token is pasted'); await p.fill('input[placeholder^="aHR0"]', 'aHR0cHM6Ly9icmlkZ2Uuc2ltcGxlZmluLm9yZy9zaW1wbGVmaW4vY2xhaW0vVEVTVA=='); await p.click('button:has-text("Connect")'); await p.waitForTimeout(800)
    const syncBtn = p.locator('button:has-text("Save matching & sync now")'); ok(await syncBtn.isEnabled(), 'sync button is enabled right after connecting (matching is pre-filled)')
    const picks = await p.locator('table.tbl select.inp').evaluateAll(els => els.map(e => e.options[e.selectedIndex].text)); ok(picks.length === 4 && picks.filter(t => /Create a new account/.test(t)).length >= 1 && picks.filter(t => !/Create a new account|don't import/.test(t)).length >= 2, 'existing accounts are auto-matched and the rest are set to be created')
    const acctsBefore = await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.accounts.length), importedBefore = await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.transactions.filter(t => t.source === 'import').length)
    await syncBtn.click(); await p.waitForTimeout(1200); const afterSync = await p.evaluate(() => { const d = JSON.parse(localStorage.getItem('wealthpilot.demo')).data; return { a: d.accounts.length, i: d.transactions.filter(t => t.source === 'import').length } })
    ok(afterSync.a > acctsBefore && afterSync.i === importedBefore + 8, 'Save matching & sync creates the missing accounts and adds the bank transactions')
    ok(/Sync history/.test(await p.locator('main').textContent()) && (await p.locator('button:has-text("Sync now")').isEnabled()), 'after syncing, history shows and plain "Sync now" is available')
    await p.click('button:has-text("Sync now")'); await p.waitForTimeout(900); ok((await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.transactions.filter(t => t.source === 'import').length)) === importedBefore + 8, 'syncing again adds nothing twice')
    await p.evaluate(() => localStorage.removeItem('wealthpilot.simSync')); await p.reload(); await p.waitForTimeout(600)
    await p.goto('http://localhost:4173/#/settings'); await p.waitForTimeout(500); await p.click('.seg button:has-text("Security")'); await p.waitForTimeout(300); ok((await p.locator('.card').first().textContent()).includes('offline demo'), 'Security tab renders (demo notice)')
    // 0.10.0: members — invite with limited access drafts an email carrying a one-time temporary password; access can be changed afterwards
    await p.click('button:has-text("Members")'); await p.waitForTimeout(300); const members0 = await p.locator('table.tbl tbody tr').count()
    await p.fill('input[placeholder="name@example.com"]', 'pat.smoke@example.com'); await p.fill('input[placeholder="how the email greets them"]', 'Pat'); await p.click('.seg button:has-text("Limited")'); await p.waitForTimeout(100)
    ok(await p.locator('button:has-text("Create sign-in & draft email")').isDisabled(), 'limited access needs at least one section before inviting')
    await p.click('label:has-text("Budget") input'); await p.click('label:has-text("Savings goals") input'); await p.waitForTimeout(100); ok(/Limited — Budget, Savings goals & plan \(read-only\)/.test(await p.locator('main').textContent()), 'access summary describes the limited grant')
    await p.click('button:has-text("Create sign-in & draft email")'); await p.waitForTimeout(600); const invM = await p.locator('.modal').textContent()
    ok(/Temporary password/.test(invM) && /WP-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}/.test(invM), 'invitation shows a one-time temporary password'); ok(/Hi Pat,/.test(invM) && /Limited — Budget, Savings goals/.test(invM) && /first sign-in only/.test(invM), 'drafted email greets by name and states the access')
    ok((await p.locator('.modal a:has-text("Open in email app")').getAttribute('href')).startsWith('mailto:pat.smoke%40example.com?subject='), 'Open in email app is a mailto link'); await p.click('.modal button:has-text("Done")'); await p.waitForTimeout(300)
    ok((await p.locator('table.tbl tbody tr').count()) === members0 + 1 && /pat\.smoke@example\.com/.test(await p.locator('table.tbl').textContent()) && /Limited/.test(await p.locator('table.tbl').textContent()), 'new member is listed as Limited')
    await p.click('table.tbl tr:has-text("pat.smoke") button:has-text("Change")'); await p.waitForTimeout(300); await p.click('.modal .seg button:has-text("Full")'); await p.click('.modal button:has-text("Save")'); await p.waitForTimeout(500)
    ok(/Full access/.test(await p.locator('table.tbl tr:has-text("pat.smoke")').textContent()), 'changing access to Full updates the member row')
    await p.goto('http://localhost:4173/#/'); await p.waitForTimeout(500); ok(!/as you last updated them/.test(await p.locator('main').textContent()), 'Dashboard overview no longer buries the account balances at the bottom')
    await p.click('.seg button:has-text("Account balances")'); await p.waitForTimeout(300); ok(/Account balances/.test(await p.locator('main .card').first().textContent()) && /as you last updated them/.test(await p.locator('main').textContent()) && await p.locator('main .kpi').count() > 0, 'Dashboard has an Account balances tab at the top with every account')
    await p.goto('http://localhost:4173/#/settings'); await p.waitForTimeout(500)
    await p.goto('http://localhost:4173/#/email'); await p.waitForTimeout(500); await p.click('button:has-text("Set up Gmail")'); await p.waitForTimeout(300)
    ok(await p.locator('.modal :text("Google OAuth client ID")').count() > 0, 'Set up Gmail opens the email capture settings instead of an error'); await p.click('.modal button:has-text("Cancel")'); await p.waitForTimeout(200)
    await p.goto('http://localhost:4173/#/settings'); await p.waitForTimeout(500)
    // 0.15.0: collapsible navigation, click-through highlight
    await p.goto('http://localhost:4173/#/'); await p.waitForTimeout(500); if (await p.locator('.app.rail-collapsed').count()) { await p.click('.railToggle'); await p.waitForTimeout(200) }
    const zoneBtn = p.locator('.nav .zone', { hasText: 'Goals & Financial Planning' }); const navBefore = await p.locator('.nav a:has-text("Savings Goals")').count(); await zoneBtn.click(); await p.waitForTimeout(200)
    ok(navBefore === 1 && (await p.locator('.nav a:has-text("Savings Goals")').count()) === 0, 'a navigation section collapses when its heading is clicked'); await zoneBtn.click(); await p.waitForTimeout(200); ok((await p.locator('.nav a:has-text("Savings Goals")').count()) === 1, 'and expands again')
    await p.click('.navtools button'); await p.waitForTimeout(200); ok((await p.locator('.nav a').count()) <= 3, 'Collapse all leaves only the current section open'); await p.click('.navtools button'); await p.waitForTimeout(200); ok((await p.locator('.nav a').count()) >= 15, 'Expand all opens every section')
    await p.click('.seg button:has-text("Account balances")'); await p.waitForTimeout(300); await p.click('.kpi .l a'); await p.waitForTimeout(900); ok(/focus=/.test(p.url()) && (await p.locator('.focus-hit').count()) === 1, 'clicking an account on the Dashboard opens Accounts with that row highlighted')
    // 0.14.0: Cash & Account Operations + Checkbook Reconciliation
    await p.goto('http://localhost:4173/#/connections'); await p.waitForTimeout(500); ok((await p.locator('h1').first().textContent()) === 'Cash & Account Operations' && /Data sources/.test(await p.locator('main').textContent()), 'Bank Connections is now Cash & Account Operations with a data-sources card')
    await p.goto('http://localhost:4173/#/reconcile'); await p.waitForTimeout(600); const rc = await p.locator('main').textContent()
    ok(/Book balance/.test(rc) && /Bank balance/.test(rc) && /Reconciled balance/.test(rc) && /Variance/.test(rc) && /Outstanding checks/.test(rc) && /Deposits in transit/.test(rc) && /Last reconciliation/.test(rc), 'Checkbook Reconciliation shows the dashboard figures')
    await p.fill('form input[inputmode="numeric"]', '4101'); await p.locator('form .field:has(label:text-is("Payee")) input').fill('Smoke Plumbing'); await p.locator('form .field:has(label:text-is("Amount")) input').fill('123.45'); await p.click('form button:has-text("Record")'); await p.waitForTimeout(500)
    ok(/#4101/.test(await p.locator('main').textContent()) && /Smoke Plumbing/.test(await p.locator('main').textContent()), 'a check recorded in the register is listed as outstanding with its number')
    await p.click('.seg button:has-text("Reconcile a statement")'); await p.waitForTimeout(300); ok(/Cleared balance/.test(await p.locator('main').textContent()) && /Tick what appears/.test(await p.locator('main').textContent()), 'the statement reconciliation worksheet opens')
    await p.click('.seg button:has-text("History")'); await p.waitForTimeout(300); ok(/Audit trail/.test(await p.locator('main').textContent()) && /register/.test(await p.locator('main').textContent()), 'the audit trail records the register entry')
    // 0.13.0: duplicates review + year-to-date coverage
    await p.goto('http://localhost:4173/#/transactions'); await p.waitForTimeout(500); await p.click('button:has-text("Duplicates")'); await p.waitForTimeout(300)
    ok(/Needs your decision/.test(await p.locator('.modal').textContent()) && /Merged — hidden from every total/.test(await p.locator('.modal').textContent()), 'Transactions → Duplicates opens the review with decisions and undo'); await p.click('.modal button:has-text("Close")'); await p.waitForTimeout(200)
    // 0.19.0: splits, tags, bulk edit, undo, saved views, safe to spend, command palette
    await p.goto('http://localhost:4173/#/transactions'); await p.waitForTimeout(600); await p.click('.opts button:has-text("All")'); await p.waitForTimeout(300)
    ok((await p.locator('button:has-text("Split (2)")').count()) >= 1, 'the demo\'s split Target run shows "Split (2)" on its row')
    await p.locator('button:has-text("Split (2)")').first().click(); await p.waitForTimeout(400); ok(/Adds up/.test(await p.locator('.modal').textContent()) && (await p.locator('.modal select').count()) === 2, 'the split editor opens with two lines that add up')
    await p.locator('.modal input[aria-label="Amount for line 1"]').fill('1.00'); await p.waitForTimeout(200); ok(/still to assign/.test(await p.locator('.modal').textContent()) && (await p.locator('.modal button:has-text("Save split")').isDisabled()), 'a split that does not add up cannot be saved'); await p.click('.modal button:has-text("Cancel")'); await p.waitForTimeout(200)
    await p.goto('http://localhost:4173/#/budget'); await p.waitForTimeout(800); const bud = await p.locator('main').textContent(); ok(/Groceries/.test(bud), 'the budget page renders with the split counted (Groceries line present)')
    await p.goto('http://localhost:4173/#/transactions'); await p.waitForTimeout(600); await p.click('.opts button:has-text("All")'); await p.waitForTimeout(300)
    const boxes = p.locator('tbody input[type=checkbox][aria-label^="Select row"]'); await boxes.nth(0).check(); await boxes.nth(1).check(); await p.waitForTimeout(200)
    ok(/2 selected/.test(await p.locator('[aria-label="Bulk edit"]').textContent()), 'selecting two rows shows the bulk-edit bar')
    await p.fill('[aria-label="Tag to add or remove"]', 'smoke'); await p.click('button:has-text("+ Tag")'); await p.waitForTimeout(500)
    ok((await p.locator('.opts button:has-text("#smoke")').count()) === 1, 'bulk tagging adds the tag and it appears as a filter'); await p.click('.opts button:has-text("#smoke")'); await p.waitForTimeout(300); ok((await p.locator('tbody tr').count()) === 2, 'the tag filter shows exactly the two tagged rows')
    await p.keyboard.press('Escape'); await p.locator('body').click({ position: { x: 5, y: 5 } }); await p.keyboard.press('Control+z'); await p.waitForTimeout(700)
    ok((await p.locator('.opts button:has-text("#smoke")').count()) === 0, 'Ctrl-Z undoes the bulk tag')
    p.once('dialog', d => d.accept('Smoke view')); await p.click('.opts button:has-text("★ Save this view")'); await p.waitForTimeout(600)
    ok((await p.locator('.opts button:has-text("Smoke view")').count()) === 1, 'a saved view is pinned above the ledger')
    await p.keyboard.press('Control+k'); await p.waitForTimeout(300); ok((await p.locator('.modal.palette').count()) === 1, 'Ctrl-K opens the command palette')
    await p.fill('.pal-in', 'kroger'); await p.waitForTimeout(300); ok(/payee/i.test(await p.locator('.pal-list').textContent()) && /Kroger/.test(await p.locator('.pal-list').textContent()), 'the palette finds a payee'); await p.keyboard.press('Enter'); await p.waitForTimeout(700)
    ok(/#\/transactions/.test(p.url()) && (await p.locator('.focus-hit').count()) >= 1, 'opening a palette hit lands on the row and highlights it')
    await p.keyboard.press('g'); await p.keyboard.press('d'); await p.waitForTimeout(500); ok(p.url().endsWith('#/'), 'G then D jumps to the Dashboard')
    ok(/Safe to spend/.test(await p.locator('.kpis').first().textContent()) && /\/day for \d+ day/.test(await p.locator('.kpis').first().textContent()), 'the Dashboard shows Safe to spend with a per-day figure')
    await p.keyboard.press('?'); await p.waitForTimeout(300); ok(/Keyboard shortcuts/.test(await p.locator('.modal').textContent()), '? opens the shortcut list'); await p.keyboard.press('Escape'); await p.waitForTimeout(200)
    // 0.19.0 phase 3: notifications tab, receipts dialog, add-to-bills
    await p.goto('http://localhost:4173/#/settings'); await p.waitForTimeout(600); await p.click('.seg button:has-text("Notifications")'); await p.waitForTimeout(400)
    const nt = await p.locator('main').textContent(); ok(/Push notifications/.test(nt) && /What to alert on/.test(nt) && /Monday digest/.test(nt), 'Settings → Notifications shows push, email, rules and the digest')
    await p.click('button:has-text("Preview today\'s alerts")'); await p.waitForTimeout(500); ok(/Nothing would be sent right now|is due|overdue|Large charge|paycheck/.test(await p.locator('main').textContent()), 'previewing today\'s alerts runs the rules in the browser')
    await p.goto('http://localhost:4173/#/transactions'); await p.waitForTimeout(600); await p.locator('button[title="Receipts and documents"]').first().click(); await p.waitForTimeout(400)
    ok(/Receipts/.test(await p.locator('.modal').textContent()) && /private storage/.test(await p.locator('.modal').textContent()), 'the receipts dialog opens (demo explains it needs a signed-in household)'); await p.click('.modal button:has-text("Close")'); await p.waitForTimeout(200)
    await p.goto('http://localhost:4173/#/insights'); await p.waitForTimeout(1200); const ins = await p.locator('main').textContent()
    if (/\+ Add to Bills/.test(ins)) { const before = await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.recurring.length); await p.locator('button:has-text("+ Add to Bills")').first().click(); await p.waitForTimeout(600); const after = await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data.recurring.length); ok(after === before + 1, 'Add to Bills creates a recurring item from a detected charge') } else ok(true, 'no detected charges outside Bills in the demo (Add to Bills not exercised)')
    await p.goto('http://localhost:4173/#/transactions'); await p.waitForTimeout(500)
    // 0.20.0 phase 4: the unified plan, saved scenarios, promotional APRs, guaranteed retirement income, price freshness, idle lock
    await p.goto('http://localhost:4173/#/plan'); await p.waitForTimeout(900); const pl = await p.locator('main').textContent()
    ok(/Where this month's extra goes/.test(pl) && /One timeline/.test(pl) && /Month by month/.test(pl), 'the Plan page shows the allocation, the timeline and the monthly table')
    await p.locator('input[aria-label="Extra per month"]').fill('400'); await p.waitForTimeout(400)
    ok(/\$400/.test(await p.locator('.plan-alloc .b').first().textContent()) && /to /.test(await p.locator('.plan-alloc .b').first().textContent()), 'debt first: $400 extra goes to the focus debt account')
    await p.click('.scenbar button:has-text("Save as scenario")'); await p.fill('.scenbar input[aria-label="Scenario name"]', 'Smoke plan'); await p.click('.schip.naming button:has-text("Save")'); await p.waitForTimeout(500)
    ok((await p.locator('.schip.on:has-text("Smoke plan")').count()) === 1, 'saving the sliders as a scenario pins a chip that is marked active')
    await p.locator('input[aria-label="Extra per month"]').fill('0'); await p.waitForTimeout(300); ok((await p.locator('.schip.on').count()) === 0, 'moving a slider leaves the saved scenario')
    await p.click('.schip button.go:has-text("Smoke plan")'); await p.waitForTimeout(400); ok(await p.locator('input[aria-label="Extra per month"]').inputValue() === '400' && (await p.locator('.schip.on').count()) === 1, 'loading the scenario puts the sliders back')
    await p.locator('input[aria-label="Extra per month"]').fill('150'); await p.waitForTimeout(300); await p.click('.scenbar button:has-text("Compare")'); await p.waitForTimeout(500)
    ok(/Sliders now/.test(await p.locator('.modal').textContent()) && /Smoke plan/.test(await p.locator('.modal').textContent()) && (await p.locator('.modal td.best').count()) >= 1, 'Compare shows the sliders against the saved scenario with the winners marked'); await p.click('.modal .mfoot button:has-text("Close")'); await p.waitForTimeout(200)
    await p.click('button:has-text("Apply this plan")'); await p.waitForTimeout(300); ok(/Debts page starts its extra-payment slider/.test(await p.locator('.modal').textContent()), 'Apply previews what it changes'); await p.click('.modal .mfoot button:has-text("Apply")'); await p.waitForTimeout(800)
    ok(/This plan is applied/.test(await p.locator('main').textContent()), 'the applied plan is flagged on the Plan page')
    await p.goto('http://localhost:4173/#/debts'); await p.waitForTimeout(900); const dbt = await p.locator('main').textContent()
    ok(/promotional rate ends/.test(dbt) && /Discover it/.test(dbt), 'Debts warns before the 0% promotion ends')
    ok(/Your applied plan sends \$150\.00\/mo/.test(dbt), 'Debts starts from the plan\'s extra payment — the pages agree')
    await p.goto('http://localhost:4173/#/investments'); await p.waitForTimeout(1000); const inv4 = await p.locator('main').textContent()
    ok(/Guaranteed income/.test(inv4) && /Claim at age/.test(inv4) && /Retirement income, year by year/.test(inv4) && /Bridge to Social Security|Portfolio money lasts/.test(inv4), 'the retirement planner models Social Security at a claiming age, pensions and a year-by-year drawdown')
    ok((await p.locator('.fresh').count()) >= 5, 'every holding shows how fresh its price is')
    await p.click('button:has-text("+ Add a pension")'); await p.waitForTimeout(300); ok((await p.locator('input[aria-label="Pension name"]').count()) === 1, 'a pension line can be added')
    await p.click('button[aria-label="Lock now"]'); await p.waitForTimeout(400)
    ok((await p.locator('.lockscreen').count()) === 1 && (await p.locator('main').count()) === 0, 'Lock now hides every figure behind the lock screen')
    await p.reload(); await p.waitForTimeout(900); ok((await p.locator('.lockscreen').count()) === 1, 'the lock survives a reload')
    await p.click('.lockscreen button:has-text("Unlock")'); await p.waitForTimeout(600); ok((await p.locator('main').count()) === 1 && (await p.locator('.lockscreen').count()) === 0, 'unlocking brings the page back')
    await p.goto('http://localhost:4173/#/transactions'); await p.waitForTimeout(500)
    // 0.21.0: comment threads, "apply to earlier", rule review flags, paycheck allocation, per-member alert routing, statement PDFs
    const LS = () => p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo')).data)
    await p.click('.slicer:has(.l:text-is("Range")) button:text-is("All")'); await p.waitForTimeout(500)
    await p.locator('button[aria-label="Comments (2)"]').first().click(); await p.waitForTimeout(400)
    ok(/Sam/.test(await p.locator('.modal').textContent()) && (await p.locator('.modal .thread li').count()) === 2, 'a transaction shows its comment thread with who said what')
    await p.fill('#wp-comment', 'Smoke: confirmed with the receipt.'); await p.click('.modal button:has-text("Post")'); await p.waitForTimeout(500)
    ok((await p.locator('.modal .thread li').count()) === 3 && (await LS()).comments.length === 3, 'posting a comment adds it to the thread and stores it'); await p.click('.modal .mfoot button:has-text("Close")'); await p.waitForTimeout(200)
    ok((await p.locator('button[aria-label="Comments (3)"]').count()) === 1, 'the ledger button counts the comments')
    const shellN = (await LS()).transactions.filter(t => t.payee === 'Shell').length
    const sh = p.locator('input[aria-label="Payee"][value="Shell"]').first(); await sh.fill('Shell Oil'); await sh.press('Tab'); await p.waitForTimeout(600)
    const act = p.locator('.toast-act:has-text("Apply to")'); ok((await act.count()) === 1 && new RegExp(`Apply to ${shellN - 1}`).test(await act.textContent()), `renaming a payee offers to rename the ${shellN - 1} earlier ones`)
    if (await act.count()) { await act.click(); await p.waitForTimeout(800) }
    ok((await LS()).transactions.filter(t => t.payee === 'Shell Oil').length === shellN, 'one tap renames every earlier Shell transaction')
    await p.evaluate(() => { const k = 'wealthpilot.demo'; const j = JSON.parse(localStorage.getItem(k)); j.household.settings.rules = [...(j.household.settings.rules || []), { id: 'smoke-r', pattern: 'chipotle', match: 'contains', enabled: true, review: true, tags: ['lunch'], source: 'manual' }]; localStorage.setItem(k, JSON.stringify(j)) })
    await p.goto('http://localhost:4173/#/settings'); await p.reload(); await p.waitForTimeout(900); await p.click('.seg button:has-text("Payee rules")'); await p.waitForTimeout(400)
    ok((await p.locator('th:has-text("Flag for review")').count()) === 1 && (await p.locator('th:has-text("Count toward goal")').count()) === 1, 'payee rules can add tags, flag for review and count toward a goal')
    await p.click('button:has-text("Apply to")'); await p.waitForTimeout(700)
    const chip = (await LS()).transactions.filter(t => t.payee === 'Chipotle'); ok(chip.length > 0 && chip.every(t => t.tags.includes('review') && t.tags.includes('lunch')), 'applying the rule tags every match and flags it for review')
    await p.goto('http://localhost:4173/#/'); await p.waitForTimeout(800); const flag = p.locator('a:has-text("flagged for review")'); ok((await flag.count()) === 1, 'the Dashboard lists the flagged transactions under Needs attention')
    if (await flag.count()) { await flag.click(); await p.waitForTimeout(800) }
    ok(/flagged for review by your payee rules/.test(await p.locator('main').textContent()), 'the link opens the ledger filtered to #review')
    await p.click('button:has-text("Mark all reviewed")'); await p.waitForTimeout(700); ok((await LS()).transactions.every(t => !(t.tags || []).includes('review')), '"Mark all reviewed" clears the flags')
    await p.goto('http://localhost:4173/#/income'); await p.waitForTimeout(800); const contrib0 = (await LS()).contributions.length
    await p.click('button:has-text("Allocate…") >> nth=0'); await p.waitForTimeout(500); const am = await p.locator('.modal').textContent()
    ok(/Plan this paycheck/.test(am) && /Bills & subscriptions|Card & loan payments/.test(am) && /Goals/.test(am) && /Everyday spending/.test(am) && /(unassigned|short)/.test(am), 'allocating a paycheck splits it into bills, payments, goals and everyday spending with what is left')
    await p.click('.modal button:has-text("to goals")'); await p.waitForTimeout(800); ok((await LS()).contributions.length >= contrib0 + 2, 'logging the goal transfers records a contribution per goal')
    await p.goto('http://localhost:4173/#/settings'); await p.waitForTimeout(600); await p.click('.seg button:has-text("Notifications")'); await p.waitForTimeout(500); const notif = await p.locator('main').textContent()
    ok(/Who gets what/.test(notif) && /Sam/.test(notif) && /charged more than usual/.test(notif) && /new repeating charge/i.test(notif) && /due for reconciling/.test(notif), 'Notifications has per-member routing and the three new alert rules')
    await p.locator('input[aria-label="Monday digest for Sam"]').uncheck(); await p.waitForTimeout(500)
    ok(await p.evaluate(() => { const j = JSON.parse(localStorage.getItem('wealthpilot.demo')); return j.household.settings.notify.members['demo-partner'].digest === false }), 'a member can be taken off the Monday digest')
    await p.goto('http://localhost:4173/#/accounts'); await p.waitForTimeout(700); ok((await p.locator('th:has-text("PDF")').count()) === 1, 'statement history has a PDF column for statements filed from email')
    await p.goto('http://localhost:4173/#/transactions'); await p.waitForTimeout(500)
    // 0.18.0: a review pair renders a router link inside the dialog (this used to crash the page with "basename of null" and look like a hang)
    await p.evaluate(() => { const k = 'wealthpilot.demo'; const j = JSON.parse(localStorage.getItem(k)); const t = j.data.transactions.find(x => x.kind === 'expense' && x.account_id); const a = { ...t, id: 'dup-a-' + Date.now(), external_id: 'sfin:a1', payee: 'Twin Coffee', amount: 4.25, duplicate_of: null, dedupe_ok: false }; const b = { ...a, id: 'dup-b-' + Date.now(), external_id: 'sfin:b1' }; j.data.transactions.push(a, b); localStorage.setItem(k, JSON.stringify(j)) })
    await p.reload(); await p.waitForTimeout(900); await p.click('button:has-text("Review")'); await p.waitForTimeout(400)
    ok(/Needs your decision \(1\)/.test(await p.locator('.modal').textContent()) && (await p.locator('.modal a[href*="focus="]').count()) >= 2, 'a possible duplicate shows in the dialog with links to both rows'); await p.click('.modal button:has-text("Two different transactions")'); await p.waitForTimeout(400)
    ok(/Needs your decision \(0\)/.test(await p.locator('.modal').textContent()), '"Two different transactions" settles the pair'); await p.click('.modal button:has-text("Close")'); await p.waitForTimeout(200)
    await p.goto('http://localhost:4173/#/connections'); await p.waitForTimeout(500); ok(/Year-to-date coverage \(\d{4}\)/.test(await p.locator('main').textContent()) && /90 days/.test(await p.locator('main').textContent()), 'Bank Connections shows year-to-date coverage per account and month')
    await p.goto('http://localhost:4173/#/settings'); await p.waitForTimeout(500)
    // 0.11.2: email-capture settings live in Settings → General, and dialogs/toasts stay readable in both themes
    await p.click('.seg button:has-text("General")'); await p.waitForTimeout(300)
    ok(/Email capture \(Gmail \/ Outlook\)/.test(await p.locator('main').textContent()), 'Settings → General has the Email capture card')
    await p.click('button:has-text("Open email capture settings")'); await p.waitForTimeout(300)
    ok(await p.locator('.modal :text("Google OAuth client ID")').count() > 0 && await p.locator('.modal :text("Application (client) ID")').count() > 0, 'the card opens the Gmail and Outlook client-ID fields')
    const contrast = async () => p.evaluate(() => { const rgb = c => c.match(/[\d.]+/g).map(Number); const L = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b) }
      const one = el => { const cs = getComputedStyle(el); const a = L(rgb(cs.color)), b = L(rgb(cs.backgroundColor)); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }
      document.body.insertAdjacentHTML('beforeend', '<div id="_t" class="toasts"><div class="toast">x</div><div class="toast err">x</div></div><div id="_b"><div class="banner">x</div><div class="msg warn">x</div><div class="msg crit">x</div></div>')
      const r = [...document.querySelectorAll('#_t .toast, #_b > div, .modal')].map(one); document.getElementById('_t').remove(); document.getElementById('_b').remove(); return Math.min(...r) })
    const cLight = await contrast(); await p.evaluate(() => { document.documentElement.dataset.theme = 'dark' }); const cDark = await contrast(); await p.evaluate(() => { document.documentElement.dataset.theme = 'light' })
    ok(cLight >= 4.5 && cDark >= 4.5, `dialog, toast, banner and message text meet 4.5:1 in light (${cLight.toFixed(1)}) and dark (${cDark.toFixed(1)})`)
    await p.click('.modal button:has-text("Cancel")'); await p.waitForTimeout(200)
    await p.goto('http://localhost:4173/#/'); await p.waitForTimeout(500)
    // 0.19.0: accessibility gate — axe-core WCAG 2.0/2.1 A + AA on eight pages; any serious or critical violation fails the run
    const axeSrc = readFileSync(fileURLToPath(new URL('../node_modules/axe-core/axe.min.js', import.meta.url)), 'utf8')
    for (const route of ['/', '/transactions', '/budget', '/reports', '/plan', '/debts', '/investments', '/income', '/settings']) {
      await p.goto('http://localhost:4173/#' + route); await p.waitForTimeout(900); await p.evaluate(axeSrc)
      const res = await p.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }))
      const bad = res.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
      ok(bad.length === 0, `axe: no serious/critical WCAG violations on ${route}` + (bad.length ? ' — ' + bad.map(v => `${v.id} (${v.nodes.length}: ${v.nodes.slice(0, 3).map(n => n.target[0]).join(' | ')})`).join('; ') : ''))
    }
    await p.goto('http://localhost:4173/#/'); await p.waitForTimeout(500)
    const tickBefore = await p.evaluate(() => getComputedStyle(document.querySelector('.js-plotly-plot .ytick text')).fill)
    await p.click('.asof button[aria-label^="Theme"]'); await p.waitForTimeout(900); ok(await p.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'dark mode toggles (system → dark)'); await p.screenshot({ path: 'e2e/shots/1400_dark.png', fullPage: false })
    const tickAfter = await p.evaluate(() => getComputedStyle(document.querySelector('.js-plotly-plot .ytick text')).fill); ok(tickBefore !== tickAfter, 'charts redraw in the new theme\'s colours when the theme changes (axis text ' + tickBefore + ' → ' + tickAfter + ')')
    await p.goBack(); await p.waitForTimeout(500); ok((await p.locator('h1').first().textContent()) === 'Settings', 'browser back returns to the previous page')
  }
  ok(!errors.length, `${W}: no page errors ${errors.slice(0, 3).join(' | ')}`); await p.close()
}
// 0.11.1: a password-reset link must open the "choose a new password" screen, never sign straight in (an unusable token shows the expired-link message)
{ const rp = await b.newPage(); await rp.goto('http://localhost:4173/#access_token=not-a-real-token&refresh_token=x&expires_in=3600&token_type=bearer&type=recovery'); await rp.waitForSelector('text=/reset link has expired|Choose a new password/', { timeout: 8000 }).catch(() => {})
  const rt = await rp.locator('body').textContent(); ok(/reset link has expired|Choose a new password/.test(rt) && !/Dashboard/.test(rt), 'a password-reset link opens the reset screen instead of signing in'); await rp.close() }
// 0.20.1: a page file missing after a deploy (a tab opened before the release) reloads the tab once to the new version instead of showing "Something went wrong"
{ const sp = await b.newPage(); await sp.goto('http://localhost:4173/'); await sp.waitForTimeout(800); await sp.click('text=Open the offline demo'); await sp.waitForTimeout(1200)
  let hits = 0; await sp.route(/\/assets\/Insights-[^/]+\.js$/, r => { hits++; return hits === 1 ? r.fulfill({ status: 404, contentType: 'text/html', body: 'gone' }) : r.continue() })
  await sp.goto('http://localhost:4173/#/insights'); await sp.waitForTimeout(3500)
  const h = await sp.locator('h1').first().textContent().catch(() => ''); const body = await sp.locator('body').textContent()
  ok(hits >= 2 && h === 'Spending Intelligence' && !/Something went wrong/.test(body), `a missing page file after a deploy reloads once and the page opens (requests ${hits}, heading "${h}")`); await sp.close() }
console.log('smoke fails', F); await b.close(); srv.close()
