// 0.31.0 — Review uncategorized: the groups, the answers, what Accept writes, and what counts as a new arrival.
import { describe, it, expect } from 'vitest'
import { demoSeed } from '../app/data/demoSeed'
import { SETTINGS_DEFAULTS, type Transaction } from '../app/data/types'
import { reviewGroups, coverage, acceptPlan, arrivals, needsCategory, reasonFor, uncategorizedAll } from './categorize'
import { findRule } from './rules'

const { data } = demoSeed(); const s = { ...SETTINGS_DEFAULTS, rules: [] }
const base = data.transactions.find(t => t.kind === 'expense' && !data.splits.some(x => x.transaction_id === t.id))!
const at = '2026-11-10T12:00:00.000Z'
const row = (id: string, payee: string | null, amount: number, extra: Partial<Transaction> = {}): Transaction => ({ ...base, id, payee, amount, category_id: null, date: '2026-11-0' + (1 + (amount % 9 | 0)), created_at: at, updated_at: at, ...extra })
const rows = [row('a1', 'WHOLEFDS MKT #10230 COLUMBUS OH', 86.41), row('a2', 'WHOLEFDS MKT #10230 COLUMBUS OH', 52.08), row('b1', 'NETFLIX.COM', 15.49), row('c1', 'SQ *BLUE DOOR CAFE', 27.6), row('d1', 'COSTCO WHSE #0344', 143.27),
  row('e1', 'ZELLE TO J MARTINEZ', 60), row('f1', null, 20), row('f2', null, 5), row('g1', 'ADP PAYROLL DEP', 2100, { kind: 'income' }), row('h1', 'Kroger', 40)]
const d2 = { ...data, transactions: [...data.transactions, ...rows] }
const cat = (id: string | null) => data.categories.find(c => c.id === id)?.name ?? null

describe('review groups', () => {
  const gs = reviewGroups(d2, s); const g = (n: string) => gs.find(x => x.name.startsWith(n))!
  it('the demo household starts with nothing to review', () => { expect(reviewGroups(data, s)).toEqual([]); expect(coverage(data)).toMatchObject({ uncategorized: 0, pct: 100 }) })
  it('one group per merchant and side, the most money first; rows without a payee stand alone', () => {
    expect(gs.map(x => x.name.split(' ')[0])).toEqual(['ADP', 'COSTCO', 'WHOLEFDS', 'ZELLE', 'Kroger', 'SQ', 'No', 'NETFLIX.COM', 'No'])
    expect(g('WHOLEFDS')).toMatchObject({ total: 138.49, kind: 'expense' }); expect(g('WHOLEFDS').txns.map(t => t.id).sort()).toEqual(['a1', 'a2'])
    expect(gs.reduce((n, x) => n + x.txns.length, 0)).toBe(rows.length)
  })
  it('each group carries the answer, how sure, and why', () => {
    expect([cat(g('WHOLEFDS').category_id), g('WHOLEFDS').confidence, g('WHOLEFDS').how]).toEqual(['Groceries', 'high', 'library'])
    expect([cat(g('NETFLIX').category_id), g('NETFLIX').confidence]).toEqual(['Subscriptions & streaming', 'high'])
    expect([cat(g('ADP').category_id), g('ADP').confidence, g('ADP').kind]).toEqual(['Paycheck', 'high', 'income'])
    expect([cat(g('Kroger').category_id), g('Kroger').how]).toEqual(['Groceries', 'history'])   // the demo household has filed Kroger before
    expect([cat(g('COSTCO').category_id), g('COSTCO').confidence]).toEqual(['Groceries', 'medium']); expect(g('SQ').confidence).toBe('medium')
    expect(g('ZELLE')).toMatchObject({ category_id: null, confidence: null, how: null }); expect(g('No')).toMatchObject({ category_id: null })
    expect(reasonFor(g('WHOLEFDS'))).toBe('a merchant Cresari knows'); expect(reasonFor(g('SQ'))).toContain('cafe'); expect(reasonFor(g('ZELLE'))).toBe('')
  })
  it('coverage counts purchases and deposits only', () => {
    const c = coverage(d2); expect(c.uncategorized).toBe(rows.length); expect(c.total).toBe(coverage(data).total + rows.length); expect(c.pct).toBe(Math.floor(c.categorized / c.total * 100)); expect(c.pct).toBeLessThan(100)
  })
  it('transfers, void rows and split transactions never need a category', () => {
    for (const patch of [{ kind: 'transfer' as const }, { status: 'void' as const }]) expect(needsCategory(d2, { ...rows[0], ...patch })).toBe(false)
    const split = data.transactions.find(t => data.splits.some(x => x.transaction_id === t.id))!; expect(needsCategory(data, { ...split, category_id: null })).toBe(false)
  })
})
describe('accepting', () => {
  const gs = reviewGroups(d2, s)
  it('files every transaction of the accepted groups and learns one rule per merchant', () => {
    const sure = gs.filter(x => x.confidence === 'high').map(x => ({ ...x, category_id: x.category_id! }))
    const plan = acceptPlan(sure, [], true)
    expect(plan.count).toBe(sure.reduce((n, x) => n + x.txns.length, 0)); expect(plan.byCat.flatMap(b => b.ids).sort()).toEqual(sure.flatMap(x => x.txns.map(t => t.id)).sort())
    expect(plan.learned).toBe(sure.length); expect(cat(findRule(plan.rules, 'WHOLEFDS MKT #999 DUBLIN OH', 'expense')!.category_id ?? null)).toBe('Groceries')
    expect(findRule(plan.rules, 'ADP PAYROLL DEP', 'income')!.kind).toBe('income')
  })
  it('learns nothing when rule learning is off, and nothing from a row with no payee', () => {
    const one = gs.filter(x => x.name === 'No payee').map(x => ({ ...x, category_id: data.categories[5].id }))
    expect(acceptPlan(one, [], true).learned).toBe(0); expect(acceptPlan(gs.filter(x => x.category_id).map(x => ({ ...x, category_id: x.category_id! })), [], false)).toMatchObject({ learned: 0, rules: [] })
  })
})
describe('new arrivals', () => {
  it('only rows nobody has touched since they were added, and only with a payee', () => {
    const touched = row('t1', 'NETFLIX.COM', 15.49, { updated_at: '2026-11-12T09:00:00.000Z' })
    const d3 = { ...d2, transactions: [...d2.transactions, touched] }
    const ids = arrivals(d3).map(t => t.id); expect(ids).toContain('b1'); expect(ids).not.toContain('t1'); expect(ids).not.toContain('f1')
    expect(uncategorizedAll(d3).map(t => t.id)).toContain('t1')
  })
})
