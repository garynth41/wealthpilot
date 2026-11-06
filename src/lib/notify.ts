// Alert rules (0.19.0) — what deserves a push or an email, decided from plain rows so the same file runs in the browser (preview, tests)
// and in the notify edge function (supabase/functions/notify/notify.ts is a byte-for-byte copy kept by scripts/sync-engines.mjs).
// NO imports. Rules, each with a stable dedupe key so the same alert is never sent twice for the same day/thing:
//   bill_due      an active bill, subscription or debt payment due today or tomorrow with no payment recorded
//   bill_overdue  due up to 30 days ago, still unpaid (re-sent every 3 days)
//   low_cash      cash on hand is below the reserve floor, or below what is due in the next 7 days
//   large_charge  an expense at or above the household's threshold that arrived in the last day
//   paycheck      a pay schedule had a pay date yesterday or today and no income was recorded for it
//   sync          the bank feed reported an error, or has not synced for 3 days
//   price_rise    (0.21.0) a fixed-price bill or subscription charged more than its listed amount in the last 35 days
//   new_recurring (0.21.0) the same merchant charged a similar amount in each of the last three months and is not in Bills
//   reconcile     (0.21.0) an account last reconciled 35+ days ago (weekly reminder), or a bank-fed account never reconciled (once)
//   revalue       (0.24.0) a property or vehicle whose value is a quarter (90 days) old or undated — once per quarter it stays stale
//   deletion      (0.25.0) the household is scheduled for deletion: once when it is scheduled and once the day before; always sent,
//                 to every member, and the only alert while a deletion is pending
// Who receives what: recipientsFor() — per-member channels with the household switches as the fallback.
// Quiet hours are a delivery concern (the function sends at 07:30 local), not a rule.

export interface NAccount { id: string; name: string; kind: string; asset_type?: string | null; status: string; balance: number; bank_balance?: number | null; include_in_cash: boolean; balance_as_of?: string | null; last_reconciled_on?: string | null; created_at?: string | null }
export interface NRecurring { id: string; name: string; payee?: string | null; kind: string; amount: number; amount_varies?: boolean; frequency: string; day_of_month?: number | null; next_due?: string | null; starts_on?: string | null; ends_on?: string | null; status: string; autopay: boolean }
export interface NOccurrence { recurring_id: string; due_date: string; status: string }
export interface NTxn { id: string; date: string; kind: string; amount: number; payee?: string | null; recurring_id?: string | null; pay_schedule_id?: string | null; created_at?: string | null; status?: string | null; duplicate_of?: string | null }
export interface NPay { id: string; name: string; frequency: string; anchor_date: string; semimonthly_days?: number[] | null; net_amount: number; starts_on?: string | null; ends_on?: string | null; status: string }
export type NSync = { status: string; last_sync_at: string | null; last_error?: string | null } | null
export interface NPrefs { bills?: boolean; low_cash?: boolean; large?: number | null; paycheck?: boolean; sync?: boolean; price_rise?: boolean; new_recurring?: boolean; reconcile?: boolean; revalue?: boolean }
export interface NInput { today: string; now?: string; deletionScheduledFor?: string | null; accounts: NAccount[]; recurring: NRecurring[]; occurrences: NOccurrence[]; transactions: NTxn[]; paySchedules: NPay[]; sync: NSync; reserveFloor: number; prefs: NPrefs; includeRetirementInCash?: boolean }
export interface Alert { kind: 'bill_due' | 'bill_overdue' | 'low_cash' | 'large_charge' | 'paycheck' | 'sync' | 'price_rise' | 'new_recurring' | 'reconcile' | 'revalue' | 'deletion'; key: string; title: string; body: string; url: string; severity: 'info' | 'warn' | 'crit'; amount?: number }

