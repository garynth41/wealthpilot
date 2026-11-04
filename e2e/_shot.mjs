import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' }); const m = await b.newPage({ viewport: { width: 390, height: 844 } })
await m.goto('http://localhost:4173/'); await m.evaluate(() => localStorage.clear()); await m.reload(); await m.click('text=Open the offline demo'); await m.waitForTimeout(1000)
await m.goto('http://localhost:4173/#/tax'); await m.waitForTimeout(900); await m.screenshot({ path: 'e2e/shots/ledger_tax_m.png', fullPage: true })
const wide = await m.evaluate(() => { const out=[]; document.querySelectorAll('body *').forEach(e=>{ const r=e.getBoundingClientRect(); if(r.right>395) out.push(e.tagName+'.'+(e.className||'').toString().slice(0,40)+' '+Math.round(r.right)) }); return out.slice(0,15) })
console.log(wide)
await b.close()
