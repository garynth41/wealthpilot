// Draws Cresari's icons and artwork from the Cresari mark — `npm run native:assets`:
//   public/favicon.svg, icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png   the web app's icons
//   assets/icon-only.png        1024² App Store / launcher icon (square, opaque — iOS rounds the corners itself)
//   assets/icon-foreground.png  1024² Android adaptive icon foreground (the mark inside the 66% safe zone, transparent)
//   assets/icon-background.png  1024² Android adaptive icon background (white)
//   assets/splash.png / splash-dark.png  2732² launch screens (white; deep navy in dark mode)
//   android notification icon   white mark on transparent, every density (only if android/ exists)
//   store/feature-graphic.png   1024×500 Google Play feature graphic; store/play-icon-512.png the 512² Play listing icon
// then runs @capacitor/assets to produce every size iOS and Android need. Playwright renders the SVG, so the result is identical anywhere.
//
// The mark (0.29.2, from Gary's artwork): three navy bars with slanted tops, rising left to right, under a gold arrow pointing up and
// to the right, on white. Same paths as src/components/Logo.tsx and the public pages — change all of them together.
import { chromium } from 'playwright'
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const WHITE = '#ffffff', NAVY = '#002a50', GOLD = '#c39139', NIGHT = '#0b1a2b', NIGHT_BARS = '#e8eef6'
const glyph = (bars = NAVY, arrow = GOLD) =>
  `<g fill="${bars}"><path d="M16.4 42.9 L24.4 38.9 V53.8 H16.4 Z"/><path d="M27.4 35.9 L35.8 31.7 V53.8 H27.4 Z"/><path d="M38.6 29 L47.4 24.5 V53.8 H38.6 Z"/></g>` +
  `<path fill="${arrow}" d="M16.4 40.2 L38.9 23.3 L33.4 17.6 L47.6 9.6 L47.4 21.9 Z"/>`
// the mark's own bounding box is x 16.4–47.6, y 9.6–53.8: centre (32, 31.7)
const centred = (scale, g) => `<g transform="translate(32 32) scale(${scale}) translate(-32 -31.7)">${g}</g>`
const svg = (w, h, body, bg = null, rx = 0) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 64 ${64 * h / w}">${bg ? `<rect width="64" height="${64 * h / w}" rx="${rx}" fill="${bg}"/>` : ''}${body}</svg>`

const jobs = [
  // web app: the tab icon and the "any" install icons are rounded white tiles; maskable and Apple touch icons are full-bleed (the system crops them)
  ['public/icon-192.png', 192, 192, svg(192, 192, centred(0.95, glyph()), WHITE, 12)],
  ['public/icon-512.png', 512, 512, svg(512, 512, centred(0.95, glyph()), WHITE, 12)],
  ['public/icon-maskable-512.png', 512, 512, svg(512, 512, centred(0.8, glyph()), WHITE)],
  ['public/apple-touch-icon.png', 180, 180, svg(180, 180, centred(1.0, glyph()), WHITE)],
  // phone apps and stores
  ['assets/icon-only.png', 1024, 1024, svg(1024, 1024, centred(1.0, glyph()), WHITE)],
  ['assets/icon-foreground.png', 1024, 1024, svg(1024, 1024, centred(0.7, glyph()))],
  ['assets/icon-background.png', 1024, 1024, svg(1024, 1024, '', WHITE)],
  ['store/play-icon-512.png', 512, 512, svg(512, 512, centred(1.0, glyph()), WHITE)],
  ['assets/splash.png', 2732, 2732, svg(2732, 2732, centred(0.36, glyph()), WHITE)],
  ['assets/splash-dark.png', 2732, 2732, svg(2732, 2732, centred(0.36, glyph(NIGHT_BARS, GOLD)), NIGHT)],
]
writeFileSync('public/favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n  <rect width="64" height="64" rx="12" fill="${WHITE}"/>\n  ${centred(0.95, glyph())}\n</svg>\n`); console.log('drew public/favicon.svg')
const notif = [['mdpi', 24], ['hdpi', 36], ['xhdpi', 48], ['xxhdpi', 72], ['xxxhdpi', 96]]
if (existsSync('android/app/src/main/res')) for (const [d, px] of notif) jobs.push([`android/app/src/main/res/drawable-${d}/ic_stat_cresari.png`, px, px, svg(px, px, centred(1.3, glyph(WHITE, WHITE)))])
const feature = `<!doctype html><html><head><style>html,body{margin:0}body{width:1024px;height:500px;background:linear-gradient(135deg,#ffffff 0%,#eef2f7 100%);display:flex;align-items:center;gap:48px;padding:0 70px;box-sizing:border-box;font-family:'Helvetica Neue',Arial,sans-serif;color:${NAVY}}h1{margin:0;font-size:76px;letter-spacing:-2px;font-weight:800}p{margin:10px 0 0;font-size:30px;color:#33475e;line-height:1.25}b{color:#9a6b17}</style></head><body>${svg(230, 230, centred(1.0, glyph()), WHITE, 12).replace('<svg ', '<svg style="flex:none;box-shadow:0 12px 40px rgba(0,42,80,.18);border-radius:44px" ')}<div><h1>Cresari</h1><p>Your household's money in one place —<br/><b>budget, bills, debts, goals</b> and the plan.</p></div></body></html>`

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
  execSync(`npx capacitor-assets generate --ios --android --iconBackgroundColor '${WHITE}' --iconBackgroundColorDark '${WHITE}' --splashBackgroundColor '${WHITE}' --splashBackgroundColorDark '${NIGHT}'`, { stdio: 'inherit' })
}
