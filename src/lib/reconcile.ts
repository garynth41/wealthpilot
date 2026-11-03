// Checkbook reconciliation — the pure rules. Imports only ./dedupe (copied alongside): the bank-sync edge function carries an identical copy
// (supabase/functions/sync-simplefin/reconcile.ts); a unit test fails if the two differ.
//
// Vocabulary
//   register entry  a transaction the household recorded itself (manual or email capture): a check, a payment, a deposit
//   bank row        a transaction that came from the bank feed or a statement file (it has a bank id in external_id)
//   outstanding     a register entry the bank has not shown yet (status 'pending', not merged into a bank row)
//   cleared         a register entry merged into its bank row (duplicate_of → the bank row), or a bank row itself
//   bank balance    what the institution last reported (accounts.bank_balance, dated bank_balance_as_of)
//   verified / reconciled balance = bank balance + the effect of everything still outstanding — the number every module uses
//   book balance    the household's own running figure (accounts.balance); the variance is book − verified
import type { DTxn } from './dedupe.ts'
import { classify, payeeSimilarity, origin } from './dedupe.ts'

export const LIABILITY_KINDS = ['credit_card', 'store_card', 'loan', 'auto_loan', 'student_loan', 'mortgage', 'bnpl', 'line_of_credit', 'medical', 'collection', 'other_liability']
export interface RAccount { id: string; kind: string; balance: number; bank_balance?: number | null; bank_balance_as_of?: string | null; last_reconciled_on?: string | null; last_reconciled_balance?: number | null }
export interface RTxn extends DTxn { reconciliation_id?: string | null; cleared_on?: string | null }

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const DAY = 86400000
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10) + 'T12:00:00Z') - Date.parse(a.slice(0, 10) + 'T12:00:00Z')) / DAY)

