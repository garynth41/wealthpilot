// Budget math. Actuals are ALWAYS derived from transactions; a budget line only holds the plan.
import type { BudgetPeriod, Category, Data, Settings, Transaction } from '../app/data/types'
import { addDays, curMonth, fmtD, mAdd, mShort, monthEnd, monthStart, today, weekStart } from './dates'
import { round2, sum } from './money'
import { elapsed, daysIn } from './periods'
import { expectedIncome } from './paySchedule'
import { liabilities, debtPlanned, debtPaidInRange } from './accounts'

export const inRange = (t: Transaction, from: string, to: string) => t.date >= from && t.date <= to && t.status !== 'void'
export const budgetable = (t: Transaction) => !t.exclude_from_budget
/** Spend in a category over a date range (expenses, plus transfers that carry the category — e.g. savings / debt payments budgeted as a line). */
export function spentIn(d: Data, catId: string, from: string, to: string) { return sum(d.transactions.filter(t => t.category_id === catId && (t.kind === 'expense' || t.kind === 'transfer') && inRange(t, from, to) && budgetable(t)).map(t => t.amount)) }
export function receivedIn(d: Data, catId: string, from: string, to: string) { return sum(d.transactions.filter(t => t.category_id === catId && t.kind === 'income' && inRange(t, from, to) && budgetable(t)).map(t => t.amount)) }
export function uncategorized(d: Data, from: string, to: string) { return d.transactions.filter(t => !t.category_id && t.kind !== 'transfer' && inRange(t, from, to)) }

