// DB mode: sign in with the confirmed e2e user, open the household, add a transaction, check it persisted and the budget period starts via RPC.
import { chromium } from 'playwright'
import { createServer } from 'node:http'; import { readFileSync, existsSync } from 'node:fs'; import { join, extname } from 'node:path'
const root = new URL('../dist', import.meta.url).pathname; const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
const srv = createServer((req, res) => { let p = join(root, req.url.split('?')[0].split('#')[0]); if (!existsSync(p) || p.endsWith('/')) p = join(root, 'index.html'); res.setHeader('Content-Type', types[extname(p)] || 'text/plain'); res.end(readFileSync(p)) }).listen(4176)
let F = 0; const ok = (c, m) => { if (!c) F++; console.log((c ? 'PASS ' : 'FAIL ') + m) }
const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}); const p = await b.newPage({ viewport: { width: 1400, height: 950 } }); const errors = []; p.on('pageerror', e => errors.push(e.message))
await p.goto('http://localhost:4176/'); await p.waitForTimeout(800); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(600)
await p.fill('#email', process.env.E2E_EMAIL); await p.fill('#pw', process.env.E2E_PW); await p.click('button:has-text("Sign in")'); await p.waitForTimeout(4000)
ok((await p.locator('h1').first().textContent()) === 'Dashboard', 'signs in and opens the household on the Dashboard')
ok(!(await p.locator('text=Offline demo').count()), 'not in demo mode')
await p.goto('http://localhost:4176/#/transactions'); await p.waitForTimeout(1500); const n0 = await p.locator('table.tbl tbody tr').count()
await p.click('text=+ Add transaction'); await p.waitForTimeout(400); await p.fill('input[placeholder="0.00"]', '19.99'); await p.fill('input[placeholder="Kroger, Landlord, Employer…"]', 'E2E payee'); await p.click('.modal button:has-text("Save")'); await p.waitForTimeout(2500)
await p.reload(); await p.waitForTimeout(4000); const n1 = await p.locator('table.tbl tbody tr').count(); ok(n1 === n0 + 1, `transaction persisted in Supabase (${n0} → ${n1})`)
await p.goto('http://localhost:4176/#/budget'); await p.waitForTimeout(1500); ok(await p.locator('text=Spending plan').count() === 1, 'budget period exists (started by RPC earlier)')
await p.goto('http://localhost:4176/#/settings'); await p.waitForTimeout(1200); await p.click('button:has-text("Activity log")'); await p.waitForTimeout(800); ok((await p.locator('table.tbl tbody tr').count()) > 5, 'activity log shows database audit rows')
await p.click('button:has-text("Members")'); await p.waitForTimeout(500); ok((await p.locator('table.tbl tbody tr').count()) === 1, 'members list shows the owner')
await p.screenshot({ path: 'e2e/shots/db_settings.png', fullPage: true })
ok(!errors.length, 'no page errors ' + errors.join(' | ')); console.log('db fails', F); await b.close(); srv.close()
