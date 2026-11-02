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
  await p.click('text=Open the offline demo'); await p.waitForTimeout(1200)
  ok(await p.locator('h1').first().textContent() === 'Dashboard', `${W}: demo opens on the Dashboard`)
  const pages = ['/forecast', '/budget', '/transactions', '/bills', '/income', '/accounts', '/debts', '/investments', '/goals', '/tax', '/reports', '/insights', '/connections', '/trends', '/hardship', '/email', '/settings', '/']
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
    const [dlR] = await Promise.all([p.waitForEvent('download'), p.click('.noprint button:has-text("CSV")')]); ok(/\.csv$/.test(dlR.suggestedFilename()), 'report CSV downloads'); const [dlRx] = await Promise.all([p.waitForEvent('download'), p.click('.noprint button:has-text("Excel")')]); ok(/\.xlsx$/.test(dlRx.suggestedFilename()), 'report Excel downloads')
    await p.click('button:has-text("Annual")'); await p.waitForTimeout(500); ok(/annual report/i.test(await p.locator('main').textContent()), 'switching to an annual report rebuilds it')
    const zones = await p.locator('.nav .zone').allTextContents(); ok(['Spending Intelligence', 'Account Balances', 'Bank Connections', 'Investments & Retirement', 'Tax Planning & Compliance', 'Goals & Financial Planning', 'Reports & Analytics', 'Security & Settings'].every(z => zones.map(x => x.toLowerCase()).includes(z.toLowerCase())), 'navigation has the eight primary sections')
    await p.goto('http://localhost:4173/#/accounts'); await p.waitForTimeout(800); ok((await p.locator('main').textContent()).includes('Account balances as last updated'), 'accounts page lists balances as last updated')
    // 0.9.0: treemap + heat map on Trends; sinking funds on Budget; manifest + service worker shipped
    await p.goto('http://localhost:4173/#/trends'); await p.waitForTimeout(900); ok((await p.locator('svg[aria-label="Treemap of spending by category"] rect').count()) >= 5, 'trends shows a category treemap'); ok((await p.locator('svg[aria-label="Heat map of daily spending"] rect').count()) > 100, 'trends shows a daily spending heat map')
    await p.goto('http://localhost:4173/#/budget'); await p.waitForTimeout(900); ok(/Sinking funds/.test(await p.locator('main').textContent()) && /Home maintenance/.test(await p.locator('main').textContent()), 'budget shows sinking funds')
    ok((await (await p.request.get('http://localhost:4173/manifest.webmanifest')).json()).name === 'WealthPilot', 'web app manifest is served'); ok((await (await p.request.get('http://localhost:4173/sw.js')).text()).includes('wealthpilot-v1'), 'service worker is served')
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
    await p.goto('http://localhost:4173/#/settings'); await p.waitForTimeout(500); await p.click('button:has-text("Security")'); await p.waitForTimeout(300); ok((await p.locator('.card').first().textContent()).includes('offline demo'), 'Security tab renders (demo notice)')
    // 0.10.0: members — invite with limited access drafts an email carrying a one-time temporary password; access can be changed afterwards
    await p.click('button:has-text("Members")'); await p.waitForTimeout(300); const members0 = await p.locator('table.tbl tbody tr').count()
    await p.fill('input[placeholder="name@example.com"]', 'pat.smoke@example.com'); await p.fill('input[placeholder="how the email greets them"]', 'Pat'); await p.click('.seg button:has-text("Limited")'); await p.waitForTimeout(100)
    ok(await p.locator('button:has-text("Create sign-in & draft email")').isDisabled(), 'limited access needs at least one section before inviting')
    await p.click('label:has-text("Budget") input'); await p.click('label:has-text("Savings goals") input'); await p.waitForTimeout(100); ok(/Limited — Budget, Savings goals \(read-only\)/.test(await p.locator('main').textContent()), 'access summary describes the limited grant')
    await p.click('button:has-text("Create sign-in & draft email")'); await p.waitForTimeout(600); const invM = await p.locator('.modal').textContent()
    ok(/Temporary password/.test(invM) && /WP-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}/.test(invM), 'invitation shows a one-time temporary password'); ok(/Hi Pat,/.test(invM) && /Limited — Budget, Savings goals/.test(invM) && /first sign-in only/.test(invM), 'drafted email greets by name and states the access')
    ok((await p.locator('.modal a:has-text("Open in email app")').getAttribute('href')).startsWith('mailto:pat.smoke%40example.com?subject='), 'Open in email app is a mailto link'); await p.click('.modal button:has-text("Done")'); await p.waitForTimeout(300)
    ok((await p.locator('table.tbl tbody tr').count()) === members0 + 1 && /pat\.smoke@example\.com/.test(await p.locator('table.tbl').textContent()) && /Limited/.test(await p.locator('table.tbl').textContent()), 'new member is listed as Limited')
    await p.click('table.tbl tr:has-text("pat.smoke") button:has-text("Change")'); await p.waitForTimeout(300); await p.click('.modal .seg button:has-text("Full")'); await p.click('.modal button:has-text("Save")'); await p.waitForTimeout(500)
    ok(/Full access/.test(await p.locator('table.tbl tr:has-text("pat.smoke")').textContent()), 'changing access to Full updates the member row')
    await p.goto('http://localhost:4173/#/'); await p.waitForTimeout(500)
    await p.click('.asof button.btn'); await p.waitForTimeout(300); ok(await p.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'dark mode toggles (system → dark)'); await p.screenshot({ path: 'e2e/shots/1400_dark.png', fullPage: false })
    await p.goBack(); await p.waitForTimeout(500); ok((await p.locator('h1').first().textContent()) === 'Settings', 'browser back returns to the previous page')
  }
  ok(!errors.length, `${W}: no page errors ${errors.slice(0, 3).join(' | ')}`); await p.close()
}
// 0.11.1: a password-reset link must open the "choose a new password" screen, never sign straight in (an unusable token shows the expired-link message)
{ const rp = await b.newPage(); await rp.goto('http://localhost:4173/#access_token=not-a-real-token&refresh_token=x&expires_in=3600&token_type=bearer&type=recovery'); await rp.waitForTimeout(1500)
  const rt = await rp.locator('body').textContent(); ok(/reset link has expired|Choose a new password/.test(rt) && !/Dashboard/.test(rt), 'a password-reset link opens the reset screen instead of signing in'); await rp.close() }
console.log('smoke fails', F); await b.close(); srv.close()