/** "CHECK 1234", "Check #1234", "CHK 1234", "CK#1234", "Check No. 1234" → "1234". Never a card's last four. */
export function parseCheckNumber(s?: string | null): string | null {
  const m = String(s || '').match(/\b(?:check|chk|ck)\s*(?:no\.?|#|number)?\s*#?\s*(\d{2,8})\b/i)
  return m ? String(+m[1]) : null
}
export const isLiabilityKind = (k: string) => LIABILITY_KINDS.includes(k)
/** Signed effect of a transaction on one account's balance (assets: deposits +, payments −; liabilities: the amount owed moves the other way). */
export function effectOn(t: RTxn, accountId: string, kind: string): number {
  const amt = Number(t.amount) || 0; if (!amt || t.status === 'void') return 0
  let moneyIn: boolean | null = null
  if (t.kind === 'income') moneyIn = t.account_id === accountId ? true : null
  else if (t.kind === 'expense') moneyIn = t.account_id === accountId ? false : null
  else { if (t.to_account_id === accountId) moneyIn = true; else if (t.account_id === accountId) moneyIn = false }
  if (moneyIn === null) return 0
  const liab = isLiabilityKind(kind)
  return liab ? (moneyIn ? -amt : amt) : moneyIn ? amt : -amt
}
const touches = (t: RTxn, id: string) => t.account_id === id || t.to_account_id === id
const live = (t: RTxn) => !t.duplicate_of && t.status !== 'void'

export type ItemType = 'check' | 'payment' | 'deposit' | 'transfer'
export function itemType(t: RTxn, accountId: string, kind: string): ItemType {
  if (t.check_number) return 'check'
  if (t.kind === 'transfer') return 'transfer'
  return effectOn(t, accountId, kind) >= 0 !== isLiabilityKind(kind) ? 'deposit' : 'payment'
}
/** Register entries the bank has not shown yet. */
export const outstanding = (txns: RTxn[], a: RAccount) => txns.filter(t => live(t) && touches(t, a.id) && origin(t) === 'typed' && t.status === 'pending')
/** Bank rows (and hand-cleared register entries) not yet tied to a completed reconciliation. */
export const unreconciled = (txns: RTxn[], a: RAccount) => txns.filter(t => live(t) && touches(t, a.id) && !t.reconciliation_id && (origin(t) !== 'typed' || t.status === 'cleared'))

/** The balance every module should use: the bank's figure plus what is still outstanding; falls back to the book balance when no bank figure exists. */
export function verifiedBalance(a: RAccount, txns: RTxn[]): number {
  if (a.bank_balance == null) return Number(a.balance) || 0
  return r2(Number(a.bank_balance) + outstanding(txns, a).reduce((s, t) => s + effectOn(t, a.id, a.kind), 0))
}
export const isVerified = (a: RAccount) => a.bank_balance != null

// ---------- matching ----------
export interface MatchCandidate { entryId: string; bankId: string; score: number; reasons: string[]; auto: boolean }
export const AUTO_MATCH_SCORE = 85
/** 0–100: the amount must agree (50); the check number clinches it (30) or rules it out; then date closeness (≤15) and payee words (≤5). */
export function matchScore(entry: RTxn, bank: RTxn): { score: number; reasons: string[] } {
  if (Math.round(Number(entry.amount) * 100) !== Math.round(Number(bank.amount) * 100) || entry.kind !== bank.kind && !(entry.kind === 'transfer' || bank.kind === 'transfer')) return { score: 0, reasons: ['different amount or direction'] }
  const reasons = ['same amount']; let score = 50
  const bankChk = bank.check_number || parseCheckNumber(bank.payee) || parseCheckNumber(bank.memo)
  if (entry.check_number && bankChk) { if (String(+entry.check_number) === String(+bankChk)) { score += 30; reasons.push(`check #${+entry.check_number}`) } else return { score: 0, reasons: [`different check numbers (#${+entry.check_number} vs #${+bankChk})`] } }
  const d = Math.abs(daysBetween(entry.date, bank.date))
  const dateScore = d === 0 ? 15 : d <= 3 ? 12 : d <= 7 ? 8 : d <= 14 ? 4 : d <= 30 ? 1 : 0
  if (d > 45) return { score: 0, reasons: ['more than 45 days apart'] }
  score += dateScore; reasons.push(d === 0 ? 'same day' : `${d} day${d === 1 ? '' : 's'} apart`)
  const sim = payeeSimilarity(entry.payee, bank.payee)
  if (sim !== null) { score += Math.round(sim * 5); if (sim >= 0.5) reasons.push(`payee ${Math.round(sim * 100)}% alike`) }
  // the duplicate engine's judgement counts too: a "certain" pair is a sure match, "likely" nearly so
  const c = classify(entry, bank)
  if (c?.confidence === 'certain') score = Math.max(score, 95)
  else if (c?.confidence === 'likely') score = Math.max(score, 85)
  return { score: Math.min(100, score), reasons }
}
/** For every outstanding entry, the best bank rows it could be; auto = safe to match without asking. A bank row is offered to one entry only. */
export function suggestMatches(txns: RTxn[], a: RAccount): MatchCandidate[] {
  const entries = outstanding(txns, a).filter(t => !t.dedupe_ok)
  const banks = txns.filter(t => live(t) && touches(t, a.id) && origin(t) !== 'typed')
  const all: MatchCandidate[] = []
  for (const e of entries) for (const b of banks) { const m = matchScore(e, b); if (m.score >= 40) all.push({ entryId: e.id, bankId: b.id, score: m.score, reasons: m.reasons, auto: false }) }
  all.sort((x, y) => y.score - x.score)
  const usedE = new Set<string>(), usedB = new Set<string>(), out: MatchCandidate[] = []
  for (const c of all) { if (usedE.has(c.entryId) || usedB.has(c.bankId)) continue; usedE.add(c.entryId); usedB.add(c.bankId); out.push(c) }
  // auto only when the entry has no other plausible candidate (unambiguous)
  for (const c of out) { const second = all.find(x => x.entryId === c.entryId && x.bankId !== c.bankId); c.auto = c.score >= AUTO_MATCH_SCORE && (!second || second.score < 60) }
  return out
}

// ---------- statement reconciliation ----------
export interface ReconcileInput { account: RAccount; txns: RTxn[]; statementDate: string; statementBalance: number; clearedIds: string[]; previous?: { statement_date: string; statement_balance: number } | null }
export interface ReconcileResult {
  openingBalance: number; firstTime: boolean; clearedDeposits: number; clearedPayments: number; clearedCount: number
  computedEnding: number; statementBalance: number; variance: number
  outstandingChecks: number; outstandingChecksCount: number; depositsInTransit: number; depositsInTransitCount: number; uncleared: number
  bookBalance: number; reconciledBalance: number; balanced: boolean
}
/** Classic bank reconciliation. opening + cleared deposits − cleared payments must equal the statement's ending balance; whatever is still
 *  outstanding explains the difference between the statement and the household's own book. */
export function reconcileStatement(i: ReconcileInput): ReconcileResult {
  const { account: a, txns } = i; const pool = txns.filter(t => live(t) && touches(t, a.id) && t.date <= i.statementDate)
  const cleared = pool.filter(t => i.clearedIds.includes(t.id))
  const eff = (t: RTxn) => effectOn(t, a.id, a.kind)
  const clearedDeposits = r2(cleared.reduce((s, t) => s + Math.max(0, eff(t)), 0)), clearedPayments = r2(cleared.reduce((s, t) => s + Math.max(0, -eff(t)), 0))
  const firstTime = !i.previous
  const opening = i.previous ? Number(i.previous.statement_balance) : r2(i.statementBalance - clearedDeposits + clearedPayments)
  const computedEnding = r2(opening + clearedDeposits - clearedPayments)
  const variance = r2(computedEnding - i.statementBalance)
  const out = pool.filter(t => !i.clearedIds.includes(t.id) && origin(t) === 'typed' && t.status === 'pending')
  const checks = out.filter(t => eff(t) < 0), deps = out.filter(t => eff(t) > 0)
  const outstandingChecks = r2(checks.reduce((s, t) => s - eff(t), 0)), depositsInTransit = r2(deps.reduce((s, t) => s + eff(t), 0))
  const reconciledBalance = r2(i.statementBalance + depositsInTransit - outstandingChecks)
  const bookBalance = r2(computedEnding + depositsInTransit - outstandingChecks)
  return { openingBalance: opening, firstTime, clearedDeposits, clearedPayments, clearedCount: cleared.length, computedEnding, statementBalance: i.statementBalance, variance,
    outstandingChecks, outstandingChecksCount: checks.length, depositsInTransit, depositsInTransitCount: deps.length, uncleared: out.length, bookBalance, reconciledBalance, balanced: Math.abs(variance) < 0.005 }
}
/** Items to tick by default: bank rows and hand-cleared entries dated on or before the statement, not yet in a completed reconciliation. */
export const defaultCleared = (txns: RTxn[], a: RAccount, statementDate: string) => unreconciled(txns, a).filter(t => t.date <= statementDate).map(t => t.id)

// ---------- dashboard figures ----------
export interface AccountReconState { bookBalance: number; bankBalance: number | null; bankAsOf: string | null; reconciledBalance: number; variance: number; outstandingChecks: number; outstandingChecksCount: number; depositsInTransit: number; depositsInTransitCount: number; uncleared: number; lastReconciledOn: string | null; verified: boolean }
export function accountState(a: RAccount, txns: RTxn[]): AccountReconState {
  const out = outstanding(txns, a); const eff = (t: RTxn) => effectOn(t, a.id, a.kind)
  const checks = out.filter(t => eff(t) < 0), deps = out.filter(t => eff(t) > 0)
  const reconciledBalance = verifiedBalance(a, txns)
  return { bookBalance: r2(Number(a.balance) || 0), bankBalance: a.bank_balance == null ? null : Number(a.bank_balance), bankAsOf: a.bank_balance_as_of || null, reconciledBalance, variance: a.bank_balance == null ? 0 : r2((Number(a.balance) || 0) - reconciledBalance),
    outstandingChecks: r2(checks.reduce((s, t) => s - eff(t), 0)), outstandingChecksCount: checks.length, depositsInTransit: r2(deps.reduce((s, t) => s + eff(t), 0)), depositsInTransitCount: deps.length, uncleared: out.length, lastReconciledOn: a.last_reconciled_on || null, verified: a.bank_balance != null }
}

// ---------- anomalies ----------
export type IssueKind = 'stale_check' | 'dormant' | 'not_at_bank' | 'returned' | 'reversal' | 'variance' | 'overdue_reconciliation' | 'duplicate'
export interface Issue { kind: IssueKind; severity: 'crit' | 'warn' | 'info'; txnId?: string; title: string; detail: string }
const RETURNED = /\b(nsf|insufficient funds|returned (?:item|check|payment)|chargeback|stop payment|reversal|reversed|rtn|unpaid item|overdraft fee)\b/i
export function findIssues(a: RAccount, txns: RTxn[], asOf: string, lastSyncDate?: string | null): Issue[] {
  const out: Issue[] = []; const mine = txns.filter(t => touches(t, a.id))
  for (const t of outstanding(mine, a)) {
    const age = daysBetween(t.date, asOf); const label = t.check_number ? `Check #${+t.check_number}` : t.payee || 'Entry'
    if (age >= 180) out.push({ kind: 'stale_check', severity: 'warn', txnId: t.id, title: `${label} is stale (${age} days)`, detail: 'Outstanding for six months or more — confirm it was never cashed, then void it or match it by hand.' })
    else if (age >= 60) out.push({ kind: 'dormant', severity: 'info', txnId: t.id, title: `${label} outstanding ${age} days`, detail: 'Still not seen at the bank.' })
    else if (lastSyncDate && daysBetween(t.date, lastSyncDate) >= 7) out.push({ kind: 'not_at_bank', severity: 'info', txnId: t.id, title: `${label} not at the bank yet`, detail: `Recorded ${t.date}; the bank feed is current to ${lastSyncDate}. Normal for a mailed check; worth a look otherwise.` })
  }
  for (const t of mine.filter(live)) {
    const text = `${t.payee || ''} ${t.memo || ''}`
    if (origin(t) !== 'typed' && RETURNED.test(text)) out.push({ kind: 'returned', severity: 'crit', txnId: t.id, title: `Returned / NSF / reversal: ${(t.payee || '').slice(0, 60)}`, detail: `${t.date} · ${Number(t.amount).toFixed(2)} — check the related payment and any fee.` })
  }
  // a bank row cancelled by an equal opposite row within 7 days with a similar payee
  const banks = mine.filter(t => live(t) && origin(t) !== 'typed')
  for (const t of banks) for (const u of banks) if (t.id < u.id && t.kind !== u.kind && t.kind !== 'transfer' && u.kind !== 'transfer' && Math.round(Number(t.amount) * 100) === Math.round(Number(u.amount) * 100) && Math.abs(daysBetween(t.date, u.date)) <= 7 && (payeeSimilarity(t.payee, u.payee) ?? 0) >= 0.5)
    out.push({ kind: 'reversal', severity: 'info', txnId: u.id, title: `Reversed: ${(t.payee || '').slice(0, 50)} ${Number(t.amount).toFixed(2)}`, detail: `${t.date} and ${u.date} cancel each other.` })
  for (const t of mine.filter(t => t.duplicate_of)) out.push({ kind: 'duplicate', severity: 'info', txnId: t.id, title: `Duplicate excluded: ${(t.payee || '').slice(0, 50)} ${Number(t.amount).toFixed(2)}`, detail: 'Merged into its bank row; not counted anywhere.' })
  const st = accountState(a, mine)
  if (st.verified && Math.abs(st.variance) >= 0.01) out.push({ kind: 'variance', severity: 'warn', title: `Book balance differs from the verified balance by ${st.variance.toFixed(2)}`, detail: 'Reconcile the account to find the difference, or accept the verified figure.' })
  if (st.verified && (!a.last_reconciled_on || daysBetween(a.last_reconciled_on, asOf) > 35)) out.push({ kind: 'overdue_reconciliation', severity: 'info', title: a.last_reconciled_on ? `Last reconciled ${a.last_reconciled_on}` : 'Never reconciled', detail: 'Reconcile against the latest statement.' })
  return out
}
