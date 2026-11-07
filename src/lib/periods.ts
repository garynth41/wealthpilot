// Budget periods: the app budgets per month, per pay period (from the primary pay schedule), per week, twice a month, or custom.
// 0.25.1: every day belongs to exactly one period of each cadence, so the next and previous period always move on (fix0251f.test.ts walks
// two years of every cadence).
import type { BudgetPeriod, Data, PaySchedule, PeriodType, Settings } from '../app/data/types'
import { addDays, daysInMonth, diffDays, fmtD, fmtDY, mLabel, monthEnd, monthStart, parse, pad, today, weekStart } from './dates'
import { payDates } from './paySchedule'

export interface Span { start: string; end: string; type: PeriodType; label: string }
export const primarySchedule = (d: Data) => d.paySchedules.filter(s => s.status === 'Active').sort((a, b) => (+b.net_amount || 0) - (+a.net_amount || 0))[0] || null
/** Every-2-weeks periods with no anchor date and no two-week budget started yet count from this Monday, so they fall on alternate Mondays. */
export const BIWEEKLY_ANCHOR = '2024-01-01'
/** The two start days of a twice-a-month budget, in order, each a whole day from 1 to 31 ([1, 15] when not set). */
const semiDays = (v: number[] | null | undefined): [number, number] => {
  const ok = (n: number) => Math.min(31, Math.max(1, Math.round(+n) || 1)); const [a, b] = (v && v.length >= 2 ? v.slice(0, 2) : [1, 15]).map(ok).sort((x, y) => x - y)
  return [a, b]
}

/** The period span that contains `date` for the household's chosen cadence. */
export function spanFor(d: Data, s: Settings, date = today()): Span {
  const t = s.periodType
  if (t === 'month') { const m = date.slice(0, 7); return { start: monthStart(m), end: monthEnd(m), type: 'month', label: mLabel(m) } }
  if (t === 'week') { const st = weekStart(date); return { start: st, end: addDays(st, 6), type: 'week', label: `Week of ${fmtD(st)}` } }
  if (t === 'semimonthly') {
    // each start day falls on the month's last day when the month is shorter (31 → Nov 30, Feb 28), and the date is compared with those
    // clamped days (0.25.1: comparing with the unclamped 31 put Nov 30 in a Nov 15–29 period that does not contain it)
    const [d1, d2] = semiDays(s.semimonthlyDays)
    const starts = (m: string): [string, string] => { const last = daysInMonth(m); return [`${m}-${pad(Math.min(d1, last))}`, `${m}-${pad(Math.min(d2, last))}`] }
    const m = date.slice(0, 7); const [a, b] = starts(m)
    const [st, nx] = date < a ? [starts(addDays(monthStart(m), -1).slice(0, 7))[1], a] : date < b ? [a, b] : [b, starts(addDays(monthEnd(m), 1).slice(0, 7))[0]]
    const end = addDays(nx, -1); return { start: st, end, type: 'semimonthly', label: `${fmtD(st)} – ${fmtD(end)}` }
  }
  if (t === 'biweekly' || t === 'custom') {
    // 0.25.1: with no anchor date, count from the latest two-week budget already started (so it stays where it is), else from alternate
    // Mondays — never from the 1st of each month, which made Nov 29 – Dec 12 overlap Dec 1 – Dec 14
    const anchor = (s.periodAnchor || d.periods.filter(p => p.period_type === t).map(p => p.start_date.slice(0, 10)).sort().pop() || BIWEEKLY_ANCHOR).slice(0, 10)
    const st = addDays(anchor, Math.floor(diffDays(date, anchor) / 14) * 14), end = addDays(st, 13)
    return { start: st, end, type: t, label: `${fmtD(st)} – ${fmtD(end)}` }
  }
  // pay period from the primary schedule; falls back to month when there is none
  const ps = primarySchedule(d); const pp = ps && payPeriod(ps, date)
  if (!pp) { const m = date.slice(0, 7); return { start: monthStart(m), end: monthEnd(m), type: 'month', label: mLabel(m) } }
  return { start: pp.start, end: pp.end, type: 'pay', label: `Pay period ${fmtD(pp.start)} – ${fmtD(pp.end)}` }
}
/** A pay period: from one pay date of the schedule up to the day before the next. Before the schedule's first pay date and after its last one
 *  (it starts or ends on a date) the periods keep the length of the first or last real one, so every day still has exactly one (0.25.1:
 *  the earlier rule left those days in a period that did not contain them, and Previous / Next stopped moving). Irregular income has no pay
 *  periods, so it budgets by calendar month. */
function payPeriod(ps: PaySchedule, date: string): { start: string; end: string } | null {
  if (ps.frequency === 'irregular') return null
  const between = (from: string, to: string) => payDates(ps, from, to)
  const prev = between(addDays(date, -400), date).pop(), next = between(addDays(date, 1), addDays(date, 400))[0]
  if (prev && next) return { start: prev, end: addDays(next, -1) }
  const nominal = ps.frequency === 'weekly' ? 7 : 14
  const starts = ps.starts_on?.slice(0, 10), ends = ps.ends_on?.slice(0, 10)
  const first = next ?? (starts && starts > date ? between(starts, addDays(starts, 400))[0] : undefined)
  if (first) { const after = between(addDays(first, 1), addDays(first, 400))[0]; const len = after ? diffDays(after, first) : nominal; const st = addDays(first, -Math.ceil(diffDays(first, date) / len) * len); return { start: st, end: addDays(st, len - 1) } }
  const last = prev ?? (ends && ends < date ? between(addDays(ends, -400), ends).pop() : undefined)
  if (last) { const before = between(addDays(last, -400), addDays(last, -1)).pop(); const len = before ? diffDays(last, before) : nominal; const st = addDays(last, Math.floor(diffDays(date, last) / len) * len); return { start: st, end: addDays(st, len - 1) } }
  return null
}
export const nextSpan = (d: Data, s: Settings, sp: Span) => spanFor(d, s, addDays(sp.end, 1))
export const prevSpan = (d: Data, s: Settings, sp: Span) => spanFor(d, s, addDays(sp.start, -1))
export const periodLabel = (p: BudgetPeriod) => p.label || (p.period_type === 'month' ? mLabel(p.start_date.slice(0, 7)) : p.period_type === 'pay' ? `Pay period ${fmtD(p.start_date)} – ${fmtD(p.end_date)}` : `${fmtD(p.start_date)} – ${fmtDY(p.end_date)}`)
export const findPeriod = (d: Data, sp: { start: string; end: string }) => d.periods.find(p => p.start_date === sp.start && p.end_date === sp.end) || null
export const currentPeriod = (d: Data, s: Settings) => findPeriod(d, spanFor(d, s))
export const periodContaining = (d: Data, date: string) => d.periods.find(p => p.start_date <= date && p.end_date >= date) || null
export const daysIn = (p: { start_date: string; end_date: string }) => Math.round((parse(p.end_date).getTime() - parse(p.start_date).getTime()) / 86400000) + 1
/** 0..1 — how much of the period has passed as of today. */
export function elapsed(p: { start_date: string; end_date: string }, t = today()) { if (t < p.start_date) return 0; if (t > p.end_date) return 1; const n = daysIn(p); return Math.min(1, (Math.round((parse(t).getTime() - parse(p.start_date).getTime()) / 86400000) + 1) / n) }
