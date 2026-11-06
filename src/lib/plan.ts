// One plan, not four (0.20.0). A month-by-month simulation that puts cash flow, debt payoff, goal contributions and retirement saving on one
// timeline, so an extra amount per month is allocated once and every page agrees on where it went. Pure functions over Data.
//
// Money model, per month:
//   income  − everyday + bill spending − base debt payments − base goal contributions − extra (to debt / goals / retirement) ± planned items
//   = change in UNALLOCATED cash (cash on hand minus what goals already hold in cash accounts).
// Base retirement contributions come out of pay (payroll, employer match) and do not touch cash; only extra sent to retirement does.
// Debt: every account pays its planned payment at its rate for that month (promotional APRs step up on their end date); freed payments
// roll to the next account; extra goes to the focus account (avalanche on the live rate, or snowball). After the last debt is paid,
// the freed payments join the extra pool when `rollFreed` is on.
import type { Account, Data, Goal, Settings } from '../app/data/types'
import { addDays, diffDays, iso, parse, today } from './dates'
import { round2, sum } from './money'
import { cashOnHand, liabilities, debtBal, debtPlanned, balanceOf } from './accounts'
import { burn } from './forecast'
import { aprAt, assumedPay, type Strategy } from './debts'
import { goalProgress } from './goals'
import { retirementAssets } from './portfolio'
import { RETIREMENT_DEFAULTS } from './retirement'

export type AllocMode = 'debt_first' | 'goals_first' | 'retirement_first' | 'split'
export interface PlanAssumptions {
  /** extra per month on top of today's plan */
  extra: number
  mode: AllocMode
  /** used when mode = 'split'; shares of `extra` (any scale, normalised) */
  split: { debt: number; goals: number; retirement: number }
  strategy: Strategy
  /** spending cut % on bills + everyday spending */
  cutPct: number
  extraIncome: number
  incomeEndsOn: string | null
  months: number
  /** after the last debt is paid, its payments join the extra pool */
  rollFreed: boolean
}
export const PLAN_DEFAULTS: PlanAssumptions = { extra: 0, mode: 'debt_first', split: { debt: 50, goals: 30, retirement: 20 }, strategy: 'avalanche', cutPct: 0, extraIncome: 0, incomeEndsOn: null, months: 36, rollFreed: true }
const clampN = (v: unknown, lo: number, hi: number, dflt: number) => { const n = +(v as number); return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt }
/** Defaults filled in and every number clamped, so a saved scenario from an older version (or a hand-edited one) always runs. */
export function normalizePlan(a: Partial<PlanAssumptions> | null | undefined): PlanAssumptions {
  const x = { ...PLAN_DEFAULTS, ...(a || {}) }
  return { extra: clampN(x.extra, 0, 100000, 0), mode: (['debt_first', 'goals_first', 'retirement_first', 'split'] as AllocMode[]).includes(x.mode) ? x.mode : 'debt_first',
    split: { debt: clampN(x.split?.debt, 0, 100, 50), goals: clampN(x.split?.goals, 0, 100, 30), retirement: clampN(x.split?.retirement, 0, 100, 20) },
    strategy: x.strategy === 'snowball' ? 'snowball' : 'avalanche', cutPct: clampN(x.cutPct, 0, 90, 0), extraIncome: clampN(x.extraIncome, 0, 100000, 0),
    incomeEndsOn: typeof x.incomeEndsOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.incomeEndsOn) ? x.incomeEndsOn : null, months: Math.round(clampN(x.months, 6, 120, 36)), rollFreed: x.rollFreed !== false }
}

export interface PlanMonth {
  date: string; income: number; spend: number; events: number
  debtBase: number; debtExtra: number; goalBase: number; goalExtra: number; retireExtra: number; toCash: number
  cash: number; debtBal: number; goalsSaved: number; retireBal: number; netWorthDelta: number
}
export interface PlanGoal { goal: Goal; startSaved: number; reachedOn: string | null; extraFirstMonth: number; target: number }
export interface PlanResult {
  a: PlanAssumptions; months: PlanMonth[]; startCash: number; startDebt: number; startRetire: number
  debtFree: string | null; debtFreeMonth: number | null; interest: number; goals: PlanGoal[]
  low: { date: string; cash: number }; floor: number; floorBreach: string | null; zeroAt: string | null
  /** where this month's extra goes — what 'Apply this plan' writes */
  now: { debt: number; goals: Record<string, number>; retirement: number; cash: number; focus: Account | null }
  totals: { debtExtra: number; goalExtra: number; retireExtra: number; toCash: number }
  endRetire: number; endCash: number
}

