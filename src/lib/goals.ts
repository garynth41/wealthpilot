import type { Data, Goal } from '../app/data/types'
import { addDays, diffDays, today } from './dates'
import { round2, sum } from './money'
import { debtBal } from './accounts'

/** The goal's target in dollars of the day it is due (0.22.0): a target set in today's dollars grows at inflation_pct a year from its base
 *  date (target_base_date, else the day the goal was created) to the target date — or to today when there is no date. Debt payoffs never inflate. */
export function goalTarget(g: Goal, asOf = today()): number {
  const i = +(g.inflation_pct || 0); if (!(i > 0) || g.kind === 'debt_payoff') return +g.target_amount || 0
  const base = (g.target_base_date || g.created_at || asOf).slice(0, 10); const end = g.target_date && g.target_date > base ? g.target_date : asOf > base ? asOf : base
  return round2((+g.target_amount || 0) * Math.pow(1 + i / 100, Math.max(0, diffDays(end, base)) / 365.25))
}
export function goalProgress(d: Data, g: Goal) {
  const target = goalTarget(g)
  const contributed = sum(d.contributions.filter(c => c.goal_id === g.id).map(c => c.amount))
  const acct = g.account_id ? d.accounts.find(a => a.id === g.account_id) : null
  const saved = g.kind === 'debt_payoff' && acct ? Math.max(0, target - debtBal(acct)) : +g.starting_amount + contributed
  const pct = target > 0 ? Math.min(1, saved / target) : 0
  const left = Math.max(0, target - saved)
  const t = today(); const monthsLeft = g.target_date ? Math.max(0, diffDays(g.target_date, t) / 30.44) : null
  const needPerMonth = monthsLeft != null ? (monthsLeft > 0.1 ? left / monthsLeft : left) : null
  const etaMonths = g.monthly_contribution > 0 ? left / g.monthly_contribution : null
  const eta = etaMonths != null && isFinite(etaMonths) ? addDays(t, Math.round(etaMonths * 30.44)) : null
  const onTrack = needPerMonth == null ? null : g.monthly_contribution >= needPerMonth - 0.5
  return { target, inflated: target > (+g.target_amount || 0) + 0.005, saved, pct, left, monthsLeft, needPerMonth, eta, onTrack, contributed, reached: left <= 0.005 }
}
