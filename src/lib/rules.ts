// Payee rules: auto-categorise transactions from any source (manual, import, email) by matching the payee.
// Rules live in household settings (settings.rules). The email engine's remembered payees (settings.finmail.rules) are still honoured as a fallback.
import type { Data, Settings, Transaction } from '../app/data/types'
import { merchantKey } from './intelligence'

import type { PayeeRule } from '../app/data/types'
export type { PayeeRule }
export type RuleMatch = PayeeRule['match']
const norm = (s?: string | null) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
/** Does this rule match the payee? Case-insensitive; `regex` is tried safely (an invalid pattern never matches). */
export function ruleMatches(r: PayeeRule, payee?: string | null, kind?: string | null): boolean {
  if (!r.enabled || !r.pattern) return false
  if (r.kind && kind && r.kind !== kind) return false
  const p = norm(payee), q = norm(r.pattern); if (!p || !q) return false
  switch (r.match) {
    case 'exact': return p === q || merchantKey(payee) === merchantKey(r.pattern)
    case 'starts': return p.startsWith(q)
    case 'regex': try { return new RegExp(r.pattern, 'i').test(payee || '') } catch { return false }
    default: return p.includes(q)
  }
}
/** First matching rule wins; longer (more specific) patterns are tried first. */
export function findRule(rules: PayeeRule[], payee?: string | null, kind?: string | null): PayeeRule | null {
  const sorted = rules.filter(r => r.enabled).slice().sort((a, b) => (b.pattern.length - a.pattern.length) || (a.created_at || '').localeCompare(b.created_at || ''))
  return sorted.find(r => ruleMatches(r, payee, kind)) || null
}
export interface Suggestion { category_id?: string | null; account_id?: string | null; payee?: string | null; exclude_from_budget?: boolean; tags?: string[]; goal_id?: string | null; rule?: PayeeRule; how: 'rule' | 'remembered' | 'history' | null }
/** The tag a rule adds when it flags a transaction for review (0.21.0); the ledger's tag filter and the Dashboard show it. */
export const REVIEW_TAG = 'review'
/** What should this transaction get? Rules first, then the email engine's remembered payee, then the most common category used for this merchant before. */
export function suggest(d: Data, s: Settings, t: Pick<Transaction, 'payee' | 'kind'>): Suggestion {
  const r = findRule(s.rules || [], t.payee, t.kind)
  if (r) { const tags = [...new Set([...(r.tags || []).map(x => x.trim().toLowerCase()).filter(Boolean), ...(r.review ? [REVIEW_TAG] : [])])]; return { category_id: r.category_id ?? undefined, account_id: r.account_id ?? undefined, payee: r.rename || undefined, exclude_from_budget: r.exclude_from_budget, tags: tags.length ? tags : undefined, goal_id: r.goal_id || undefined, rule: r, how: 'rule' } }
  const fm = s.finmail?.rules?.[emailKey(t.payee)]
  if (fm?.category) return { category_id: fm.category, account_id: fm.account || undefined, how: 'remembered' }
  const k = merchantKey(t.payee); if (k !== 'unknown') {
    const counts = new Map<string, number>(); for (const x of d.transactions) if (x.category_id && x.kind === t.kind && merchantKey(x.payee) === k) counts.set(x.category_id, (counts.get(x.category_id) || 0) + 1)
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]; if (best && best[1] >= 2) return { category_id: best[0], how: 'history' }
  }
  return { how: null }
}
/** Same normalisation the email engine uses for its remembered-payee keys. */
export const emailKey = (s?: string | null) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/\b(inc|llc|corp|pbc|co|the|services?|billing)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
/** Apply a suggestion to a transaction patch — only fills what is empty unless `force`. Returns null when nothing would change. */
export function applySuggestion(t: Partial<Transaction>, sg: Suggestion, force = false): Partial<Transaction> | null {
  const patch: Partial<Transaction> = {}
  if (sg.category_id && (force || !t.category_id)) patch.category_id = sg.category_id
  if (sg.account_id && (force || !t.account_id)) patch.account_id = sg.account_id
  if (sg.payee && sg.payee !== t.payee) patch.payee = sg.payee
  if (sg.exclude_from_budget != null && sg.exclude_from_budget !== !!t.exclude_from_budget) patch.exclude_from_budget = sg.exclude_from_budget
  if (sg.tags?.length) { const have = t.tags || []; const next = [...new Set([...have, ...sg.tags])]; if (next.length !== have.length) patch.tags = next }
  if (sg.goal_id && (force || !t.goal_id)) patch.goal_id = sg.goal_id
  return Object.keys(patch).length ? patch : null
}
/** Plan a bulk run over the ledger: which transactions would change and how. Pages show this before writing. */
export function planAutoCategorise(d: Data, s: Settings, opts: { onlyUncategorised?: boolean } = { onlyUncategorised: true }) {
  const out: Array<{ t: Transaction; patch: Partial<Transaction>; how: NonNullable<Suggestion['how']> }> = []
  for (const t of d.transactions) {
    if (t.status === 'void') continue
    const sg = suggest(d, s, t); if (!sg.how) continue
    // transfers (savings moves, card payments) only take a rule's tags and goal, never a guessed category
    if (t.kind === 'transfer') { if (sg.how !== 'rule' || !(sg.tags?.length || sg.goal_id)) continue; const patch = applySuggestion(t, { tags: sg.tags, goal_id: sg.goal_id, rule: sg.rule, how: 'rule' }); if (patch) out.push({ t, patch, how: 'rule' }); continue }
    if (opts.onlyUncategorised && t.category_id && !(sg.how === 'rule' && (sg.tags?.length || sg.goal_id))) continue
    const patch = applySuggestion(t, sg, !opts.onlyUncategorised && sg.how === 'rule'); if (patch) out.push({ t, patch, how: sg.how })
  }
  return out
}
/** Build a rule from a correction the user just made ("Kroger → Groceries"), using a pattern that is specific enough: the merchant key. */
export function learnRule(payee: string, patch: { category_id?: string | null; account_id?: string | null }, kind?: 'expense' | 'income' | null): PayeeRule | null {
  const k = merchantKey(payee); if (k === 'unknown' || (!patch.category_id && !patch.account_id)) return null
  return { id: 'r' + Math.random().toString(36).slice(2, 10), pattern: k, match: 'contains', category_id: patch.category_id ?? null, account_id: patch.account_id ?? null, kind: kind ?? null, enabled: true, hits: 0, created_at: new Date().toISOString(), source: 'learned' }
}
/** Upsert: a learned rule for the same pattern + kind replaces the old one instead of piling up. */
export function upsertRule(rules: PayeeRule[], r: PayeeRule): PayeeRule[] {
  const i = rules.findIndex(x => x.pattern === r.pattern && x.match === r.match && (x.kind ?? null) === (r.kind ?? null))
  if (i < 0) return [...rules, r]
  const next = rules.slice(); next[i] = { ...rules[i], ...r, id: rules[i].id, hits: rules[i].hits || 0 }; return next
}
/** Which existing transactions does this rule hit? (for the rules table's "matches" column) */
export function ruleHits(d: Data, r: PayeeRule) { return d.transactions.filter(t => t.status !== 'void' && t.kind !== 'transfer' && ruleMatches(r, t.payee, t.kind)).length }

