// Split transactions (0.19.0). A transaction with rows in d.splits is budgeted by those rows: each slice's amount counts against the
// slice's category, and the parent's own category_id is only a display default. Everything that attributes money to categories
// (budget actuals, spending by category/group/priority, uncategorized, reports) goes through categoryLines() so the rule lives here once.
import type { Data, Transaction, TransactionSplit } from '../app/data/types'
import { round2 } from './money'

export interface CategoryLine { txn: Transaction; category_id: string | null; amount: number; split: TransactionSplit | null }

/** The slices of one transaction (sorted), or [] when it is not split. */
export function splitsFor(d: Pick<Data, 'splits'>, txnId: string): TransactionSplit[] { return (d.splits || []).filter(s => s.transaction_id === txnId).sort((a, b) => a.sort_order - b.sort_order || String(a.created_at || '').localeCompare(String(b.created_at || ''))) }
export const isSplit = (d: Pick<Data, 'splits'>, t: Transaction) => (d.splits || []).some(s => s.transaction_id === t.id)

/** One line per (transaction, category): the transaction itself when it is not split, else one line per slice. */
export function categoryLines(d: Pick<Data, 'splits'>, txns: Transaction[]): CategoryLine[] {
  const by = new Map<string, TransactionSplit[]>(); for (const s of d.splits || []) { const a = by.get(s.transaction_id); if (a) a.push(s); else by.set(s.transaction_id, [s]) }
  const out: CategoryLine[] = []
  for (const t of txns) { const ss = by.get(t.id); if (ss && ss.length) for (const s of ss) out.push({ txn: t, category_id: s.category_id || null, amount: +s.amount || 0, split: s }); else out.push({ txn: t, category_id: t.category_id || null, amount: +t.amount || 0, split: null }) }
  return out
}

/** Why a proposed set of slices cannot be saved, or null when it can. Slices must be positive and sum to the parent's amount (to the cent). */
export function validateSplits(parentAmount: number, slices: Array<{ amount: number; category_id?: string | null }>): string | null {
  if (slices.length < 2) return 'A split needs at least two lines'
  if (slices.some(s => !(+s.amount > 0))) return 'Every line needs an amount above zero'
  const total = round2(slices.reduce((n, s) => n + (+s.amount || 0), 0))
  if (Math.abs(total - round2(parentAmount)) > 0.005) return `Lines add up to $${total.toFixed(2)}, the transaction is $${round2(parentAmount).toFixed(2)} (${total > parentAmount ? '+' : '−'}$${Math.abs(round2(total - parentAmount)).toFixed(2)})`
  return null
}
/** The amount still unassigned while a split is being typed (for the editor's "remaining" line). */
export const splitRemaining = (parentAmount: number, slices: Array<{ amount: number }>) => round2(parentAmount - slices.reduce((n, s) => n + (+s.amount || 0), 0))
