// Drill-down (0.30.0): the exact transactions behind a figure on a chart, table or tile.
// One rule: a drill-down uses the SAME lines the figure was built from (rangeStat's spendLines / flowOf), so the panel's total always
// equals the bar, slice or cell that was clicked — split transactions count slice by slice, refunds come off their own category,
// transactions left out of the budget and duplicates are not there. Pure functions; the panel is components/DrillDown.tsx.
import type { Data, Transaction } from '../app/data/types'
import { accountLookup, budgetable, flowOf, inRange, spendLines } from './budget'
import { merchantKey } from './intelligence'
import { round2 } from './money'

export interface DrillFilter {
  /** inclusive ISO dates */
  from: string; to: string
  /** 'spend' (default) = purchases less refunds; 'income' = money in from outside */
  flow?: 'spend' | 'income'
  /** a category by name; 'Uncategorized' = no category */
  category?: string
  /** a category group ('Housing', 'Food'…); 'Other' = no group */
  group?: string
  /** 'Essential' | 'Important' | 'Discretionary' */
  priority?: string
  /** a merchant by lib/intelligence merchantKey */
  merchant?: string
  /** an income source: a pay schedule's name, or a payee's merchantKey */
  source?: string
  /** 0 = Sunday … 6 = Saturday */
  weekday?: number
}
/** One line of a drill-down: a transaction, or one slice of a split transaction. `amount` is signed for spending (a refund is negative). */
export interface DrillLine { txn: Transaction; category_id: string | null; amount: number; slice: boolean }

const dayOf = (iso: string) => new Date(iso + 'T12:00:00').getDay()

export function drillLines(d: Data, f: DrillFilter): DrillLine[] {
  const acct = accountLookup(d), cat = (id?: string | null) => d.categories.find(c => c.id === id)
  const tx = d.transactions.filter(t => inRange(t, f.from, f.to) && !t.duplicate_of && budgetable(t))
  let lines: DrillLine[]
  if (f.flow === 'income') {
    lines = tx.filter(t => flowOf(t, acct) === 'income').map(t => ({ txn: t, category_id: t.category_id ?? null, amount: t.amount, slice: false }))
    if (f.source !== undefined) lines = lines.filter(l => incomeSource(d, l.txn).key === f.source)
  } else {
    lines = spendLines(d, tx, acct).map(l => ({ txn: l.txn, category_id: l.category_id ?? null, amount: l.amount, slice: !!l.split }))
  }
  if (f.category !== undefined) lines = lines.filter(l => (cat(l.category_id)?.name || 'Uncategorized') === f.category)
  if (f.group !== undefined) lines = lines.filter(l => (cat(l.category_id)?.group || 'Other') === f.group)
  if (f.priority !== undefined) lines = lines.filter(l => cat(l.category_id)?.priority === f.priority)
  if (f.merchant !== undefined) lines = lines.filter(l => merchantKey(l.txn.payee) === f.merchant)
  if (f.weekday !== undefined) lines = lines.filter(l => dayOf(l.txn.date) === f.weekday)
  return lines.sort((a, b) => b.txn.date.localeCompare(a.txn.date) || Math.abs(b.amount) - Math.abs(a.amount))
}
/** Where a deposit came from — the same key Reports' Income table uses. */
export function incomeSource(d: Data, t: Transaction): { key: string; name: string } {
  const ps = t.pay_schedule_id ? d.paySchedules.find(p => p.id === t.pay_schedule_id) : undefined
  if (ps) return { key: ps.name, name: ps.name }
  const p = (t.payee || '').trim(); return p ? { key: merchantKey(p), name: p } : { key: 'Other income', name: 'Other income' }
}

export interface DrillSummary {
  total: number; count: number; average: number
  largest: DrillLine | null
  /** biggest first */
  merchants: Array<{ key: string; name: string; total: number; count: number }>
  categories: Array<{ name: string; total: number; count: number }>
  /** oldest first, every month in the range that has a line */
  months: Array<{ month: string; total: number; count: number }>
}
export function summarize(d: Data, lines: DrillLine[]): DrillSummary {
  const total = round2(lines.reduce((n, l) => n + l.amount, 0)); const count = lines.length
  const bump = <K,>(m: Map<K, { total: number; count: number }>, k: K, v: number) => { const r = m.get(k) || { total: 0, count: 0 }; r.total = round2(r.total + v); r.count++; m.set(k, r) }
  const mer = new Map<string, { total: number; count: number }>(), names = new Map<string, string>(), cats = new Map<string, { total: number; count: number }>(), mon = new Map<string, { total: number; count: number }>()
  for (const l of lines) {
    const k = merchantKey(l.txn.payee); bump(mer, k, l.amount); if (!names.has(k)) names.set(k, (l.txn.payee || 'No payee').trim() || 'No payee')
    bump(cats, d.categories.find(c => c.id === l.category_id)?.name || 'Uncategorized', l.amount); bump(mon, l.txn.date.slice(0, 7), l.amount)
  }
  const largest = lines.reduce<DrillLine | null>((b, l) => (!b || Math.abs(l.amount) > Math.abs(b.amount) ? l : b), null)
  return {
    total, count, average: count ? round2(total / count) : 0, largest,
    merchants: [...mer.entries()].map(([key, r]) => ({ key, name: names.get(key) || key, ...r })).sort((a, b) => b.total - a.total),
    categories: [...cats.entries()].map(([name, r]) => ({ name, ...r })).sort((a, b) => b.total - a.total),
    months: [...mon.entries()].map(([month, r]) => ({ month, ...r })).sort((a, b) => a.month.localeCompare(b.month)),
  }
}
/** The link that opens these transactions in the ledger. */
export const ledgerLink = (lines: DrillLine[]) => '#/transactions?ids=' + [...new Set(lines.map(l => l.txn.id))].slice(0, 400).join(',')
