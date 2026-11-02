import { describe, it, expect } from 'vitest'
import functionCopy from '../../supabase/functions/sync-simplefin/simplefin.ts?raw'
import engineSource from './simplefin.ts?raw'
import { guessKind, claimUrlFromToken, splitAccessUrl, redactUrl, syncWindow, guessLast4, normaliseResponse, autoMatch, balanceFor, toNewTxns, dropKnown, type SfinResponse } from './simplefin'

const b64 = (s: string) => btoa(s)
const resp: SfinResponse = { errors: ['Connection to Chase failed at https://u:p@bridge.example/x'], accounts: [
  { id: 'A1', name: 'Total Checking (x4821)', org: { name: 'Chase Bank' }, balance: '2,310.55', 'available-balance': '2300.00', 'balance-date': 1793600000, transactions: [
    { id: 't1', posted: 1793500000, amount: '-45.20', description: '  KROGER  #123 ' }, { id: 't2', posted: 1793510000, amount: '1800.00', description: 'ACME PAYROLL' }, { id: 't3', posted: 1793520000, amount: '-9.99', description: 'NETFLIX', pending: true }, { id: 't4', posted: 1793520000, amount: '0', description: 'ZERO' }] },
  { id: 'A2', name: 'Freedom Card ...7710', org: { name: 'Chase Bank' }, balance: '-640.12', 'balance-date': 1793600000, transactions: [{ id: 'c1', posted: 1793500000, amount: '-64.00', description: 'AMAZON' }, { id: 'c2', posted: 1793530000, amount: '200.00', description: 'PAYMENT THANK YOU' }] },
  { id: 'A3', name: 'Savings', org: { domain: 'ally.com' }, balance: '8000', 'balance-date': 1793600000 }] }

