// 0.37.0 — "Always leave out ones like this": the rule it writes is the one that is found, and it matches the payee it was written for.
import { describe, it, expect } from 'vitest'
import { findRule, leaveOutRules, ruleMatches, learnRule, type PayeeRule } from './rules'
import { merchantIdentity } from './merchants'

const rule = (p: Partial<PayeeRule>): PayeeRule => ({ id: 'r1', pattern: 'kroger', match: 'contains', category_id: 'groceries', enabled: true, hits: 0, created_at: '2026-01-01T00:00:00Z', ...p })

describe('a learned description matches the payee it came from', () => {
  it.each(['Zelle payment to Gavionne Conf# tcpnq1vmx', 'ACME-HARDWARE', 'INTERNET TFR FRM CHECKING', 'OVERDRAFT PROTECTION FROM XXXXXXXXXX0253'])('%s', payee => {
    const next = leaveOutRules([], payee, 'expense')!; expect(next).toHaveLength(1); expect(next[0]).toMatchObject({ pattern: merchantIdentity(payee).pattern, exclude_from_budget: true, kind: 'expense', enabled: true })
    expect(ruleMatches(next[0], payee, 'expense')).toBe(true); expect(findRule(next, payee, 'expense')?.exclude_from_budget).toBe(true)
    expect(ruleMatches(next[0], payee, 'income')).toBe(false)   // only the side it was written for
  })
  it('and so does a category rule learned the ordinary way', () => { const r = learnRule('Zelle payment to Gavionne Conf# abc', { category_id: 'kids' }, 'expense')!; expect(ruleMatches(r, 'Zelle payment to Gavionne Conf# zzz9', 'expense')).toBe(true); expect(ruleMatches(r, 'Zelle payment to Farda Sesi Conf# zzz9', 'expense')).toBe(false) })
  it('a rule typed by hand still matches the text as written, and nothing more', () => { expect(ruleMatches(rule({}), 'KROGER #1234', 'expense')).toBe(true); expect(ruleMatches(rule({ pattern: 'kroger fuel' }), 'KROGER #1234', 'expense')).toBe(false) })
  it('no rule for a payee with no description of its own', () => { expect(leaveOutRules([], '', 'expense')).toBeNull(); expect(leaveOutRules([], 'PAYPAL', 'expense')).toBeNull() })
})

describe('the leave-out rule is the one that is found', () => {
  const pat = merchantIdentity('KROGER #1234').pattern!
  it('an existing rule for that side keeps its category and gains the flag', () => {
    const next = leaveOutRules([rule({ pattern: pat, kind: 'expense' })], 'KROGER #1234', 'expense')!
    expect(next).toHaveLength(1); expect(next[0]).toMatchObject({ id: 'r1', category_id: 'groceries', exclude_from_budget: true })
  })
  it('a rule that covers both sides keeps the other side, and this side gets its own copy with the flag', () => {
    const next = leaveOutRules([rule({ pattern: pat, kind: null })], 'KROGER #1234', 'expense')!
    expect(next).toHaveLength(2)
    expect(findRule(next, 'KROGER #1234', 'expense')).toMatchObject({ category_id: 'groceries', exclude_from_budget: true, kind: 'expense' })
    const inc = findRule(next, 'KROGER #1234', 'income')!; expect(inc.id).toBe('r1'); expect(inc.kind).toBe('income'); expect(inc.exclude_from_budget).toBeFalsy()
  })
  it('it is added to the rules there are now, not a copy from earlier', () => {
    const a = leaveOutRules([], 'INTERNET TFR FRM CHECKING', 'income')!; const b = leaveOutRules(a, 'Zelle payment to Gavionne Conf# q', 'expense')!
    expect(b).toHaveLength(2); expect(findRule(b, 'INTERNET TFR FRM CHECKING', 'income')?.exclude_from_budget).toBe(true); expect(findRule(b, 'Zelle payment to Gavionne Conf# zz', 'expense')?.exclude_from_budget).toBe(true)
  })
  it('turning it off clears the flag and keeps the rule', () => { const on = leaveOutRules([rule({ pattern: pat, kind: 'expense' })], 'KROGER #1234', 'expense')!; expect(leaveOutRules(on, 'KROGER #1234', 'expense', false)![0]).toMatchObject({ category_id: 'groceries', exclude_from_budget: false }) })
})
