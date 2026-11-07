// Recurring bills, subscriptions, debt payments and income: due dates, upcoming occurrences, status.
import type { Data, Recurring, RecurringFreq, Transaction, BillOccurrence } from '../app/data/types'
import { addDays, addMonthsClamp, daysInMonth, diffDays, pad, today } from './dates'
import { sum } from './money'
import { amountDueN, billPaymentsN } from './notify'

export const REC_PER_YEAR: Record<RecurringFreq, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, every_2_months: 6, quarterly: 4, every_6_months: 2, yearly: 1, irregular: 0 }
export const recMonthly = (r: Recurring) => (+r.amount || 0) * REC_PER_YEAR[r.frequency] / 12
export const recActive = (d: Data) => d.recurring.filter(r => r.status === 'Active')
export const isOutflow = (r: Recurring) => r.kind !== 'income'

/** Due dates of one recurring item within [from, to]. */
export function dueDates(r: Recurring, from: string, to: string): string[] {
  const out: string[] = []
  const lo = r.starts_on && r.starts_on > from ? r.starts_on : from, hi = r.ends_on && r.ends_on < to ? r.ends_on : to
  if (lo > hi || r.status === 'Cancelled') return out
  const seed = (r.next_due || (r.day_of_month ? `${today().slice(0, 7)}-${pad(Math.min(r.day_of_month, daysInMonth(today().slice(0, 7))))}` : today())).slice(0, 10)
  if (r.frequency === 'irregular') return seed >= lo && seed <= hi ? [seed] : []
  if (r.frequency === 'weekly' || r.frequency === 'biweekly') { const step = r.frequency === 'weekly' ? 7 : 14; let d = seed; while (d > lo) d = addDays(d, -step); while (d < lo) d = addDays(d, step); for (let k = 0; d <= hi && k < 400; k++) { out.push(d); d = addDays(d, step) } return out }
  if (r.frequency === 'semimonthly') { const day = r.day_of_month || +seed.slice(8); const d2 = day <= 15 ? day + 15 : day - 15; const a = new Date(+lo.slice(0, 4), +lo.slice(5, 7) - 1, 1); for (let m = 0; m < 40; m++) { const mk = `${a.getFullYear() + Math.floor((a.getMonth() + m) / 12)}-${pad(((a.getMonth() + m) % 12) + 1)}`; const last = daysInMonth(mk); for (const dd of [Math.min(day, last), Math.min(d2, last)].sort((x, y) => x - y)) { const d = `${mk}-${pad(dd)}`; if (d > hi) return out; if (d >= lo) out.push(d) } } return out }
  const months = { monthly: 1, every_2_months: 2, quarterly: 3, every_6_months: 6, yearly: 12 }[r.frequency] || 1
  const day = r.day_of_month || +seed.slice(8)
  let k = 0, d = addMonthsClamp(seed, 0, day); while (d > lo) { k -= months; d = addMonthsClamp(seed, k, day) } while (d < lo) { k += months; d = addMonthsClamp(seed, k, day) }
  for (let n = 0; d <= hi && n < 400; n++) { out.push(d); k += months; d = addMonthsClamp(seed, k, day) }
  return out
}
export const nextDue = (r: Recurring, from = today()) => dueDates(r, from, addDays(from, 400))[0] || null

export interface Upcoming { r: Recurring; date: string; amount: number; occ: BillOccurrence | null; txn: Transaction | null; status: 'paid' | 'scheduled' | 'skipped' | 'overdue' | 'due_today' | 'due_soon' | 'due' | 'autopay'; days: number }
/** The payments for one recurring item's due dates in [from, to] (0.25.1), one to one: a payment covers one due date — the nearest still
 *  unpaid one whose window it falls in — and each due date takes at most one payment. A due date's window runs from 12 days before it to
 *  10 days after, but never past half the gap to the due date before or after (a weekly bill's is 3 days either side), so a weekly bill paid
 *  once is paid for that week only. A payment counts when it carries this item's recurring_id, or — when it is not tied to another item or
 *  to another due date — when its payee holds the bill's word at a close amount: the first word of the Payee, or with no Payee the first word
 *  of the name that names a company ("AEP Ohio" yes, "Gas" no). A payment recorded for a due date (Mark paid) belongs to that date, and a
 *  date marked paid or skipped takes no other payment. The rule itself is billPaymentsN in lib/notify.ts, so the alerts, the Monday digest
 *  and the phone reminders reach the same answer. */
export function paymentsFor(d: Data, r: Recurring, from: string, to: string): Map<string, Transaction> {
  const out = new Map<string, Transaction>(); const dues = dueDates(r, addDays(from, -31), addDays(to, 31)); if (!dues.length) return out
  for (const [due, t] of billPaymentsN(r, dues, d.occurrences, d.transactions).paid) if (due >= from && due <= to) out.set(due, t)
  return out
}
/** The payment that covers one due date of this recurring item, if any (the one-to-one rule of paymentsFor). */
export const matchTxn = (d: Data, r: Recurring, due: string): Transaction | null => paymentsFor(d, r, due, due).get(due) || null
/** Every occurrence of every active recurring item in a window, with its paid/due state. */
export function upcoming(d: Data, from: string, to: string, kinds?: Recurring['kind'][]): Upcoming[] {
  const t = today(), out: Upcoming[] = []
  for (const r of recActive(d)) {
    if (kinds && !kinds.includes(r.kind)) continue
    const dates = dueDates(r, from, to); if (!dates.length) continue
    const paidBy = paymentsFor(d, r, from, to)
    for (const date of dates) {
      const occ = d.occurrences.find(o => o.recurring_id === r.id && o.due_date === date) || null
      const txn = (occ?.transaction_id && d.transactions.find(x => x.id === occ.transaction_id)) || paidBy.get(date) || null
      const amount = amountDueN(r, occ, txn)   // the amount filed for the date, else what was paid when it varies, else the listed amount
      const days = diffDays(date, t)
      let status: Upcoming['status'] = 'due'
      if (occ?.status === 'skipped') status = 'skipped'
      else if (occ?.status === 'paid' || txn) status = 'paid'
      else if (occ?.status === 'scheduled') status = 'scheduled'
      else if (days < 0) status = 'overdue'
      else if (days === 0) status = 'due_today'
      else if (r.autopay) status = 'autopay'
      else if (days <= (r.reminder_days ?? 3)) status = 'due_soon'
      out.push({ r, date, amount, occ, txn, status, days })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount)
}
export const STATUS_PILL: Record<Upcoming['status'], { cls: string; label: string }> = { paid: { cls: 'good', label: 'Paid' }, scheduled: { cls: 'wait', label: 'Scheduled' }, skipped: { cls: 'idle', label: 'Skipped' }, overdue: { cls: 'crit', label: 'Overdue' }, due_today: { cls: 'soon', label: 'Due today' }, due_soon: { cls: 'warn', label: 'Due soon' }, due: { cls: 'info', label: 'Due' }, autopay: { cls: 'wait', label: 'Autopay' } }
/** Monthly commitments: bills + subscriptions + debt payments (what the household must cover each month). */
export function monthlyCommitments(d: Data) { const act = recActive(d).filter(isOutflow); return { bills: sum(act.filter(r => r.kind === 'bill').map(recMonthly)), subs: sum(act.filter(r => r.kind === 'subscription').map(recMonthly)), debt: sum(act.filter(r => r.kind === 'debt_payment').map(recMonthly)), savings: sum(act.filter(r => r.kind === 'savings' || r.kind === 'transfer').map(recMonthly)), total: sum(act.map(recMonthly)) } }
