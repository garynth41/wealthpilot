// Recurring bills, subscriptions, debt payments and income: due dates, upcoming occurrences, status.
import type { Data, Recurring, RecurringFreq, Transaction, BillOccurrence } from '../app/data/types'
import { addDays, addMonthsClamp, daysInMonth, diffDays, pad, today } from './dates'
import { close, sum } from './money'

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
/** A payment made for this recurring item near the due date (same recurring_id, or same payee + close amount). */
export function matchTxn(d: Data, r: Recurring, due: string): Transaction | null {
  const lo = addDays(due, -12), hi = addDays(due, 10)
  const cands = d.transactions.filter(t => t.status !== 'void' && t.date >= lo && t.date <= hi && (t.recurring_id === r.id || (r.payee && t.payee && t.payee.toLowerCase().includes(r.payee.toLowerCase().split(' ')[0]) && (r.amount_varies || close(t.amount, r.amount, 0.25)))))
  return cands.sort((a, b) => Math.abs(diffDays(a.date, due)) - Math.abs(diffDays(b.date, due)))[0] || null
}
/** Every occurrence of every active recurring item in a window, with its paid/due state. */
export function upcoming(d: Data, from: string, to: string, kinds?: Recurring['kind'][]): Upcoming[] {
  const t = today(), out: Upcoming[] = []
  for (const r of recActive(d)) {
    if (kinds && !kinds.includes(r.kind)) continue
    for (const date of dueDates(r, from, to)) {
      const occ = d.occurrences.find(o => o.recurring_id === r.id && o.due_date === date) || null
      const txn = (occ?.transaction_id && d.transactions.find(x => x.id === occ.transaction_id)) || matchTxn(d, r, date)
      const amount = occ?.amount ?? (txn && r.amount_varies ? txn.amount : +r.amount || 0)
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
