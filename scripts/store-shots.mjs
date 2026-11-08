// Store screenshots (0.25.1) — `npm run build && npm run store:shots` (PW_CHROMIUM=/path/to/chrome if Playwright's own browser is missing).
// Opens the built app's offline demo at each store's phone size and saves, per device:
//   store/screenshots/<device>/raw/NN-page.png   the app exactly as it looks (no frame, no text)
//   store/screenshots/<device>/NN-page.png       the same screen under a one-line caption — what goes in the listing
// Devices: App Store "iPhone with Dynamic Island (large display)" 1320 × 2868 and "(medium display)" 1206 × 2622 — Apple scales these to
// every other iPhone — and a Google Play phone 1080 × 2112 (9:17.6, inside Google's 2:1 limit). PNGs are flattened (no transparency,
// which Apple rejects). The sample data's bank, insurer and person names are swapped for generic ones first, so the listing shows no
// third-party brands or real names. The same renamed sample household is saved as store/review-household.json: restore it (Settings →
// Backup & data → Restore) into the App Review account so reviewers see a lived-in household (see docs/STORE_LAUNCH.md).
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../dist', import.meta.url)), PORT = 4188
const DEVICES = [
  { id: 'iphone-6.9', w: 440, h: 956, scale: 3 },     // 1320 × 2868
  { id: 'iphone-6.3', w: 402, h: 874, scale: 3 },     // 1206 × 2622
  { id: 'android-phone', w: 360, h: 704, scale: 3 },  // 1080 × 2112
]
const SCREENS = [
  ['/', 'dashboard', 'Your household’s money at a glance', 'Safe to spend, what’s due and where you stand'],
  ['/budget', 'budget', 'A budget for every paycheck', 'Plan it, track it, roll it over'],
  ['/bills', 'bills', 'Never miss a bill', 'Reminders before it’s due, one tap to mark paid'],
  ['/debts', 'debts', 'A clear way out of debt', 'Avalanche or snowball, with your payoff date'],
  ['/forecast', 'forecast', 'See your cash before it happens', 'A day-by-day forecast with what-ifs'],
  ['/goals', 'goals', 'Save for what matters', 'Goals, milestones and progress you share'],
]
// sample-data names → neutral ones (longest first, so "Chase Freedom" goes before "Chase")
const RENAME = Object.entries({
  'Huntington Checking': 'Everyday Checking', 'Chase Total Checking': 'Joint Checking', 'Ally Savings': 'High-Yield Savings', 'Fidelity 401(k)': 'Workplace 401(k)',
  'Chase Freedom': 'Rewards Card', 'Amex Blue Cash': 'Cash-Back Card', 'Discover it': 'Travel Card', 'Schwab brokerage': 'Brokerage', 'Pay off Amex': 'Pay off the cash-back card',
  'Amex payment': 'Cash-back card payment', 'Chase payment': 'Rewards card payment', 'Discover payment': 'Travel card payment', 'Huntington auto loan': 'Auto loan',
  'American Express': 'Card issuer', 'Huntington': 'Community Bank', 'Fidelity Freedom 2050': 'Target Date 2050 Fund', 'Fidelity US Bond Index': 'US Bond Index Fund',
  'Vanguard Total Stock Market ETF': 'Total Stock Market ETF', 'Johnson & Johnson': 'Healthcare stock', 'Fidelity': 'Plan provider', 'Schwab': 'Brokerage', 'Chase': 'Card bank', 'Amex': 'Cash-back card',
  'Ally': 'Online bank', 'Discover': 'Travel card', 'AEP Ohio electric': 'Electric', 'AEP Ohio': 'Electric company', 'Columbia Gas': 'Gas utility', 'Spectrum internet': 'Internet',
  'Spectrum': 'Internet provider', 'Verizon': 'Phone plan', 'GEICO auto': 'Car insurance', 'GEICO': 'Car insurer', 'Netflix': 'Streaming', 'Spotify': 'Music', 'Planet Fitness': 'Gym',
  'Kroger': 'Grocery store', 'Olentangy Property Mgmt': 'Property manager', 'Meridian Aviation Group': 'Employer', 'Paycheck — Meridian': 'Paycheck', 'Anthem': 'Health insurer',
  'Haven Life': 'Life insurer', 'Progressive': 'Car insurer', '2021 Honda CR-V': 'Family SUV', 'Auto — Honda CR-V': 'Auto — family SUV', 'Honda CR-V': 'family SUV',
  'Sample household (demo)': 'Our household', 'Thomas household (demo)': 'Our household', 'Thomas household': 'Our household', 'Gary': 'Alex',
}).sort((a, b) => b[0].length - a[0].length)

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2' }
const isFile = f => { try { return statSync(f).isFile() } catch { return false } }
const srv = createServer((req, res) => { let p = join(root, decodeURIComponent(req.url.split('?')[0].split('#')[0])); if (!isFile(p)) p = join(root, 'index.html'); res.setHeader('Content-Type', types[extname(p)] || 'application/octet-stream'); res.end(readFileSync(p)) })
await new Promise(r => srv.listen(PORT, r))
const font = (pkg, file) => `data:font/woff2;base64,${readFileSync(`node_modules/@fontsource/${pkg}/files/${file}`).toString('base64')}`
const FONTS = `@font-face{font-family:Cap;font-weight:700;src:url(${font('space-grotesk', 'space-grotesk-latin-700-normal.woff2')})}@font-face{font-family:Sub;font-weight:500;src:url(${font('ibm-plex-sans', 'ibm-plex-sans-latin-500-normal.woff2')})}`

