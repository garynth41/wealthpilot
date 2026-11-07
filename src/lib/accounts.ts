import { ASSET_KINDS, LIABILITY_KINDS, REVOLVING_KINDS, type Account, type Data, type Settings } from '../app/data/types'
import { sum } from './money'
import { diffDays, today } from './dates'
import { verifiedBalance } from './reconcile'

/** The balance every calculation uses: the bank's verified figure plus outstanding register entries when the account has one, else the book balance. */
export const balanceOf = (a: Account, d: Data) => verifiedBalance(a, d.transactions)

export const isAsset = (a: Account) => ASSET_KINDS.includes(a.kind)
export const isLiability = (a: Account) => LIABILITY_KINDS.includes(a.kind)
export const isRevolving = (a: Account) => REVOLVING_KINDS.includes(a.kind)
export const isActive = (a: Account) => a.status === 'Active'
export const activeAccounts = (d: Data) => d.accounts.filter(isActive)
export const assets = (d: Data) => activeAccounts(d).filter(isAsset)
export const liabilities = (d: Data) => activeAccounts(d).filter(isLiability)
/** What is owed — the verified balance (0.25.1): the bank's figure plus anything still outstanding when the household's transactions are
 *  given; without them the bank's figure alone when there is one (no outstanding entries known), else the book balance. Every payoff,
 *  interest, utilization and plan figure uses it, so they agree with the totals. */
export const debtBal = (a: Account, d?: Pick<Data, 'transactions'>) => Math.max(0, verifiedBalance(a, d ? d.transactions : []))
/** Label that stays unique when two accounts share a name. */
export function acctLabel(a: Account, all: Account[]) { const same = all.filter(x => (x.name || '').trim().toLowerCase() === (a.name || '').trim().toLowerCase()); if (same.length < 2) return a.name; if (a.last4 && same.filter(x => x.last4 === a.last4).length === 1) return `${a.name} ··${a.last4}`; return `${a.name} (${a.ref || a.id.slice(0, 4)})` }
/** Does this account count toward cash on hand: an active asset account flagged include_in_cash (retirement only when the setting says so). */
export const countsAsCash = (a: Account, s: Pick<Settings, 'includeRetirementInCash'>) => isActive(a) && isAsset(a) && (a.include_in_cash || (!!s.includeRetirementInCash && a.kind === 'retirement'))
/** Cash you can spend: active asset accounts flagged include_in_cash (retirement excluded unless the setting says so). */
export function cashOnHand(d: Data, s: Settings) { return sum(assets(d).filter(a => countsAsCash(a, s)).map(a => balanceOf(a, d))) }
export function netWorth(d: Data) { const as = sum(assets(d).filter(a => a.include_in_net_worth).map(a => balanceOf(a, d))), li = sum(liabilities(d).filter(a => a.include_in_net_worth).map(a => debtBal(a, d))); return { assets: as, liabilities: li, net: as - li } }
export const debtPlanned = (a: Account) => Math.max(+(a.planned_payment ?? 0) || 0, +a.minimum_payment || 0)
export function utilization(a: Account, d?: Pick<Data, 'transactions'>) { return isRevolving(a) && +(a.credit_limit || 0) > 0 ? debtBal(a, d) / +a.credit_limit! : null }
export function debtDueState(a: Account, d?: Pick<Data, 'transactions'>) {
  if (!(+a.minimum_payment > 0) && !(+(a.statement_balance || 0) > 0) && debtBal(a, d) < 1) return { cls: 'good', label: 'Nothing due' }
  if (!a.due_date) return { cls: 'idle', label: 'No due date' }
  const due = a.due_date.slice(0, 10), t = today()
  if (a.last_paid_due && a.last_paid_due.slice(0, 10) >= due) return { cls: 'good', label: 'Paid' }
  if (due < t) return { cls: 'crit', label: `Overdue ${diffDays(t, due)}d` }
  if (due === t) return { cls: 'soon', label: 'Due today' }
  const n = diffDays(due, t); return { cls: n <= 7 ? 'warn' : 'info', label: a.autopay ? `Autopay in ${n}d` : `Due in ${n}d` }
}
export function debtPaidInRange(d: Data, a: Account, from: string, to: string) { return sum(d.transactions.filter(t => t.kind === 'transfer' && t.to_account_id === a.id && t.status !== 'void' && t.date >= from && t.date <= to).map(t => t.amount)) }
