// Accounts left out of the household's figures (0.28.0).
//
// A household can see an account at the bank that is not its own money — a child's checking account linked to a parent's sign-in, an account
// held for someone else. Switched off on the Accounts page (accounts.excluded), the account and everything on it stay in the database and
// the bank sync keeps them current, but the app counts and lists none of it. Switching it back on restores everything.
//
// How it is done: the store passes what it loads through leaveOut(). The left-out accounts and the rows that sit only on them move to
// data.off; every page and engine reads data.accounts / data.transactions as before and so never sees them — no page had to change to stop
// counting them. Only the Accounts page (to switch one back on) and bank matching (to keep its feed attached) read data.off.
//
// Money that moves between a left-out account and a counted one. The duplicate engine pairs the bank's two rows of a transfer between the
// household's own accounts into one transfer (lib/dedupe.ts). A left-out account is not one of the household's own for that rule: when it
// is switched off, each such pair is taken apart again (unpairForLeavingOut) — the counted account keeps its row as the money out or money
// in the bank reported, the other row goes off the books with its account — and the engine does not pair across the line while it is off.
// Switched back on, the engine pairs them again on its next run. A transfer typed by hand across the line stays a transfer; budget.flowOf
// reads it as spending (money sent to the left-out account) or income (money that came from it).
//
// Also off the books with the account: the bills paid from it, income deposited to it, goals saved in it, its statements, balance history,
// holdings and reconciliations, what email capture filed against it and creditor calls about it. Recorded net-worth snapshots are read
// without its balance (withoutAccounts), so the history does not step on the day it is left out.
import type { Account, Data, NetWorthSnapshot, OffBooks, Transaction } from '../app/data/types'
import { LIABILITY_KINDS } from '../app/data/types'
import { unpairPatch, origin, type DTxn } from './dedupe'

export const emptyOff = (): OffBooks => ({ accounts: [], transactions: [], duplicates: [], recurring: [], paySchedules: [], statements: [], balances: [], holdings: [], reconciliations: [], goals: [], emailItems: [], hardship: [] })
export const offOf = (d: Pick<Data, 'off'>): OffBooks => d.off || emptyOff()
/** Every account the household has, counted or not — for the few places that must not lose sight of one (bank matching, names). */
export const everyAccount = (d: Pick<Data, 'accounts' | 'off'>): Account[] => (d.off?.accounts.length ? [...d.accounts, ...d.off.accounts] : d.accounts)

/** Does this transaction sit only on left-out accounts? One on a left-out account, one between two of them, or a payment into one with no
 *  source account. A transfer with a counted account on the other side stays on the books. */
export function isOffTxn(t: Pick<Transaction, 'account_id' | 'to_account_id'>, off: Set<string>): boolean {
  const from = t.account_id || null, to = t.to_account_id || null
  const offFrom = !!from && off.has(from), offTo = !!to && off.has(to)
  if (offFrom) return !to || offTo
  return !from && offTo
}

/** Move the left-out accounts and what sits on them out of the data every page reads. Rows keep their ids and nothing is changed in them;
 *  run it on what the repo loaded (after splitDups). With nothing left out the data comes back as it was. */
export function leaveOut(d: Data): Data {
  const offAccts = d.accounts.filter(a => a.excluded)
  if (!offAccts.length) return d.off ? { ...d, off: undefined } : d
  const off = new Set(offAccts.map(a => a.id)); const o = emptyOff(); o.accounts = offAccts
  const split = <T,>(rows: T[], gone: (r: T) => boolean, into: T[]): T[] => rows.filter(r => { if (gone(r)) { into.push(r); return false } return true })
  const on = (id?: string | null) => !!id && off.has(id)
  return {
    ...d, off: o,
    accounts: d.accounts.filter(a => !a.excluded),
    transactions: split(d.transactions, t => isOffTxn(t, off), o.transactions),
    duplicates: split(d.duplicates || [], t => isOffTxn(t, off), o.duplicates),
    // a bill paid from a left-out account goes with it; one paid from a counted account toward a left-out card stays (it is this household's money)
    recurring: split(d.recurring, r => on(r.account_id) || (!r.account_id && on(r.liability_account_id)), o.recurring),
    paySchedules: split(d.paySchedules, p => on(p.deposit_account_id), o.paySchedules),
    statements: split(d.statements, s => on(s.account_id), o.statements),
    balances: split(d.balances, b => on(b.account_id), o.balances),
    holdings: split(d.holdings, h => on(h.account_id), o.holdings),
    reconciliations: split(d.reconciliations, r => on(r.account_id), o.reconciliations),
    goals: split(d.goals, g => on(g.account_id), o.goals),
    // what email capture filed against the account (a past-due notice would otherwise still raise an alert) and creditor calls about it
    emailItems: split(d.emailItems, e => on(e.account_id), o.emailItems),
    hardship: split(d.hardship, h => on(h.account_id), o.hardship),
    snapshots: d.snapshots.map(s => withoutAccounts(s, offAccts)),
  }
}
const LIAB = new Set<string>(LIABILITY_KINDS); const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
/** A recorded net-worth snapshot read without the left-out accounts: each one's balance that day (by_account) comes off the assets,
 *  liabilities and cash it was counted in, so the history and "change since" do not step on the day an account is left out. The stored
 *  snapshot is not changed — counted again, the account is back in its history. (Which totals it was in is taken from how the account is
 *  set today: active, in net worth, counts as cash.)
 *  Limits: a snapshot with no per-account figures (none were kept, as in the sample data) cannot be adjusted and stays as recorded; and
 *  snapshots recorded before 0.28.0 kept each account's book balance while the totals used the verified one, so where those two differed
 *  that difference stays in the history. From 0.28.0 the snapshot keeps the same figure the totals use (Accounts → Record today's snapshot). */
