import { describe, it, expect } from 'vitest'
import functionCopy from '../../supabase/functions/sync-simplefin/dedupe.ts?raw'
import engineSource from './dedupe.ts?raw'
import { planDedupe, payeeTokens, payeeSimilarity, alreadyPresent, keeperOrder, origin, type DTxn } from './dedupe'

const CHK = 'acct-0224', GAV = 'acct-2060', CAT = 'cat-utilities'
let n = 0
const t = (p: Partial<DTxn>): DTxn => ({ id: p.id || `t${++n}`, date: '2026-10-21', kind: 'expense', amount: 150, account_id: null, payee: '', source: 'manual', external_id: null, status: 'cleared', created_at: `2026-11-01T00:00:${String(n).padStart(2, '0')}Z`, ...p })
const bank = (p: Partial<DTxn>) => t({ source: 'import', external_id: `sfin:ACT-1:${p.id || n + 1}`, account_id: CHK, ...p })
const email = (p: Partial<DTxn>) => t({ source: 'email', memo: 'From email', category_id: CAT, ...p })

describe('payee words', () => {
  it('strips bank boilerplate, ids and filler', () => {
    expect(payeeTokens('AEP COLUMBUS SOU DES:BILL PAY ID:XXXXX036071 INDN:GARY THOMAS CO ID:XXXXX29611 WEB')).toEqual(['aep', 'columbus', 'sou'])
    expect(payeeTokens('GLOBAL LENDING DES:BILL PAY ID:9185685 INDN:GARY THOMAS')).toEqual(['global', 'lending'])
    expect(payeeTokens('AT&T Payment')).toEqual(['att'])
    expect(payeeTokens('Buckeye Utility Billing')).toEqual(['buckeye', 'utility'])
    expect(payeeTokens('')).toEqual([])
  })
  it('scores overlap on the shorter name', () => {
    expect(payeeSimilarity('AEP Ohio', 'AEP COLUMBUS SOU DES:BILL PAY ID:1')).toBe(0.5)
    expect(payeeSimilarity('American Express', 'AMERICAN EXPRESS DES:ACH PMT ID:A5530')).toBe(1)
    expect(payeeSimilarity('AMZN Mktp US', 'Amazon')).toBe(0)
    expect(payeeSimilarity('', 'Kroger')).toBeNull()
  })
})

describe('which copy is kept', () => {
  it('bank feed > statement file > email > manual, then categorised, then oldest', () => {
    const b = bank({ id: 'b' }), f = t({ id: 'f', external_id: 'csv:abc', source: 'import' }), e = email({ id: 'e' }), m = t({ id: 'm' })
    expect([m, e, f, b].sort(keeperOrder).map(x => x.id)).toEqual(['b', 'f', 'e', 'm'])
    expect([origin(b), origin(f), origin(e)]).toEqual(['bank', 'file', 'typed'])
  })
})