/** Goal contributions to record for transactions a rule marked as goal transfers (0.21.0): one per transaction, never twice. */
export function goalLinks(d: Data, txns: Array<Pick<Transaction, 'id' | 'goal_id' | 'date' | 'amount' | 'status'>>) {
  const have = new Set(d.contributions.map(c => c.transaction_id).filter(Boolean))
  return txns.filter(t => t.goal_id && t.status !== 'void' && !have.has(t.id) && d.goals.some(g => g.id === t.goal_id)).map(t => ({ goal_id: t.goal_id!, date: t.date, amount: +t.amount || 0, transaction_id: t.id, notes: 'marked by a payee rule' }))
}

/** "Apply this to earlier ones too" (0.21.0): after a category or payee change on one row, the other rows from the same merchant that
 *  do not have it yet — newest first, within `months`. Payee renames match the old name exactly; categories match the merchant. */
export function similarEarlier(d: Data, row: Transaction, field: 'category_id' | 'payee', oldPayee: string | null | undefined, value: unknown, months = 12): Transaction[] {
  if (!row.payee && !oldPayee) return []
  const since = (() => { const x = new Date(row.date + 'T12:00:00'); x.setMonth(x.getMonth() - months); return x.toISOString().slice(0, 10) })()
  const live = d.transactions.filter(t => t.id !== row.id && t.status !== 'void' && !t.duplicate_of && t.date >= since && t.kind === row.kind)
  if (field === 'payee') { const from = norm(oldPayee); if (!from || norm(String(value)) === from) return []; return live.filter(t => norm(t.payee) === from).sort((a, b) => b.date.localeCompare(a.date)) }
  const k = merchantKey(row.payee); if (k === 'unknown' || !value) return []
  return live.filter(t => merchantKey(t.payee) === k && t.category_id !== value).sort((a, b) => b.date.localeCompare(a.date))
}
