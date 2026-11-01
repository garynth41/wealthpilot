import type { Data, Goal } from '../app/data/types'
import { addDays, diffDays, today } from './dates'
import { sum } from './money'
import { debtBal } from './accounts'

export function goalProgress(d: Data, g: Goal) {
  const contributed = sum(d.contributions.filter(c => c.goal_id === g.id).map(c => c.amount))
  const acct = g.account_id ? d.accounts.find(a => a.id === g.account_id) : null
  const saved = g.kind === 'debt_payoff' && acct ? Math.max(0, +g.target_amount - debtBal(acct)) : +g.starting_amount + contributed
  const pct = g.target_amount > 0 ? Math.min(1, saved / g.target_amount) : 0
  const left = Math.max(0, g.target_amount - saved)
  const t = today(); const monthsLeft = g.target_date ? Math.max(0, diffDays(g.target_date, t) / 30.44) : null
  const needPerMonth = monthsLeft != null ? (monthsLeft > 0.1 ? left / monthsLeft : left) : null
  const etaMonths = g.monthly_contribution > 0 ? left / g.monthly_contribution : null
  const eta = etaMonths != null && isFinite(etaMonths) ? addDays(t, Math.round(etaMonths * 30.44)) : null
  const onTrack = needPerMonth == null ? null : g.monthly_contribution >= needPerMonth - 0.5
  return { saved, pct, left, monthsLeft, needPerMonth, eta, onTrack, contributed, reached: left <= 0.005 }
}
