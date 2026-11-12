// notify — proactive alerts (migration 0011). Rules live in ./notify.ts (a copy of src/lib/notify.ts kept identical by scripts/sync-engines.mjs).
//   POST { action: "run_daily" }   x-cron-secret: evaluate every household's rules, send what is new (push to every opted-in device, email when configured)
//   POST { action: "digest" }      x-cron-secret: the Monday digest (email + a short push)
//   POST { action: "test", household_id }   signed-in member: a test push to the caller's devices and a test email to the household address
//   POST { action: "preview", household_id } signed-in member: the alerts the rules would send right now, without sending
// Limited access (0.25.1): a member whose modules list only some sections gets only the deletion notice (recipientsFor), and may not use
// preview or test — both answer 403 "Alerts need full access", since alerts carry money from every section.
// Delivery: Web Push via VAPID (secrets VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT); email via Resend (RESEND_API_KEY, EMAIL_FROM) —
// without a Resend key, email rows are logged as 'skipped' and everything else still works. Quiet hours: the cron runs at 07:30 Eastern.
// Never sent: transaction memos, account numbers, anything beyond the alert's own title/body (amounts, payees, dates).
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { computeAlerts, computeDigest, recipientsFor, isLimitedMember, DIGEST_NOTICES, type Alert, type NInput, type NMember, type NRouting } from './notify.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin = createClient(url, service, { auth: { persistSession: false } })
const APP_URL = Deno.env.get('APP_URL') || 'https://garynth41.github.io/wealthpilot/'
let VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') || '', VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') || ''; const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:garynthomas@gmail.com'
// read at send time (not module load) so a secret added after the instance booted is seen on the next call
const resendKey = () => Deno.env.get('RESEND_API_KEY') || '', emailFrom = () => Deno.env.get('EMAIL_FROM') || 'Cresari <onboarding@resend.dev>'
/** VAPID keys come from Vault (migration 0012, vapid_keys() is service-role only) unless set as function secrets. */
async function vapid() {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) { const { data } = await admin.rpc('vapid_keys'); const row = Array.isArray(data) ? data[0] : data; if (row?.public_key && row?.private_key) { VAPID_PUBLIC = row.public_key; VAPID_PRIVATE = row.private_key } }
  if (VAPID_PUBLIC && VAPID_PRIVATE) { try { webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE) } catch (e) { await logError(null, 'VAPID keys invalid: ' + (e as Error).message) } }
  return !!(VAPID_PUBLIC && VAPID_PRIVATE)
}

const todayET = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).toISOString().slice(0, 10)
const money = (n: number) => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
async function logError(household_id: string | null, message: string, context: Record<string, unknown> = {}) { try { await admin.from('app_errors').insert({ household_id, source: 'notify', message: message.slice(0, 2000), context }) } catch { /* */ } }