const monthDate = (m: number, from = today()) => { const d = parse(from); d.setDate(1); d.setMonth(d.getMonth() + m); return iso(d) }

/** Run the plan. Deterministic; no randomness, no writes. */
export function buildPlan(d: Data, s: Settings, raw?: Partial<PlanAssumptions>): PlanResult {
  const a = normalizePlan(raw); const t = today(); const b = burn(d, s)
  const ri = { ...RETIREMENT_DEFAULTS, ...(s.retirement || {}) }; const realMonthly = Math.pow((1 + ri.expectedReturn) / (1 + ri.inflation), 1 / 12) - 1
  // goals: active, not debt-payoff (that money is the debt bucket), highest priority first
  const gl = d.goals.filter(g => g.status === 'Active' && g.kind !== 'debt_payoff').slice().sort((x, y) => x.priority - y.priority || x.sort_order - y.sort_order)
  const cashIds = new Set(d.accounts.filter(x => x.include_in_cash).map(x => x.id))
  const goals = gl.map(g => { const p = goalProgress(d, g); return { g, saved: p.saved, target: +g.target_amount || 0, reachedOn: p.reached ? t : null as string | null, extraFirst: 0 } })
  const heldInCash = Math.min(cashOnHand(d, s), sum(goals.filter(x => x.g.account_id && cashIds.has(x.g.account_id)).map(x => Math.min(x.saved, x.g.account_id ? balanceOf(d.accounts.find(z => z.id === x.g.account_id)!, d) : 0))))
  const startCash = round2(cashOnHand(d, s) - heldInCash)
  const debts = liabilities(d).filter(x => debtBal(x) >= 1).map(x => ({ acct: x, b: debtBal(x), pay: assumedPay(x, debtPlanned(x)), rate: 0 }))
  const startDebt = round2(sum(debts.map(x => x.b))); const startRetire = retirementAssets(d).total; const startGoals = sum(goals.map(x => x.saved))
  const baseSpend = (b.fixed + b.variable) * (1 - a.cutPct / 100) - b.relief
  const events = d.planned.filter(p => p.status === 'Planned').map(p => ({ date: p.date.slice(0, 10), amount: +p.amount || 0 }))
  const order = (): Array<'debt' | 'goals' | 'retirement'> => a.mode === 'goals_first' ? ['goals', 'debt', 'retirement'] : a.mode === 'retirement_first' ? ['retirement', 'debt', 'goals'] : ['debt', 'goals', 'retirement']
  const shareSum = a.split.debt + a.split.goals + a.split.retirement || 1

  let cash = startCash, retire = startRetire, interest = 0, debtFreeMonth: number | null = debts.length ? null : 0, freed = 0
  const months: PlanMonth[] = []; let low = { date: t, cash }, floorBreach: string | null = null, zeroAt: string | null = null; const floor = +s.reserveFloor || 0
  const now: PlanResult['now'] = { debt: 0, goals: {}, retirement: 0, cash: 0, focus: null }
  const tot = { debtExtra: 0, goalExtra: 0, retireExtra: 0, toCash: 0 }
  for (let m = 0; m < a.months; m++) {
    const from = m === 0 ? t : monthDate(m), to = addDays(monthDate(m + 1), -1)
    // income (stops on incomeEndsOn, prorated for the month it ends in)
    let income = b.income
    if (a.incomeEndsOn && a.incomeEndsOn <= to) income = a.incomeEndsOn < from ? 0 : b.income * Math.max(0, diffDays(a.incomeEndsOn, from)) / Math.max(1, diffDays(to, from) + 1)
    income += a.extraIncome
    const ev = sum(events.filter(e => e.date >= from && e.date <= to).map(e => e.amount))
    // debts: interest at this month's rate, then base payments; payments freed by a paid-off account roll to the next one
    let debtBase = 0, pool = 0
    debts.forEach(x => { x.rate = aprAt(x.acct, m) / 1200 })
    const ranked = debts.filter(x => x.b > 0.005).sort((x, y) => a.strategy === 'avalanche' ? y.rate - x.rate : x.b - y.b)
    for (const x of debts) { if (x.b <= 0.005) { pool += x.pay; continue } const i = x.b * x.rate; interest += i; x.b += i; const p = Math.min(x.b, x.pay); x.b -= p; debtBase += p; pool += x.pay - p }
    for (const x of ranked) { if (pool <= 0.005) break; if (x.b <= 0.005) continue; const p = Math.min(x.b, pool); x.b -= p; pool -= p; debtBase += p }
    const debtsLeft = () => debts.some(x => x.b > 0.005)
    if (!debtsLeft() && debtFreeMonth == null) debtFreeMonth = m
    if (!debtsLeft()) freed = sum(debts.map(x => x.pay))
    // base goal contributions (capped at what each goal still needs)
    let goalBase = 0
    for (const x of goals) { const need = Math.max(0, x.target - x.saved); const c = Math.min(need, +x.g.monthly_contribution || 0); x.saved += c; goalBase += c; if (x.saved >= x.target - 0.005 && !x.reachedOn) x.reachedOn = to }
    // extra, by mode; a bucket that cannot absorb its share passes the rest down the order, and whatever is left stays as cash
    let extra = a.extra + (a.rollFreed && debtFreeMonth != null && debtFreeMonth < m ? freed : 0)
    const give = { debt: 0, goals: 0, retirement: 0 }
    const absorbDebt = (amt: number) => { let left = amt; const rk = debts.filter(x => x.b > 0.005).sort((x, y) => a.strategy === 'avalanche' ? y.rate - x.rate : x.b - y.b); if (m === 0 && rk[0]) now.focus = rk[0].acct; for (const x of rk) { if (left <= 0.005) break; const p = Math.min(x.b, left); x.b -= p; left -= p } return amt - left }
    const absorbGoals = (amt: number) => { let left = amt; for (const x of goals) { if (left <= 0.005) break; const need = Math.max(0, x.target - x.saved); if (need <= 0.005) continue; const p = Math.min(need, left); x.saved += p; left -= p; if (m === 0) now.goals[x.g.id] = round2((now.goals[x.g.id] || 0) + p); if (m === 0) x.extraFirst += p; if (x.saved >= x.target - 0.005 && !x.reachedOn) x.reachedOn = to } return amt - left }
    const absorb = (k: 'debt' | 'goals' | 'retirement', amt: number) => k === 'debt' ? absorbDebt(amt) : k === 'goals' ? absorbGoals(amt) : amt
    if (a.mode === 'split') {
      const want = { debt: extra * a.split.debt / shareSum, goals: extra * a.split.goals / shareSum, retirement: extra * a.split.retirement / shareSum }
      let spill = 0; for (const k of ['debt', 'goals', 'retirement'] as const) { const got = absorb(k, want[k] + spill); give[k] += got; spill = want[k] + spill - got }
      extra = spill
    } else { for (const k of order()) { if (extra <= 0.005) break; const got = absorb(k, extra); give[k] += got; extra -= got } }
    if (!debtsLeft() && debtFreeMonth == null) debtFreeMonth = m
    const toCash = Math.max(0, extra)
    retire = retire * (1 + realMonthly) + (+ri.annualContribution || 0) / 12 + give.retirement
    const spend = Math.max(0, baseSpend)
    cash = cash + income - spend - debtBase - give.debt - goalBase - give.goals - give.retirement + ev
    if (m === 0) { now.debt = round2(give.debt); now.retirement = round2(give.retirement); now.cash = round2(toCash) }
    tot.debtExtra += give.debt; tot.goalExtra += give.goals; tot.retireExtra += give.retirement; tot.toCash += toCash
    const dBal = sum(debts.map(x => Math.max(0, x.b))), gSaved = sum(goals.map(x => x.saved))
    months.push({ date: from, income: round2(income), spend: round2(spend), events: round2(ev), debtBase: round2(debtBase), debtExtra: round2(give.debt), goalBase: round2(goalBase), goalExtra: round2(give.goals), retireExtra: round2(give.retirement), toCash: round2(toCash), cash: round2(cash), debtBal: round2(dBal), goalsSaved: round2(gSaved), retireBal: round2(retire), netWorthDelta: round2((cash - startCash) + (startDebt - dBal) + (retire - startRetire) + (gSaved - startGoals)) })
    if (cash < low.cash) low = { date: to, cash: round2(cash) }
    if (floor && cash < floor && !floorBreach) floorBreach = to
    if (cash < 0 && !zeroAt) zeroAt = to
  }
  return { a, months, startCash, startDebt, startRetire, debtFree: debtFreeMonth == null ? null : debtFreeMonth === 0 && !debts.length ? t : addDays(monthDate(debtFreeMonth + 1), -1), debtFreeMonth, interest: round2(interest),
    goals: goals.map(x => ({ goal: x.g, startSaved: goalProgress(d, x.g).saved, reachedOn: x.reachedOn, extraFirstMonth: round2(x.extraFirst), target: x.target })),
    low, floor, floorBreach, zeroAt, now, totals: { debtExtra: round2(tot.debtExtra), goalExtra: round2(tot.goalExtra), retireExtra: round2(tot.retireExtra), toCash: round2(tot.toCash) },
    endRetire: round2(retire), endCash: round2(cash) }
}

