// 0.30.0 — drill-down: the transactions behind a figure add up to exactly that figure, on the demo household (which has splits,
// refunds, card spending and transfers) — for every category, group, priority and month, and for income by source.
import { describe, it, expect } from 'vitest'
import { demoSeed } from '../app/data/demoSeed'
import { rangeStat } from './budget'
import { merchantAnalysis } from './intelligence'
import { drillLines, summarize, ledgerLink, incomeSource } from './drill'
import { round2 } from './money'

const { data } = demoSeed()
const months = [...new Set(data.transactions.map(t => t.date.slice(0, 7)))].sort()
const range = (m: string) => ({ from: m + '-01', to: m + '-31' })
const tot = (ls: Array<{ amount: number }>) => round2(ls.reduce((n, l) => n + l.amount, 0))

describe('a drill-down adds up to the figure it came from', () => {
  it('the demo household has months to test with', () => { expect(months.length).toBeGreaterThan(1); expect(data.splits.length).toBeGreaterThan(0) })
  it.each(months)('%s: total spending, every category, every group and each priority', m => {
    const r = range(m), st = rangeStat(data, r.from, r.to)
    expect(tot(drillLines(data, r))).toBe(st.spend)
    for (const [name, v] of Object.entries(st.byCat)) expect([name, tot(drillLines(data, { ...r, category: name }))]).toEqual([name, round2(v)])
    for (const [g, v] of Object.entries(st.byGroup)) expect([g, tot(drillLines(data, { ...r, group: g }))]).toEqual([g, round2(v)])
    expect(tot(drillLines(data, { ...r, priority: 'Essential' }))).toBe(round2(st.ess))
    expect(tot(drillLines(data, { ...r, priority: 'Discretionary' }))).toBe(round2(st.disc))
  })
  it.each(months)('%s: income, and income by source', m => {
    const r = range(m), st = rangeStat(data, r.from, r.to), all = drillLines(data, { ...r, flow: 'income' })
    expect(tot(all)).toBe(st.income)
    const keys = [...new Set(all.map(l => incomeSource(data, l.txn).key))]
    expect(round2(keys.reduce((n, k) => n + tot(drillLines(data, { ...r, flow: 'income', source: k })), 0))).toBe(st.income)
  })
  it('a merchant drill-down matches Spending Intelligence for merchants with no refunds', () => {
    const r = range(months[months.length - 2]); const ms = merchantAnalysis(data, r.from, r.to).slice(0, 8); expect(ms.length).toBeGreaterThan(3)
    for (const mch of ms) { const ls = drillLines(data, { ...r, merchant: mch.key }); if (ls.every(l => l.amount > 0)) expect([mch.name, tot(ls)]).toEqual([mch.name, mch.total]) }
  })
  it('weekdays split the month with nothing left over', () => {
    const r = range(months[months.length - 2])
    expect(round2([0, 1, 2, 3, 4, 5, 6].reduce((n, w) => n + tot(drillLines(data, { ...r, weekday: w })), 0))).toBe(rangeStat(data, r.from, r.to).spend)
  })
  it('leaves out void rows, duplicates and anything excluded from the budget', () => {
    const r = range(months[months.length - 2]), base = drillLines(data, r), t = base.find(l => !l.slice)!.txn
    for (const patch of [{ status: 'void' as const }, { duplicate_of: 'x' }, { exclude_from_budget: true }]) {
      const d2 = { ...data, transactions: data.transactions.map(x => x.id === t.id ? { ...x, ...patch } : x) }
      expect(drillLines(d2, r).some(l => l.txn.id === t.id)).toBe(false)
    }
  })
})
describe('the summary of a drill-down', () => {
  const r = range(months[months.length - 2]), lines = drillLines(data, r), s = summarize(data, lines)
  it('totals, counts and the average agree with the lines', () => {
    expect(s.total).toBe(tot(lines)); expect(s.count).toBe(lines.length); expect(s.average).toBe(round2(s.total / s.count))
    expect(Math.abs(s.largest!.amount)).toBe(Math.max(...lines.map(l => Math.abs(l.amount))))
  })
  it('merchants, categories and months each add back to the total, biggest first', () => {
    for (const part of [s.merchants, s.categories, s.months]) expect(round2(part.reduce((n, x) => n + x.total, 0))).toBe(s.total)
    expect(s.merchants[0].total).toBeGreaterThanOrEqual(s.merchants[1].total); expect(s.months.map(x => x.month)).toEqual([r.from.slice(0, 7)])
  })
  it('newest first, and the ledger link names each transaction once', () => {
    expect(lines[0].txn.date >= lines[lines.length - 1].txn.date).toBe(true)
    const ids = ledgerLink(lines).split('ids=')[1].split(','); expect(new Set(ids).size).toBe(ids.length); expect(ids.length).toBe(new Set(lines.map(l => l.txn.id)).size)
  })
  it('nothing behind a figure is an empty summary, not an error', () => {
    expect(summarize(data, drillLines(data, { ...r, category: 'No such category' }))).toMatchObject({ total: 0, count: 0, average: 0, largest: null, merchants: [] })
  })
})