interface Prefs extends NRouting { bills?: boolean; low_cash?: boolean; large?: number | null; paycheck?: boolean; sync?: boolean; digest?: boolean; price_rise?: boolean; new_recurring?: boolean; reconcile?: boolean }
async function loadHousehold(hh: string) {
  const [h, acc, rec, occ, tx, pay, sync, members] = await Promise.all([
    admin.from('households').select('*').eq('id', hh).single(),
    admin.from('accounts').select('*').eq('household_id', hh),   // '*': `excluded` may not exist yet (migration 0020)
    admin.from('recurring').select('id, name, payee, kind, amount, amount_varies, frequency, day_of_month, next_due, starts_on, ends_on, status, autopay, account_id, liability_account_id').eq('household_id', hh),
    admin.from('bill_occurrences').select('recurring_id, due_date, status, transaction_id, amount').eq('household_id', hh).gte('due_date', new Date(Date.now() - 75 * 86400000).toISOString().slice(0, 10)),
    admin.from('transactions').select('id, date, kind, amount, payee, recurring_id, pay_schedule_id, created_at, status, duplicate_of, category_id, account_id, to_account_id').eq('household_id', hh).gte('date', new Date(Date.now() - 105 * 86400000).toISOString().slice(0, 10)),
    admin.from('pay_schedules').select('id, name, frequency, anchor_date, semimonthly_days, net_amount, starts_on, ends_on, status, deposit_account_id').eq('household_id', hh),
    admin.from('sync_connections').select('status, last_sync_at, last_error').eq('household_id', hh).maybeSingle(),
    admin.from('household_members').select('user_id, email, role, modules').eq('household_id', hh)])
  if (h.error) throw h.error
  const settings = (h.data.settings || {}) as Record<string, unknown>; const prefs = (settings.notify || {}) as Prefs
  const num = <T extends Record<string, unknown>>(r: T) => { const o = { ...r } as Record<string, unknown>; for (const k of ['balance', 'bank_balance', 'amount', 'net_amount']) if (k in o && o[k] != null) o[k] = Number(o[k]); return o as T }
  // Accounts left out of the household's figures (0.28.0, accounts.excluded): no alert or digest counts them, the rows that sit only on
  // them, the bills paid from them or the income deposited to them — the same line the app draws (src/lib/leftOut.ts).
  type Row = Record<string, unknown> & { id?: string; excluded?: boolean; account_id?: string | null; to_account_id?: string | null; liability_account_id?: string | null; deposit_account_id?: string | null; recurring_id?: string | null }
  const rowsOf = (r: { data: unknown }) => (r.data || []) as Row[]
  const off = new Set(rowsOf(acc).filter(a => a.excluded).map(a => a.id as string)); const isOff = (id?: string | null) => !!id && off.has(id)
  const counted = (rows: Row[], gone: (r: Row) => boolean): Row[] => (off.size ? rows.filter(r => !gone(r)) : rows)
  const accts = counted(rowsOf(acc), a => !!a.excluded)
  const txns = counted(rowsOf(tx), t => (isOff(t.account_id) ? !t.to_account_id || isOff(t.to_account_id) : !t.account_id && isOff(t.to_account_id)))
  const recs = counted(rowsOf(rec), r => isOff(r.account_id) || (!r.account_id && isOff(r.liability_account_id)))
  const pays = counted(rowsOf(pay), p => isOff(p.deposit_account_id))
  const kept = new Set(recs.map(r => r.id)); const occs = counted(rowsOf(occ), o => !kept.has(o.recurring_id as string))
  return { household: h.data, settings, prefs, members: (members.data || []) as NMember[], input: { today: todayET(), now: new Date().toISOString(), deletionScheduledFor: (h.data as { deletion_scheduled_for?: string | null }).deletion_scheduled_for ?? null, accounts: accts.map(num), recurring: recs.map(num), occurrences: occs.map(num), transactions: txns.map(num), paySchedules: pays.map(num), sync: sync.data || null, reserveFloor: Number(settings.reserveFloor || 0), includeRetirementInCash: !!settings.includeRetirementInCash, prefs } as unknown as NInput }
}

