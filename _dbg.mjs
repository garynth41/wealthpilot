import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' }); const p = await b.newPage({ viewport: { width: 1400, height: 950 } })
await p.goto('http://localhost:4173/'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.click('text=Open the offline demo'); await p.waitForTimeout(1000)
console.log('links', await p.locator('.nav a').count(), 'tools', await p.locator('.navtools button').textContent())
await p.click('.navtools button'); await p.waitForTimeout(300); console.log('after collapse', await p.locator('.nav a').count(), await p.locator('.navtools button').textContent(), await p.evaluate(() => localStorage.getItem('wealthpilot.navClosed')))
await b.close()
