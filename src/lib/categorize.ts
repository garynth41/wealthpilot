// Review uncategorized (0.31.0): everything without a category, gathered by merchant, each group with the app's best answer and how
// sure it is. Pure functions; the screen is components/ReviewUncategorized.tsx.
import type { Data, Settings, Transaction } from '../app/data/types'
import { merchantKey } from './intelligence'
import { suggest, learnRule, upsertRule, type PayeeRule, type Suggestion } from './rules'
import { isSplit } from './splits'
import { round2 } from './money'

/** A transaction that still needs a category: a purchase or a deposit (never a transfer), not void, not split into lines. */
export const needsCategory = (d: Pick<Data, 'splits'>, t: Transaction) => !t.category_id && t.kind !== 'transfer' && t.status !== 'void' && !t.duplicate_of && !isSplit(d, t)
export const uncategorizedAll = (d: Data) => d.transactions.filter(t => needsCategory(d, t))

/** New arrivals: uncategorized rows nobody has touched since they were added (a bank sync, an import, an email). A row someone has
 *  edited — including one whose category was cleared on purpose — is never filed behind their back; it waits on Review uncategorized. */
export const arrivals = (d: Data) => uncategorizedAll(d).filter(t => !!t.payee && (!t.updated_at || !t.created_at || Math.abs(Date.parse(t.updated_at) - Date.parse(t.created_at)) < 5000))

export interface ReviewGroup {
  /** merchant key + side; transactions with no payee are each their own group */
  id: string; key: string; kind: 'expense' | 'income'
  /** the payee as the newest transaction shows it */
  name: string
  txns: Transaction[]; total: number; last: string
  /** the app's answer: a category, how sure, and where it came from — or nothing */
  category_id: string | null; confidence: 'high' | 'medium' | null; how: Suggestion['how']; matched?: string
}
/** Uncategorized transactions by merchant, the most money first. */
export function reviewGroups(d: Data, s: Settings): ReviewGroup[] {
  const by = new Map<string, Transaction[]>()
  for (const t of uncategorizedAll(d)) { const k = merchantKey(t.payee); const id = (k === 'unknown' ? 'one:' + t.id : k) + '|' + t.kind; const a = by.get(id); if (a) a.push(t); else by.set(id, [t]) }
  const out: ReviewGroup[] = []
  for (const [id, list] of by) {
    const txns = list.slice().sort((a, b) => b.date.localeCompare(a.date)); const first = txns[0]; const kind = first.kind as 'expense' | 'income'
    const sg = first.payee ? suggest(d, s, { payee: first.payee, kind }) : { how: null } as Suggestion
    const ok = !!sg.category_id && d.categories.some(c => c.id === sg.category_id && !c.archived)
    out.push({ id, key: merchantKey(first.payee), kind, name: (first.payee || '').trim() || 'No payee', txns, total: round2(txns.reduce((n, t) => n + t.amount, 0)), last: first.date,
      category_id: ok ? sg.category_id! : null, confidence: ok ? sg.confidence || 'medium' : null, how: ok ? sg.how : null, matched: ok ? sg.matched : undefined })
  }
  return out.sort((a, b) => b.total - a.total || b.txns.length - a.txns.length || a.name.localeCompare(b.name))
}
/** Why the app suggests it, in a few plain words. */
export function reasonFor(g: Pick<ReviewGroup, 'how' | 'confidence' | 'matched'>): string {
  if (g.how === 'rule') return 'matches one of your rules'
  if (g.how === 'remembered') return 'remembered from your email'
  if (g.how === 'history') return g.confidence === 'high' ? 'how you filed it before' : 'how you filed it most often'
  if (g.how === 'library') return g.confidence === 'high' ? 'a merchant Cresari knows' : `looks like it${g.matched ? ` (“${g.matched}”)` : ''}`
  return ''
}
export interface Coverage { total: number; categorized: number; uncategorized: number; amount: number; pct: number }
/** How much of the ledger has a category: purchases and deposits only, over all time or since `from`. */
export function coverage(d: Data, from?: string): Coverage {
  const live = d.transactions.filter(t => t.kind !== 'transfer' && t.status !== 'void' && !t.duplicate_of && (!from || t.date >= from))
  const un = live.filter(t => needsCategory(d, t))
  return { total: live.length, categorized: live.length - un.length, uncategorized: un.length, amount: round2(un.reduce((n, t) => n + t.amount, 0)), pct: live.length ? Math.floor((live.length - un.length) / live.length * 100) : 100 }
}
/** The writes for accepting some groups: transaction ids per category, and the rules to learn (one per merchant and side). */
export function acceptPlan(groups: Array<Pick<ReviewGroup, 'key' | 'kind' | 'txns' | 'name'> & { category_id: string }>, rules: PayeeRule[], learn: boolean) {
  const byCat = new Map<string, string[]>(); let next = rules; let learned = 0
  for (const g of groups) {
    byCat.set(g.category_id, [...(byCat.get(g.category_id) || []), ...g.txns.map(t => t.id)])
    if (learn && g.key !== 'unknown') { const r = learnRule(g.name, { category_id: g.category_id }, g.kind); if (r) { next = upsertRule(next, r); learned++ } }
  }
  return { byCat: [...byCat.entries()].map(([category_id, ids]) => ({ category_id, ids })), rules: next, learned, count: groups.reduce((n, g) => n + g.txns.length, 0) }
}
