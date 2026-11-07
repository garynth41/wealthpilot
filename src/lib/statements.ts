// Applying a card / loan statement to its account (0.25.1). A statement is a snapshot as of its statement date: it always goes into the
// statement history, it updates the account's statement fields (date, balance, minimum, due date) when it is the newest statement on file,
// and it moves the account's current balance only when it is also the newest information about that balance.
import type { Account } from '../app/data/types'

export interface StatementInput { statement_date: string; statement_balance: number; minimum_payment: number; due_date?: string | null }
export interface StatementUpdate {
  /** what to write to the account (empty when the statement is older than the one on file — it is only history then) */
  patch: Partial<Account>
  /** true when this is the newest statement on file, so the account's statement fields, minimum and due date follow it */
  newest: boolean
  /** true when the current balance moves to the statement balance */
  balanceMoved: boolean
  /** why the balance stayed: the bank feed reports it, or a balance dated after the statement is already on file */
  kept?: 'bank_feed' | 'newer_balance' | 'older_statement'
}
const day = (s?: string | null) => (s ? String(s).slice(0, 10) : '')

/** The account changes a new statement brings.
 *  - Statement fields (date, balance, minimum, due date; the due status re-armed; planned payment raised to the minimum) when no newer statement is on file.
 *  - The current balance (and balance_as_of) only when there is no bank-feed balance and no balance dated after the statement date. */
export function statementUpdate(a: Account, s: StatementInput): StatementUpdate {
  const sd = day(s.statement_date)
  const newest = !a.statement_date || sd >= day(a.statement_date)
  if (!newest) return { patch: {}, newest: false, balanceMoved: false, kept: 'older_statement' }
  const patch: Partial<Account> = { statement_date: sd, statement_balance: s.statement_balance, minimum_payment: s.minimum_payment, due_date: s.due_date || null, last_paid_due: null, planned_payment: Math.max(+(a.planned_payment || 0), s.minimum_payment) }
  const kept = a.bank_balance != null ? 'bank_feed' as const : a.balance_as_of && day(a.balance_as_of) > sd ? 'newer_balance' as const : undefined
  if (!kept) { patch.balance = s.statement_balance; patch.balance_as_of = sd }
  return { patch, newest: true, balanceMoved: !kept, kept }
}