/** What 'Apply this plan' changes: each goal's monthly contribution and the retirement contribution, replacing (not adding to) whatever a
 *  previous apply put there. Debt extra is stored in settings.plan and read by the Debts page. */
export function applyPlanPatches(d: Data, s: Settings, r: PlanResult) {
  const prev = s.plan; const goals: Array<{ id: string; from: number; to: number }> = []
  const ids = new Set([...Object.keys(r.now.goals), ...Object.keys(prev?.goalExtra || {})])
  for (const id of ids) { const g = d.goals.find(x => x.id === id); if (!g) continue; const base = Math.max(0, (+g.monthly_contribution || 0) - (prev?.goalExtra?.[id] || 0)); const to = round2(base + (r.now.goals[id] || 0)); if (Math.abs(to - (+g.monthly_contribution || 0)) > 0.005) goals.push({ id, from: +g.monthly_contribution || 0, to }) }
  const ri = { ...RETIREMENT_DEFAULTS, ...(s.retirement || {}) }; const retBase = Math.max(0, (+ri.annualContribution || 0) - (prev?.retireExtra || 0) * 12)
  const retirement = { from: +ri.annualContribution || 0, to: round2(retBase + r.now.retirement * 12) }
  return { goals, retirement, plan: { assumptions: r.a as unknown as Record<string, unknown>, appliedAt: new Date().toISOString(), debtExtra: r.now.debt, goalExtra: Object.fromEntries(Object.entries(r.now.goals).filter(([, v]) => v > 0.005)), retireExtra: r.now.retirement, strategy: r.a.strategy } }
}

/** The most extra per month (to the nearest $25) the household can send without unallocated cash dropping below the reserve floor
 *  (or below zero when no floor is set) at any point in the horizon. `baselineBreaches` = even $0 extra breaks the floor. */
export function affordableExtra(d: Data, s: Settings, raw?: Partial<PlanAssumptions>): { max: number; floor: number; baselineBreaches: boolean; breachOn: string | null } {
  const a = normalizePlan(raw); const floor = +s.reserveFloor || 0
  const run = (x: number) => buildPlan(d, s, { ...a, extra: x })
  const base = run(0); const okAt = (x: number) => run(x).low.cash >= floor - 0.5
  if (base.low.cash < floor - 0.5) return { max: 0, floor, baselineBreaches: true, breachOn: floor ? base.floorBreach : base.zeroAt }
  let lo = 0, hi = 25; while (hi <= 50000 && okAt(hi)) { lo = hi; hi *= 2 }
  while (hi - lo > 25) { const mid = Math.floor((lo + hi) / 2 / 25) * 25; if (mid <= lo) break; if (okAt(mid)) lo = mid; else hi = mid }
  return { max: lo, floor, baselineBreaches: false, breachOn: null }
}
