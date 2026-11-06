// staging-admin (0.25.0) — deployed to the STAGING project only, never to production. Applies a SQL file from this repository
// (supabase/staging/schema.sql, a newer migration, supabase/staging/e2e.sql) to the staging database, so schema changes reach
// staging without pasting SQL anywhere. Locked by an admin token held as this function's secret; refuses to run on production.
import postgres from 'npm:postgres@3.4.5'
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
Deno.serve(async (req) => {
  if ((Deno.env.get('SUPABASE_URL') || '').includes('dshswfcpovdpxcidolqb')) return json(403, { error: 'never on production' })
  const tok = Deno.env.get('STAGING_ADMIN_TOKEN') || ''
  if (tok.length < 32 || req.headers.get('x-admin-token') !== tok) return json(401, { error: 'admin token required' })
  let b: { url?: string; replace?: Record<string, string> }; try { b = await req.json() } catch { return json(400, { error: 'JSON body expected' }) }
  const url = String(b.url || ''); if (!/^https:\/\/raw\.githubusercontent\.com\/garynth41\/wealthpilot\/[\w./-]+\.sql$/.test(url)) return json(400, { error: 'only .sql files from the wealthpilot repository' })
  const r = await fetch(url); if (!r.ok) return json(400, { error: `fetch ${r.status}` })
  let text = await r.text(); for (const [k, v] of Object.entries(b.replace || {})) if (/^__[A-Z_]+__$/.test(k)) text = text.replaceAll(k, v)
  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false })
  try { await sql.begin(async tx => { await tx.unsafe(text) }); return json(200, { ok: true, bytes: text.length }) }
  catch (e) { return json(500, { ok: false, error: (e as Error).message, detail: (e as { position?: string; where?: string }).where || null, position: (e as { position?: string }).position || null }) }
  finally { await sql.end({ timeout: 5 }) }
})
