// Global search (0.36.0 — Gary, Nov 21): one box that looks through everything the household has on file.
//   Go to         pages, accounts, bills, goals and planned items, by name
//   Transactions  every transaction ever recorded — payee, memo, category (and the categories and memos of its splits), account,
//                 tags, reference, date and amount
//   Activity      the activity log — who changed what (the newest 300 entries, which is what the app loads)
// Several words narrow the search: every word has to be found somewhere in the item. A number also matches an amount: 45 finds $45.00
// to $45.99, 45.20 finds exactly that. Nothing here leaves the device; it reads what is already loaded.
// The index is built once per data change (buildIndex) so typing only scans plain strings.
import type { ActivityRow, Data, Transaction } from '../app/data/types'
import { fm2 } from './money'
import { fmtD, fmtDY, fmtDT } from './dates'
import { linkTo } from './focus'

export interface Hit { kind: 'page' | 'account' | 'bill' | 'goal' | 'planned' | 'transaction' | 'activity' | 'more'; title: string; sub?: string; to: string; key: string }
export interface PageRef { path: string; title: string; sub: string; zone: string }
export interface SearchResult {
  /** pages, accounts, bills, goals, planned items — best match first */
  go: Hit[]
  /** matching transactions, newest first (the first few), with how many match in all and the ids of every one */
  transactions: Hit[]; txnTotal: number; txnIds: string[]
  /** matching activity-log entries, newest first (the first few), and how many match */
  activity: Hit[]; actTotal: number
}
export const TXN_SHOWN = 7, ACT_SHOWN = 4, GO_SHOWN = 6
/** Lower case, accents folded, punctuation that never matters dropped; "1,850.00" is read as 1850.00. */
export const fold = (s: unknown) => String(s ?? '').replace(/(\d),(?=\d{3}(\D|$))/g, '$1').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s.$#@/&'-]/gu, ' ').replace(/\s+/g, ' ').trim()
/** The words of a query. */
export const words = (q: string) => fold(q).split(' ').filter(Boolean)
const AMOUNT = /^\$?\d[\d,]*(\.\d{1,2})?$/
/** A word that reads as money: the amount, and whether it names the cents ("45.20") or only the dollars ("45"). */
const asAmount = (w: string) => { if (!AMOUNT.test(w)) return null; const v = Number(w.replace(/[$,]/g, '')); return isFinite(v) ? { v, cents: w.includes('.') } : null }

export interface SearchIndex {
  txns: Array<{ t: Transaction; text: string; amount: number }>
  acts: Array<{ a: ActivityRow; text: string }>
  things: Array<{ hit: Hit; text: string }>
}
const TABLE_WORDS: Record<string, string> = { recurring_items: 'bill recurring', pay_schedules: 'pay income schedule', planned_items: 'planned item', net_worth_snapshots: 'net worth snapshot', budget_lines: 'budget', household_members: 'member', transaction_splits: 'split', balance_history: 'balance', forecast_snapshots: 'saved forecast' }
/** What the activity log calls a table, in plain words. */
export const tableName = (t: string) => (t || '').replace(/_/g, ' ')
export function buildIndex(d: Data): SearchIndex {
  const cat = new Map(d.categories.map(c => [c.id, c.name])), acct = new Map([...(d.off?.accounts || []), ...d.accounts].map(a => [a.id, `${a.name} ${a.institution || ''} ${a.last4 || ''}`]))
  const splits = new Map<string, string>(); for (const s of d.splits) splits.set(s.transaction_id, `${splits.get(s.transaction_id) || ''} ${cat.get(s.category_id || '') || ''} ${s.memo || ''}`)
  const txns = d.transactions.map(t => ({ t, amount: Math.abs(+t.amount || 0),
    text: fold(`${t.payee || ''} ${t.memo || ''} ${cat.get(t.category_id || '') || (t.kind === 'transfer' ? '' : 'uncategorized')} ${acct.get(t.account_id || '') || ''} ${acct.get(t.to_account_id || '') || ''} ${(t.tags || []).join(' ')} ${t.ref || ''} ${t.kind} ${t.status || ''} ${t.date} ${fmtDY(t.date)} ${splits.get(t.id) || ''}`) }))
    .sort((a, b) => b.t.date.localeCompare(a.t.date) || String(b.t.created_at || '').localeCompare(String(a.t.created_at || '')))
  const acts = (d.activity || []).map(a => ({ a, text: fold(`${a.summary || ''} ${a.action} ${a.action === 'insert' ? 'added created' : a.action === 'delete' ? 'deleted removed' : 'changed edited updated'} ${tableName(a.table_name)} ${TABLE_WORDS[a.table_name] || ''} ${a.user_email || ''} ${String(a.created_at).slice(0, 10)} ${fmtD(String(a.created_at).slice(0, 10))}`) }))
  const things: SearchIndex['things'] = []
  for (const a of d.accounts.filter(a => a.status === 'Active')) things.push({ text: fold(`${a.name} ${a.institution || ''} ${a.last4 || ''}`), hit: { kind: 'account', title: a.name, sub: `${a.institution ? a.institution + ' · ' : ''}balance ${fm2(a.balance)}`, to: linkTo('/accounts', a.id), key: 'a' + a.id } })
  for (const r of d.recurring.filter(r => r.status === 'Active')) things.push({ text: fold(`${r.name} ${r.payee || ''}`), hit: { kind: 'bill', title: r.name, sub: `${fm2(r.amount)} · ${r.frequency.replace(/_/g, ' ')}${r.next_due ? ' · next ' + fmtD(r.next_due) : ''}`, to: linkTo('/bills', r.id), key: 'b' + r.id } })
  for (const g of d.goals.filter(g => g.status === 'Active')) things.push({ text: fold(g.name), hit: { kind: 'goal', title: g.name, sub: `target ${fm2(g.target_amount)}`, to: linkTo('/goals', g.id), key: 'g' + g.id } })
  for (const p of d.planned.filter(p => p.status === 'Planned')) things.push({ text: fold(`${p.label} ${p.category || ''}`), hit: { kind: 'planned', title: p.label, sub: `${fmtD(p.date)} · ${fm2(p.amount)}`, to: '/forecast?view=long', key: 'x' + p.id } })
  return { txns, acts, things }
}
/** Does every word of the query appear? A money word may match the amount instead of the text. */
function matches(text: string, ws: string[], amount?: number): boolean {
  for (const w of ws) {
    if (text.includes(w)) continue
    const m = amount == null ? null : asAmount(w)
    if (m && (m.cents ? Math.abs(amount! - m.v) < 0.005 : Math.floor(amount! + 0.0001) === m.v)) continue
    return false
  }
  return true
}
/** How well a name fits the query: the whole name, its start, a word's start, or just somewhere in it. */
const fit = (text: string, needle: string, ws: string[]) => (text === needle ? 100 : text.startsWith(needle) ? 60 : ws.every(w => text.split(' ').some(x => x.startsWith(w))) ? 40 : ws.every(w => text.includes(w)) ? 20 : 0)
export const txnHit = (t: Transaction, names: { cat: Map<string, string>; acct: Map<string, string> }): Hit => ({ kind: 'transaction', key: 't' + t.id, to: linkTo('/transactions', t.id),
  title: `${(t.payee || '').trim() || (t.kind === 'transfer' ? 'Transfer' : 'No payee')}`,
  sub: `${fmtDY(t.date)} · ${t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : ''}${fm2(Math.abs(+t.amount || 0))} · ${names.acct.get(t.account_id || '') || 'no account'}${t.kind !== 'transfer' ? ' · ' + (names.cat.get(t.category_id || '') || 'uncategorized') : ''}` })