const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
for (const d of DEVICES) {
  const dir = `store/screenshots/${d.id}`; mkdirSync(`${dir}/raw`, { recursive: true })
  const ctx = await b.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.scale, isMobile: true, hasTouch: true, colorScheme: 'light', timezoneId: 'America/New_York', locale: 'en-US' })
  // the sample household seen late in a month (the 24th, or SHOT_DATE), so the month's numbers are settled — early in a month the rent is
  // paid and the second paycheck has not come yet, which makes "this period" look worse than the household really is
  const at = process.env.SHOT_DATE ? new Date(process.env.SHOT_DATE) : (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 24, 10) })()
  await ctx.clock.setFixedTime(at)
  const p = await ctx.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message))
  await p.goto(`http://localhost:${PORT}/`); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(500)
  await p.click('text=Open the offline demo'); await p.waitForTimeout(1200)
  // neutral names in the stored sample data, then reload so every page reads them
  await p.evaluate(([pairs]) => { const k = 'wealthpilot.demo'; let s = localStorage.getItem(k); if (!s) throw new Error('no demo data'); for (const [f, t] of pairs) s = s.split(f).join(t); localStorage.setItem(k, s) }, [RENAME])
  await p.reload(); await p.waitForTimeout(1200)
  if (d === DEVICES[0]) {   // the review account's starting data: the renamed sample household, in the backup file format
    const demo = await p.evaluate(() => JSON.parse(localStorage.getItem('wealthpilot.demo') || 'null'))
    writeFileSync('store/review-household.json', JSON.stringify({ app: 'Cresari', exported_at: new Date().toISOString(), household: { ...(demo.household || {}), name: 'Our household' }, ...demo.data }, null, 1))
  }
  for (const [i, [path, name]] of SCREENS.entries()) {
    await p.goto(`http://localhost:${PORT}/#${path}`); await p.waitForTimeout(1400)
    await p.evaluate(() => { for (const el of document.querySelectorAll('.banner')) if (/^Offline demo/.test(el.textContent || '')) el.style.display = 'none'; window.scrollTo(0, 0) })
    const leftovers = await p.evaluate(() => document.body.innerText)
    for (const [from] of RENAME) if (from.length > 4 && leftovers.includes(from)) console.warn(`  ${d.id} ${path}: still shows "${from}"`)
    await p.waitForTimeout(250)
    await p.screenshot({ path: `${dir}/raw/${String(i + 1).padStart(2, '0')}-${name}.png` })
  }
  if (errors.length) console.warn(`  ${d.id}: page errors — ${errors.join(' | ')}`)
  await ctx.close()
  // captioned versions: the raw screen, a little smaller, under a caption on the app's dark ground
  const cctx = await b.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.scale }); const c = await cctx.newPage()
  for (const [i, [, name, title, sub]] of SCREENS.entries()) {
    const file = `${String(i + 1).padStart(2, '0')}-${name}.png`, img = `data:image/png;base64,${readFileSync(`${dir}/raw/${file}`).toString('base64')}`
    const capH = Math.round(d.h * 0.2), shotW = Math.round(d.w * 0.84)
    await c.setContent(`<!doctype html><html><head><style>${FONTS}html,body{margin:0;width:${d.w}px;height:${d.h}px;overflow:hidden;background:linear-gradient(160deg,#15181c 0%,#23272e 100%)}
      .cap{height:${capH}px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:0 ${Math.round(d.w * 0.07)}px;box-sizing:border-box}
      h1{font:700 ${Math.round(d.w * 0.068)}px/1.12 Cap,sans-serif;letter-spacing:-.02em;color:#fff;margin:0}
      p{font:500 ${Math.round(d.w * 0.039)}px/1.3 Sub,sans-serif;color:#c9ced6;margin:${Math.round(d.w * 0.02)}px 0 0} p b{color:#f97316;font-weight:500}
      .shot{width:${shotW}px;margin:0 auto;border-radius:${Math.round(d.w * 0.06)}px ${Math.round(d.w * 0.06)}px 0 0;overflow:hidden;box-shadow:0 0 0 ${Math.max(2, Math.round(d.w * 0.012))}px #3a4049,0 18px 50px rgba(0,0,0,.5)}
      .shot img{display:block;width:100%}</style></head><body><div class="cap"><h1>${title}</h1><p>${sub}</p></div><div class="shot"><img src="${img}"></div></body></html>`)
    await c.waitForTimeout(150)
    await c.screenshot({ path: `${dir}/${file}` })
  }
  await cctx.close(); console.log(`${d.id}: ${SCREENS.length} screens at ${d.w * d.scale} × ${d.h * d.scale}`)
}
await b.close(); srv.close()
