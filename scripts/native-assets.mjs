// Draws the phone apps' artwork from the WealthPilot mark (public/favicon.svg) — `npm run native:assets`:
//   assets/icon-only.png        1024² App Store / launcher icon (square, opaque — iOS rounds the corners itself)
//   assets/icon-foreground.png  1024² Android adaptive icon foreground (the mark inside the 66% safe zone, transparent)
//   assets/icon-background.png  1024² Android adaptive icon background (the dark tile)
//   assets/splash.png / splash-dark.png  2732² launch screens
//   android notification icon   white mark on transparent, every density (only if android/ exists)
//   store/feature-graphic.png   1024×500 Google Play feature graphic; store/play-icon-512.png the 512² Play listing icon
// then runs @capacitor/assets to produce every size iOS and Android need. Playwright renders the SVG, so the result is identical anywhere.
import { chromium } from 'playwright'
import { mkdirSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

const BG = '#15181c', ORANGE = '#f97316'
const glyph = (stroke = '#ffffff', accent = ORANGE) => `<path d="M12 46 L22 32 L30 39 L42 22" fill="none" stroke="${stroke}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M54 11 L48 29 L44 22 L36 19.5 Z" fill="${accent}"/><circle cx="12" cy="46" r="3.4" fill="${accent}"/>`
// the mark's own bounding box is about x 8.6–54, y 11–49.4: centre (31.3, 30.2)
const centred = (scale, g) => `<g transform="translate(32 32) scale(${scale}) translate(-31.3 -30.2)">${g}</g>`
const svg = (w, h, body, bg = null) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 64 ${64 * h / w}">${bg ? `<rect width="64" height="${64 * h / w}" fill="${bg}"/>` : ''}${body}</svg>`

const jobs = [
  ['assets/icon-only.png', 1024, 1024, svg(1024, 1024, centred(1.0, glyph()), BG)],
  ['assets/icon-foreground.png', 1024, 1024, svg(1024, 1024, centred(0.62, glyph()))],
  ['assets/icon-background.png', 1024, 1024, svg(1024, 1024, '', BG)],
  ['store/play-icon-512.png', 512, 512, svg(512, 512, centred(1.0, glyph()), BG)],
  ['assets/splash.png', 2732, 2732, svg(2732, 2732, centred(0.36, glyph()), BG)],
  ['assets/splash-dark.png', 2732, 2732, svg(2732, 2732, centred(0.36, glyph()), BG)],
]
const notif = [['mdpi', 24], ['hdpi', 36], ['xhdpi', 48], ['xxhdpi', 72], ['xxxhdpi', 96]]
if (existsSync('android/app/src/main/res')) for (const [d, px] of notif) jobs.push([`android/app/src/main/res/drawable-${d}/ic_stat_wealthpilot.png`, px, px, svg(px, px, centred(1.25, glyph('#ffffff', '#ffffff')))])
const feature = `<!doctype html><html><head><style>html,body{margin:0}body{width:1024px;height:500px;background:linear-gradient(135deg,${BG} 0%,#23272e 100%);display:flex;align-items:center;gap:44px;padding:0 70px;box-sizing:border-box;font-family:'Helvetica Neue',Arial,sans-serif;color:#fff}h1{margin:0;font-size:76px;letter-spacing:-2px;font-weight:800}p{margin:10px 0 0;font-size:30px;color:#c9ced6;line-height:1.25}b{color:${ORANGE}}</style></head><body>${svg(230, 230, centred(1.0, glyph()), BG).replace('<svg ', '<svg style="border-radius:44px;flex:none;box-shadow:0 12px 40px rgba(0,0,0,.45)" ')}<div><h1>WealthPilot</h1><p>Your household's money in one place —<br/><b>budget, bills, debts, goals</b> and the plan.</p></div></body></html>`

const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
for (const [file, w, h, markup] of jobs) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  await p.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${markup}</body></html>`)
  mkdirSync(file.split('/').slice(0, -1).join('/'), { recursive: true })
  await p.locator('svg').screenshot({ path: file, omitBackground: true }); await p.close(); console.log('drew', file)
}
mkdirSync('store', { recursive: true })
const p = await b.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 }); await p.setContent(feature); await p.screenshot({ path: 'store/feature-graphic.png' }); console.log('drew store/feature-graphic.png')
await b.close()
if (!process.argv.includes('--no-generate') && (existsSync('android') || existsSync('ios'))) {
  execSync(`npx capacitor-assets generate --ios --android --iconBackgroundColor '${BG}' --iconBackgroundColorDark '${BG}' --splashBackgroundColor '${BG}' --splashBackgroundColorDark '${BG}'`, { stdio: 'inherit' })
}