export const actHit = (a: ActivityRow, q: string): Hit => ({ kind: 'activity', key: 'l' + a.id, to: `/settings?tab=activity&q=${encodeURIComponent(q.trim())}`,
  title: a.summary || `${a.action} ${tableName(a.table_name)}`, sub: `${fmtDT(a.created_at)} · ${a.user_email || 'someone'} · ${a.action === 'insert' ? 'added' : a.action === 'delete' ? 'deleted' : 'changed'} ${tableName(a.table_name)}` })

/** Search everything. `pages` are the pages this person can open; transactions and the activity log are searched only when their page is among them. */
export function searchAll(q: string, ix: SearchIndex, d: Pick<Data, 'categories' | 'accounts'>, pages: PageRef[]): SearchResult {
  const needle = fold(q), ws = words(q); const paths = new Set(pages.map(p => p.path))
  const go: Array<Hit & { sc: number }> = []
  for (const v of pages) { const sc = needle ? Math.max(fit(fold(v.title), needle, ws), fit(fold(v.zone), needle, ws) / 2, ws.every(w => fold(v.sub).includes(w)) ? 8 : 0) : 1; if (sc) go.push({ kind: 'page', title: v.title, sub: v.sub, to: v.path, key: 'p' + v.path, sc }) }
  if (!needle) return { go: go.slice(0, 12), transactions: [], txnTotal: 0, txnIds: [], activity: [], actTotal: 0 }
  const kindPath: Record<string, string> = { account: '/accounts', bill: '/bills', goal: '/goals', planned: '/forecast' }
  for (const x of ix.things) { if (!paths.has(kindPath[x.hit.kind])) continue; const sc = fit(x.text, needle, ws); if (sc) go.push({ ...x.hit, sc: sc - 1 }) }
  go.sort((a, b) => b.sc - a.sc)
  const names = { cat: new Map(d.categories.map(c => [c.id, c.name])), acct: new Map(d.accounts.map(a => [a.id, a.name])) }
  const tx = paths.has('/transactions') ? ix.txns.filter(x => matches(x.text, ws, x.amount)) : []
  const ac = paths.has('/settings') ? ix.acts.filter(x => matches(x.text, ws)) : []
  return { go: go.slice(0, GO_SHOWN).map(({ sc: _sc, ...h }) => h), transactions: tx.slice(0, TXN_SHOWN).map(x => txnHit(x.t, names)), txnTotal: tx.length, txnIds: tx.map(x => x.t.id),
    activity: ac.slice(0, ACT_SHOWN).map(x => actHit(x.a, q)), actTotal: ac.length }
}
/** The activity-log entries a query matches (the Activity log's own filter uses the same rule as the global search). */
export function filterActivity(rows: ActivityRow[], q: string): ActivityRow[] {
  const ws = words(q); if (!ws.length) return rows
  const ix = buildIndex({ categories: [], accounts: [], splits: [], transactions: [], recurring: [], goals: [], planned: [], activity: rows } as unknown as Data)
  return ix.acts.filter(x => matches(x.text, ws)).map(x => x.a)
}
/** Where "See all N transactions" goes: the ledger, showing exactly the transactions that matched. Up to LINK_MAX ids ride in the
 *  address; a longer set is handed over through session storage, as drill-down does. */
export function ledgerSearchLink(ids: string[], q: string, store?: Pick<Storage, 'setItem'> | null, max = 300, key = 'cresari.ledgerSet'): string {
  const tail = `&from=search&q=${encodeURIComponent(q.trim())}`, direct = '/transactions?ids=' + ids.join(',') + tail
  if (ids.length <= max || !store) return direct
  try { store.setItem(key, JSON.stringify(ids)); return '/transactions?ids=@set' + tail } catch { return direct }
}
