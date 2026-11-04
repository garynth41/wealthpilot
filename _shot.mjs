import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' }); const p = await b.newPage({ viewport: { width: 1400, height: 1000 } })
await p.goto('http://localhost:4173/'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.click('text=Open the offline demo'); await p.waitForTimeout(1500)
await p.screenshot({ path: 'e2e/shots/ledger_light.png' })
await p.evaluate(() => { localStorage.setItem('wealthpilot.theme', 'dark'); document.documentElement.dataset.theme = 'dark' }); await p.waitForTimeout(400)
await p.screenshot({ path: 'e2e/shots/ledger_dark.png' })
await p.goto('http://localhost:4173/#/transactions'); await p.waitForTimeout(800); await p.screenshot({ path: 'e2e/shots/ledger_txn_dark.png' })
await b.close()
