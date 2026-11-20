// 0.30.0 — drill-down: the transactions behind a figure add up to exactly that figure, on the demo household (which has splits,
// refunds, card spending and transfers) — for every category, group, priority and month, and for income by source.
import { describe, it, expect } from 'vitest'
import { demoSeed } from '../app/data/demoSeed'
import { rangeStat, spentIn } from './budget'
import { merchantAnalysis, merchantKey } from './intelligence'
import { drillLines, summarize, ledgerLink, lineIds, incomeSource, LINK_MAX, LEDGER_SET } from './drill'
import { buildReport } from './reports'
import { SETTINGS_DEFAULTS } from '../app/data/types'
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
  it.each(months)('%s: every merchant matches Spending Intelligence, refunds or not', m => {
    const r = range(m); const ms = merchantAnalysis(data, r.from, r.to)
    for (const mch of ms) expect([mch.name, tot(drillLines(data, { ...r, flow: 'purchases', merchant: mch.key }))]).toEqual([mch.name, mch.total])
  })
  it('a merchant with a refund: the purchases view shows the bar, the spending view shows it net', () => {
    const r = range(months[months.length - 2]), mch = merchantAnalysis(data, r.from, r.to)[0], buy = data.transactions.find(t => t.kind === 'expense' && merchantKey(t.payee) === mch.key && t.date >= r.from && t.date <= r.to)!
    const card = data.accounts.find(a => a.kind === 'credit_card')!
    const d2 = { ...data, transactions: [...data.transactions, { ...buy, id: 'refund-1', kind: 'income' as const, amount: 20, account_id: card.id }] }
    expect(tot(drillLines(d2, { ...r, flow: 'purchases', merchant: mch.key }))).toBe(merchantAnalysis(d2, r.from, r.to).find(x => x.key === mch.key)!.total)
    expect(tot(drillLines(d2, { ...r, merchant: mch.key }))).toBe(round2(tot(drillLines(data, { ...r, merchant: mch.key })) - 20))
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

// Review of 0.30.0 (PR #28): each figure has its own counting rule, and its drill-down follows that rule.
describe('a budget line and its drill-down', () => {
  const r = range(months[months.length - 2]); const cats = data.categories.filter(c => c.kind === 'expense')
  it('every expense category: the lines add up to the line\'s Spent', () => {
    for (const c of cats) expect([c.name, tot(drillLines(data, { ...r, flow: 'budget', category: c.name }))]).toEqual([c.name, round2(spentIn(data, c.id, r.from, r.to))])
  })
  it('a loan payment and a move to savings filed under a category count on the line and are listed, not re-filed; a card payment is not', () => {
    const c = cats[0], from = data.accounts.find(a => a.kind === 'checking')!, loan = data.accounts.find(a => ['loan', 'mortgage', 'auto_loan', 'student_loan'].includes(a.kind)), card = data.accounts.find(a => a.kind === 'credit_card')!, sav = data.accounts.find(a => a.kind === 'savings')!
    const base = data.transactions.find(t => t.kind === 'expense' && t.date >= r.from && t.date <= r.to)!
    const tr = (id: string, to: string, amount: number) => ({ ...base, id, kind: 'transfer' as const, account_id: from.id, to_account_id: to, category_id: c.id, amount, payee: 'Transfer ' + id })
    const extra = [tr('t-save', sav.id, 150), tr('t-card', card.id, 90), ...(loan ? [tr('t-loan', loan.id, 312)] : [])]
    const d2 = { ...data, transactions: [...data.transactions, ...extra] }
    const ls = drillLines(d2, { ...r, flow: 'budget', category: c.name })
    expect(tot(ls)).toBe(round2(spentIn(d2, c.id, r.from, r.to)))
    expect(ls.find(l => l.txn.id === 't-save')?.fixed).toBe('moved to savings'); expect(ls.some(l => l.txn.id === 't-card')).toBe(false)
    if (loan) expect(ls.find(l => l.txn.id === 't-loan')?.fixed).toBe('loan payment')
    // the spending view of the same category leaves the transfers out
    expect(drillLines(d2, { ...r, category: c.name }).some(l => l.txn.kind === 'transfer')).toBe(false)
  })
})
describe('the "Other + loan payments" part of the Trends chart', () => {
  it.each(months)('%s: the lines add up to the segment', m => {
    const r = range(m), st = rangeStat(data, r.from, r.to), top = Object.keys(st.byCat).sort((a, b) => st.byCat[b] - st.byCat[a]).slice(0, 3)
    const segment = round2(Object.entries(st.byCat).filter(([k]) => !top.includes(k)).reduce((n, [, v]) => n + v, 0) + st.loans)
    expect(tot(drillLines(data, { ...r, notCategories: top, loans: true }))).toBe(segment)
    for (const k of top) expect(tot(drillLines(data, { ...r, category: k }))).toBe(round2(st.byCat[k]))
  })
})
describe('income', () => {
  const r = range(months[months.length - 2])
  it('a split deposit is listed slice by slice and cannot be re-filed whole', () => {
    const dep = drillLines(data, { ...r, flow: 'income' }).find(l => !l.slice)!.txn; const cs = data.categories.filter(c => c.kind === 'income')
    const mk = (id: string, amount: number, category_id: string) => ({ ...data.splits[0], id, transaction_id: dep.id, amount, category_id })
    const d2 = { ...data, splits: [...data.splits, mk('s1', round2(dep.amount - 10), cs[0].id), mk('s2', 10, (cs[1] || cs[0]).id)] }
    const ls = drillLines(d2, { ...r, flow: 'income' }).filter(l => l.txn.id === dep.id)
    expect(ls.length).toBe(2); expect(ls.every(l => l.slice)).toBe(true); expect(tot(ls)).toBe(dep.amount)
    expect(tot(drillLines(d2, { ...r, flow: 'income' }))).toBe(rangeStat(d2, r.from, r.to).income)
  })
  it('every row of the Income report opens its own deposits — also when a pay schedule and a payee share a name', () => {
    const sched = data.paySchedules[0], dep = data.transactions.find(t => t.kind === 'income' && !t.pay_schedule_id && t.date >= r.from && t.date <= r.to) || data.transactions.find(t => t.kind === 'income' && t.date >= r.from && t.date <= r.to)!
    const d2 = { ...data, transactions: [...data.transactions, { ...dep, id: 'same-name', pay_schedule_id: null, payee: sched.name, amount: 77 }] }
    const sec = buildReport(d2, SETTINGS_DEFAULTS, 'custom', r.to, ['income'], r.to, r).sections.find(s => s.id === 'income')!.table!
    expect(sec.rows.filter(row => row[0] === sched.name).length).toBeGreaterThan(0)
    expect(sec.keys!.length).toBe(sec.rows.length)
    sec.rows.forEach((row, i) => expect([row[0], tot(drillLines(d2, { from: r.from, to: r.to, flow: 'income', source: sec.keys![i] }))]).toEqual([row[0], row[2]]))
  })
})
describe('the ledger link', () => {
  it('names every transaction, or hands a long set over whole', () => {
    const all = drillLines(data, { from: '2000-01-01', to: '2100-01-01' }); const many = Array.from({ length: LINK_MAX + 1 }, (_, i) => ({ ...all[0], txn: { ...all[0].txn, id: 'x' + i } }))
    const kept: Record<string, string> = {}; const ok = { setItem: (k: string, v: string) => { kept[k] = v } }, broken = { setItem: () => { throw new Error('quota') } }
    expect(ledgerLink(many, ok)).toBe('#/transactions?ids=@set'); expect(JSON.parse(kept[LEDGER_SET])).toEqual(lineIds(many))
    // storage refused or missing: the link carries every id itself rather than opening something else
    for (const st of [broken, null]) expect(ledgerLink(many, st).split('ids=')[1].split(',')).toEqual(lineIds(many))
    expect(ledgerLink(many.slice(0, LINK_MAX)).split('ids=')[1].split(',').length).toBe(LINK_MAX)
  })
})
