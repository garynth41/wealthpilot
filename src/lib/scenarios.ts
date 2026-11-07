// Saved scenarios (0.20.0): the what-if state of a planner, named, reloadable and comparable side by side. Pure functions.
// A scenario never changes real data; loading one only moves the sliders. Shapes, one per planner:
//   forecast    { cutPct, leanOnly, extraIncome, incomeEndsOn }                         → Forecast "What if…"
//   debt        { extra, strategy }                                                      → Debts "Payoff strategy"
//   retirement  Partial<RetirementInputs>                                                → Investments "Retirement planner"
//   plan        PlanAssumptions (lib/plan.ts)                                            → Plan
//   goal        { goalId, monthly, lump }                                                → a goal's "What if…"
import type { Data, Settings, Scenario, ScenarioKind, RetirementInputs } from '../app/data/types'
import { addDays, diffDays, today } from './dates'
import { fmtMoney, fmtPct } from './money'
import { runwayProjection } from './forecast'
import { simulate, type Strategy } from './debts'
import { liabilities } from './accounts'
import { projectRetirement, RETIREMENT_DEFAULTS, drawdown } from './retirement'
import { retirementAssets } from './portfolio'
import { buildPlan, normalizePlan } from './plan'
import { goalWhatIf } from './planning'

export interface ForecastA { cutPct: number; leanOnly: boolean; extraIncome: number; incomeEndsOn: string | null }
export interface DebtA { extra: number; strategy: Strategy }
export interface GoalA { goalId: string; monthly: number; lump: number }
export const SCENARIO_LABEL: Record<ScenarioKind, string> = { forecast: 'Cash forecast', debt: 'Debt payoff', retirement: 'Retirement', plan: 'Plan', goal: 'Goal' }

const num = (v: unknown, lo: number, hi: number, dflt: number) => { const n = +(v as number); return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt }
const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
export function normalize(kind: 'forecast', a: unknown): ForecastA
export function normalize(kind: 'debt', a: unknown): DebtA
export function normalize(kind: 'goal', a: unknown): GoalA
export function normalize(kind: 'retirement', a: unknown): RetirementInputs
export function normalize(kind: ScenarioKind, a: unknown): Record<string, unknown>
/** Defaults filled in and values clamped, so an old or hand-edited scenario always loads. */
export function normalize(kind: ScenarioKind, raw: unknown): unknown {
  const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (kind === 'forecast') return { cutPct: num(a.cutPct, 0, 90, 0), leanOnly: !!a.leanOnly, extraIncome: num(a.extraIncome, 0, 100000, 0), incomeEndsOn: date(a.incomeEndsOn) }
  if (kind === 'debt') return { extra: num(a.extra, 0, 100000, 0), strategy: a.strategy === 'snowball' ? 'snowball' : 'avalanche' }
  if (kind === 'goal') return { goalId: String(a.goalId || ''), monthly: num(a.monthly, 0, 100000, 0), lump: num(a.lump, 0, 10000000, 0) }
  if (kind === 'plan') return normalizePlan(a)
  const r = { ...RETIREMENT_DEFAULTS, ...a } as RetirementInputs
  return { ...r, currentAge: num(r.currentAge, 16, 100, 40), retireAge: num(r.retireAge, 30, 100, 65), lifeExpectancy: num(r.lifeExpectancy, 50, 120, 92), annualContribution: num(r.annualContribution, 0, 1e7, 0), expectedReturn: num(r.expectedReturn, -0.5, 0.5, 0.07), inflation: num(r.inflation, -0.05, 0.2, 0.025), returnStdDev: num(r.returnStdDev, 0, 1, 0.12), desiredIncome: num(r.desiredIncome, 0, 1e7, 60000), socialSecurity: num(r.socialSecurity, 0, 1e6, 0), currentIncome: num(r.currentIncome, 0, 1e8, 0), ssHaircut: num(r.ssHaircut, 0, 1, 0), pensions: Array.isArray(r.pensions) ? r.pensions : [] }
}

/** One comparable number. `better` says which direction wins; `v` is the raw value used for that (Infinity allowed). */
export interface Metric { k: string; label: string; v: number | null; text: string; better: 'high' | 'low' | null }
const mo = (m: number) => !isFinite(m) ? 'never' : m >= 24 ? (m / 12).toFixed(1) + ' yrs' : Math.round(m) + ' mo'

