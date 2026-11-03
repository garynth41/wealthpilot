// Planning engines (0.5.0): liquidity, goal allocation, goal milestones and what-if projections. Pure functions over Data.
import type { Account, Data, Goal, Settings } from '../app/data/types'
import { addDays, diffDays, today } from './dates'
import { round2, sum } from './money'
import { assets, cashOnHand, isLiability, isRevolving, debtBal, balanceOf } from './accounts'
import { healthIndicators } from './intelligence'
import { goalProgress } from './goals'

// ---------------- account balances: available credit ----------------
/** Assets: the balance; revolving debt: limit − owed; instalment debt: nothing to draw. */
export function availableBalance(a: Account): number | null {
  if (!isLiability(a)) return +a.balance || 0
  if (isRevolving(a) && +(a.credit_limit || 0) > 0) return round2(Math.max(0, +a.credit_limit! - debtBal(a)))
  return null
}

// ---------------- liquidity ----------------
export interface Liquidity { cash: number; emergencyFund: number; essentialsPerMonth: number; burnRate: number; monthsEssentials: number | null; monthsAll: number | null; reserveFloor: number; aboveFloor: number; targetMonths: number; targetFund: number; coveragePct: number | null; band: 'good' | 'warn' | 'crit' | 'idle'; tiers: Array<{ label: string; amount: number }> }
/** Cash reserve levels and how many months of living expenses they cover. Essentials = spending in Essential-priority categories (3-month average); "all" = full burn rate. */
export function liquidity(d: Data, s: Settings, asOf = today()): Liquidity {
  const h = healthIndicators(d, s, 3, asOf)
  const essentialsPerMonth = round2(h.burnRate * (h.essentialShare ?? 1)) || 0
  const cash = cashOnHand(d, s)
  const ef = d.goals.filter(g => g.kind === 'emergency_fund' && g.status !== 'Cancelled').map(g => goalProgress(d, g).saved)
  const efAcct = d.goals.filter(g => g.kind === 'emergency_fund' && g.account_id).map(g => d.accounts.find(a => a.id === g.account_id)).filter(Boolean) as Account[]
  const emergencyFund = round2(ef.length ? Math.max(...ef, ...efAcct.map(a => balanceOf(a, d))) : sum(assets(d).filter(a => a.kind === 'savings').map(a => balanceOf(a, d))))
  const targetMonths = Math.max(1, s.runwayGreen); const targetFund = round2(essentialsPerMonth * targetMonths)
  const monthsEssentials = essentialsPerMonth > 0 ? round2(cash / essentialsPerMonth) : null, monthsAll = h.burnRate > 0 ? round2(cash / h.burnRate) : null
  const coveragePct = targetFund > 0 ? round2(emergencyFund / targetFund) : null
  const band: Liquidity['band'] = monthsEssentials == null ? 'idle' : monthsEssentials >= s.runwayGreen ? 'good' : monthsEssentials >= s.runwayYellow ? 'warn' : 'crit'
  const tiers = [{ label: 'Reserve floor (never below)', amount: +s.reserveFloor || 0 }, { label: `${s.runwayYellow} months of essentials`, amount: round2(essentialsPerMonth * s.runwayYellow) }, { label: `${s.runwayGreen} months of essentials`, amount: targetFund }, { label: `${s.runwayGreen} months of everything`, amount: round2(h.burnRate * s.runwayGreen) }]
  return { cash, emergencyFund, essentialsPerMonth, burnRate: h.burnRate, monthsEssentials, monthsAll, reserveFloor: +s.reserveFloor || 0, aboveFloor: round2(cash - (+s.reserveFloor || 0)), targetMonths, targetFund, coveragePct, band, tiers }
}

// ---------------- goal allocation ----------------
export interface Allocation { goal: Goal; saved: number; target: number; left: number; pct: number; allocated: number; fromAccount: string | null; covered: 'full' | 'partial' | 'none' | 'tracked' }
export interface AllocationResult { rows: Allocation[]; allocatable: number; allocated: number; unallocated: number; shortfall: number }
/** How today's balances support each goal. A goal linked to an account is funded by that account's balance (shared between goals on the same account, by priority);
 *  unlinked savings goals draw on remaining unassigned cash (savings first, then checking above the reserve floor), by priority. Debt-payoff goals report progress only. */
