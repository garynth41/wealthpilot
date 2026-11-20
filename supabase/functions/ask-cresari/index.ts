// ask-cresari — the advisor (0.32.0). A signed-in member of a household asks a money question; this function checks that the advisor is
// open to them and that they are under their daily limit (public.ai_reserve — counted before anything is sent), sends the question with
// the summary the app built on the person's device to the AI service, and returns the answer.
//   - The key for the AI service is the secret ANTHROPIC_API_KEY. It never reaches the app.
//   - Nothing about the question or the answer is stored: ai_usage keeps who, when and the token counts.
//   - Who may ask, the daily limits and the model are settings in app_meta the operator changes from Feedback & testers (migration 0023).
// Secrets: ANTHROPIC_API_KEY
import { createClient } from 'npm:@supabase/supabase-js@2'
import { prepare, buildRequest, readReply, refusal, type AskBody } from './core.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const TIMEOUT_MS = 55000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  const auth = req.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return json(401, { error: 'Sign in first' })
  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const asUser = createClient(url, anon, { global: { headers: { Authorization: auth } } })
  const { data: { user }, error: uErr } = await asUser.auth.getUser()
  if (uErr || !user) return json(401, { error: 'Sign in first' })

  let b: AskBody
  try { b = await req.json() } catch { return json(400, { error: 'Bad JSON' }) }
  if (!b.household_id || typeof b.household_id !== 'string') return json(400, { error: 'household_id required' })
  const p = prepare(b)
  if ('error' in p) return json(400, { error: p.error })
  const key = Deno.env.get('ANTHROPIC_API_KEY')
  if (!key) return json(503, { error: 'Ask Cresari is not set up yet' })

  // counted first: a question that cannot be recorded is not sent
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: r, error: rErr } = await admin.rpc('ai_reserve', { p_user: user.id, p_household: b.household_id, p_detail: p.detail })
  if (rErr || !r) return json(500, { error: 'Could not check your access — try again' })
  if (!r.ok) { const no = refusal(String(r.reason), Number(r.limit) || 0); return json(no.status, { error: no.error, limit: r.limit ?? 0, used: r.used ?? 0 }) }
  const giveBack = async () => { try { await admin.rpc('ai_finish', { p_id: r.id, p_ok: false }) } catch { /* it stops counting on its own after ten minutes */ } }

  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(buildRequest(String(r.model), p)),
    })
    if (!res.ok) {
      // the status only — never the question, the data or the service's reply
      console.error('ask-cresari: AI service replied', res.status, 'model', r.model)
      await giveBack()
      return json(502, { error: res.status === 429 || res.status === 529 ? 'The AI service is busy right now — try again in a minute' : 'Ask Cresari could not get an answer just now — try again', limit: r.limit, used: Math.max(0, Number(r.used) - 1) })
    }
    const out = readReply(await res.json())
    if (!out.text) { await giveBack(); return json(502, { error: 'Ask Cresari came back empty — try asking again', limit: r.limit, used: Math.max(0, Number(r.used) - 1) }) }
    await admin.rpc('ai_finish', { p_id: r.id, p_ok: true, p_in: out.input, p_out: out.output })
    return json(200, { answer: out.text, limit: r.limit, used: r.used })
  } catch (e) {
    console.error('ask-cresari:', e instanceof Error ? e.name : 'error')
    await giveBack()
    return json(504, { error: 'Ask Cresari took too long — try again', limit: r.limit, used: Math.max(0, Number(r.used) - 1) })
  } finally { clearTimeout(timer) }
})
