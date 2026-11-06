// First-run checklist (0.23.0): the handful of steps that make the numbers trustworthy, each detected from the household's own data
// (nothing to tick by hand), with a link to where it is done. Shown on the Dashboard until every required step is done or dismissed.
import type { Data, Settings } from '../app/data/types'
import { addDays, today } from './dates'

export interface SetupStep { key: string; label: string; why: string; to: string; done: boolean; optional?: boolean }
export function setupSteps(d: Data, s: Settings, asOf = today()): SetupStep[] {
  const active = d.accounts.filter(a => a.status === 'Active')
  const recent = d.transactions.filter(t => t.status !== 'void' && t.date >= addDays(asOf, -30) && t.kind !== 'transfer')
  const uncat = recent.filter(t => !t.category_id && !d.splits.some(x => x.transaction_id === t.id)).length
  const fed = (s.imports || []).length > 0 || d.transactions.some(t => t.source === 'import' || t.source === 'email' || !!t.external_id) || active.some(a => a.bank_balance != null)
  return [
    { key: 'accounts', label: 'Add your accounts', why: 'checking, savings, cards and loans — so cash, debt and net worth are real', to: '/accounts', done: active.length > 0 },
    { key: 'balances', label: 'Enter today\'s balances', why: 'the starting point for every forecast', to: '/accounts', done: active.some(a => !!a.balance_as_of || a.bank_balance != null || +a.balance !== 0) },
    { key: 'income', label: 'Add your income and pay schedule', why: 'paydays drive the cash calendar, safe-to-spend and the budget period', to: '/income', done: d.paySchedules.some(p => p.status === 'Active') },
    { key: 'bills', label: 'List your bills and subscriptions', why: 'so nothing due is a surprise, and alerts can remind you', to: '/bills', done: d.recurring.some(r => r.status === 'Active') },
    { key: 'transactions', label: 'Bring in transactions', why: 'connect the bank feed, import a statement or capture from email', to: '/connections', done: fed || d.transactions.length >= 20 },
    { key: 'budget', label: 'Start a budget', why: 'plan the period; actuals fill in from your transactions', to: '/budget', done: d.periods.length > 0 },
    { key: 'categorize', label: 'Categorize the last 30 days', why: 'uncategorized spending is not counted against any budget line', to: '/transactions', done: recent.length > 0 && uncat <= Math.max(2, recent.length * 0.1) },
    { key: 'goal', label: 'Set a goal', why: 'an emergency fund first — three to six months of essentials', to: '/goals', done: d.goals.length > 0, optional: true },
    { key: 'alerts', label: 'Choose your alerts', why: 'bills due, low cash, large charges and the Monday digest by push or email', to: '/settings', done: !!s.notify, optional: true },
    { key: 'household', label: 'Invite your household', why: 'share the budget with a partner, with whatever access you choose', to: '/settings', done: d.members.length > 1, optional: true },
  ]
}
export function setupProgress(steps: SetupStep[]) {
  const req = steps.filter(x => !x.optional); const done = req.filter(x => x.done).length
  return { done, total: req.length, all: done === req.length, next: steps.find(x => !x.done && !x.optional) || steps.find(x => !x.done) || null }
}
/** Is there anything to forecast yet? Without accounts, income, bills or transactions every projection is a row of zeros. */
export const hasMoneyData = (d: Pick<Data, 'accounts' | 'paySchedules' | 'recurring' | 'transactions'>) => d.accounts.some(a => a.status === 'Active') || d.paySchedules.some(p => p.status === 'Active') || d.recurring.some(r => r.status === 'Active') || d.transactions.length > 0
