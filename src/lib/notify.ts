// Alert rules (0.19.0) — what deserves a push or an email, decided from plain rows so the same file runs in the browser (preview, tests)
// and in the notify edge function (supabase/functions/notify/notify.ts is a byte-for-byte copy kept by scripts/sync-engines.mjs).
// NO imports. Rules, each with a stable dedupe key so the same alert is never sent twice for the same day/thing:
//   bill_due      an active bill, subscription or debt payment due today or tomorrow with no payment recorded
//   bill_overdue  due up to 30 days ago, still unpaid (re-sent every 3 days)
//   low_cash      cash on hand is below the reserve floor, or below what is due in the next 7 days plus what is already overdue (0.25.1)
//   large_charge  an expense at or above the household's threshold that arrived in the last day
//   paycheck      a pay schedule had a pay date yesterday or today and no income was recorded for it
//   sync          the bank feed reported an error, or has not synced for 3 days
//   price_rise    (0.21.0) a fixed-price bill or subscription charged more than its listed amount in the last 35 days
//   new_recurring (0.21.0) the same merchant charged a similar amount in each of the last three months and is not in Bills
//   reconcile     (0.21.0) an account last reconciled 35+ days ago (weekly reminder), or a bank-fed account never reconciled (once)
//   revalue       (0.24.0) a property or vehicle whose value is a quarter (90 days) old or undated — once per quarter it stays stale
//   deletion      (0.25.0) the household is scheduled for deletion: once when it is scheduled and once the day before; always sent,
//                 to every member, and the only alert while a deletion is pending
// Who receives what: recipientsFor() — per-member channels with the household switches as the fallback; a member with Limited access
// gets only the deletion notice (0.25.1).
// Paid or not (0.25.1): matchPaymentsN() pairs payments with due dates one to one — the Bills page (lib/recurring.ts) uses the same function.
// Quiet hours are a delivery concern (the function sends at 07:30 local), not a rule.

export interface NAccount { id: string; name: string; kind: string; asset_type?: string | null; status: string; balance: number; bank_balance?: number | null; include_in_cash: boolean; balance_as_of?: string | null; last_reconciled_on?: string | null; created_at?: string | null }
export interface NRecurring { id: string; name: string; payee?: string | null; kind: string; amount: number; amount_varies?: boolean; frequency: string; day_of_month?: number | null; next_due?: string | null; starts_on?: string | null; ends_on?: string | null; status: string; autopay: boolean }
/** `transaction_id`: the payment recorded for this due date (Mark paid, email capture); it belongs to this date and covers no other.
 *  `amount`: the amount filed for this due date (an email bill, Mark paid), which is what the date asks for (amountDueN). */
export interface NOccurrence { recurring_id: string; due_date: string; status: string; transaction_id?: string | null; amount?: number | null }
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

/** Due dates of a recurring item inside [from, to] — the same rules as lib/recurring.ts dueDates (a test compares the two). `today` is the
 *  household's today: an item with a day of the month but no next due date counts from today's month, as the app does. */
export function dueDatesN(r: NRecurring, from: string, to: string, today: string = from): string[] {
  const lo = r.starts_on && r.starts_on > from ? r.starts_on : from, hi = r.ends_on && r.ends_on < to ? r.ends_on : to
  if (lo > hi || r.status !== 'Active') return []
  const t0 = today.slice(0, 10)
  const seed = (r.next_due || (r.day_of_month ? clampDay(+t0.slice(0, 4), +t0.slice(5, 7), r.day_of_month) : t0)).slice(0, 10)
  if (r.frequency === 'irregular') return seed >= lo && seed <= hi ? [seed] : []
  const out: string[] = []
  if (r.frequency === 'weekly' || r.frequency === 'biweekly') { const step = r.frequency === 'weekly' ? 7 : 14; let d = seed; while (d > lo) d = addDaysN(d, -step); while (d < lo) d = addDaysN(d, step); for (let k = 0; d <= hi && k < 400; k++) { out.push(d); d = addDaysN(d, step) } return out }
  const day = r.day_of_month || +seed.slice(8)
  const on = (i: number, dd: number) => clampDay(Math.floor(i / 12), (i % 12) + 1, dd)   // month number i (year × 12 + month − 1), day dd clamped
  if (r.frequency === 'semimonthly') { const days = [day, day <= 15 ? day + 15 : day - 15].sort((a, b) => a - b); for (let i = monthIdx(lo); i <= monthIdx(hi); i++) for (const dd of days) { const d = on(i, dd); if (d >= lo && d <= hi) out.push(d) } return out }
  // every `months` months from the seed's month. 0.25.1: start from the first month in the window that lines up with the seed — stepping from
  // the window's own month and filtering afterwards lost every due date when the window started in an off month
  const months = ({ monthly: 1, every_2_months: 2, quarterly: 3, every_6_months: 6, yearly: 12 } as Record<string, number>)[r.frequency] || 1
  let i = monthIdx(lo); i += (((monthIdx(seed) - i) % months) + months) % months
  for (; i <= monthIdx(hi); i += months) { const d = on(i, day); if (d >= lo && d <= hi) out.push(d) }
  return out
}
/** The two paydays of a twice-a-month schedule, in order (0.25.1) — the one rule lib/paySchedule.ts payDates and the alerts both call: the
 *  schedule's own two days, or the 15th and the last day of the month (31, shortened to the month's last day) when none are set, as the
 *  Income page says. The alerts used to assume the 1st and the 15th, so a missed end-of-month paycheck went unflagged and a false one was
 *  flagged on the 2nd. */
