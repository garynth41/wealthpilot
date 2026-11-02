// Smoke: serve dist, open the offline demo, visit every page, click through core flows, catch console/page errors, screenshot each page.
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFileSync, statSync, mkdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../dist', import.meta.url)); mkdirSync('e2e/shots', { recursive: true })   // fileURLToPath: works on Windows too (URL.pathname gives "/C:/…")
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }
const isFile = f => { try { return statSync(f).isFile() } catch { return false } }   // a directory path must fall back to index.html too (Windows: readFileSync on a dir throws EISDIR)
const srv = createServer((req, res) => { let p = join(root, decodeURIComponent(req.url.split('?')[0].split('#')[0])); if (!isFile(p)) p = join(root, 'index.html'); res.setHeader('Content-Type', types[extname(p)] || 'application/octet-stream'); res.end(readFileSync(p)) }).listen(4173)
let F = 0; const ok = (c, m) => { if (!c) F++; console.log((c ? 'PASS ' : 'FAIL ') + m) }
const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
for (const W of [1400, 390]) {
  const p = await b.newPage({ viewport: { width: W, height: W === 390 ? 844 : 950 }, timezoneId: 'America/New_York' }); const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|net::ERR|fonts.googleapis|Failed to load resource/.test(m.text())) errors.push(m.text()) })
  await p.goto('http://localhost:4173/'); await p.waitForTimeout(800); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(600)
  await p.click('text=Open the offline demo'); await p.waitForTimeout(1200)
  ok(await p.locator('h1').first().textContent() === 'Dashboard', `${W}: demo opens on the Dashboard`)
  const pages = ['/forecast', '/budget', '/transactions', '/bills', '/income', '/accounts', '/debts', '/goals', '/insights', '/connections', '/trends', '/hardship', '/email', '/settings', '/']
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
    await p.goto('http://localhost:4173/#/settings'); await p.waitForTimeout(500); await p.click('button:has-text("Security")'); await p.waitForTimeout(300); ok((await p.locator('.card').first().textContent()).includes('offline demo'), 'Security tab renders (demo notice)')
    await p.goto('http://localhost:4173/#/'); await p.waitForTimeout(500)
    await p.click('.asof button.btn'); await p.waitForTimeout(300); ok(await p.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'dark mode toggles (system → dark)'); await p.screenshot({ path: 'e2e/shots/1400_dark.png', fullPage: false })
    await p.goBack(); await p.waitForTimeout(500); ok((await p.locator('h1').first().textContent()) === 'Settings', 'browser back returns to the previous page')
  }
  ok(!errors.length, `${W}: no page errors ${errors.slice(0, 3).join(' | ')}`); await p.close()
}
console.log('smoke fails', F); await b.close(); srv.close()