async function sendPush(hh: string, userIds: string[] | null, title: string, body: string, path: string, tag: string): Promise<{ sent: number; failed: number; detail: string }> {
  if (!(await vapid())) return { sent: 0, failed: 0, detail: 'push not configured (VAPID keys)' }
  let q = admin.from('push_subscriptions').select('id, endpoint, p256dh, auth, user_id, failures').eq('household_id', hh); if (userIds) q = q.in('user_id', userIds)
  const { data: subs } = await q; if (!subs?.length) return { sent: 0, failed: 0, detail: 'no devices opted in' }
  let sent = 0, failed = 0; const errs: string[] = []
  for (const s of subs) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title, body, url: APP_URL + '#' + path, tag }), { TTL: 6 * 3600 }); sent++; await admin.from('push_subscriptions').update({ last_used_at: new Date().toISOString(), failures: 0 }).eq('id', s.id) }
    catch (e) { failed++; const code = (e as { statusCode?: number }).statusCode; errs.push(String(code || (e as Error).message)); if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('id', s.id); else await admin.from('push_subscriptions').update({ failures: (s.failures || 0) + 1 }).eq('id', s.id) }
  }
  return { sent, failed, detail: errs.join(', ') }
}
async function sendEmail(to: string, subject: string, html: string, text: string): Promise<{ ok: boolean; detail: string }> {
  const key = resendKey(); if (!key) return { ok: false, detail: 'email not configured (RESEND_API_KEY)' }
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: emailFrom(), to: [to], subject, html, text }) })
  if (!r.ok) return { ok: false, detail: `Resend ${r.status}: ${(await r.text()).slice(0, 200)}` }
  return { ok: true, detail: 'sent' }
}
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
function alertEmail(name: string, alerts: Alert[]) {
  const rows = alerts.map(a => `<tr><td style="padding:8px 10px;border-bottom:1px solid #e6e9ed;color:${a.severity === 'crit' ? '#9a3412' : a.severity === 'warn' ? '#92400e' : '#3a4048'};font-weight:600">${esc(a.title)}</td><td style="padding:8px 10px;border-bottom:1px solid #e6e9ed;color:#5b6470">${esc(a.body)}</td><td style="padding:8px 10px;border-bottom:1px solid #e6e9ed"><a href="${APP_URL}#${a.url}" style="color:#b53a0a">Open</a></td></tr>`).join('')
  const html = `<div style="font-family:'IBM Plex Sans',Segoe UI,Arial,sans-serif;color:#15181c;max-width:640px"><h2 style="font-weight:700;margin:0 0 4px">Cresari — ${alerts.length} thing${alerts.length === 1 ? '' : 's'} need${alerts.length === 1 ? 's' : ''} attention</h2><div style="color:#5b6470;margin-bottom:14px">${esc(name)} · ${todayET()}</div><table style="border-collapse:collapse;width:100%;font-size:14px">${rows}</table><p style="color:#8b949e;font-size:12px;margin-top:16px">Sent by your Cresari. Change what you receive under Settings → Notifications.</p></div>`
  return { html, text: alerts.map(a => `• ${a.title} — ${a.body} (${APP_URL}#${a.url})`).join('\n') }
}

