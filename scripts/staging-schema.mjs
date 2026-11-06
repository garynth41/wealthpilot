// Staging database (0.25.0): every migration in order, minus what only production should run — the pg_cron jobs that call the
// production edge functions and anything marked [prod-only] … [/prod-only]. `node scripts/staging-schema.mjs > /tmp/schema.sql`
// (or `--from 0018` for just the newer migrations) prints the SQL to apply to the staging project before production.
import { readFileSync, readdirSync } from 'node:fs'
const dir = new URL('../supabase/migrations/', import.meta.url)
const from = (() => { const i = process.argv.indexOf('--from'); return i > 0 ? process.argv[i + 1] : '0000' })()
const strip = sql => sql
  .replace(/--\s*\[prod-only\][\s\S]*?--\s*\[\/prod-only\][^\n]*\n?/g, '-- (production-only section left out of staging)\n')
  .replace(/select\s+cron\.unschedule\([^;]*;\s*/gi, '')
  .replace(/select\s+cron\.schedule\([\s\S]*?\$(job)?\$\s*\);\s*/gi, '-- (scheduled job left out of staging)\n')
const files = readdirSync(dir).filter(f => /^\d{4}_.*\.sql$/.test(f) && f.slice(0, 4) >= from).sort()
let out = `-- WealthPilot staging schema: ${files.length} migration(s) from ${files[0]} to ${files[files.length - 1]}, production-only jobs removed\n`
for (const f of files) { const s = strip(readFileSync(new URL(f, dir), 'utf8')); if (/cron\.schedule|functions\/v1\//.test(s)) { console.error(`${f}: still calls production after stripping — mark it [prod-only]`); process.exit(1) } out += `\n-- ===== ${f} =====\n${s}\n` }
process.stdout.write(out)