describe('setup token and access URL', () => {
  it('decodes a setup token (plain or URL-safe base64) to the https claim URL', () => {
    const url = 'https://bridge.simplefin.org/simplefin/claim/ABC123'
    expect(claimUrlFromToken(b64(url))).toBe(url)
    expect(claimUrlFromToken('  ' + b64(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '\n')).toBe(url)
  })
  it('refuses tokens that are empty, not base64, not a URL, not https, or carry a password', () => {
    expect(() => claimUrlFromToken('')).toThrow(/Paste/); expect(() => claimUrlFromToken('!!!notbase64!!!')).toThrow(/not a SimpleFIN/)
    expect(() => claimUrlFromToken(b64('just words'))).toThrow(/web address/); expect(() => claimUrlFromToken(b64('http://bridge.example/claim/x'))).toThrow(/https/)
    expect(() => claimUrlFromToken(b64('https://u:p@bridge.example/claim/x'))).toThrow(/password/)
  })
  it('moves the credentials of an access URL into a Basic header and redacts them from text', () => {
    const { base, authorization } = splitAccessUrl('https://user%40x:s3cret@beta-bridge.simplefin.org/simplefin')
    expect(base).toBe('https://beta-bridge.simplefin.org/simplefin'); expect(authorization).toBe('Basic ' + btoa('user@x:s3cret'))
    expect(() => splitAccessUrl('http://u:p@h/x')).toThrow(/https/); expect(() => splitAccessUrl('https://h/x')).toThrow(/credentials/)
    expect(redactUrl('failed https://u:p@bridge.example/x now')).toBe('failed https://***:***@bridge.example/x now')
  })
})

describe('window and account hints', () => {
  it('first sync reads 89 days; later syncs overlap 5 days and never exceed 90', () => {
    const now = 1_800_000_000
    expect(syncWindow(null, now)).toEqual({ start: now - 89 * 86400, end: now })
    expect(syncWindow(now - 86400, now)).toEqual({ start: now - 86400 - 5 * 86400, end: now })
    expect(syncWindow(now - 200 * 86400, now).start).toBe(now - 89 * 86400)
  })
  it('finds the last four digits in the usual spellings', () => {
    for (const [n, e] of [['Total Checking (x4821)', '4821'], ['Card ...7710', '7710'], ['Visa ending in 0042', '0042'], ['Savings *9911', '9911'], ['IRA 5555', '5555'], ['Savings', null], ['Account 12345678', null]] as const) expect(guessLast4(n), n).toBe(e)
  })
})

describe('normalise, match and map', () => {
  const n = normaliseResponse(resp)
  it('normalises amounts, dates and org names, and redacts credentials in provider errors', () => {
    expect(n.errors[0]).toContain('***:***@'); expect(n.errors[0]).not.toContain('u:p@')
    const a = n.accounts[0]; expect(a).toMatchObject({ id: 'A1', org: 'Chase Bank', last4: '4821', balance: 2310.55, available: 2300 }); expect(a.txns[0]).toMatchObject({ amount: -45.2, description: 'KROGER #123' })
    expect(n.accounts[2]).toMatchObject({ org: 'ally.com', available: null })
  })
  it('matches bank accounts to local ones by last four + institution, each local account once', () => {
    const locals = [{ id: 'L1', name: 'Chase Total Checking', institution: 'Chase', last4: '4821', kind: 'checking' }, { id: 'L2', name: 'Chase Freedom', institution: 'Chase', last4: '7710', kind: 'credit_card' }, { id: 'L3', name: 'Ally Savings', institution: 'Ally', last4: null, kind: 'savings' }, { id: 'L4', name: 'Huntington Checking', institution: 'Huntington', last4: '4821', kind: 'checking' }]
    expect(autoMatch(n.accounts, locals)).toEqual({ A1: 'L1', A2: 'L2', A3: 'L3' })
    expect(autoMatch(n.accounts, [{ id: 'X', name: 'Cash wallet', kind: 'cash' }])).toEqual({})
  })
  it('stores liabilities as a positive amount owed and assets as reported', () => {
    expect(balanceFor({ balance: -640.12 }, 'credit_card')).toBe(640.12); expect(balanceFor({ balance: 25 }, 'credit_card')).toBe(0); expect(balanceFor({ balance: 2310.55 }, 'checking')).toBe(2310.55); expect(balanceFor({ balance: -50 }, 'checking')).toBe(-50)
  })
  it('maps posted items only: out = expense, in = income, with a stable external id', () => {
    const t = toNewTxns(n.accounts[0], { id: 'L1', kind: 'checking' })
    expect(t.map(x => [x.kind, x.amount, x.payee, x.external_id])).toEqual([['expense', 45.2, 'KROGER #123', 'sfin:A1:t1'], ['income', 1800, 'ACME PAYROLL', 'sfin:A1:t2']])
    expect(toNewTxns(n.accounts[1], { id: 'L2', kind: 'credit_card' }).map(x => x.kind)).toEqual(['expense', 'income'])
  })
})

describe('account type guess', () => {
  it('picks a sensible type from the bank account name, falling back on the sign of the balance', () => {
    for (const [n, e] of [['Total Checking (x4821)', 'checking'], ['Chase Freedom Unlimited', 'credit_card'], ['Ally Online Savings', 'savings'], ['Fidelity 401(k)', 'retirement'], ['Roth IRA', 'retirement'], ['Schwab Brokerage', 'investment'], ['Auto Loan', 'auto_loan'], ['Home Mortgage', 'mortgage'], ['Student Loan', 'student_loan'], ['Platinum Card', 'credit_card'], ['Joint Spending', 'checking']] as const) expect(guessKind(n), n).toBe(e)
    expect(guessKind('Account 7', -300)).toBe('credit_card'); expect(guessKind('Account 7', 300)).toBe('checking')
  })
})

describe('de-duplication', () => {
  const inc = [{ date: '2026-11-01', kind: 'expense', amount: 45.2, external_id: 'sfin:A1:t1' }, { date: '2026-11-01', kind: 'expense', amount: 12, external_id: 'sfin:A1:t5' }, { date: '2026-11-01', kind: 'expense', amount: 12, external_id: 'sfin:A1:t6' }, { date: '2026-11-02', kind: 'income', amount: 1800, external_id: 'sfin:A1:t2' }]
  it('skips known external ids and hand-entered twins (one existing row cancels one new one)', () => {
    const r = dropKnown(inc, 'L1', [{ account_id: 'L1', date: '2026-11-02', kind: 'income', amount: 1800 }, { account_id: 'L1', date: '2026-11-01', kind: 'expense', amount: 12 }, { account_id: 'L1', date: '2026-11-01', kind: 'expense', amount: 45.2, external_id: 'sfin:A1:t1' }])
    expect(r.fresh.map(x => x.external_id)).toEqual(['sfin:A1:t6']); expect(r.skipped).toBe(3)
  })
  it('does not treat another account\'s identical amount as a duplicate, and is idempotent when run twice', () => {
    const r = dropKnown(inc, 'L1', [{ account_id: 'L9', date: '2026-11-01', kind: 'expense', amount: 12 }]); expect(r.fresh.length).toBe(4)
    const again = dropKnown(inc, 'L1', r.fresh.map(f => ({ account_id: 'L1', date: f.date, kind: f.kind, amount: f.amount, external_id: f.external_id }))); expect(again.fresh.length).toBe(0)
  })
})

describe('edge function copy', () => {
  it('supabase/functions/sync-simplefin/simplefin.ts is identical to src/lib/simplefin.ts', () => {
    expect(functionCopy).toBe(engineSource)
  })
})
