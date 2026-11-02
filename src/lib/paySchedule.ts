import type { PaySchedule, PayFrequency } from '../app/data/types'
import { addDays, addMonthsClamp, iso, parse, today, daysInMonth, monthKey } from './dates'

export const PER_YEAR: Record<PayFrequency, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, quarterly: 4, yearly: 1, irregular: 12 }
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
export const lastPayDate = (ps: PaySchedule, before = today()) => payDates(ps, addDays(before, -400), addDays(before, -1)).pop() || null
/** Expected net income from all active schedules inside a date range. */
export function expectedIncome(schedules: PaySchedule[], from: string, to: string) { return schedules.filter(s => s.status === 'Active').reduce((n, s) => n + payDates(s, from, to).length * (+s.net_amount || 0), 0) }
export const monthlyIncome = (schedules: PaySchedule[]) => schedules.filter(s => s.status === 'Active').reduce((n, s) => n + monthlyEquivalent(+s.net_amount || 0, s.frequency), 0)
/** A pay period is the stretch from one pay date up to the day before the next (driven by the primary schedule). */
export function payPeriodFor(ps: PaySchedule, date: string): { start: string; end: string } | null {
  const prev = payDates(ps, addDays(date, -400), date).pop(); const next = payDates(ps, addDays(date, 1), addDays(date, 400))[0]
  if (!prev && !next) return null
  const start = prev || addDays(next!, -(ps.frequency === 'weekly' ? 7 : 14)); const end = next ? addDays(next, -1) : addDays(start, 13)
  return { start, end }
}
export const payMonthLabel = (d: string) => monthKey(d)
export const isoOf = iso