export interface LineStat { cat: Category; planned: number; rollover: number; available: number; actual: number; left: number; pct: number | null; state: 'good' | 'warn' | 'crit' | 'idle'; lineId?: string; notes?: string | null }
export interface PeriodStat { period: BudgetPeriod; lines: LineStat[]; income: LineStat[]; incB: number; incA: number; spB: number; spA: number; left: number; net: number; rate: number | null; ess: number; imp: number; disc: number; fixed: number; variable: number; elapsed: number; pace: number | null; uncat: number; expectedPay: number; days: number }
/** Everything the Budget screen needs for one period. */
export function periodStat(d: Data, s: Settings, p: BudgetPeriod): PeriodStat {
  const from = p.start_date, to = p.end_date, cats = d.categories.filter(c => !c.archived)
  const lineOf = (c: Category) => d.lines.find(l => l.period_id === p.id && l.category_id === c.id)
  const mk = (c: Category): LineStat => { const l = lineOf(c); const planned = +(l?.planned ?? 0), rollover = +(l?.rollover_in ?? 0), available = planned + rollover
    const actual = c.kind === 'income' ? receivedIn(d, c.id, from, to) : spentIn(d, c.id, from, to); const left = available - actual
    const pct = available > 0 ? actual / available : null
    const state: LineStat['state'] = c.kind === 'income' ? (actual >= available && available > 0 ? 'good' : actual > 0 ? 'warn' : 'idle') : !available && !actual ? 'idle' : actual > available * (1 + s.budgetCritPct / 100) ? 'crit' : actual > available ? 'warn' : 'good'
    return { cat: c, planned, rollover, available, actual, left, pct, state, lineId: l?.id, notes: l?.notes } }
  const lines = cats.filter(c => c.kind === 'expense').map(mk).filter(x => x.available > 0 || x.actual > 0 || x.lineId), income = cats.filter(c => c.kind === 'income').map(mk).filter(x => x.available > 0 || x.actual > 0 || x.lineId)
  const spB = sum(lines.map(x => x.available)), spA = sum(lines.map(x => x.actual)), incB = Math.max(sum(income.map(x => x.available)), +p.expected_income || 0), incA = sum(income.map(x => x.actual))
  const by = (pr: string) => sum(lines.filter(x => x.cat.priority === pr).map(x => x.actual)), byT = (ct: string) => lines.filter(x => x.cat.cost_type === ct)
  const el = elapsed(p); const varB = sum(byT('Variable').map(x => x.available)), varA = sum(byT('Variable').map(x => x.actual))
  const pace = p.start_date <= today() && p.end_date >= today() && varB ? varA / (varB * Math.max(0.05, el)) : null
  return { period: p, lines, income, incB, incA, spB, spA, left: spB - spA, net: incA - spA, rate: incA > 0 ? (incA - spA) / incA : null, ess: by('Essential'), imp: by('Important'), disc: by('Discretionary'), fixed: sum(byT('Fixed').map(x => x.actual)), variable: varA, elapsed: el, pace, uncat: sum(uncategorized(d, from, to).map(t => t.amount)), expectedPay: expectedIncome(d.paySchedules, from, to), days: daysIn(p) }
}
/** Totals for any date range (no period needed): income, spend, by priority — used by trends and the dashboard. */
export function rangeStat(d: Data, from: string, to: string) {
  const tx = d.transactions.filter(t => inRange(t, from, to) && budgetable(t)); const cat = (id?: string | null) => d.categories.find(c => c.id === id)
  const income = sum(tx.filter(t => t.kind === 'income').map(t => t.amount)), spend = sum(tx.filter(t => t.kind === 'expense').map(t => t.amount))
  const debt = sum(d.transactions.filter(t => t.kind === 'transfer' && inRange(t, from, to) && liabilities(d).some(a => a.id === t.to_account_id)).map(t => t.amount))
  const saved = sum(d.transactions.filter(t => t.kind === 'transfer' && inRange(t, from, to) && d.accounts.some(a => a.id === t.to_account_id && (a.kind === 'savings' || a.kind === 'investment' || a.kind === 'retirement'))).map(t => t.amount))
  const byCat: Record<string, number> = {}; tx.filter(t => t.kind === 'expense').forEach(t => { const k = cat(t.category_id)?.name || 'Uncategorized'; byCat[k] = (byCat[k] || 0) + t.amount })
  const byGroup: Record<string, number> = {}; tx.filter(t => t.kind === 'expense').forEach(t => { const k = cat(t.category_id)?.group || 'Other'; byGroup[k] = (byGroup[k] || 0) + t.amount })
  const pr = (p: string) => sum(tx.filter(t => t.kind === 'expense' && cat(t.category_id)?.priority === p).map(t => t.amount))
  return { income, spend, debt, saved, out: spend + debt, net: income - spend - debt, byCat, byGroup, ess: pr('Essential'), imp: pr('Important'), disc: pr('Discretionary'), count: tx.length }
}
/** Series for trends: week / month / year buckets from the first transaction to now. */
export function trendSeries(d: Data, gran: 'week' | 'month' | 'year') {
  const dates = d.transactions.filter(t => t.status !== 'void').map(t => t.date).sort(); if (!dates.length) return []
  const first = dates[0], t = today(), out: Array<{ key: string; label: string; from: string; to: string; income: number; spend: number; debt: number; net: number; planned: number | null }> = []
  if (gran === 'week') { for (let w = weekStart(first); w <= t; w = addDays(w, 7)) { const r = rangeStat(d, w, addDays(w, 6)); out.push({ key: w, label: 'Wk of ' + fmtD(w), from: w, to: addDays(w, 6), income: r.income, spend: r.spend, debt: r.debt, net: r.net, planned: null }) } return out.slice(-26) }
  if (gran === 'month') { for (let m = first.slice(0, 7); m <= curMonth(); m = mAdd(m, 1)) { const r = rangeStat(d, monthStart(m), monthEnd(m)); const per = d.periods.filter(p => p.period_type === 'month' && p.start_date.slice(0, 7) === m)[0]; const planned = per ? sum(d.lines.filter(l => l.period_id === per.id && d.categories.find(c => c.id === l.category_id)?.kind === 'expense').map(l => +l.planned + +l.rollover_in)) : null; out.push({ key: m, label: mShort(m), from: monthStart(m), to: monthEnd(m), income: r.income, spend: r.spend, debt: r.debt, net: r.net, planned }) } return out.slice(-24) }
  const ys = [...new Set(d.transactions.map(x => x.date.slice(0, 4)))].sort(); return ys.map(y => { const r = rangeStat(d, y + '-01-01', y + '-12-31'); return { key: y, label: y + (y === t.slice(0, 4) ? ' (YTD)' : ''), from: y + '-01-01', to: y + '-12-31', income: r.income, spend: r.spend, debt: r.debt, net: r.net, planned: null } })
}
/** Insights for a period: over-runs, slack, pace, uncategorized, debt share. */
export function insights(s: Settings, ps: PeriodStat) {
  const out: Array<{ c: 'good' | 'warn' | 'crit' | 'info' | 'idle'; t: string; m: string; save?: number }> = []
  const over = ps.lines.filter(l => l.state !== 'good' && l.state !== 'idle').sort((a, b) => (b.actual - b.available) - (a.actual - a.available))
  over.slice(0, 4).forEach(l => out.push({ c: l.state === 'crit' ? 'crit' : 'warn', t: `${l.cat.name} is over budget`, m: `${round2(l.actual)} spent of ${l.available} planned`, save: l.actual - l.available }))
  if (ps.pace != null && ps.pace > 1.1) out.push({ c: 'warn', t: 'Variable spending is ahead of pace', m: `${Math.round(ps.pace * 100)}% of the pro-rated budget with ${Math.round(ps.elapsed * 100)}% of the period gone` })
  if (ps.pace != null && ps.pace <= 0.9) out.push({ c: 'good', t: 'Variable spending is under pace', m: `${Math.round(ps.pace * 100)}% of the pro-rated budget so far` })
  if (ps.uncat > 0) out.push({ c: 'info', t: 'Uncategorized transactions', m: `${round2(ps.uncat)} is not counted against any budget line — categorize it on the Transactions page` })
  const disc = ps.lines.filter(l => l.cat.priority === 'Discretionary' && l.actual > 0).sort((a, b) => b.actual - a.actual)
  if (disc.length) out.push({ c: 'info', t: `Discretionary spend is ${Math.round(ps.disc / Math.max(1, ps.spA) * 100)}% of spending`, m: `largest: ${disc.slice(0, 3).map(l => `${l.cat.name} ${round2(l.actual)}`).join(', ')}`, save: ps.disc })
  if (ps.rate != null) out.push({ c: ps.rate >= s.savingsTargetPct / 100 ? 'good' : ps.rate >= 0 ? 'warn' : 'crit', t: `Savings rate ${Math.round(ps.rate * 100)}%`, m: `target ${s.savingsTargetPct}% · net ${round2(ps.net)} this period` })
  if (!out.length) out.push({ c: 'idle', t: 'Nothing to flag', m: 'Every line is within plan so far.' })
  return out
}
/** Monthly debt commitment: planned payments on liabilities (or what was paid in the month if more). */
export function monthlyDebt(d: Data, m = curMonth()) { return sum(liabilities(d).map(a => Math.max(debtPlanned(a), debtPaidInRange(d, a, monthStart(m), monthEnd(m))))) }