export const semiPayDaysN = (days?: number[] | null): [number, number] => { const [a, b] = (days && days.length === 2 ? days : [15, 31]).slice().sort((x, y) => x - y); return [a, b] }
/** Pay dates of a schedule inside [from, to] (same rules as lib/paySchedule.ts, compact). */
export function payDatesN(p: NPay, from: string, to: string): string[] {
  const lo = p.starts_on && p.starts_on > from ? p.starts_on : from, hi = p.ends_on && p.ends_on < to ? p.ends_on : to
  if (lo > hi || p.status !== 'Active') return []
  const anchor = p.anchor_date.slice(0, 10); const out: string[] = []
  // twice a month: both days in each month of the window, each clamped to the month's end and counted once (30 and 31 in February are one day)
  if (p.frequency === 'semimonthly') { const days = semiPayDaysN(p.semimonthly_days); for (let i = monthIdx(lo); i <= monthIdx(hi); i++) for (const dd of days) { const d = clampDay(Math.floor(i / 12), (i % 12) + 1, dd); if (d >= lo && d <= hi && out[out.length - 1] !== d) out.push(d) } return out }
  if (p.frequency === 'weekly' || p.frequency === 'biweekly') { const step = p.frequency === 'weekly' ? 7 : 14; let d = anchor; while (d > lo) d = addDaysN(d, -step); while (d < lo) d = addDaysN(d, step); for (let k = 0; d <= hi && k < 60; k++) { out.push(d); d = addDaysN(d, step) } return out }
  if (p.frequency === 'irregular') return []
  const months = ({ monthly: 1, quarterly: 3, yearly: 12 } as Record<string, number>)[p.frequency] || 1; const day = +anchor.slice(8)
  let y = +anchor.slice(0, 4), m = +anchor.slice(5, 7)
  while (clampDay(y, m, day) > lo) { m -= months; while (m < 1) { m += 12; y-- } }
  for (let n = 0; n < 48; n++) { const d = clampDay(y, m, day); if (d > hi) break; if (d >= lo) out.push(d); m += months; while (m > 12) { m -= 12; y++ } }
  return out
}

const LIAB = ['credit_card', 'store_card', 'loan', 'auto_loan', 'student_loan', 'mortgage', 'bnpl', 'line_of_credit', 'medical', 'collection', 'other_liability']
/** How far from a due date a payment still counts for it (0.25.1): from 12 days before to 10 days after, but never past half the gap to the
 *  due date before or after it — a weekly bill's window is 3 days either side, so one payment cannot reach the week before or after. */
export function payWindowN(prev: string | null | undefined, due: string, next: string | null | undefined): [string, string] {
  const before = prev ? Math.min(12, Math.floor(diff(due, prev) / 2)) : 12, after = next ? Math.min(10, Math.floor(diff(next, due) / 2)) : 10
  return [addDaysN(due, -before), addDaysN(due, after)]
}
/** Payments paired with one recurring item's due dates, one to one (0.25.1) — the rule the Bills page (lib/recurring.ts), the alerts and the
 *  phone reminders all use. `dues` is the item's schedule in date order (include a month either side of the dates you ask about, so each one
 *  sees its neighbours); `open(due)` is false for a date already settled (marked paid or skipped, or linked to its payment). Each payment
 *  covers at most one due date and each due date takes at most one payment: the closest pairs are settled first (on a tie, the earlier due
 *  date), so a payment covers the nearest still-unpaid due date whose window it falls in. Returns due date → payment id. */