async function runDaily(hh: string) {
  const { household, prefs, members, input } = await loadHousehold(hh)
  const alerts = computeAlerts(input); if (!alerts.length) return { household_id: hh, alerts: 0, push: 0, email: 'none' }
  // per alert: who gets it (0.21.0 per-member channels); email keys carry the member so each person gets each alert once
  const routes = alerts.map(a => ({ a, r: recipientsFor(prefs, members, a.kind) }))
  const keys = [...new Set(routes.flatMap(({ a, r }) => [a.key, ...r.email.map(e => e.user_id ? `${a.key}@${e.user_id}` : a.key)]))]
  const { data: sentRows } = await admin.from('notifications').select('dedupe_key, channel').eq('household_id', hh).eq('status', 'sent').in('dedupe_key', keys)
  const already = new Set((sentRows || []).map(r => r.dedupe_key + '|' + r.channel))
  let pushN = 0
  for (const { a, r } of routes) {
    if (!r.push.length || already.has(a.key + '|push')) continue
    const res = await sendPush(hh, r.push, a.title, a.body, a.url, a.kind)
    await admin.from('notifications').insert({ household_id: hh, kind: a.kind, dedupe_key: a.key, title: a.title, body: a.body, url: a.url, channel: 'push', status: res.sent ? 'sent' : res.failed ? 'failed' : 'skipped', detail: res.detail.slice(0, 300) })
    if (res.sent) pushN++
  }
  // one email per address with every alert that address has not had yet
  const byAddr = new Map<string, Array<{ a: Alert; key: string }>>()
  for (const { a, r } of routes) for (const e of r.email) { const key = e.user_id ? `${a.key}@${e.user_id}` : a.key; if (already.has(key + '|email')) continue; const l = byAddr.get(e.to) || []; l.push({ a, key }); byAddr.set(e.to, l) }
  const sent: string[] = []
  for (const [to, list] of byAddr) {
    const fresh = list.map(x => x.a); const { html, text } = alertEmail(household.name, fresh)
    const res = await sendEmail(to, `Cresari: ${fresh[0].title}${fresh.length > 1 ? ` + ${fresh.length - 1} more` : ''}`, html, text); sent.push(`${to}: ${res.detail}`)
    for (const { a, key } of list) await admin.from('notifications').insert({ household_id: hh, kind: a.kind, dedupe_key: key, title: a.title, body: a.body, url: a.url, channel: 'email', status: res.ok ? 'sent' : /not configured/.test(res.detail) ? 'skipped' : 'failed', detail: res.detail.slice(0, 300) })
  }
  return { household_id: hh, alerts: alerts.length, push: pushN, email: sent.length ? sent.join('; ') : 'nothing new' }
}
async function runDigest(hh: string) {
  const { household, prefs, members, input } = await loadHousehold(hh)
  if (prefs.digest === false) return { household_id: hh, digest: 'off' }
  if (input.deletionScheduledFor) return { household_id: hh, digest: 'scheduled for deletion — no digest' }
  const d = computeDigest({ today: input.today, accounts: input.accounts, recurring: input.recurring, occurrences: input.occurrences, transactions: input.transactions, reserveFloor: input.reserveFloor, includeRetirementInCash: input.includeRetirementInCash })
  const keyD = `digest:${input.today}`
  const { data: done } = await admin.from('notifications').select('id').eq('household_id', hh).like('dedupe_key', `${keyD}%`).eq('status', 'sent').limit(1); if (done?.length) return { household_id: hh, digest: 'already sent' }
  const title = `Your week: ${money(d.safeThisWeek)} safe to spend · ${d.week.length} bill${d.week.length === 1 ? '' : 's'} due`
  const weekRows = d.week.map(w => `<tr><td style="padding:6px 10px;border-bottom:1px solid #e6e9ed">${w.due}</td><td style="padding:6px 10px;border-bottom:1px solid #e6e9ed">${esc(w.name)}${w.autopay ? ' <span style="color:#8b949e">autopay</span>' : ''}</td><td style="padding:6px 10px;border-bottom:1px solid #e6e9ed;text-align:right">${money(w.amount)}</td></tr>`).join('')
  const chg = d.priorWeek > 0 ? Math.round((d.lastWeek - d.priorWeek) / d.priorWeek * 100) : null
  const notices = computeAlerts(input).filter(a => DIGEST_NOTICES.includes(a.kind))   // 0.21.0: price rises, new repeating charges, reconciliations due
  const html = `<div style="font-family:'IBM Plex Sans',Segoe UI,Arial,sans-serif;color:#15181c;max-width:640px"><h2 style="font-weight:700;margin:0 0 4px">Your week ahead</h2><div style="color:#5b6470;margin-bottom:14px">${esc(household.name)} · week of ${input.today}</div>
    <table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:0 -8px 14px"><tr><td style="border:1px solid #d7dbe0;border-radius:6px;padding:12px"><div style="font-size:12px;color:#5b6470">Safe to spend this week</div><div style="font-size:26px;font-weight:700">${money(d.safeThisWeek)}</div>${d.overdueTotal > 0 ? `<div style="font-size:12px;color:#9a3412">after ${money(d.overdueTotal)} overdue</div>` : ''}</td><td style="border:1px solid #d7dbe0;border-radius:6px;padding:12px"><div style="font-size:12px;color:#5b6470">Cash on hand</div><div style="font-size:26px;font-weight:700">${money(d.cash)}</div><div style="font-size:12px;color:#5b6470">floor ${money(d.floor)}</div></td><td style="border:1px solid #d7dbe0;border-radius:6px;padding:12px"><div style="font-size:12px;color:#5b6470">Spent last week</div><div style="font-size:26px;font-weight:700">${money(d.lastWeek)}</div><div style="font-size:12px;color:${chg != null && chg > 0 ? '#9a3412' : '#166534'}">${chg == null ? 'no prior week' : (chg > 0 ? '+' : '') + chg + '% vs the week before'}</div></td></tr></table>
    <h3 style="margin:12px 0 6px;font-size:15px">Due this week · ${money(d.dueTotal)}</h3>${d.week.length ? `<table style="border-collapse:collapse;width:100%;font-size:14px">${weekRows}</table>` : '<div style="color:#5b6470">Nothing due.</div>'}
    ${d.overdue.length ? `<h3 style="margin:14px 0 6px;font-size:15px;color:#9a3412">Overdue</h3><ul>${d.overdue.map(o => `<li>${esc(o.name)} · ${money(o.amount)} · due ${o.due}${o.autopay ? ' · autopay that has not gone through' : ''}</li>`).join('')}</ul>` : ''}
    ${d.topPayees.length ? `<h3 style="margin:14px 0 6px;font-size:15px">Where last week went</h3><ul>${d.topPayees.map(([n, v]) => `<li>${esc(n)} · ${money(v)}</li>`).join('')}</ul>` : ''}
    ${d.income ? `<div style="color:#5b6470">Income received last week: ${money(d.income)}</div>` : ''}${d.uncategorized ? `<div style="color:#5b6470">${d.uncategorized} transaction${d.uncategorized === 1 ? '' : 's'} from last week still uncategorized.</div>` : ''}
    ${notices.length ? `<h3 style="margin:14px 0 6px;font-size:15px">Worth a look</h3><ul>${notices.map(n => `<li><b>${esc(n.title)}</b> — ${esc(n.body)} <a href="${APP_URL}#${n.url}" style="color:#b53a0a">Open</a></li>`).join('')}</ul>` : ''}
    <p style="margin-top:16px"><a href="${APP_URL}#/" style="color:#b53a0a">Open Cresari</a> · <a href="${APP_URL}#/reports" style="color:#b53a0a">Reports</a></p><p style="color:#8b949e;font-size:12px">Change what you receive under Settings → Notifications.</p></div>`
  const text = `${title}\nCash ${money(d.cash)} (floor ${money(d.floor)}) · spent last week ${money(d.lastWeek)}\nDue this week:\n${d.week.map(w => `  ${w.due} ${w.name} ${money(w.amount)}`).join('\n') || '  nothing'}\n${d.overdue.length ? 'Overdue (' + money(d.overdueTotal) + ', taken off safe to spend): ' + d.overdue.map(o => o.name).join(', ') + '\n' : ''}${APP_URL}`
  const out: Record<string, unknown> = { household_id: hh, notices: notices.length }
  const r = recipientsFor(prefs, members, 'digest')
  const mails: string[] = []
  for (const e of r.email) { const key = e.user_id ? `${keyD}@${e.user_id}` : keyD; const res = await sendEmail(e.to, title, html, text); mails.push(`${e.to}: ${res.detail}`); await admin.from('notifications').insert({ household_id: hh, kind: 'digest', dedupe_key: key, title, body: text.slice(0, 500), url: '/', channel: 'email', status: res.ok ? 'sent' : /not configured/.test(res.detail) ? 'skipped' : 'failed', detail: res.detail.slice(0, 300) }) }
  out.email = mails.join('; ') || 'no one'
  if (r.push.length) { const res = await sendPush(hh, r.push, title, `${d.week.length ? d.week.slice(0, 3).map(w => `${w.name} ${money(w.amount)}`).join(' · ') : 'nothing due'} — cash ${money(d.cash)}`, '/', 'digest'); out.push = res.sent; await admin.from('notifications').insert({ household_id: hh, kind: 'digest', dedupe_key: keyD, title, body: text.slice(0, 500), url: '/', channel: 'push', status: res.sent ? 'sent' : res.failed ? 'failed' : 'skipped', detail: res.detail.slice(0, 300) }) }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  let b: { action?: string; household_id?: string }; try { b = await req.json() } catch { return json(400, { error: 'JSON body expected' }) }
  if (b.action === 'run_daily' || b.action === 'digest') {
    const given = req.headers.get('x-cron-secret') || '', envSecret = Deno.env.get('CRON_SECRET')
    const ok = (!!envSecret && given === envSecret) || (given.length >= 32 && (await admin.rpc('cron_secret_ok', { p: given })).data === true)
    if (!ok) return json(401, { error: 'cron secret required' })
    const { data: hhs, error } = await admin.from('households').select('id'); if (error) return json(500, { error: error.message })
    const out: unknown[] = []
    for (const h of hhs || []) { try { out.push(b.action === 'digest' ? await runDigest(h.id) : await runDaily(h.id)) } catch (e) { await logError(h.id, (e as Error).message, { action: b.action }); out.push({ household_id: h.id, error: (e as Error).message }) } }
    // config: which delivery secrets the function can see — names only, never values — so a mis-typed secret name shows up in the cron log
    const seen = Object.keys(Deno.env.toObject()).filter(k => !/^(SUPABASE_|SB_|DENO_|HOME$|PATH$|PWD$|HOSTNAME$|LANG|TZ$|SHLVL|_$)/.test(k)).sort()
    return json(200, { ok: true, results: out, config: { push: await vapid(), email: !!resendKey(), secrets_seen: seen } })
  }
  // signed-in actions
  const auth = req.headers.get('Authorization') || ''; if (!auth.startsWith('Bearer ')) return json(401, { error: 'sign in first' })
  const user = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: me } = await user.auth.getUser(); if (!me?.user) return json(401, { error: 'sign in first' })
  const hh = String(b.household_id || ''); if (!hh) return json(400, { error: 'household_id required' })
  const { data: m } = await admin.from('household_members').select('role, email, modules').eq('household_id', hh).eq('user_id', me.user.id).maybeSingle(); if (!m) return json(403, { error: 'not a member' })
  // 0.25.1: the preview lists every alert (cash, bills, payees, income, charges) and a test speaks for alerts a Limited member never gets
  if ((b.action === 'preview' || b.action === 'test') && isLimitedMember(m)) return json(403, { error: 'Alerts need full access' })
  if (b.action === 'preview') { try { const { input } = await loadHousehold(hh); return json(200, { today: input.today, alerts: computeAlerts(input), push: await vapid(), email: !!resendKey() }) } catch (e) { return json(500, { error: (e as Error).message }) } }
  if (b.action === 'test') {
    const push = await sendPush(hh, [me.user.id], 'Cresari test', 'Push notifications are working on this device.', '/settings', 'test')
    const { prefs } = await loadHousehold(hh); const mine = prefs.members?.[me.user.id]; const to = (mine?.email ? mine.email_to || m.email : null) || prefs.email_to || m.email
    const email = to ? await sendEmail(to, 'Cresari test email', `<p>Email alerts are working. You will get bills due, low cash, large charges and the Monday digest here.</p><p><a href="${APP_URL}">Open Cresari</a></p>`, 'Email alerts are working.') : { ok: false, detail: 'no address' }
    await admin.from('notifications').insert([{ household_id: hh, kind: 'test', dedupe_key: 'test:' + Date.now(), title: 'Test', body: 'push', url: '/settings', channel: 'push', status: push.sent ? 'sent' : push.failed ? 'failed' : 'skipped', detail: push.detail.slice(0, 300) }, { household_id: hh, kind: 'test', dedupe_key: 'test:' + Date.now() + ':e', title: 'Test', body: 'email', url: '/settings', channel: 'email', status: email.ok ? 'sent' : /not configured/.test(email.detail) ? 'skipped' : 'failed', detail: email.detail.slice(0, 300) }])
    return json(200, { push, email })
  }
  return json(400, { error: 'unknown action' })
})
