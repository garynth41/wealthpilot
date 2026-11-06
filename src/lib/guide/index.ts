// The guide (0.24.1): every page's help, collected from ./pages/*.ts, plus lookups and a plain search used by the help drawer and
// the Help Center. Loaded lazily (only the drawer and /help import it), so the text never weighs on the first page load.
import type { GuideCard, GuidePage, GuideTask, GuideTerm } from './types'
import { GENERAL } from './general'

const mods = import.meta.glob<Record<string, unknown>>('./pages/*.ts', { eager: true })
const isPage = (x: unknown): x is GuidePage => !!x && typeof x === 'object' && typeof (x as GuidePage).path === 'string' && Array.isArray((x as GuidePage).cards)
export const GUIDE: GuidePage[] = Object.values(mods).flatMap(m => Object.values(m)).filter(isPage).sort((a, b) => a.path.localeCompare(b.path))

export const guideFor = (path: string): GuidePage | null => GUIDE.find(p => p.path === path) || null
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
/** The guide entry for a card heading on a page: an exact title, else a `match` pattern. */
export function cardHelp(path: string, title: string): GuideCard | null {
  const p = guideFor(path); if (!p) return null; const t = norm(title)
  return p.cards.find(c => norm(c.title) === t) || p.cards.find(c => { if (!c.match) return false; try { return new RegExp(c.match, 'i').test(title) } catch { return false } }) || null
}
/** A stable anchor for a card's section (used in links and to scroll the drawer). */
export const cardAnchor = (title: string) => 'g-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export interface TermEntry extends GuideTerm { path: string | null }
/** Every glossary term across the app, A–Z, one entry per term (the first page that defines it keeps it). */
export function glossaryAll(): TermEntry[] {
  const seen = new Map<string, TermEntry>()
  for (const t of GENERAL.glossary) seen.set(norm(t.term), { ...t, path: null })
  for (const p of GUIDE) for (const t of p.glossary || []) if (!seen.has(norm(t.term))) seen.set(norm(t.term), { ...t, path: p.path })
  return [...seen.values()].sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }))
}
export interface TaskEntry extends GuideTask { path: string | null }
export const tasksAll = (): TaskEntry[] => [...GENERAL.tasks.map(t => ({ ...t, path: null })), ...GUIDE.flatMap(p => (p.tasks || []).map(t => ({ ...t, path: p.path })))]

export type Hit = { kind: 'page' | 'card' | 'task' | 'term' | 'faq'; path: string | null; title: string; snippet: string; card?: string; score: number }
const words = (q: string) => norm(q).split(/[^a-z0-9%$]+/).filter(w => w.length > 1)
/** Plain keyword search across every page, card, field, task, term and FAQ. Title matches weigh most; every word must appear. */
export function searchGuide(q: string, limit = 40): Hit[] {
  const ws = words(q); if (!ws.length) return []
  const hits: Hit[] = []
  const add = (h: Omit<Hit, 'score'>, title: string, body: string) => {
    const T = norm(title), B = norm(body); if (!ws.every(w => T.includes(w) || B.includes(w))) return
    const score = ws.reduce((n, w) => n + (T.includes(w) ? 5 : 0) + (T.startsWith(w) ? 2 : 0) + Math.min(3, B.split(w).length - 1), 0)
    hits.push({ ...h, score })
  }
  const snip = (body: string) => { const B = body.replace(/\s+/g, ' '); const i = Math.max(0, ws.map(w => B.toLowerCase().indexOf(w)).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? 0); const s = Math.max(0, i - 50); return (s ? '…' : '') + B.slice(s, s + 170) + (B.length > s + 170 ? '…' : '') }
  for (const p of GUIDE) {
    const pbody = [p.summary, ...(p.start || []), ...(p.top || []).map(f => f.term + ' ' + f.text)].join(' ')
    add({ kind: 'page', path: p.path, title: titleOf(p.path), snippet: snip(pbody) }, titleOf(p.path), pbody)
    for (const c of p.cards) { const body = [c.what, ...(c.how || []), ...(c.fields || []).map(f => f.term + ' ' + f.text), ...(c.tips || [])].join(' '); add({ kind: 'card', path: p.path, title: c.title, card: c.title, snippet: snip(body) }, c.title, body) }
    for (const t of p.tasks || []) add({ kind: 'task', path: p.path, title: t.q, snippet: snip(t.steps.join(' ')) }, t.q, t.steps.join(' '))
    for (const t of p.glossary || []) add({ kind: 'term', path: p.path, title: t.term, snippet: snip(t.def) }, t.term, t.def)
  }
  for (const t of GENERAL.tasks) add({ kind: 'task', path: null, title: t.q, snippet: snip(t.steps.join(' ')) }, t.q, t.steps.join(' '))
  for (const t of GENERAL.glossary) add({ kind: 'term', path: null, title: t.term, snippet: snip(t.def) }, t.term, t.def)
  for (const f of GENERAL.faq) add({ kind: 'faq', path: null, title: f.q, snippet: snip(f.a.join(' ')) }, f.q, f.a.join(' '))
  const rank = { term: 0, card: 1, task: 2, faq: 3, page: 4 }
  return hits.sort((a, b) => b.score - a.score || rank[a.kind] - rank[b.kind]).slice(0, limit)
}

/** Page titles, kept here (not imported from the layout) so the guide stays a plain module. Mirrors VIEWS in components/Layout.tsx. */
export const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard', '/forecast': 'Cash Flow Forecast', '/insights': 'Spending Intelligence', '/transactions': 'Transactions', '/budget': 'Budget', '/bills': 'Bills & Subscriptions',
  '/income': 'Income & Pay Periods', '/accounts': 'Account Balances', '/debts': 'Debt Payoff', '/connections': 'Cash & Account Operations', '/reconcile': 'Checkbook Reconciliation',
  '/email': 'Email Money Capture', '/investments': 'Investments & Retirement', '/tax': 'Tax Planning', '/plan': 'Plan', '/goals': 'Savings Goals', '/protection': 'Insurance & Estate',
  '/hardship': 'Hardship & Creditor Outreach', '/reports': 'Reports', '/trends': 'Trends & Analysis', '/settings': 'Settings', '/help': 'Help Center',
}
export const titleOf = (path: string | null) => (path ? PAGE_TITLES[path] || path : 'Using WealthPilot')
export { GENERAL }
export type { GuideCard, GuidePage, GuideTask, GuideTerm }
