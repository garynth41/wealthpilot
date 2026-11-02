import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' }); const p = await b.newPage()
p.on('pageerror', e => console.log('PAGEERROR', e.message))
await p.goto('http://localhost:5199/?demo=1', { waitUntil: 'networkidle' })
// demo mode entry if needed
const demo = p.getByText(/try the demo|demo/i).first(); if (await demo.count()) { try { await demo.click({ timeout: 2000 }) } catch {} }
for (const theme of ['light', 'dark']) {
  await p.evaluate(t => { document.documentElement.dataset.theme = t }, theme)
  await p.goto('http://localhost:5199/#/settings', { waitUntil: 'networkidle' }).catch(()=>{})
  await p.evaluate(t => { document.documentElement.dataset.theme = t }, theme)
  await p.waitForTimeout(400)
  const r = await p.evaluate(() => { const s = document.querySelector('select'); if (!s) return 'no select'; const o = s.querySelector('option'); const cs = getComputedStyle(s), co = o ? getComputedStyle(o) : null
    return { scheme: getComputedStyle(document.documentElement).colorScheme, select: [cs.backgroundColor, cs.color], option: co && [co.backgroundColor, co.color] } })
  console.log(theme, JSON.stringify(r))
  await p.screenshot({ path: `/tmp/claude-0/sel-${theme}.png` })
}
await b.close()