/** The handful of numbers that matter for each planner, computed from the scenario's assumptions against today's data. */
export function metrics(kind: ScenarioKind, d: Data, s: Settings, raw: unknown): Metric[] {
  const t = today()
  if (kind === 'forecast') {
    const a = normalize('forecast', raw); const p = runwayProjection(d, s, { cutPct: a.cutPct, leanOnly: a.leanOnly, extraIncome: a.extraIncome, incomeEndsOn: a.incomeEndsOn })
    const runway = p.zeroAt ? diffDays(p.zeroAt, t) / 30.44 : Infinity
    return [{ k: 'runway', label: 'Runway to zero', v: runway, text: isFinite(runway) ? mo(runway) : '24+ mo', better: 'high' },
      { k: 'floor', label: 'Reaches the reserve floor', v: p.floorAt ? diffDays(p.floorAt, t) : Infinity, text: p.floorAt ? p.floorAt : 'never', better: 'high' },
      { k: 'min', label: 'Lowest cash in 24 months', v: p.minCash, text: fmtMoney(p.minCash), better: 'high' },
      { k: 'end', label: 'Cash in 24 months', v: p.ys[p.ys.length - 1], text: fmtMoney(p.ys[p.ys.length - 1]), better: 'high' }]
  }
  if (kind === 'debt') {
    const a = normalize('debt', raw); const sim = simulate(liabilities(d), a.extra, a.strategy, false, d)
    return [{ k: 'months', label: 'Debt-free in', v: sim.months, text: mo(sim.months), better: 'low' },
      { k: 'date', label: 'Debt-free on', v: sim.months, text: isFinite(sim.months) ? addDays(t, Math.round(sim.months * 30.44)) : 'never', better: null },
      { k: 'interest', label: 'Interest paid', v: sim.interest, text: isFinite(sim.interest) ? fmtMoney(sim.interest) : 'grows', better: 'low' },
      { k: 'extra', label: 'Extra per month', v: a.extra, text: fmtMoney(a.extra), better: null }]
  }
  if (kind === 'retirement') {
    const i = normalize('retirement', raw); const bal = retirementAssets(d).total; const p = projectRetirement(bal, i); const dd = drawdown(p.real, i)
    return [{ k: 'ready', label: 'Readiness', v: p.readiness, text: `${p.readiness} / 100`, better: 'high' },
      { k: 'real', label: "At retirement (today's $)", v: p.real, text: fmtMoney(p.real), better: 'high' },
      { k: 'income', label: 'Sustainable income', v: p.sustainableIncome, text: fmtMoney(p.sustainableIncome) + '/yr', better: 'high' },
      { k: 'lasts', label: 'Money lasts to', v: dd.depletionAge ?? Infinity, text: dd.depletionAge ? `age ${dd.depletionAge}` : `past ${i.lifeExpectancy}`, better: 'high' },
      { k: 'repl', label: 'Income replacement', v: p.replacementRatio, text: fmtPct(p.replacementRatio), better: 'high' }]
  }
  if (kind === 'plan') {
    const r = buildPlan(d, s, raw as Record<string, unknown>)
    const reached = r.goals.filter(g => g.reachedOn).length
    return [{ k: 'debtfree', label: 'Debt-free on', v: r.debtFreeMonth ?? Infinity, text: r.debtFree || `not within ${r.a.months} mo`, better: 'low' },
      { k: 'interest', label: 'Interest paid', v: r.interest, text: fmtMoney(r.interest), better: 'low' },
      { k: 'goals', label: 'Goals reached', v: reached, text: `${reached} of ${r.goals.length}`, better: 'high' },
      { k: 'low', label: 'Lowest unallocated cash', v: r.low.cash, text: fmtMoney(r.low.cash), better: 'high' },
      { k: 'retire', label: `Retirement in ${r.a.months} mo`, v: r.endRetire, text: fmtMoney(r.endRetire), better: 'high' },
      { k: 'nw', label: 'Net worth change', v: r.months.at(-1)?.netWorthDelta ?? 0, text: fmtMoney(r.months.at(-1)?.netWorthDelta ?? 0), better: 'high' }]
  }
  const a = normalize('goal', raw); const g = d.goals.find(x => x.id === a.goalId)
  if (!g) return [{ k: 'missing', label: 'Goal', v: null, text: 'goal no longer exists', better: null }]
  const w = goalWhatIf(d, g, { monthly: a.monthly, lump: a.lump })
  return [{ k: 'date', label: 'Reached', v: w.months ?? Infinity, text: w.months === 0 ? 'now' : w.date || 'never', better: 'low' },
    { k: 'ontime', label: 'By the target date', v: w.onTime == null ? null : w.onTime ? 1 : 0, text: w.onTime == null ? '—' : w.onTime ? 'yes' : 'no', better: 'high' },
    { k: 'monthly', label: 'Per month', v: a.monthly, text: fmtMoney(a.monthly), better: null }]
}

export interface CompareRow { k: string; label: string; cells: Array<{ text: string; best: boolean }> }
/** Rows of metrics for several scenarios side by side, the winning cell marked (ties mark every winner; nothing marked when all equal). */
export function compare(cols: Metric[][]): CompareRow[] {
  const keys = cols[0]?.map(m => m.k) || []
  return keys.map(k => {
    const cells = cols.map(c => c.find(m => m.k === k)!); const dir = cells[0]?.better
    const vals = cells.map(c => c?.v); const finite = vals.filter((v): v is number => v != null && !Number.isNaN(v))
    const best = dir && finite.length > 1 && new Set(finite).size > 1 ? (dir === 'high' ? Math.max(...finite) : Math.min(...finite)) : null
    return { k, label: cells[0]?.label || k, cells: cells.map(c => ({ text: c?.text ?? '—', best: best != null && c?.v === best })) }
  })
}
/** Scenarios of one kind for the picker: pinned first, then by name. */
export const scenariosOf = (d: Data, kind: ScenarioKind, goalId?: string) => (d.scenarios || []).filter(x => x.kind === kind && (kind !== 'goal' || !goalId || (x.assumptions as { goalId?: string }).goalId === goalId)).slice().sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.sort_order - b.sort_order || a.name.localeCompare(b.name))
/** True when the sliders still match a saved scenario (so the UI can say "Scenario: X" instead of "unsaved changes"). */
export function sameAssumptions(kind: ScenarioKind, a: unknown, b: unknown) { return JSON.stringify(normalize(kind, a)) === JSON.stringify(normalize(kind, b)) }
export type { Scenario }
