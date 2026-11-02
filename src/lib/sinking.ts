// Sinking funds (0.9.0): categories budgeted per month or per year are spread across whatever budget period the household uses.
// A category's `budget_cadence` says what its `default_budget` means: 'period' = per budget period (as before), 'monthly' = per month, 'yearly' = per year.
import type { BudgetPeriod, Category, Data, Settings } from '../app/data/types'
import { diffDays, today, monthStart } from './dates'
import { round2, sum } from './money'
import { spentIn } from './budget'

const days = (from: string, to: string) => diffDays(to, from) + 1
const isWholeMonth = (from: string, to: string) => from.slice(8) === '01' && from.slice(0, 7) === to.slice(0, 7) && monthStart(from.slice(0, 7)) === from && to === new Date(Date.UTC(+from.slice(0, 4), +from.slice(5, 7), 0)).toISOString().slice(0, 10)
/** The planned amount for one budget period: per-period as entered; monthly and yearly amounts prorated (whole calendar months use 1/12 exactly, other periods by days). */
export function plannedForPeriod(c: Pick<Category, 'default_budget' | 'budget_cadence'>, from: string, to: string): number {
  const amt = +c.default_budget || 0; if (!amt || c.budget_cadence === 'period') return round2(amt)
  if (isWholeMonth(from, to)) return round2(c.budget_cadence === 'yearly' ? amt / 12 : amt)
  const n = days(from, to); return round2(c.budget_cadence === 'yearly' ? amt * n / 365 : amt * n / (365 / 12))
}
/** Lines whose planned amount should be re-derived for a period (cadence ≠ 'period'). Returns patches for existing lines and new lines to insert. */
export function cadencePlan(d: Data, p: BudgetPeriod): { updates: Array<{ id: string; planned: number }>; inserts: Array<{ category_id: string; planned: number }> } {
  const updates: Array<{ id: string; planned: number }> = [], inserts: Array<{ category_id: string; planned: number }> = []
  for (const c of d.categories.filter(c => !c.archived && c.kind !== 'transfer' && c.budget_cadence !== 'period' && +c.default_budget > 0)) {
    const want = plannedForPeriod(c, p.start_date, p.end_date); const line = d.lines.find(l => l.period_id === p.id && l.category_id === c.id)
    if (line) { if (Math.abs(+line.planned - want) > 0.004) updates.push({ id: line.id, planned: want }) } else inserts.push({ category_id: c.id, planned: want })
  }
  return { updates, inserts }
}
export interface SinkingFund { cat: Category; yearly: number; perMonth: number; accrued: number; spent: number; balance: number; pctOfYear: number; status: 'ahead' | 'on track' | 'overdrawn' }
/** Year-to-date view of every yearly / monthly category: what has been set aside so far, what was spent, and the fund balance. */
export function sinkingFunds(d: Data, _s: Settings, asOf = today()): SinkingFund[] {
  const y = asOf.slice(0, 4), from = `${y}-01-01`; const elapsed = days(from, asOf) / (diffDays(`${y}-12-31`, from) + 1)
  return d.categories.filter(c => !c.archived && c.kind === 'expense' && c.budget_cadence !== 'period' && +c.default_budget > 0).map(c => {
    const yearly = round2(c.budget_cadence === 'yearly' ? +c.default_budget : +c.default_budget * 12); const accrued = round2(yearly * elapsed); const spent = round2(spentIn(d, c.id, from, asOf)); const balance = round2(accrued - spent)
    return { cat: c, yearly, perMonth: round2(yearly / 12), accrued, spent, balance, pctOfYear: round2(elapsed), status: balance < -0.005 ? 'overdrawn' : spent < accrued * 0.5 ? 'ahead' : 'on track' } as SinkingFund
  }).sort((a, b) => b.yearly - a.yearly)
}
export const sinkingTotals = (f: SinkingFund[]) => ({ yearly: round2(sum(f.map(x => x.yearly))), accrued: round2(sum(f.map(x => x.accrued))), spent: round2(sum(f.map(x => x.spent))), balance: round2(sum(f.map(x => x.balance))) })
