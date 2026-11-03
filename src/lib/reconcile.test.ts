// Acceptance tests from the Cash & Account Operations spec (Tests 1–6) plus the rules under them.
import { describe, it, expect } from 'vitest'
import functionCopy from '../../supabase/functions/sync-simplefin/reconcile.ts?raw'
import engineSource from './reconcile.ts?raw'
import { parseCheckNumber, effectOn, verifiedBalance, matchScore, suggestMatches, reconcileStatement, defaultCleared, accountState, findIssues, AUTO_MATCH_SCORE, type RTxn, type RAccount } from './reconcile'
import { planDedupe } from './dedupe'
import { cashOnHand, netWorth } from './accounts'
import { emptyData, SETTINGS_DEFAULTS, type Account, type Transaction } from '../app/data/types'
import { MemoryRepo } from '../app/data/memoryRepo'
import { demoSeed } from '../app/data/demoSeed'

const CHK: RAccount = { id: 'chk', kind: 'checking', balance: 1000, bank_balance: 1200, bank_balance_as_of: '2026-11-01' }
let n = 0
const t = (p: Partial<RTxn>): RTxn => ({ id: p.id || `t${++n}`, date: '2026-10-20', kind: 'expense', amount: 100, account_id: 'chk', payee: '', source: 'manual', external_id: null, status: 'pending', ...p })
const bank = (p: Partial<RTxn>) => t({ source: 'import', external_id: `sfin:A:${p.id || n + 1}`, status: 'cleared', ...p })
const check = (num: string, p: Partial<RTxn>) => t({ check_number: num, ...p })

describe('check numbers and effects', () => {
  it('reads a check number out of a bank description, never a card number', () => {
    for (const [s, e] of [['CHECK 1234', '1234'], ['Check #0042', '42'], ['CHK 771', '771'], ['Check No. 9', null], ['CHECKCARD 1017 KOALAFI', null], ['Mobile deposit', null]] as const) expect(parseCheckNumber(s), s).toBe(e)
  })
  it('signs an effect for assets and liabilities', () => {
    expect(effectOn(t({ kind: 'income', amount: 50 }), 'chk', 'checking')).toBe(50); expect(effectOn(t({ amount: 50 }), 'chk', 'checking')).toBe(-50)
    expect(effectOn(t({ kind: 'transfer', amount: 50, account_id: 'chk', to_account_id: 'card' }), 'card', 'credit_card')).toBe(-50)   // paying the card reduces what is owed
    expect(effectOn(t({ kind: 'transfer', amount: 50, account_id: 'chk', to_account_id: 'sav' }), 'sav', 'savings')).toBe(50)
    expect(effectOn(t({ amount: 50, status: 'void' }), 'chk', 'checking')).toBe(0); expect(effectOn(t({ amount: 50, account_id: 'other' }), 'chk', 'checking')).toBe(0)
  })
})

describe('Test 1 — a bank row and its register entry match automatically', () => {
  it('scores check number + amount + date near 100 and offers it as an automatic match', () => {
    const entry = check('1042', { id: 'e', date: '2026-10-18', amount: 250, payee: 'Columbus Water' }), row = bank({ id: 'b', date: '2026-10-21', amount: 250, payee: 'CHECK 1042' })
    const m = matchScore(entry, row); expect(m.score).toBeGreaterThanOrEqual(AUTO_MATCH_SCORE); expect(m.reasons).toContain('check #1042')
    const s = suggestMatches([entry, row, bank({ id: 'x', amount: 250, date: '2026-10-21', payee: 'CHECK 1043' })], CHK)
    expect(s).toHaveLength(1); expect(s[0]).toMatchObject({ entryId: 'e', bankId: 'b', auto: true })
  })
  it('a matched item counts as cleared in the statement reconciliation', () => {
    const row = bank({ id: 'b', date: '2026-10-21', amount: 250 })
    const r = reconcileStatement({ account: CHK, txns: [row, t({ id: 'e', amount: 250, duplicate_of: 'b' })], statementDate: '2026-10-31', statementBalance: 950, clearedIds: ['b'], previous: { statement_date: '2026-09-30', statement_balance: 1200 } })
    expect(r.clearedPayments).toBe(250); expect(r.computedEnding).toBe(950); expect(r.balanced).toBe(true); expect(r.clearedCount).toBe(1)
  })
  it('different check numbers rule a pair out; two candidates within 10 points are not automatic', () => {
    expect(matchScore(check('10', { amount: 5 }), bank({ amount: 5, payee: 'CHECK 11' })).score).toBe(0)
    const e = t({ id: 'e', amount: 20, payee: 'Venmo' }), b1 = bank({ id: 'b1', amount: 20, payee: 'VENMO' }), b2 = bank({ id: 'b2', amount: 20, payee: 'VENMO', date: '2026-10-21' })
    const s = suggestMatches([e, b1, b2], CHK); expect(s).toHaveLength(1); expect(s[0].auto).toBe(false)
  })
})