describe('planDedupe — cases from real data', () => {
  it('an email payment filed twice collapses to one (same day, same payee, no account)', () => {
    const a = email({ id: 'a', date: '2026-10-31', amount: 298.62, payee: 'AT&T' }), b = email({ id: 'b', date: '2026-10-31', amount: 298.62, payee: 'AT&T' })
    const p = planDedupe([a, b]); expect(p.auto).toHaveLength(1); expect(p.auto[0].confidence).toBe('certain'); expect([p.auto[0].keeper, ...p.auto[0].dups].sort()).toEqual(['a', 'b']); expect(p.review).toEqual([])
  })
  it('the email pair plus the bank line a day later all collapse onto the bank line, which inherits the category', () => {
    const e1 = email({ id: 'e1', payee: 'AEP Ohio' }), e2 = email({ id: 'e2', payee: 'AEP Ohio' })
    const b = bank({ id: 'bk', date: '2026-10-22', payee: 'AEP COLUMBUS SOU DES:BILL PAY ID:XXXXX036071 INDN:GARY THOMAS CO ID:XXXXX29611 WEB' })
    const p = planDedupe([e1, e2, b]); expect(p.auto).toHaveLength(1)
    expect(p.auto[0].keeper).toBe('bk'); expect(p.auto[0].dups.sort()).toEqual(['e1', 'e2']); expect(p.auto[0].patch).toEqual({ category_id: CAT }); expect(p.review).toEqual([])
  })
  it('an email payment 3 days before the bank line merges (Global Lending)', () => {
    const e = email({ id: 'e', date: '2026-09-18', amount: 324, payee: 'Global Lending Services' }), b = bank({ id: 'b', date: '2026-09-21', amount: 324, payee: 'GLOBAL LENDING DES:BILL PAY ID:9185685' })
    expect(planDedupe([e, b]).auto.map(g => [g.keeper, g.dups])).toEqual([['b', ['e']]])
  })
  it('a match in a different account is only offered for review (Buckeye)', () => {
    const e = email({ id: 'e', date: '2026-09-15', amount: 67.31, account_id: CHK, payee: 'Buckeye Utility Billing' }), b = bank({ id: 'b', date: '2026-09-17', amount: 67.31, account_id: GAV, payee: 'BUCKEYE UTILITY BUCKEYE UT' })
    const p = planDedupe([e, b]); expect(p.auto).toEqual([]); expect(p.review).toHaveLength(1); expect(p.review[0].confidence).toBe('possible')
  })
  it('two identical bank-feed charges on the same day are NOT merged automatically', () => {
    const p = planDedupe([bank({ id: 'x', amount: 5.25, payee: 'STARBUCKS' }), bank({ id: 'y', amount: 5.25, payee: 'STARBUCKS' })])
    expect(p.auto).toEqual([]); expect(p.review).toHaveLength(1)
  })
  it('a statement-file row and the bank-sync row for the same purchase merge, keeping the bank row', () => {
    const f = t({ id: 'f', source: 'import', external_id: 'csv:9a1', account_id: CHK, date: '2026-08-06', amount: 42.1, payee: 'KROGER #123' }), b = bank({ id: 'b', date: '2026-08-07', amount: 42.1, payee: 'KROGER 123 COLUMBUS OH' })
    expect(planDedupe([f, b]).auto.map(g => [g.keeper, g.dups])).toEqual([['b', ['f']]])
  })
  it('one email that matches two identical bank charges is ambiguous → review', () => {
    const e = email({ id: 'e', amount: 20, payee: 'Venmo' }), b1 = bank({ id: 'b1', amount: 20, payee: 'VENMO DES:PAYMENT' }), b2 = bank({ id: 'b2', amount: 20, payee: 'VENMO DES:PAYMENT' })
    const p = planDedupe([e, b1, b2]); expect(p.auto).toEqual([]); expect(p.review.length).toBeGreaterThanOrEqual(2)
  })
  it('two emails and the bank line on the same day are one payment (American Express)', () => {
    const e1 = email({ id: 'e1', date: '2026-09-18', amount: 40, payee: 'American Express' }), e2 = email({ id: 'e2', date: '2026-09-18', amount: 40, payee: 'American Express' })
    const b = bank({ id: 'b', date: '2026-09-18', amount: 40, payee: 'AMERICAN EXPRESS DES:ACH PMT ID:A5530 INDN:GARY THOMAS CO ID:XXXXX33497 WEB' })
    const p = planDedupe([e1, e2, b]); expect(p.auto.map(g => [g.keeper, g.dups.sort()])).toEqual([['b', ['e1', 'e2']]]); expect(p.review).toEqual([])
  })
  it('a chain of look-alikes stretching beyond 4 days from the kept copy is not merged', () => {
    const p = planDedupe([email({ id: 'a', date: '2026-10-01', payee: 'Gym' }), email({ id: 'b', date: '2026-10-04', payee: 'Gym' }), email({ id: 'c', date: '2026-10-07', payee: 'Gym' })])
    expect(p.auto).toEqual([]); expect(p.review.length).toBeGreaterThan(0)
  })
  it('different amounts, directions, far-apart dates and unrelated payees never match', () => {
    const p = planDedupe([email({ amount: 150 }), email({ amount: 150.01 }), email({ kind: 'income', amount: 150 }), email({ amount: 150, date: '2026-10-28' }), bank({ amount: 150, date: '2026-10-23', payee: 'NETFLIX' })])
    expect(p.auto).toEqual([])
  })
  it('respects "not a duplicate", already-merged and void rows', () => {
    const a = email({ id: 'a', payee: 'AT&T', dedupe_ok: true }), b = email({ id: 'b', payee: 'AT&T' })
    expect(planDedupe([a, b]).auto).toEqual([])
    expect(planDedupe([email({ id: 'c', payee: 'X' }), email({ id: 'd', payee: 'X', duplicate_of: 'c' })]).auto).toEqual([])
    expect(planDedupe([email({ id: 'e', payee: 'X' }), email({ id: 'f', payee: 'X', status: 'void' })]).auto).toEqual([])
  })
  it('is stable: running the plan on its own result finds nothing more', () => {
    const rows = [email({ id: 'e1', payee: 'AEP Ohio' }), email({ id: 'e2', payee: 'AEP Ohio' }), bank({ id: 'bk', date: '2026-10-22', payee: 'AEP COLUMBUS SOU DES:BILL PAY' })]
    const p = planDedupe(rows); const after = rows.map(r => p.auto[0].dups.includes(r.id) ? { ...r, duplicate_of: p.auto[0].keeper } : r)
    expect(planDedupe(after)).toEqual({ auto: [], review: [] })
  })
})

describe('alreadyPresent (checked before a row is saved)', () => {
  it('finds the same bank id, or a certain match, and nothing weaker', () => {
    const ex = [bank({ id: 'b', external_id: 'sfin:A:1', payee: 'AT&T', amount: 298.62 }), email({ id: 'e', payee: 'Anthropic', amount: 107, date: '2026-10-15' })]
    expect(alreadyPresent({ date: '2026-10-21', kind: 'expense', amount: 298.62, external_id: 'sfin:A:1' }, ex)?.id).toBe('b')
    expect(alreadyPresent({ date: '2026-10-15', kind: 'expense', amount: 107, payee: 'Anthropic', source: 'email' }, ex)?.id).toBe('e')
    expect(alreadyPresent({ date: '2026-10-17', kind: 'expense', amount: 107, payee: 'Anthropic', source: 'email' }, ex)).toBeNull()
  })
})

it('the bank-sync function carries an identical copy of this engine', () => { expect(functionCopy).toBe(engineSource) })