function withoutAccounts(s: NetWorthSnapshot, offAccts: Account[]): NetWorthSnapshot {
  const by = s.by_account || {}; let assets = +s.assets || 0, liabilities = +s.liabilities || 0, cash = +s.cash || 0, hit = false; const rest = { ...by }
  for (const a of offAccts) { if (!(a.id in by) || a.status !== 'Active') continue; const v = +by[a.id] || 0; hit = true; delete rest[a.id]
    if (LIAB.has(a.kind)) { if (a.include_in_net_worth) liabilities -= Math.max(0, v) } else { if (a.include_in_net_worth) assets -= v; if (a.include_in_cash) cash -= v } }
  return hit ? { ...s, assets: r2(assets), liabilities: r2(liabilities), cash: r2(cash), by_account: rest } : s
}

export interface Unpair { keeper: string; patch: Partial<Transaction>; /** the merged row to restore — absent when an earlier attempt already restored it */ restore?: string }
/** Before an account is switched off: the paired transfers and payments that have it on one side and a counted account on the other, and how
 *  to take each apart — the merged row is restored, then the kept row goes back to the expense the bank reported (its category is cleared
 *  when that was a transfer category, so it shows as uncategorized spending to be filed). Unlike restoring a duplicate by hand, the rows
 *  are not marked "not a duplicate": switched back on, the account's transfers are paired again.
 *
 *  A paired keeper is recognised by what it is — a row from the bank feed or a statement file that is a transfer with both accounts set (the
 *  bank never reports one; only pairing makes it) — not by the merged row still hanging off it. So the plan can always be worked out again:
 *  with the account already off, and after an attempt that stopped between the two writes (the merged row restored, the keeper not yet
 *  changed), the keeper is still found and finished. The store restores first and changes the keeper second for that reason. */
export function unpairForLeavingOut(d: Pick<Data, 'transactions' | 'duplicates' | 'categories' | 'accounts'> & { off?: Data['off'] }, accountId: string): Unpair[] {
  const counted = new Set(d.accounts.filter(a => !a.excluded && a.id !== accountId).map(a => a.id))
  // merged rows on the account itself are in data.off once it is switched off: looked at too
  const dupsOf = new Map<string, Transaction[]>(); for (const x of [...(d.duplicates || []), ...(d.off?.duplicates || [])]) if (x.duplicate_of) dupsOf.set(x.duplicate_of, [...(dupsOf.get(x.duplicate_of) || []), x])
  const transferCat = new Set(d.categories.filter(c => c.kind === 'transfer').map(c => c.id))
  const out: Unpair[] = []
  for (const k of d.transactions) {
    if (k.kind !== 'transfer' || !k.account_id || !k.to_account_id || origin(k as unknown as DTxn) === 'typed') continue
    const other = k.account_id === accountId ? k.to_account_id : k.to_account_id === accountId ? k.account_id : null
    if (!other || !counted.has(other)) continue
    const dup = (dupsOf.get(k.id) || []).find(x => unpairPatch(k as unknown as DTxn, x as unknown as DTxn))
    out.push({ keeper: k.id, ...(dup ? { restore: dup.id } : {}), patch: { kind: 'expense', to_account_id: null, ...(k.category_id && transferCat.has(k.category_id) ? { category_id: null } : {}) } })
  }
  return out
}

/** What switching an account off takes out of the figures — for the confirmation and the Accounts page. */
export function leftOutSummary(d: Pick<Data, 'transactions' | 'duplicates' | 'recurring' | 'paySchedules' | 'goals' | 'categories' | 'accounts'>, accountId: string) {
  const off = new Set([accountId, ...d.accounts.filter(a => a.excluded).map(a => a.id)])
  const mine = (t: Transaction) => t.account_id === accountId || t.to_account_id === accountId
  const txns = d.transactions.filter(t => mine(t) && isOffTxn(t, off)).length
  const pairs = unpairForLeavingOut(d, accountId).length
  const crossing = d.transactions.filter(t => mine(t) && !isOffTxn(t, off)).length
  const bills = d.recurring.filter(r => r.account_id === accountId || (!r.account_id && r.liability_account_id === accountId)).length
  const pay = d.paySchedules.filter(p => p.deposit_account_id === accountId).length
  const goals = d.goals.filter(g => g.account_id === accountId).length
  return { txns, pairs, crossing, bills, pay, goals }
}
