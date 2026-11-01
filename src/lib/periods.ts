// Budget periods: the app budgets per month, per pay period (from the primary pay schedule), per week, twice a month, or custom.
import type { BudgetPeriod, Data, PeriodType, Settings } from '../app/data/types'
import { addDays, daysInMonth, fmtD, fmtDY, mLabel, monthEnd, monthStart, parse, pad, today, weekStart } from './dates'
import { payPeriodFor } from './paySchedule'

export interface Span { start: string; end: string; type: PeriodType; label: string }
export const primarySchedule = (d: Data) => d.paySchedules.filter(s => s.status === 'Active').sort((a, b) => (+b.net_amount || 0) - (+a.net_amount || 0))[0] || null

/** The period span that contains `date` for the household's chosen cadence. */
export function spanFor(d: Data, s: Settings, date = today()): Span {
  const t = s.periodType
  if (t === 'month') { const m = date.slice(0, 7); return { start: monthStart(m), end: monthEnd(m), type: 'month', label: mLabel(m) } }
  if (t === 'week') { const st = weekStart(date); return { start: st, end: addDays(st, 6), type: 'week', label: `Week of ${fmtD(st)}` } }
  if (t === 'semimonthly') { const [d1, d2] = (s.semimonthlyDays || [1, 15]).slice().sort((a, b) => a - b); const m = date.slice(0, 7), last = daysInMonth(m), day = +date.slice(8)
    const a = `${m}-${pad(Math.min(d1, last))}`, b = `${m}-${pad(Math.min(d2, last))}`
    if (day < d1) { const pm = addDays(monthStart(m), -1).slice(0, 7); const pb = `${pm}-${pad(Math.min(d2, daysInMonth(pm)))}`; return { start: pb, end: addDays(a, -1), type: 'semimonthly', label: `${fmtD(pb)} – ${fmtD(addDays(a, -1))}` } }
    if (day < d2) return { start: a, end: addDays(b, -1), type: 'semimonthly', label: `${fmtD(a)} – ${fmtD(addDays(b, -1))}` }
    const nm = addDays(monthEnd(m), 1).slice(0, 7); const na = `${nm}-${pad(Math.min(d1, daysInMonth(nm)))}`; return { start: b, end: addDays(na, -1), type: 'semimonthly', label: `${fmtD(b)} – ${fmtD(addDays(na, -1))}` } }
  if (t === 'biweekly' || t === 'custom') { const anchor = (s.periodAnchor || monthStart(date.slice(0, 7))).slice(0, 10); let st = anchor; while (st > date) st = addDays(st, -14); while (addDays(st, 14) <= date) st = addDays(st, 14); return { start: st, end: addDays(st, 13), type: t, label: `${fmtD(st)} – ${fmtD(addDays(st, 13))}` } }
  // pay period from the primary schedule; falls back to month when there is none
  const ps = primarySchedule(d); const pp = ps && payPeriodFor(ps, date)
  if (!pp) { const m = date.slice(0, 7); return { start: monthStart(m), end: monthEnd(m), type: 'month', label: mLabel(m) } }
  return { start: pp.start, end: pp.end, type: 'pay', label: `Pay period ${fmtD(pp.start)} – ${fmtD(pp.end)}` }
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
