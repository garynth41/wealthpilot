import type { Data, PaySchedule, PayFrequency, Transaction } from '../app/data/types'
import { addDays, addMonthsClamp, diffDays, iso, parse, today, daysInMonth, monthKey } from './dates'

/** Paychecks a year by frequency. Irregular is a one-off (0.25.1): paid once, only on its known pay date — it has no monthly amount, and
 *  the cash calendar, the runway and the Plan count it once, in its own month (see oneOffPay). */
export const PER_YEAR: Record<PayFrequency, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, quarterly: 4, yearly: 1, irregular: 0 }
export const monthlyEquivalent = (amount: number, f: PayFrequency) => (amount * PER_YEAR[f]) / 12
const semiDays = (ps: PaySchedule) => (ps.semimonthly_days && ps.semimonthly_days.length === 2 ? ps.semimonthly_days : [15, 31]).slice().sort((a, b) => a - b)

/** Every pay date in [from, to] for a schedule, computed from its anchor date. */
export function payDates(ps: PaySchedule, from: string, to: string): string[] {
  const out: string[] = []
  const lo = ps.starts_on && ps.starts_on > from ? ps.starts_on : from, hi = ps.ends_on && ps.ends_on < to ? ps.ends_on : to
  if (lo > hi || ps.status === 'Ended') return out
  const anchor = ps.anchor_date.slice(0, 10)
  if (ps.frequency === 'semimonthly') {
    const [d1, d2] = semiDays(ps); const a = parse(lo); const b = parse(hi)
    for (let m = new Date(a.getFullYear(), a.getMonth(), 1); m <= b; m.setMonth(m.getMonth() + 1)) { const mk = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`; const last = daysInMonth(mk); for (const dd of [d1, d2]) { const d = `${mk}-${String(Math.min(dd, last)).padStart(2, '0')}`; if (d >= lo && d <= hi) out.push(d) } }
    return [...new Set(out)].sort()
  }
  if (ps.frequency === 'irregular') return anchor >= lo && anchor <= hi ? [anchor] : []
  const step = ps.frequency === 'weekly' ? 7 : ps.frequency === 'biweekly' ? 14 : 0
  if (step) { // walk from the anchor in both directions
    let d = anchor; while (d > lo) d = addDays(d, -step); while (d < lo) d = addDays(d, step)
    for (let k = 0; d <= hi && k < 400; k++) { out.push(d); d = addDays(d, step) }
    return out
  }
  const months = ps.frequency === 'monthly' ? 1 : ps.frequency === 'quarterly' ? 3 : 12; const day = parse(anchor).getDate()
  let k = 0; let d = anchor; while (d > lo) { k -= months; d = addMonthsClamp(anchor, k, day) } while (d < lo) { k += months; d = addMonthsClamp(anchor, k, day) }
  for (let n = 0; d <= hi && n < 400; n++) { out.push(d); k += months; d = addMonthsClamp(anchor, k, day) }
  return out
}
export const nextPayDate = (ps: PaySchedule, from = today()) => payDates(ps, from, addDays(from, 400))[0] || null
/** The next paycheck still to come across the active schedules (0.25.1): a payday whose deposit is already on file — on the day itself, or a
 *  day or two early — is not "next" any more. */
export function nextPaycheck(d: Pick<Data, 'paySchedules' | 'transactions'>, from = today(), days = 400): { p: PaySchedule; d: string } | null {
  return d.paySchedules.filter(p => p.status === 'Active').flatMap(p => { const dd = payDates(p, from, addDays(from, days)).find(x => !paycheckOnFile(d, p, x)); return dd ? [{ p, d: dd }] : [] }).sort((a, b) => a.d.localeCompare(b.d))[0] || null
}
export const lastPayDate = (ps: PaySchedule, before = today()) => payDates(ps, addDays(before, -400), addDays(before, -1)).pop() || null
/** Expected net income from all active schedules inside a date range. */
export function expectedIncome(schedules: PaySchedule[], from: string, to: string) { return schedules.filter(s => s.status === 'Active').reduce((n, s) => n + payDates(s, from, to).length * (+s.net_amount || 0), 0) }
/** Take-home in an average month from the active schedules that repeat — a one-off (Irregular) is not monthly income. */
export const monthlyIncome = (schedules: PaySchedule[]) => schedules.filter(s => s.status === 'Active').reduce((n, s) => n + monthlyEquivalent(+s.net_amount || 0, s.frequency), 0)
/** One-off (Irregular) pay due in [from, to] (0.25.1), each once on its pay date — the runway and the Plan add it in its month on top of the
 *  monthly income; one whose deposit is already on file is left out (cash on hand has it). */
export function oneOffPay(d: Pick<Data, 'paySchedules' | 'transactions'>, from: string, to: string): Array<{ date: string; amount: number; ps: PaySchedule }> {
  return d.paySchedules.filter(p => p.status === 'Active' && p.frequency === 'irregular' && +p.net_amount > 0).flatMap(p => payDates(p, from, to).filter(dd => !paycheckOnFile(d, p, dd)).map(dd => ({ date: dd, amount: +p.net_amount, ps: p })))
}
/** A pay period is the stretch from one pay date up to the day before the next (driven by the primary schedule). */
export function payPeriodFor(ps: PaySchedule, date: string): { start: string; end: string } | null {
  const prev = payDates(ps, addDays(date, -400), date).pop(); const next = payDates(ps, addDays(date, 1), addDays(date, 400))[0]
  if (!prev && !next) return null
  const start = prev || addDays(next!, -(ps.frequency === 'weekly' ? 7 : 14)); const end = next ? addDays(next, -1) : addDays(start, 13)
  return { start, end }
}
export const payMonthLabel = (d: string) => monthKey(d)
export const isoOf = iso
/** The income already on file for one payday of a schedule (0.25.1), so a paycheck is never logged twice. Mirrors the notify `paycheck`
 *  rule: an income transaction within 2 days of the payday that is linked to this schedule, or — when it is not linked to another
 *  schedule — within 2% (at least $5) of the take-home, or of `amount` when one was typed. Void and merged-duplicate rows do not count.
 *  The closest one by date wins. */
export function paycheckOnFile(d: Pick<Data, 'transactions'>, ps: PaySchedule, date: string, amount?: number | null): Transaction | null {
  const near = (want: number, got: number) => want > 0 && Math.abs(got - want) <= Math.max(5, want * 0.02)
  const hits = d.transactions.filter(t => t.kind === 'income' && t.status !== 'void' && !t.duplicate_of && Math.abs(diffDays(t.date, date)) <= 2
    && (t.pay_schedule_id === ps.id || (!t.pay_schedule_id && (near(+ps.net_amount || 0, +t.amount) || near(+(amount || 0), +t.amount)))))
  return hits.sort((a, b) => Math.abs(diffDays(a.date, date)) - Math.abs(diffDays(b.date, date)))[0] || null
}