export function goalAllocation(d: Data, s: Settings): AllocationResult {
  const goals = d.goals.filter(g => g.status === 'Active').slice().sort((a, b) => a.priority - b.priority || a.sort_order - b.sort_order)
  const acctLeft = new Map<string, number>(assets(d).map(a => [a.id, balanceOf(a, d)]))
  const rows: Allocation[] = []
  for (const g of goals.filter(g => g.account_id)) { const p = goalProgress(d, g); if (g.kind === 'debt_payoff') { rows.push({ goal: g, saved: p.saved, target: g.target_amount, left: p.left, pct: p.pct, allocated: p.saved, fromAccount: g.account_id!, covered: 'tracked' }); continue }
    const avail = acctLeft.get(g.account_id!) ?? 0; const take = Math.min(avail, g.target_amount); acctLeft.set(g.account_id!, round2(avail - take))
    rows.push({ goal: g, saved: p.saved, target: g.target_amount, left: p.left, pct: p.pct, allocated: round2(take), fromAccount: g.account_id!, covered: take >= g.target_amount - 0.005 ? 'full' : take > 0 ? 'partial' : 'none' }) }
  // pool for unlinked goals: unassigned savings + checking cash above the floor (counts-as-cash accounts only)
  const pool0 = round2(sum(assets(d).filter(a => a.include_in_cash || (s.includeRetirementInCash && a.kind === 'retirement')).map(a => acctLeft.get(a.id) ?? 0)) - (+s.reserveFloor || 0)); let pool = Math.max(0, pool0)
  for (const g of goals.filter(g => !g.account_id)) { const p = goalProgress(d, g); const take = Math.min(pool, g.target_amount); pool = round2(pool - take)
    rows.push({ goal: g, saved: p.saved, target: g.target_amount, left: p.left, pct: p.pct, allocated: round2(take), fromAccount: null, covered: take >= g.target_amount - 0.005 ? 'full' : take > 0 ? 'partial' : 'none' }) }
  const allocated = round2(sum(rows.filter(r => r.covered !== 'tracked').map(r => r.allocated)))
  const allocatable = round2(sum(assets(d).filter(a => a.include_in_cash).map(a => balanceOf(a, d))))
  const shortfall = round2(sum(rows.filter(r => r.covered !== 'tracked').map(r => Math.max(0, r.target - r.allocated))))
  return { rows, allocatable, allocated, unallocated: round2(Math.max(0, pool)), shortfall }
}

// ---------------- milestones & what-if ----------------
export interface Milestone { pct: number; amount: number; date: string | null; reached: boolean; reachedOn?: string | null }
/** 25 / 50 / 75 / 100 % milestones with the date each was (or will be) hit at the current monthly contribution. */
export function goalMilestones(d: Data, g: Goal, asOf = today()): Milestone[] {
  const p = goalProgress(d, g); const contribs = d.contributions.filter(c => c.goal_id === g.id).slice().sort((a, b) => a.date.localeCompare(b.date))
  return [0.25, 0.5, 0.75, 1].map(pct => { const amount = round2(g.target_amount * pct)
    if (p.saved >= amount - 0.005) { let run = +g.starting_amount, on: string | null = null; if (run < amount - 0.005) for (const c of contribs) { run += c.amount; if (run >= amount - 0.005) { on = c.date; break } }; return { pct, amount, date: on, reached: true, reachedOn: on } }   // reachedOn null = covered by the starting amount (or by the linked account's balance)
    const months = g.monthly_contribution > 0 ? (amount - p.saved) / g.monthly_contribution : null
    return { pct, amount, date: months != null && isFinite(months) ? addDays(asOf, Math.round(months * 30.44)) : null, reached: false } })
}
export interface WhatIf { monthly: number; months: number | null; date: string | null; onTime: boolean | null; byTarget: number | null; neededForTarget: number | null }
/** Change the monthly contribution (or a one-off lump sum) and see when the goal lands and whether it beats the target date. */
export function goalWhatIf(d: Data, g: Goal, opts: { monthly?: number; lump?: number; asOf?: string } = {}): WhatIf {
  const asOf = opts.asOf || today(); const p = goalProgress(d, g); const monthly = opts.monthly ?? g.monthly_contribution; const left = Math.max(0, p.left - (opts.lump || 0))
  const months = left <= 0.005 ? 0 : monthly > 0 ? left / monthly : null
  const date = months == null ? null : addDays(asOf, Math.round(months * 30.44))
  const monthsToTarget = g.target_date ? Math.max(0, diffDays(g.target_date, asOf) / 30.44) : null
  const onTime = g.target_date && date ? date <= g.target_date : null
  const byTarget = monthsToTarget != null ? round2(Math.min(g.target_amount, p.saved + (opts.lump || 0) + monthly * monthsToTarget)) : null
  const neededForTarget = monthsToTarget != null ? round2(monthsToTarget > 0.1 ? left / monthsToTarget : left) : null
  return { monthly, months: months == null ? null : round2(months), date, onTime, byTarget, neededForTarget }
}