describe('Test 2 — an outstanding check stays outstanding and reduces the reconciled balance', () => {
  it('is not cleared, is listed as an outstanding check, and lowers both the reconciled and the verified balance', () => {
    const c = check('1050', { id: 'c', date: '2026-10-28', amount: 300, payee: 'Landlord' })
    const txns = [c, bank({ id: 'b', date: '2026-10-05', amount: 100 })]
    expect(defaultCleared(txns, CHK, '2026-10-31')).toEqual(['b'])
    const r = reconcileStatement({ account: CHK, txns, statementDate: '2026-10-31', statementBalance: 1100, clearedIds: ['b'], previous: { statement_date: '2026-09-30', statement_balance: 1200 } })
    expect(r.balanced).toBe(true); expect(r.outstandingChecks).toBe(300); expect(r.outstandingChecksCount).toBe(1); expect(r.reconciledBalance).toBe(800); expect(r.bookBalance).toBe(800)
    expect(verifiedBalance({ ...CHK, bank_balance: 1100 }, txns)).toBe(800)
    const st = accountState({ ...CHK, bank_balance: 1100, balance: 800 }, txns); expect(st.outstandingChecks).toBe(300); expect(st.variance).toBe(0); expect(st.verified).toBe(true)
  })
  it('a deposit in transit raises it', () => {
    const txns = [t({ id: 'd', kind: 'income', amount: 500, payee: 'Mobile deposit' })]
    expect(verifiedBalance(CHK, txns)).toBe(1700)
    const r = reconcileStatement({ account: CHK, txns, statementDate: '2026-10-31', statementBalance: 1200, clearedIds: [], previous: { statement_date: '2026-09-30', statement_balance: 1200 } })
    expect(r.depositsInTransit).toBe(500); expect(r.reconciledBalance).toBe(1700)
  })
})

describe('Test 3 — duplicate imports are flagged and excluded from balances', () => {
  it('the duplicate engine flags the copy; the verified balance and the reconciliation ignore it', () => {
    const a = bank({ id: 'a', amount: 60, payee: 'KROGER' }), copy = t({ id: 'c', source: 'import', external_id: 'csv:1', amount: 60, payee: 'Kroger 123', status: 'cleared' })
    const plan = planDedupe([a, copy]); expect(plan.auto).toHaveLength(1); expect(plan.auto[0].keeper).toBe('a')
    const merged = { ...copy, duplicate_of: 'a' }
    const r = reconcileStatement({ account: CHK, txns: [a, merged], statementDate: '2026-10-31', statementBalance: 1140, clearedIds: ['a', 'c'], previous: { statement_date: '2026-09-30', statement_balance: 1200 } })
    expect(r.clearedPayments).toBe(60); expect(r.balanced).toBe(true)
    expect(findIssues(CHK, [a, merged], '2026-11-03').some(i => i.kind === 'duplicate' && i.txnId === 'c')).toBe(true)
  })
})