export function matchPaymentsN(dues: string[], open: (due: string) => boolean, pays: Array<{ id: string; date: string }>): Map<string, string> {
  const pairs: Array<{ dist: number; due: string; date: string; id: string }> = []
  dues.forEach((due, i) => {
    if (!open(due)) return
    const [lo, hi] = payWindowN(dues[i - 1], due, dues[i + 1])
    for (const p of pays) { const date = p.date.slice(0, 10); if (date >= lo && date <= hi) pairs.push({ dist: Math.abs(diff(date, due)), due, date, id: p.id }) }
  })
  pairs.sort((a, b) => a.dist - b.dist || a.due.localeCompare(b.due) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const out = new Map<string, string>(), used = new Set<string>()
  for (const x of pairs) if (!out.has(x.due) && !used.has(x.id)) { out.set(x.due, x.id); used.add(x.id) }
  return out
}
/** Words that say what kind of bill something is rather than who it is paid to ("Gas", "Rent", "Car insurance", "City water"). A bill with no
 *  Payee is never matched on one of these — a gas-station purchase must not pay a bill called "Gas". */
const BILL_WORDS = new Set(['the', 'our', 'and', 'for', 'new', 'monthly', 'weekly', 'yearly', 'annual', 'bill', 'bills', 'payment', 'payments', 'pay', 'pmt', 'autopay',
  'rent', 'mortgage', 'hoa', 'home', 'house', 'apartment', 'electric', 'electricity', 'power', 'energy', 'gas', 'water', 'sewer', 'trash', 'garbage', 'recycling',
  'utility', 'utilities', 'internet', 'wifi', 'broadband', 'cable', 'phone', 'cell', 'mobile', 'wireless', 'insurance', 'life', 'health', 'dental', 'vision',
  'medical', 'auto', 'car', 'vehicle', 'parking', 'toll', 'tolls', 'loan', 'loans', 'student', 'card', 'credit', 'debt', 'transfer', 'savings', 'saving', 'fund',
  'emergency', 'tax', 'taxes', 'fee', 'fees', 'daycare', 'childcare', 'child', 'kids', 'school', 'tuition', 'allowance', 'support', 'pet', 'gym', 'membership',
  'subscription', 'streaming', 'music', 'storage', 'lawn', 'cleaning', 'city', 'county', 'town', 'village', 'state', 'department', 'dept', 'service', 'services', 'company'])
/** The word a payment's payee must contain to count for a bill (0.25.1) — the one rule the Bills page, the alerts, the Monday digest and the
 *  phone reminders use: the first word of its Payee; with no Payee, the first word of its name that names a company rather than a kind of
 *  bill ("AEP Ohio" → aep, "Columbia Gas" → columbia; "Gas" or "Car insurance" → none). With no word, only payments recorded for the bill
 *  (its recurring_id) count. Surrounding punctuation is dropped ("Disney+" → disney). */
export function billWordN(r: { payee?: string | null; name?: string | null }): string {
  const words = (s: string | null | undefined) => String(s || '').toLowerCase().split(/\s+/).map(w => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')).filter(Boolean)
  const payee = words(r.payee); if (payee.length) return payee[0]
  return words(r.name).find(w => { const bare = w.replace(/[^a-z0-9]/g, ''); return bare.length >= 3 && !BILL_WORDS.has(bare) }) || ''
}
/** A transaction from this bill's merchant: recorded for it (its recurring_id), or not tied to another bill and with `word` in its payee. */
const fromBillN = (r: NRecurring, t: NTxn, word: string) => t.recurring_id === r.id || (!t.recurring_id && !!word && !!t.payee && t.payee.toLowerCase().includes(word))
/** One recurring item's due dates and its payments (0.25.1) — the one function the Bills page (lib/recurring.ts paymentsFor) and the alerts
 *  (paidDatesN) both call. `dues` is the item's schedule in date order, a month either side of the dates asked about. `settled`: dates marked
 *  paid or skipped, or linked to the payment recorded for them. `paid`: each other date's payment, matched one to one (matchPaymentsN). A
 *  payment counts when it is recorded for this item, or — when not tied to another bill or to another due date — when its payee holds the
 *  bill's word (billWordN) at a close amount (within 25%, at least $1; any amount when the bill's amount varies). Void and merged-duplicate
 *  rows never count. */
export function billPaymentsN<T extends NTxn>(r: NRecurring, dues: string[], occ: NOccurrence[], tx: T[]): { settled: Set<string>; paid: Map<string, T> } {
  const linked = new Set(occ.map(o => o.transaction_id).filter((x): x is string => !!x)), onFile = (id: string) => tx.some(t => t.id === id)
  const settled = new Set(occ.filter(o => o.recurring_id === r.id && (o.status === 'paid' || o.status === 'skipped' || (!!o.transaction_id && onFile(o.transaction_id)))).map(o => o.due_date.slice(0, 10)))
  const word = billWordN(r), listed = Number(r.amount) || 0
  const pays = tx.filter(t => !t.duplicate_of && t.status !== 'void' && !linked.has(t.id) && fromBillN(r, t, word) && (t.recurring_id === r.id || r.amount_varies || Math.abs((Number(t.amount) || 0) - listed) <= Math.max(1, Math.abs(listed) * 0.25)))
  const byId = new Map(pays.map(t => [t.id, t] as const)), paid = new Map<string, T>()
  for (const [due, id] of matchPaymentsN(dues, x => !settled.has(x), pays)) paid.set(due, byId.get(id)!)
  return { settled, paid }
}
/** What one due date asks for (0.25.1) — the one rule the Bills page and the alerts both call: the amount filed on that date's occurrence (an
 *  email bill, Mark paid) when there is one; else, for a bill whose amount varies, what was paid; else the bill's listed amount. */
export function amountDueN(r: NRecurring, occ?: { amount?: number | null } | null, paidWith?: { amount: number } | null): number {
  if (occ && occ.amount != null) return Number(occ.amount) || 0
  return paidWith && r.amount_varies ? Number(paidWith.amount) || 0 : Number(r.amount) || 0
}
/** The due dates of `r` inside [from, to] that are taken care of (0.25.1): settled, or covered by a payment (billPaymentsN). */
export function paidDatesN(r: NRecurring, from: string, to: string, occ: NOccurrence[], tx: NTxn[], today: string = from): Set<string> {
  const dues = dueDatesN(r, addDaysN(from, -31), addDaysN(to, 31), today), out = new Set<string>()
  if (!dues.length) return out
  const { settled, paid } = billPaymentsN(r, dues, occ, tx)
  for (const d of [...settled, ...paid.keys()]) if (d >= from && d <= to) out.add(d)
  return out
}
/** Every unpaid due date inside [from, to] of the household's active bills, subscriptions, debt payments and transfers (0.25.1), with what it
 *  asks for (amountDueN; `filed` when that came from the date's occurrence). The bill alerts, the low-cash check, the Monday digest and the
 *  phone reminders all count from this one list. */
export function unpaidDuesN<R extends NRecurring>(inp: { today: string; recurring: R[]; occurrences: NOccurrence[]; transactions: NTxn[] }, from: string, to: string): Array<{ r: R; due: string; amount: number; filed: boolean }> {
  return inp.recurring.filter(r => r.status === 'Active' && r.kind !== 'income').flatMap(r => {
    const paid = paidDatesN(r, from, to, inp.occurrences, inp.transactions, inp.today)
    return dueDatesN(r, from, to, inp.today).filter(d => !paid.has(d)).map(due => {
      const o = inp.occurrences.find(x => x.recurring_id === r.id && x.due_date.slice(0, 10) === due)
      return { r, due, amount: amountDueN(r, o), filed: !!o && o.amount != null }
    })
  })
}
export function computeAlerts(inp: NInput): Alert[] {
  const p = { ...NOTIFY_DEFAULTS, ...Object.fromEntries(Object.entries(inp.prefs || {}).filter(([, v]) => v != null)) } as Required<NPrefs>
  const t = inp.today; const out: Alert[] = []; const live = inp.transactions.filter(x => !x.duplicate_of && x.status !== 'void')
  if (inp.deletionScheduledFor) { const d = inp.deletionScheduledFor.slice(0, 10); const left = diff(d, t)
    return [{ kind: 'deletion', key: `deletion:${d}:${left <= 1 ? 'final' : 'scheduled'}`, title: left <= 1 ? 'This household is permanently deleted tomorrow' : `This household will be permanently deleted on ${d}`, body: 'Everything in it — accounts, transactions, files and backups — for every member. Until then it is read-only; an owner can cancel in Settings.', url: '/settings', severity: 'crit' }] }
  const bucket3 = Math.floor(parse(t).getTime() / DAY / 3)
  if (p.bills) for (const { r, due, amount } of unpaidDuesN(inp, addDaysN(t, -30), addDaysN(t, 1))) {
    const d = diff(due, t)
    if (d >= 0) out.push({ kind: 'bill_due', key: `bill_due:${r.id}:${due}`, title: `${r.name} ${d === 0 ? 'is due today' : 'is due tomorrow'}`, body: `${money(amount)}${r.autopay ? ' · autopay — check the balance covers it' : ''}`, url: '/bills', severity: r.autopay ? 'info' : 'warn', amount })
    else if (!r.autopay) out.push({ kind: 'bill_overdue', key: `bill_overdue:${r.id}:${due}:${bucket3}`, title: `${r.name} is ${-d} day${d === -1 ? '' : 's'} overdue`, body: `${money(amount)} was due ${due}`, url: '/bills', severity: 'crit', amount })
  }
  if (p.low_cash) {
    const cash = inp.accounts.filter(a => a.status === 'Active' && !LIAB.includes(a.kind) && (a.include_in_cash || (inp.includeRetirementInCash && a.kind === 'retirement'))).reduce((n, a) => n + (a.bank_balance ?? a.balance ?? 0), 0)
    const due7 = owedN(unpaidDuesN(inp, t, addDaysN(t, 7)))
    // 0.25.1: what is already overdue (the last 30 days, autopay included) is still owed — the same amounts Safe to spend and the Monday digest take off
    const overdue = owedN(unpaidDuesN(inp, addDaysN(t, -30), addDaysN(t, -1))), owed = due7 + overdue
    if (inp.reserveFloor > 0 && cash < inp.reserveFloor) out.push({ kind: 'low_cash', key: `low_cash:floor:${t}`, title: `Cash is below your ${money(inp.reserveFloor)} floor`, body: `${money(cash)} on hand across cash accounts`, url: '/', severity: 'crit', amount: cash })
    else if (owed > cash) out.push({ kind: 'low_cash', key: `low_cash:due7:${t}`, title: overdue > 0 ? 'Overdue bills and bills due this week exceed cash on hand' : 'Bills due this week exceed cash on hand', body: `${overdue > 0 ? `${money(overdue)} overdue and ` : ''}${money(due7)} due in 7 days, ${money(cash)} available`, url: '/forecast', severity: 'crit', amount: round(owed - cash) })
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
    const word = billWordN(r)   // 0.25.1: the bill's merchant found the same way as its payments, so "Gas" never "goes up" at a gas station
    const last = live.filter(x => x.kind === 'expense' && diff(t, x.date) >= 0 && diff(t, x.date) <= 35 && fromBillN(r, x, word.length > 2 ? word : '')).sort((a, b) => b.date.localeCompare(a.date))[0]
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
const owedN = (list: Array<{ amount: number }>) => list.reduce((n, x) => n + x.amount, 0)

/** Who receives an alert of this kind (0.21.0). Each member's own choices win; anything they did not set falls back to the household
 *  switches: push goes to every member's devices unless push is off; email goes to the household address (or the owner) unless a
 *  member chose email for themselves. `kinds` limits a member to some alert kinds; 'digest' is the Monday digest.
 *  0.25.1: a member with Limited access gets only the deletion notice — no other alert and no digest, whatever their own settings say —
 *  because alerts and the digest show cash, bills, payees, income and charges from sections they cannot open. */
export interface NMember { user_id: string; email?: string | null; role: string | null; modules: string[] | null }
export interface NMemberPrefs { push?: boolean; email?: boolean; email_to?: string | null; digest?: boolean; kinds?: string[] | null }
export interface NRouting { push?: boolean; email?: boolean; email_to?: string | null; members?: Record<string, NMemberPrefs> }
/** Limited access (0.25.1): not an owner, and `modules` lists the sections the member may open (null = every section — the database's
 *  module_allowed() reads it the same way). Modules that were never loaded count as limited, so a missing column can only hold alerts back. */
export const isLimitedMember = (m: { role?: string | null; modules?: string[] | null }) => m.role !== 'owner' && m.modules !== null
export function recipientsFor(prefs: NRouting, members: NMember[], kind: string): { push: string[]; email: Array<{ to: string; user_id: string | null }> } {
  const mm = prefs.members || {}; const push: string[] = []; const email: Array<{ to: string; user_id: string | null }> = []
  const limited = new Set(members.filter(isLimitedMember).map(m => m.user_id))
  for (const m of members) {
    if (kind !== 'deletion' && limited.has(m.user_id)) continue
    const p = mm[m.user_id] || {}
    const wants = kind === 'digest' ? p.digest !== false : kind === 'deletion' || !p.kinds || p.kinds.includes(kind)
    if (!wants) continue
    if (p.push ?? (prefs.push !== false)) push.push(m.user_id)
    if (p.email === true) { const to = String(p.email_to || m.email || '').trim().toLowerCase(); if (/@/.test(to)) email.push({ to, user_id: m.user_id }) }
  }
  // the household address, unless a member picked email for themselves (a Limited member's own choice does not switch it off); it falls back
  // to an owner's address, never to a Limited member's
  if (prefs.email && !Object.entries(mm).some(([uid, p]) => p.email === true && !limited.has(uid))) { const to = String(prefs.email_to || members.find(m => m.role === 'owner')?.email || members.find(m => !limited.has(m.user_id))?.email || '').trim().toLowerCase(); if (/@/.test(to)) email.push({ to, user_id: null }) }
  const seen = new Set<string>(); return { push, email: email.filter(e => !seen.has(e.to) && (seen.add(e.to), true)) }
}

/** The Monday digest: one email with the week ahead and the week behind. */
export interface DigestInput { today: string; accounts: NAccount[]; recurring: NRecurring[]; occurrences: NOccurrence[]; transactions: NTxn[]; reserveFloor: number; includeRetirementInCash?: boolean; categoriesOf?: (t: NTxn) => string }
export function computeDigest(inp: DigestInput) {
  const t = inp.today; const live = inp.transactions.filter(x => !x.duplicate_of && x.status !== 'void')
  const cash = inp.accounts.filter(a => a.status === 'Active' && !LIAB.includes(a.kind) && (a.include_in_cash || (inp.includeRetirementInCash && a.kind === 'retirement'))).reduce((n, a) => n + (a.bank_balance ?? a.balance ?? 0), 0)
  const row = ({ r, due, amount }: { r: NRecurring; due: string; amount: number }) => ({ name: r.name, amount, due, autopay: r.autopay })
  const week = unpaidDuesN(inp, t, addDaysN(t, 6)).map(row).sort((a, b) => a.due.localeCompare(b.due))
  // 0.25.1: everything due in the last 30 days and still unpaid is still owed — autopay included (an autopay that never went through), as in
  // the app's Safe to spend — so it is listed and taken off what is safe to spend (the low-cash alert counts the same list)
  const overdue = unpaidDuesN(inp, addDaysN(t, -30), addDaysN(t, -1)).map(row).sort((a, b) => a.due.localeCompare(b.due))
  const overdueTotal = overdue.reduce((n, o) => n + o.amount, 0)
  const spend = (from: string, to: string) => live.filter(x => x.kind === 'expense' && x.date >= from && x.date <= to).reduce((n, x) => n + x.amount, 0)
  const lastWeek = spend(addDaysN(t, -7), addDaysN(t, -1)), priorWeek = spend(addDaysN(t, -14), addDaysN(t, -8)), income = live.filter(x => x.kind === 'income' && x.date >= addDaysN(t, -7) && x.date <= addDaysN(t, -1)).reduce((n, x) => n + x.amount, 0)
  const byPayee = new Map<string, number>(); for (const x of live.filter(x => x.kind === 'expense' && x.date >= addDaysN(t, -7) && x.date <= addDaysN(t, -1))) { const k = (x.payee || 'Unknown').trim(); byPayee.set(k, (byPayee.get(k) || 0) + x.amount) }
  const topPayees = [...byPayee.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const dueTotal = week.reduce((n, w) => n + w.amount, 0)
  return { cash, floor: inp.reserveFloor, safeThisWeek: Math.max(0, cash - dueTotal - overdueTotal - inp.reserveFloor), week, dueTotal, overdue, overdueTotal, lastWeek, priorWeek, income, topPayees, uncategorized: live.filter(x => x.kind === 'expense' && x.date >= addDaysN(t, -7) && !inp.categoriesOf?.(x) && !(x as { category_id?: string | null }).category_id).length }
}
