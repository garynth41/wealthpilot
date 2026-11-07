// Paycheck allocation (0.21.0): when a paycheck lands, propose where it goes before the next one — bills, card and loan payments and
// planned items due before the next payday, each goal's share of its monthly contribution, the applied plan's extra, everyday spending at
// the recent pace — and what is left. A proposal only: nothing is written unless the person logs the goal transfers.
import type { Data, PaySchedule, Settings, Transaction } from '../app/data/types'
import { addDays, diffDays, today } from './dates'
import { round2, sum } from './money'
import { cashCalendar } from './forecast'
import { payDates, PER_YEAR } from './paySchedule'
import { goalProgress } from './goals'

/** The pay schedule a deposit belongs to: its own link, or an active schedule whose take-home it matches (±2% or $5) within 3 days of a pay date. */
export function scheduleFor(d: Data, t: Pick<Transaction, 'kind' | 'amount' | 'date' | 'pay_schedule_id' | 'account_id'>): PaySchedule | null {
  if (t.kind !== 'income') return null
  if (t.pay_schedule_id) return d.paySchedules.find(p => p.id === t.pay_schedule_id) || null
  const near = d.paySchedules.filter(p => p.status === 'Active' && +p.net_amount > 0 && Math.abs(+t.amount - +p.net_amount) <= Math.max(5, +p.net_amount * 0.02) && payDates(p, addDays(t.date, -3), addDays(t.date, 3)).length > 0)
  return near.sort((a, b) => Number(b.deposit_account_id === t.account_id) - Number(a.deposit_account_id === t.account_id))[0] || null
}
/** Paychecks that landed in the last `days` days (newest first). */
export const recentPaychecks = (d: Data, days = 3, asOf = today()) => d.transactions.filter(t => t.kind === 'income' && t.status !== 'void' && !t.duplicate_of && t.date >= addDays(asOf, -days) && t.date <= asOf && !!scheduleFor(d, t)).sort((a, b) => b.date.localeCompare(a.date))

export type AllocGroup = 'bills' | 'debt' | 'planned' | 'goals' | 'plan' | 'everyday'
export interface AllocLine { group: AllocGroup; label: string; amount: number; date?: string; goalId?: string; accountId?: string | null }
export interface Allocation { paycheck: Transaction; schedule: PaySchedule | null; amount: number; until: string; nextPay: string | null; days: number; lines: AllocLine[]; byGroup: Record<AllocGroup, number>; committed: number; leftover: number; short: number }
export const GROUP_LABEL: Record<AllocGroup, string> = { bills: 'Bills & subscriptions', debt: 'Card & loan payments', planned: 'Planned items & estimated tax', goals: 'Goals', plan: 'Your plan\'s extra', everyday: 'Everyday spending' }

export function allocatePaycheck(d: Data, s: Settings, pay: Transaction, asOf = today()): Allocation {
  const schedule = scheduleFor(d, pay)
  const nextFromSchedule = schedule ? payDates(schedule, addDays(pay.date, 1), addDays(pay.date, 70))[0] || null : null
  const cal = cashCalendar(d, s, 70)
  const nextPay = nextFromSchedule || cal.items.find(x => x.src === 'pay' && x.amt > 0 && x.date > pay.date)?.date || null
  const until = addDays(nextPay || addDays(pay.date, 14), -1); const start = pay.date > asOf ? pay.date : asOf
  const days = Math.max(1, diffDays(until, pay.date) + 1)
  const lines: AllocLine[] = []
  for (const x of cal.items) {
    if (x.amt >= 0 || x.date < start || x.date > until || x.src === 'flex' || x.src === 'pay') continue
    lines.push({ group: x.src === 'debt' ? 'debt' : x.src === 'planned' || x.src === 'tax' ? 'planned' : 'bills', label: x.label, amount: round2(-x.amt), date: x.date })
  }
  // goals: each active goal's monthly contribution, shared across the paychecks in a month
  const perMonth = !schedule ? 2 : schedule.frequency === 'irregular' ? 1 : PER_YEAR[schedule.frequency] / 12   // a one-off covers one month's share
  for (const g of d.goals.filter(g => g.status === 'Active' && g.kind !== 'debt_payoff' && +g.monthly_contribution > 0)) {
    const p = goalProgress(d, g); if (p.reached) continue
    lines.push({ group: 'goals', label: g.name, amount: round2(Math.min(p.left, +g.monthly_contribution / perMonth)), goalId: g.id, accountId: g.account_id || null })
  }
  // the applied plan's extra to debt and retirement (its goal extra is already inside each goal's monthly contribution)
  const plan = s.plan
  if (plan?.debtExtra) lines.push({ group: 'plan', label: 'Extra debt payment (your plan)', amount: round2(plan.debtExtra / perMonth) })
  if (plan?.retireExtra) lines.push({ group: 'plan', label: 'Extra to retirement (your plan)', amount: round2(plan.retireExtra / perMonth) })
  // everyday spending at the recent weekly pace, for the days until the next paycheck
  const weekly = -(cal.items.find(x => x.src === 'flex')?.amt ?? 0)
  if (weekly > 0) lines.push({ group: 'everyday', label: `Everyday spending · ${days} days at your recent pace`, amount: round2(weekly * days / 7) })
  const byGroup = { bills: 0, debt: 0, planned: 0, goals: 0, plan: 0, everyday: 0 } as Record<AllocGroup, number>
  for (const l of lines) byGroup[l.group] = round2(byGroup[l.group] + l.amount)
  const committed = round2(sum(lines.map(l => l.amount))), amount = +pay.amount || 0
  return { paycheck: pay, schedule, amount, until, nextPay, days, lines, byGroup, committed, leftover: round2(amount - committed), short: round2(Math.max(0, committed - amount)) }
}
