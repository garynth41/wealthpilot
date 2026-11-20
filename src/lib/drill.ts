// Drill-down (0.30.0): the exact transactions behind a figure on a chart, table or tile.
// One rule: a drill-down uses the SAME lines the figure was built from (rangeStat's spendLines / flowOf), so the panel's total always
// equals the bar, slice or cell that was clicked — split transactions count slice by slice, refunds come off their own category,
// transactions left out of the budget and duplicates are not there. Pure functions; the panel is components/DrillDown.tsx.
import type { Data, Transaction } from '../app/data/types'
import { accountLookup, budgetable, flowOf, inRange, spendLines } from './budget'
import { categoryLines } from './splits'
import { merchantKey } from './intelligence'
import { round2 } from './money'

export interface DrillFilter {
  /** inclusive ISO dates */
  from: string; to: string
  /** which figure the lines stand behind:
   *  'spend' (default)  purchases less refunds — rangeStat, every spending chart;
   *  'income'           money in from outside;
   *  'budget'           what a budget line's Spent counts (lib/budget lineActuals): spending less refunds PLUS transfers filed under the
   *                     category — loan payments, money moved to savings — but never card payments;
   *  'purchases'        what Spending Intelligence counts per merchant (lib/intelligence merchantAnalysis): every purchase, refunds not taken off. */
  flow?: 'spend' | 'income' | 'budget' | 'purchases'
  /** a category by name; 'Uncategorized' = no category */
  category?: string
  /** every category EXCEPT these names — the "Other" part of a stacked chart */
  notCategories?: string[]
  /** with flow 'spend': also list loan payments (the "Other + loan payments" part of the Trends chart) */
  loans?: boolean
  /** a category group ('Housing', 'Food'…); 'Other' = no group */
  group?: string
  /** 'Essential' | 'Important' | 'Discretionary' */
  priority?: string
  /** a merchant by lib/intelligence merchantKey */
  merchant?: string
  /** an income source by the key Reports uses: a pay schedule's name, or a payee's merchantKey */
  source?: string
  /** 0 = Sunday … 6 = Saturday */
  weekday?: number
}
/** One line of a drill-down: a transaction, or one slice of a split transaction. `amount` is signed for spending (a refund is negative).
 *  `slice` = part of a split; `fixed` = a line that is listed but not re-filed here (a loan payment, a transfer), with the words to show. */
export interface DrillLine { txn: Transaction; category_id: string | null; amount: number; slice: boolean; fixed?: string }

const dayOf = (iso: string) => new Date(iso + 'T12:00:00').getDay()
const FIXED: Record<string, string> = { loan: 'loan payment', save: 'moved to savings', move: 'transfer' }

export function drillLines(d: Data, f: DrillFilter): DrillLine[] {
  const acct = accountLookup(d), cat = (id?: string | null) => d.categories.find(c => c.id === id)
  const inR = d.transactions.filter(t => inRange(t, f.from, f.to) && !t.duplicate_of)
  const tx = inR.filter(budgetable)
  const line = (l: { txn: Transaction; category_id?: string | null; amount: number; split?: unknown }, sign = 1, fixed?: string): DrillLine => ({ txn: l.txn, category_id: l.category_id ?? null, amount: sign * l.amount, slice: !!l.split, ...(fixed ? { fixed } : {}) })
  let lines: DrillLine[]
  if (f.flow === 'income') {
    // split deposits count slice by slice, as a budget's income lines do
    lines = categoryLines(d, tx.filter(t => flowOf(t, acct) === 'income')).map(l => line(l))
    if (f.source !== undefined) lines = lines.filter(l => incomeSource(d, l.txn).key === f.source)
  } else if (f.flow === 'budget') {
    lines = categoryLines(d, tx).flatMap(l => { const fl = flowOf(l.txn, acct); return fl === 'income' || fl === 'card' ? [] : fl === 'spend' ? [line(l)] : fl === 'refund' ? [line(l, -1)] : [line(l, 1, FIXED[fl] || 'transfer')] })
  } else if (f.flow === 'purchases') {
    lines = categoryLines(d, d.transactions.filter(t => t.kind === 'expense' && inRange(t, f.from, f.to))).map(l => line(l))
  } else {
    lines = spendLines(d, tx, acct).map(l => line(l))
  }
  const nameOf = (l: DrillLine) => cat(l.category_id)?.name || 'Uncategorized'
  if (f.category !== undefined) lines = lines.filter(l => nameOf(l) === f.category)
  if (f.notCategories) lines = lines.filter(l => !f.notCategories!.includes(nameOf(l)))
  if (f.group !== undefined) lines = lines.filter(l => (cat(l.category_id)?.group || 'Other') === f.group)
  if (f.priority !== undefined) lines = lines.filter(l => cat(l.category_id)?.priority === f.priority)
  // loan payments are counted whole and whatever their category, exactly as rangeStat's `loans` is
  if (f.loans && !f.flow) lines = lines.concat(inR.filter(t => flowOf(t, acct) === 'loan').map(t => line({ txn: t, category_id: t.category_id, amount: t.amount }, 1, FIXED.loan)))
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
/** The ids behind a set of lines, each transaction once (a split transaction has several lines). */
export const lineIds = (lines: DrillLine[]) => [...new Set(lines.map(l => l.txn.id))]
/** A ledger link carries ids in the address up to this many; a longer set is handed over by name (see LEDGER_SET) so none is dropped. */
export const LINK_MAX = 300
export const LEDGER_SET = 'cresari.ledgerSet'
/** The link that opens these transactions in the ledger. Above LINK_MAX the caller stores the ids under LEDGER_SET and the link names the set. */
export const ledgerLink = (lines: DrillLine[]) => { const ids = lineIds(lines); return '#/transactions?ids=' + (ids.length > LINK_MAX ? '@set' : ids.join(',')) }
