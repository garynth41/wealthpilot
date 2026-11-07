// Database tests on a plain local Postgres (0.25.1): every migration, applied in order to an empty database with a small stand-in for
// what Supabase provides (supabase/tests/stub.sql), the staging test helpers (supabase/staging/e2e.sql), then each supabase/tests/*.test.sql.
// It catches a migration that does not run, or does not run twice, before staging ever sees it, and checks account deletion, the
// membership and alert guards and the account-number scrub row by row. It never touches staging or production.
// Needs psql and a Postgres 15+ server reached through the usual PGHOST / PGPORT / PGUSER / PGPASSWORD (CI starts one; on your own
// computer: `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16`, then PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres).
import { spawnSync, execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'

const root = new URL('..', import.meta.url).pathname
const db = `wealthpilot_test_${process.pid}`
let failed = 0, passed = 0

/** psql with the SQL on stdin; notices (where PASS lines arrive) and errors come back on stderr */
function psql(database, sql, { quiet = false } = {}) {
  const r = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', database], { input: sql, encoding: 'utf8', cwd: root, maxBuffer: 64 << 20 })
  if (r.error) throw new Error(`psql could not start (${r.error.message}) — install the PostgreSQL client`)
  for (const line of (r.stderr || '').split('\n')) {
    const pass = /NOTICE:\s+PASS (.*)/.exec(line); if (pass) { passed++; if (!quiet) console.log('PASS ' + pass[1]); continue }
    const err = /(ERROR|FATAL):\s+(.*)/.exec(line); if (err) { failed++; console.log((/^FAIL/.test(err[2]) ? '' : 'FAIL ') + err[2]) }
  }
  return r.status === 0
}
const step = (name, ok) => { if (ok) console.log(`ok   ${name}`); else { console.log(`FAIL ${name}`); failed += failed ? 0 : 1 } return ok }

if (!psql('postgres', `create database ${db};`, { quiet: true })) { console.error('could not create a test database — is a Postgres server running (PGHOST, PGUSER, PGPASSWORD)?'); process.exit(1) }
try {
  // the staging schema (production-only jobs left out); pg_cron and pg_net are Supabase extensions, and the jobs that need them are not in it
  const schema = (from = '0000') => execFileSync('node', ['scripts/staging-schema.mjs', '--from', from], { cwd: root, encoding: 'utf8' })
    .replace(/^create extension (if not exists )?pg_(cron|net)( schema extensions)?;/gm, '-- (no pg_$2 here)')
  const e2e = readFileSync(`${root}supabase/staging/e2e.sql`, 'utf8').replace(/__(OWNER|VIEWER)_HASH__/g, '$2a$10$' + 'x'.repeat(53))
  const migrations = readdirSync(`${root}supabase/migrations`).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()
  const ok = step('the Supabase stand-in', psql(db, readFileSync(`${root}supabase/tests/stub.sql`, 'utf8')))
    && step(`all ${migrations.length} migrations, in order, on an empty database`, psql(db, schema()))
    && step(`the newest migration again (${migrations.at(-1)}: each one must be safe to re-run)`, psql(db, schema(migrations.at(-1).slice(0, 4))))
    && step('the staging test helpers (e2e.sql)', psql(db, e2e))
  if (ok) for (const f of readdirSync(`${root}supabase/tests`).filter(f => f.endsWith('.test.sql')).sort()) {
    console.log(`\n${f}`)
    // each file on a database of its own, so one file's rows never change another's results
    const one = `${db}_${f.replace(/\W+/g, '_').slice(0, 30)}`
    psql('postgres', `create database ${one} template ${db};`, { quiet: true })
    try { if (!psql(one, readFileSync(`${root}supabase/tests/${f}`, 'utf8'))) failed += failed ? 0 : 1 } finally { psql('postgres', `drop database if exists ${one};`, { quiet: true }) }
  }
} finally {
  psql('postgres', `drop database if exists ${db};`, { quiet: true })
}
console.log(`\n${passed} passed${failed ? `, ${failed} failed` : ''}`)
process.exit(failed ? 1 : 0)