export const NOTIFY_DEFAULTS: Required<NPrefs> = { bills: true, low_cash: true, large: 500, paycheck: true, sync: true, price_rise: true, new_recurring: true, reconcile: true, revalue: true }
/** The alerts that also go in the Monday digest's "Worth a look" list. */
export const DIGEST_NOTICES: Alert['kind'][] = ['price_rise', 'new_recurring', 'reconcile', 'revalue']
const DAY = 86400000
const iso = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
const parse = (s: string) => new Date(s.slice(0, 10) + 'T12:00:00Z')
export const addDaysN = (s: string, n: number) => iso(new Date(parse(s).getTime() + n * DAY))
const diff = (a: string, b: string) => Math.round((parse(a).getTime() - parse(b).getTime()) / DAY)
const dim = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()   // m: 1-12
const clampDay = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, dim(y, m))).padStart(2, '0')}`
const money = (n: number) => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const money2 = (n: number) => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const STOP = new Set(['the', 'inc', 'llc', 'co', 'com', 'www', 'pos', 'debit', 'purchase', 'card', 'payment', 'online', 'recurring', 'ach', 'autopay', 'bill', 'pmt'])
/** A merchant key for grouping card lines: the first two meaningful words ('NETFLIX.COM 866-579' → 'netflix'). */
export const mkey = (s?: string | null) => String(s || '').toLowerCase().replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w)).slice(0, 2).join(' ')
const monthIdx = (d: string) => +d.slice(0, 4) * 12 + (+d.slice(5, 7) - 1)

/** Due dates of a recurring item inside [from, to] (same rules as lib/recurring.ts, compact). */
export function dueDatesN(r: NRecurring, from: string, to: string): string[] {
  const lo = r.starts_on && r.starts_on > from ? r.starts_on : from, hi = r.ends_on && r.ends_on < to ? r.ends_on : to
  if (lo > hi || r.status !== 'Active') return []
  const seed = (r.next_due || (r.day_of_month ? clampDay(+from.slice(0, 4), +from.slice(5, 7), r.day_of_month) : from)).slice(0, 10)
  if (r.frequency === 'irregular') return seed >= lo && seed <= hi ? [seed] : []
  const out: string[] = []
  if (r.frequency === 'weekly' || r.frequency === 'biweekly') { const step = r.frequency === 'weekly' ? 7 : 14; let d = seed; while (d > lo) d = addDaysN(d, -step); while (d < lo) d = addDaysN(d, step); for (let k = 0; d <= hi && k < 60; k++) { out.push(d); d = addDaysN(d, step) } return out }
  const months = r.frequency === 'semimonthly' ? 0 : ({ monthly: 1, every_2_months: 2, quarterly: 3, every_6_months: 6, yearly: 12 } as Record<string, number>)[r.frequency] || 1
  const day = r.day_of_month || +seed.slice(8)
  let y = +lo.slice(0, 4), m = +lo.slice(5, 7)
  for (let n = 0; n < 48; n++) {
    const days = months === 0 ? [day, day <= 15 ? day + 15 : day - 15].sort((a, b) => a - b) : [day]
    for (const dd of days) { const d = clampDay(y, m, dd); if (d >= lo && d <= hi) out.push(d) }
    if (months === 0) { m++; } else { m += months } while (m > 12) { m -= 12; y++ }
    if (`${y}-${String(m).padStart(2, '0')}-01` > hi) break
  }
  // monthly-family items are anchored to the seed's month cadence (every 2 months from the seed, not from `from`)
  if (months > 1) { const sy = +seed.slice(0, 4), sm = +seed.slice(5, 7); return out.filter(d => (((+d.slice(0, 4) - sy) * 12 + (+d.slice(5, 7) - sm)) % months + months) % months === 0) }
  return out
}
/** Pay dates of a schedule inside [from, to] (same rules as lib/paySchedule.ts, compact). */
export function payDatesN(p: NPay, from: string, to: string): string[] {
  const lo = p.starts_on && p.starts_on > from ? p.starts_on : from, hi = p.ends_on && p.ends_on < to ? p.ends_on : to
  if (lo > hi || p.status !== 'Active') return []
  const anchor = p.anchor_date.slice(0, 10); const out: string[] = []
  if (p.frequency === 'semimonthly') { const [d1, d2] = (p.semimonthly_days && p.semimonthly_days.length === 2 ? p.semimonthly_days : [1, 15]).slice().sort((a, b) => a - b); let y = +lo.slice(0, 4), m = +lo.slice(5, 7); for (let n = 0; n < 36; n++) { for (const dd of [d1, d2]) { const d = clampDay(y, m, dd); if (d >= lo && d <= hi) out.push(d) } m++; if (m > 12) { m = 1; y++ } if (`${y}-${String(m).padStart(2, '0')}-01` > hi) break } return out }
  if (p.frequency === 'weekly' || p.frequency === 'biweekly') { const step = p.frequency === 'weekly' ? 7 : 14; let d = anchor; while (d > lo) d = addDaysN(d, -step); while (d < lo) d = addDaysN(d, step); for (let k = 0; d <= hi && k < 60; k++) { out.push(d); d = addDaysN(d, step) } return out }
  if (p.frequency === 'irregular') return []
  const months = ({ monthly: 1, quarterly: 3, yearly: 12 } as Record<string, number>)[p.frequency] || 1; const day = +anchor.slice(8)
  let y = +anchor.slice(0, 4), m = +anchor.slice(5, 7)
  while (clampDay(y, m, day) > lo) { m -= months; while (m < 1) { m += 12; y-- } }
  for (let n = 0; n < 48; n++) { const d = clampDay(y, m, day); if (d > hi) break; if (d >= lo) out.push(d); m += months; while (m > 12) { m -= 12; y++ } }
  return out
}

const LIAB = ['credit_card', 'store_card', 'loan', 'auto_loan', 'student_loan', 'mortgage', 'bnpl', 'line_of_credit', 'medical', 'collection', 'other_liability']
/** Was a due date paid? An occurrence marked paid/skipped, or a payment near the due date: same recurring_id, or the item's payee with a close amount (the app's matchTxn rule). */
function paidFor(r: NRecurring, due: string, occ: NOccurrence[], tx: NTxn[]) {
  if (occ.some(o => o.recurring_id === r.id && o.due_date === due && (o.status === 'paid' || o.status === 'skipped'))) return true
  const first = (r.payee || r.name || '').toLowerCase().split(' ')[0]
  return tx.some(t => !t.duplicate_of && t.status !== 'void' && diff(t.date, due) >= -12 && diff(t.date, due) <= 10 && (t.recurring_id === r.id || (!!first && !!t.payee && t.payee.toLowerCase().includes(first) && (r.amount_varies || Math.abs(t.amount - r.amount) <= Math.max(1, r.amount * 0.25)))))
}
export function computeAlerts(inp: NInput): Alert[] {
  const p = { ...NOTIFY_DEFAULTS, ...Object.fromEntries(Object.entries(inp.prefs || {}).filter(([, v]) => v != null)) } as Required<NPrefs>
  const t = inp.today; const out: Alert[] = []; const live = inp.transactions.filter(x => !x.duplicate_of && x.status !== 'void')
  if (inp.deletionScheduledFor) { const d = inp.deletionScheduledFor.slice(0, 10); const left = diff(d, t)
    return [{ kind: 'deletion', key: `deletion:${d}:${left <= 1 ? 'final' : 'scheduled'}`, title: left <= 1 ? 'This household is permanently deleted tomorrow' : `This household will be permanently deleted on ${d}`, body: 'Everything in it — accounts, transactions, files and backups — for every member. Until then it is read-only; an owner can cancel in Settings.', url: '/settings', severity: 'crit' }] }
  const bucket3 = Math.floor(parse(t).getTime() / DAY / 3)
  if (p.bills) for (const r of inp.recurring.filter(r => r.status === 'Active' && r.kind !== 'income')) {
    for (const due of dueDatesN(r, addDaysN(t, -30), addDaysN(t, 1))) {
      if (paidFor(r, due, inp.occurrences, live)) continue
      const d = diff(due, t)
      if (d >= 0) out.push({ kind: 'bill_due', key: `bill_due:${r.id}:${due}`, title: `${r.name} ${d === 0 ? 'is due today' : 'is due tomorrow'}`, body: `${money(r.amount)}${r.autopay ? ' · autopay — check the balance covers it' : ''}`, url: '/bills', severity: r.autopay ? 'info' : 'warn', amount: r.amount })
      else if (!r.autopay) out.push({ kind: 'bill_overdue', key: `bill_overdue:${r.id}:${due}:${bucket3}`, title: `${r.name} is ${-d} day${d === -1 ? '' : 's'} overdue`, body: `${money(r.amount)} was due ${due}`, url: '/bills', severity: 'crit', amount: r.amount })
    }
  }
  if (p.low_cash) {
    const cash = inp.accounts.filter(a => a.status === 'Active' && !LIAB.includes(a.kind) && (a.include_in_cash || (inp.includeRetirementInCash && a.kind === 'retirement'))).reduce((n, a) => n + (a.bank_balance ?? a.balance ?? 0), 0)
    const due7 = inp.recurring.filter(r => r.status === 'Active' && r.kind !== 'income').reduce((n, r) => n + dueDatesN(r, t, addDaysN(t, 7)).filter(d => !paidFor(r, d, inp.occurrences, live)).length * (+r.amount || 0), 0)
    if (inp.reserveFloor > 0 && cash < inp.reserveFloor) out.push({ kind: 'low_cash', key: `low_cash:floor:${t}`, title: `Cash is below your ${money(inp.reserveFloor)} floor`, body: `${money(cash)} on hand across cash accounts`, url: '/', severity: 'crit', amount: cash })
    else if (due7 > cash) out.push({ kind: 'low_cash', key: `low_cash:due7:${t}`, title: 'Bills due this week exceed cash on hand', body: `${money(due7)} due in 7 days, ${money(cash)} available`, url: '/forecast', severity: 'crit', amount: due7 - cash })
  }
  const largeAt = p.large || 0
  if (largeAt > 0) {
    const since = inp.now ? new Date(Date.parse(inp.now) - DAY).toISOString() : addDaysN(t, -1) + 'T00:00:00Z'
    for (const x of live.filter(x => x.kind === 'expense' && x.amount >= largeAt && (x.created_at ? x.created_at >= since : x.date >= addDaysN(t, -1))))
      out.push({ kind: 'large_charge', key: `large:${x.id}`, title: `Large charge: ${money(x.amount)} ${x.payee ? 'at ' + x.payee : ''}`.trim(), body: `on ${x.date} — ${x.amount >= largeAt * 2 ? 'twice' : 'over'} your ${money(largeAt)} threshold`, url: '/transactions', severity: 'warn', amount: x.amount })
  }
  if (p.paycheck) for (const ps of inp.paySchedules.filter(x => x.status === 'Active' && x.net_amount > 0)) {
    for (const d of payDatesN(ps, addDaysN(t, -1), t)) {
      const got = live.some(x => x.kind === 'income' && Math.abs(diff(x.date, d)) <= 2 && (x.pay_schedule_id === ps.id || Math.abs(x.amount - ps.net_amount) <= Math.max(5, ps.net_amount * 0.02)))
      if (!got && diff(t, d) >= 1) out.push({ kind: 'paycheck', key: `paycheck:${ps.id}:${d}`, title: `${ps.name}: paycheck not recorded`, body: `${money(ps.net_amount)} was expected on ${d} — check the account or the schedule`, url: '/income', severity: 'warn', amount: ps.net_amount })
    }
  }
  if (p.sync && inp.sync) {
    if (inp.sync.status === 'error') out.push({ kind: 'sync', key: `sync:error:${bucket3}`, title: 'Bank sync failed', body: (inp.sync.last_error || 'The last sync reported an error').slice(0, 140), url: '/connections', severity: 'warn' })
    else if (inp.sync.last_sync_at && diff(t, inp.sync.last_sync_at.slice(0, 10)) >= 3) out.push({ kind: 'sync', key: `sync:stale:${bucket3}`, title: 'Bank feed has not updated for 3 days', body: `Last sync ${inp.sync.last_sync_at.slice(0, 10)}`, url: '/connections', severity: 'warn' })
  }
  if (p.price_rise) for (const r of inp.recurring.filter(r => r.status === 'Active' && (r.kind === 'subscription' || r.kind === 'bill') && !r.amount_varies && +r.amount > 0)) {
    const first = (r.payee || r.name || '').toLowerCase().split(' ')[0]
    const last = live.filter(x => x.kind === 'expense' && diff(t, x.date) >= 0 && diff(t, x.date) <= 35 && (x.recurring_id === r.id || (first.length > 2 && (x.payee || '').toLowerCase().includes(first)))).sort((a, b) => b.date.localeCompare(a.date))[0]
    if (last && last.amount > +r.amount + Math.max(1, +r.amount * 0.05) && last.amount < +r.amount * 3)
      out.push({ kind: 'price_rise', key: `price_rise:${r.id}:${last.id}`, title: `${r.name} went up`, body: `${money2(+r.amount)} → ${money2(last.amount)} on ${last.date} — update the bill if this is the new price`, url: '/bills', severity: 'warn', amount: round(last.amount - +r.amount) })
  }
  if (p.new_recurring) {
    const known = inp.recurring.filter(r => r.status !== 'Cancelled').map(r => mkey(r.payee || r.name)).filter(Boolean)
    const groups = new Map<string, NTxn[]>()
    for (const x of live) { if (x.kind !== 'expense' || x.recurring_id || diff(t, x.date) > 100 || diff(t, x.date) < 0) continue; const k = mkey(x.payee); if (!k) continue; const g = groups.get(k) || []; g.push(x); groups.set(k, g) }
    for (const [k, g] of groups) {
      if (known.some(n => n === k || n.split(' ')[0] === k.split(' ')[0])) continue
      const latest = g.slice().sort((a, b) => b.date.localeCompare(a.date))[0]; if (diff(t, latest.date) > 35) continue
      const m = monthIdx(latest.date); const byMonth = new Map<number, number>(); for (const x of g) { const i = monthIdx(x.date); byMonth.set(i, (byMonth.get(i) || 0) + x.amount) }
      if (![m, m - 1, m - 2].every(i => byMonth.has(i))) continue
      const amts = [m, m - 1, m - 2].map(i => byMonth.get(i)!); if (Math.max(...amts) > Math.min(...amts) * 1.15 + 1) continue
      const avg = amts.reduce((a, b) => a + b, 0) / 3
      out.push({ kind: 'new_recurring', key: `new_recurring:${k}:${latest.date.slice(0, 7)}`, title: `New repeating charge: ${latest.payee || k}`, body: `about ${money2(avg)} in each of the last 3 months — add it to Bills so the forecast counts it`, url: '/insights', severity: 'info', amount: round(avg) })
    }
  }
  if (p.reconcile) for (const a of inp.accounts.filter(a => a.status === 'Active' && ['checking', 'savings', 'credit_card', 'store_card', 'line_of_credit'].includes(a.kind))) {
    if (a.last_reconciled_on) { const age = diff(t, a.last_reconciled_on.slice(0, 10)); if (age >= 35) out.push({ kind: 'reconcile', key: `reconcile:${a.id}:${Math.floor(age / 7)}`, title: `${a.name}: time to reconcile`, body: `last reconciled ${a.last_reconciled_on.slice(0, 10)} — ${age} days ago`, url: '/reconcile', severity: 'info' }) }
    else if (a.bank_balance != null && a.created_at && diff(t, a.created_at.slice(0, 10)) >= 35) out.push({ kind: 'reconcile', key: `reconcile:${a.id}:never`, title: `${a.name} has never been reconciled`, body: 'tick the bank statement against the register once so the verified balance means something', url: '/reconcile', severity: 'info' })
  }
  if (p.revalue) for (const a of inp.accounts.filter(a => a.status === 'Active' && (a.kind === 'other_asset' || !!a.asset_type) && !LIAB.includes(a.kind))) {
    const at = a.balance_as_of ? a.balance_as_of.slice(0, 10) : null; const age = at ? diff(t, at) : null
    if (age == null) out.push({ kind: 'revalue', key: `revalue:${a.id}:undated`, title: `${a.name}: add the value and its date`, body: 'type today\'s estimate (Zillow, an appraisal, Kelley Blue Book) so net worth is current', url: '/accounts', severity: 'info' })
    else if (age >= 90) out.push({ kind: 'revalue', key: `revalue:${a.id}:${at}:${Math.floor(age / 90)}`, title: `${a.name}: time to update the value`, body: `${money(+a.balance || 0)} was the value on ${at} — ${age} days ago`, url: '/accounts', severity: 'info', amount: +a.balance || 0 })
  }
  const rank = { crit: 0, warn: 1, info: 2 }; return out.sort((a, b) => rank[a.severity] - rank[b.severity])
}
const round = (n: number) => Math.round(n * 100) / 100

/** Who receives an alert of this kind (0.21.0). Each member's own choices win; anything they did not set falls back to the household
 *  switches: push goes to every member's devices unless push is off; email goes to the household address (or the owner) unless a
 *  member chose email for themselves. `kinds` limits a member to some alert kinds; 'digest' is the Monday digest. */
export interface NMember { user_id: string; email?: string | null; role?: string | null }
export interface NMemberPrefs { push?: boolean; email?: boolean; email_to?: string | null; digest?: boolean; kinds?: string[] | null }
export interface NRouting { push?: boolean; email?: boolean; email_to?: string | null; members?: Record<string, NMemberPrefs> }
export function recipientsFor(prefs: NRouting, members: NMember[], kind: string): { push: string[]; email: Array<{ to: string; user_id: string | null }> } {
  const mm = prefs.members || {}; const push: string[] = []; const email: Array<{ to: string; user_id: string | null }> = []
  for (const m of members) {
    const p = mm[m.user_id] || {}
    const wants = kind === 'digest' ? p.digest !== false : kind === 'deletion' || !p.kinds || p.kinds.includes(kind)
    if (!wants) continue
    if (p.push ?? (prefs.push !== false)) push.push(m.user_id)
    if (p.email === true) { const to = String(p.email_to || m.email || '').trim().toLowerCase(); if (/@/.test(to)) email.push({ to, user_id: m.user_id }) }
  }
  if (prefs.email && !Object.values(mm).some(p => p.email === true)) { const to = String(prefs.email_to || members.find(m => m.role === 'owner')?.email || members[0]?.email || '').trim().toLowerCase(); if (/@/.test(to)) email.push({ to, user_id: null }) }
  const seen = new Set<string>(); return { push, email: email.filter(e => !seen.has(e.to) && (seen.add(e.to), true)) }
}

/** The Monday digest: one email with the week ahead and the week behind. */
export interface DigestInput { today: string; accounts: NAccount[]; recurring: NRecurring[]; occurrences: NOccurrence[]; transactions: NTxn[]; reserveFloor: number; includeRetirementInCash?: boolean; categoriesOf?: (t: NTxn) => string }
export function computeDigest(inp: DigestInput) {
  const t = inp.today; const live = inp.transactions.filter(x => !x.duplicate_of && x.status !== 'void')
  const cash = inp.accounts.filter(a => a.status === 'Active' && !LIAB.includes(a.kind) && (a.include_in_cash || (inp.includeRetirementInCash && a.kind === 'retirement'))).reduce((n, a) => n + (a.bank_balance ?? a.balance ?? 0), 0)
  const week = inp.recurring.filter(r => r.status === 'Active' && r.kind !== 'income').flatMap(r => dueDatesN(r, t, addDaysN(t, 6)).filter(d => !paidFor(r, d, inp.occurrences, live)).map(d => ({ name: r.name, amount: +r.amount || 0, due: d, autopay: r.autopay }))).sort((a, b) => a.due.localeCompare(b.due))
  const overdue = inp.recurring.filter(r => r.status === 'Active' && r.kind !== 'income' && !r.autopay).flatMap(r => dueDatesN(r, addDaysN(t, -30), addDaysN(t, -1)).filter(d => !paidFor(r, d, inp.occurrences, live)).map(d => ({ name: r.name, amount: +r.amount || 0, due: d })))
  const spend = (from: string, to: string) => live.filter(x => x.kind === 'expense' && x.date >= from && x.date <= to).reduce((n, x) => n + x.amount, 0)
  const lastWeek = spend(addDaysN(t, -7), addDaysN(t, -1)), priorWeek = spend(addDaysN(t, -14), addDaysN(t, -8)), income = live.filter(x => x.kind === 'income' && x.date >= addDaysN(t, -7) && x.date <= addDaysN(t, -1)).reduce((n, x) => n + x.amount, 0)
  const byPayee = new Map<string, number>(); for (const x of live.filter(x => x.kind === 'expense' && x.date >= addDaysN(t, -7) && x.date <= addDaysN(t, -1))) { const k = (x.payee || 'Unknown').trim(); byPayee.set(k, (byPayee.get(k) || 0) + x.amount) }
  const topPayees = [...byPayee.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const dueTotal = week.reduce((n, w) => n + w.amount, 0)
  return { cash, floor: inp.reserveFloor, safeThisWeek: Math.max(0, cash - dueTotal - inp.reserveFloor), week, dueTotal, overdue, lastWeek, priorWeek, income, topPayees, uncategorized: live.filter(x => x.kind === 'expense' && x.date >= addDaysN(t, -7) && !inp.categoriesOf?.(x) && !(x as { category_id?: string | null }).category_id).length }
}