describe('Test 4 — a disconnected institution: error logged, balances preserved, user alerted', () => {
  it('the simulated bank fails, nothing changes, the failure is in the log and the status says so', async () => {
    localStorage.setItem('wealthpilot.simSync', '1')
    const repo = new MemoryRepo(demoSeed()); await repo.syncConnect(); const map: Record<string, string> = {}; for (const b of MemoryRepo.SIM_BANK) map[b.id] = repo.data.accounts[0].id; await repo.syncSetMap(map)
    const before = JSON.stringify(repo.data.accounts.map(a => [a.balance, a.bank_balance]))
    repo.simFailNext('Connection to the bank failed')
    await expect(repo.syncNow()).rejects.toThrow(/Connection to the bank failed/)
    expect(JSON.stringify(repo.data.accounts.map(a => [a.balance, a.bank_balance]))).toBe(before)
    const st = await repo.syncStatus(); expect(st.connection?.status).toBe('error'); expect(st.connection?.last_error).toMatch(/Connection/); expect(st.log[0].ok).toBe(false)
    expect(repo.data.audit[0]).toMatchObject({ kind: 'sync_failure' })
    localStorage.removeItem('wealthpilot.simSync')
  })
})

describe('Test 5 — verified balances take precedence everywhere', () => {
  it('cash on hand and net worth use bank balance + outstanding, not the book figure', () => {
    const d = emptyData()
    d.accounts = [{ id: 'chk', name: 'Checking', kind: 'checking', status: 'Active', balance: 5000, bank_balance: 1200, include_in_cash: true, include_in_net_worth: true } as unknown as Account,
      { id: 'sav', name: 'Savings', kind: 'savings', status: 'Active', balance: 300, include_in_cash: true, include_in_net_worth: true } as unknown as Account]
    d.transactions = [t({ id: 'c', amount: 200 }) as unknown as Transaction]
    expect(cashOnHand(d, SETTINGS_DEFAULTS)).toBe(1300)   // 1200 − 200 outstanding + 300 book-only savings
    expect(netWorth(d).assets).toBe(1300)
  })
})

describe('Test 6 — a manual override is stored with timestamp, user, reason and an audit record', () => {
  it('completing a reconciliation with an adjustment records all of it', async () => {
    const repo = new MemoryRepo(demoSeed()); const a = repo.data.accounts.find(x => x.kind === 'checking')!
    const r = await repo.completeReconciliation({ account_id: a.id, statement_date: '2026-10-31', statement_balance: 999, opening_balance: 1000, cleared_ids: [], book_balance: 1000, cleared_deposits: 0, cleared_payments: 0, outstanding_checks: 0, deposits_in_transit: 0, reconciled_balance: 999, variance: 1, adjustment: -1, adjustment_reason: 'bank fee not yet recorded', notes: null })
    expect(r.status).toBe('completed_with_adjustment'); expect(r.completed_at).toBeTruthy(); expect(r.completed_by_email).toBe('demo'); expect(r.adjustment_reason).toBe('bank fee not yet recorded')
    const ev = repo.data.audit.find(e => e.kind === 'override'); expect(ev).toBeTruthy(); expect(ev!.detail).toMatchObject({ adjustment: -1, reason: 'bank fee not yet recorded' }); expect(ev!.user_email).toBe('demo'); expect(ev!.created_at).toBeTruthy()
    expect(repo.data.accounts.find(x => x.id === a.id)!.last_reconciled_on).toBe('2026-10-31')
    await expect(repo.update('reconciliations', r.id, { variance: 0 })).rejects.toThrow(/immutable/)
  })
})

describe('issues', () => {
  it('stale checks, returned items and reversals are found', () => {
    const txns = [check('7', { id: 's', date: '2026-04-01', amount: 40 }), bank({ id: 'r', payee: 'RETURNED ITEM NSF FEE', amount: 35 }), bank({ id: 'p', payee: 'NETFLIX', amount: 15.49, date: '2026-10-10' }), bank({ id: 'q', kind: 'income', payee: 'NETFLIX REFUND', amount: 15.49, date: '2026-10-12' })]
    const kinds = findIssues({ ...CHK, last_reconciled_on: '2026-09-20' }, txns, '2026-11-03', '2026-11-02').map(i => i.kind)
    expect(kinds).toContain('stale_check'); expect(kinds).toContain('returned'); expect(kinds).toContain('reversal'); expect(kinds).toContain('overdue_reconciliation')
  })
})

it('the bank-sync function carries an identical copy of this engine', () => { expect(functionCopy).toBe(engineSource) })
