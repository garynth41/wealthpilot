// The bank-sync edge function runs the same dedupe and reconcile rulebooks as the app. This copies them from src/lib into the function
// folder (`npm run engines:sync`) or verifies the copies are identical (`--check`, run by CI and the unit tests) so they can never drift.
import { readFileSync, writeFileSync } from 'node:fs'
const pairs = [['src/lib/dedupe.ts', 'supabase/functions/sync-simplefin/dedupe.ts'], ['src/lib/reconcile.ts', 'supabase/functions/sync-simplefin/reconcile.ts'], ['src/lib/notify.ts', 'supabase/functions/notify/notify.ts'], ['src/lib/prices.ts', 'supabase/functions/price-feed/prices.ts']]
const check = process.argv.includes('--check'); let bad = 0
for (const [src, dst] of pairs) {
  const a = readFileSync(src, 'utf8'); let b = ''; try { b = readFileSync(dst, 'utf8') } catch { /* missing */ }
  if (a === b) { console.log(`ok       ${dst}`); continue }
  if (check) { console.log(`DIFFERS  ${dst} (run: npm run engines:sync)`); bad++ } else { writeFileSync(dst, a); console.log(`updated  ${dst}`) }
}
if (bad) process.exit(1)
