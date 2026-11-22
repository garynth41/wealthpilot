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
/** Digits a name itself marks as an account number: "(1234)", "x1234", "…1234", "..1234", "••1234", "*1234", "#1234", "ending in 1234".
 *  A bare number ("Roth IRA 2024") is not taken, and neither is a number inside a longer note in brackets ("Roth IRA (2024
 *  contributions)"), so a year in a name is never read as an account number. */
const MARKED = /(?:\bx+|\*+|…|\.{2,}|•+|#|\bending in\s*)\s*(\d{4})(?!\d)|[(\[]\s*(\d{4})\s*[)\]]/i
/** An account's name and its last four digits, taken apart (0.38.1). Banks and people both write the digits into the name — "Adv Plus
 *  Banking- 0224 (0224)", "Gary Checking … (4019)", "Total Checking (x4821)" — and the account keeps them in their own field too, so a
 *  label made of name + digits said them two or three times. `base` is the name with every mention of those digits, and the marks around
 *  them, taken out; `l4` is the digits: the stored ones, else the ones the name marks. A name that is nothing but the digits keeps itself. */
export function nameParts(name: string | null | undefined, last4?: string | null): { base: string; l4: string } {
  const raw = String(name || '').replace(/\s+/g, ' ').trim(), given = String(last4 || '').trim()
  const mk = raw.match(MARKED); const l4 = given || mk?.[1] || mk?.[2] || ''
  if (!/^\d{2,}$/.test(l4)) return { base: raw, l4 }   // no digits, or letters in the field: nothing in the name to take out
  // a mention inside a longer note in brackets — "(2024 contributions)" — has an opening bracket and no closing one next to it: left alone
  const base = raw.replace(/([\s\-–—·•*#.…(\[]*)(?:\b(?:ending in|x+)\s*)?(\d+)(\s*[)\]]*)/gi, (m, lead: string, digits: string, trail: string) => digits === l4 && /[(\[]/.test(lead) === /[)\]]/.test(trail) ? ' ' : m)
    .replace(/\s+/g, ' ').replace(/^[\s\-–—·•*#.…,:)\]]+|[\s\-–—·•*#.…,:(\[]+$/g, '')
  return base ? { base, l4 } : { base: raw, l4: '' }
}
/** The one way an account is written where its digits are shown: the name, then the last four once, at the end, in brackets —
 *  "Adv Plus Banking (0224)". An account with no digits is just its name. */
export function acctTitle(name: string | null | undefined, last4?: string | null) { const { base, l4 } = nameParts(name, last4); return l4 ? `${base} (${l4})` : base }
/** Label that stays unique when two accounts share a name. A name that carries its own digits is tidied to "Name (1234)"; a name without
 *  them is left as it is, and gains its digits only when two accounts share the name. */
export function acctLabel(a: Account, all: Account[]) {
  const byRef = `${a.name} (${a.ref || a.id.slice(0, 4)})`, low = (x: string) => x.trim().toLowerCase()
  const first = (x: Account) => {
    const { base, l4 } = nameParts(x.name, x.last4); const tidy = l4 && base !== String(x.name || '').replace(/\s+/g, ' ').trim() ? `${base} (${l4})` : x.name
    const same = all.filter(y => low(y.name || '') === low(x.name || '')); if (same.length < 2) return tidy
    return x.last4 && same.filter(y => y.last4 === x.last4).length === 1 ? acctTitle(x.name, x.last4) : null
  }
  const mine = first(a); if (mine == null) return byRef
  // two names that differ only in how they write the same digits ("Visa x1111", "Visa (1111)") tidy to one label: told apart by reference
  return all.some(x => x.id !== a.id && low(first(x) ?? '') === low(mine)) ? byRef : mine
}
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
