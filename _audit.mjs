import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' }); const p = await b.newPage({ viewport: { width: 1400, height: 950 } })
const BASE = 'http://localhost:4180/'
await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.click('text=Open the offline demo'); await p.waitForTimeout(1200)
const audit = () => p.evaluate(() => {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, bl, a = 1] = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r, g, b: bl, a } }
  const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b) }
  const bgOf = el => { let layers = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break } } let base = { r: 255, g: 255, b: 255 }; for (const c of layers.reverse()) base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) }; return base }
  const out = []; const seen = new Set()
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue
    const txt = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' '); if (!txt && !(el.tagName === 'INPUT' && el.value) && el.tagName !== 'SELECT') continue
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue
    const fg = parse(cs.color); if (!fg) continue; const bg = bgOf(el); const a = fg.a; const f = { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) }
    const L1 = lum(f), L2 = lum(bg); const ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05)
    const px = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700; const need = (px >= 24 || (px >= 18.66 && bold)) ? 3 : 4.5
    if (ratio < need) { const key = el.className + '|' + cs.color + '|' + JSON.stringify(bg); if (seen.has(key)) continue; seen.add(key); out.push({ ratio: +ratio.toFixed(2), need, cls: (el.tagName + '.' + String(el.className).split(' ').join('.')).slice(0, 60), txt: (txt || el.value || '').slice(0, 40), fg: cs.color, bg: `rgb(${bg.r | 0},${bg.g | 0},${bg.b | 0})` }) }
  }
  return out })
const pages = ['/', '/forecast', '/insights', '/transactions', '/budget', '/bills', '/income', '/accounts', '/debts', '/connections', '/email', '/investments', '/tax', '/goals', '/hardship', '/reports', '/trends', '/settings']
const all = {}
for (const theme of ['light', 'dark']) {
  await p.evaluate(t => { localStorage.setItem('wealthpilot.theme', t); document.documentElement.dataset.theme = t }, theme)
  for (const pg of pages) { await p.goto(BASE + '#' + pg); await p.waitForTimeout(500); await p.evaluate(t => { document.documentElement.dataset.theme = t }, theme); for (const f of await audit()) (all[`${theme} ${f.cls} ${f.fg} on ${f.bg}`] ||= { ...f, theme, pages: [] }).pages.push(pg) }
  // settings tabs
  for (const tab of ['Categories', 'Payee rules', 'Members', 'Security', 'Backup & data', 'Activity log']) { await p.goto(BASE + '#/settings'); await p.waitForTimeout(300); await p.click(`.seg button:has-text("${tab}")`); await p.waitForTimeout(300); for (const f of await audit()) (all[`${theme} ${f.cls} ${f.fg} on ${f.bg}`] ||= { ...f, theme, pages: [] }).pages.push('settings/' + tab) }
  // dialogs + toast + messages
  await p.goto(BASE + '#/transactions'); await p.waitForTimeout(500)
  const dlg = async (name, fn) => { try { await fn(); await p.waitForTimeout(400); for (const f of await audit()) (all[`${theme} ${f.cls} ${f.fg} on ${f.bg}`] ||= { ...f, theme, pages: [] }).pages.push('dialog:' + name); await p.keyboard.press('Escape'); const x = p.locator('.mclose'); if (await x.count()) await x.first().click().catch(() => {}) } catch (e) { console.log('dialog fail', name, e.message.split('\n')[0]) } }
  await dlg('add transaction', () => p.click('button:has-text("Add transaction"), button:has-text("+ Add")'))
  await p.goto(BASE + '#/connections'); await p.waitForTimeout(400)
  await p.goto(BASE + '#/email'); await p.waitForTimeout(500)
  await dlg('email setup', () => p.click('button:has-text("Settings"), button:has-text("Set up")'))
  await dlg('paste tester', () => p.click('button:has-text("Paste")'))
  await p.goto(BASE + '#/settings'); await p.click('.seg button:has-text("Members")'); await p.waitForTimeout(300)
  await dlg('access change', () => p.click('table.tbl button:has-text("Change")').catch(() => {}))
  await p.evaluate(() => { const s = window.__wpToast; }); await p.goto(BASE + '#/budget'); await p.waitForTimeout(500)
  await p.evaluate(() => document.querySelector('body').insertAdjacentHTML('beforeend', '<div class="toasts"><div class="toast">Saved sample toast</div><div class="toast err">Error sample toast</div></div><div style="position:fixed;top:5px;left:5px;z-index:99;width:400px"><div class="banner">Warn banner text</div><div class="banner info">Info banner</div><div class="banner crit">Crit banner</div><div class="banner good">Good banner</div><div class="msg">Info msg</div><div class="msg crit">Crit msg</div><div class="msg good">Good msg</div><div class="msg warn">Warn msg</div><span class="pill good">good</span><span class="pill warn">warn</span><span class="pill crit">crit</span><span class="pill info">info</span><span class="pill idle">idle</span></div>'))
  for (const f of await audit()) (all[`${theme} ${f.cls} ${f.fg} on ${f.bg}`] ||= { ...f, theme, pages: [] }).pages.push('samples')
  await p.reload(); await p.waitForTimeout(600)
}
const rows = Object.values(all).sort((a, b) => a.ratio - b.ratio)
console.log(rows.length, 'distinct low-contrast combinations'); for (const r of rows.slice(0, 60)) console.log(`${r.theme} ${r.ratio}/${r.need} ${r.cls} "${r.txt}" ${r.fg} on ${r.bg} [${[...new Set(r.pages)].slice(0, 4).join(', ')}]`)
await b.close()
