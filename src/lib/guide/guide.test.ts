// 0.24.1 — the guide covers every page and every card on it, and the search finds things.
import { describe, it, expect } from 'vitest'
import { GUIDE, guideFor, cardHelp, glossaryAll, tasksAll, searchGuide, PAGE_TITLES, GENERAL } from './index'
import { ALL_SECTIONS } from '../reports'

// the page sources, as text (Vite raw import — no file-system access needed)
const SOURCES = import.meta.glob<string>('../../pages/*.tsx', { query: '?raw', import: 'default', eager: true })
/** Which route(s) each page file's cards appear on. */
const ROUTES: Record<string, string[]> = {
  Accounts: ['/accounts'], Allocate: ['/', '/income'], AssetsParts: ['/accounts', '/debts'], BankSync: ['/connections'], Bills: ['/bills'], Budget: ['/budget'], Connections: ['/connections'],
  Coverage: ['/connections'], Dashboard: ['/'], DashboardParts: ['/'], Debts: ['/debts'], Email: ['/email'], Forecast: ['/forecast'], Goals: ['/goals'], Hardship: ['/hardship'], Income: ['/income'],
  Insights: ['/insights'], Investments: ['/investments'], Lots: ['/investments'], Migrate: ['/connections'], Plan: ['/plan'], Protection: ['/protection'], Reconcile: ['/reconcile'], Reports: ['/reports'],
  Settings: ['/settings'], Tax: ['/tax'], Transactions: ['/transactions'], Trends: ['/trends'],
}
/** Every <Card title=…> in a page file: literal titles, the fixed text of template titles, and the string literals inside expressions. Cards with help="…" use that key. */
function cardTitles(src: string): Array<{ title: string; raw: string }> {
  const out: Array<{ title: string; raw: string }> = []
  for (const m of src.matchAll(/<Card\b((?:[^>{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)>/g)) {
    const attrs = m[1]
    const help = attrs.match(/\bhelp="([^"]+)"/); if (help) { out.push({ title: help[1], raw: 'help=' + help[1] }); continue }
    if (/\bhelp=\{false\}/.test(attrs)) continue
    const lit = attrs.match(/\btitle="([^"]+)"/); if (lit) { out.push({ title: lit[1], raw: lit[1] }); continue }
    const tpl = attrs.match(/\btitle=\{`([^`]*)`\}/); if (tpl) { out.push({ title: tpl[1].replace(/\$\{[^}]*\}/g, 'X'), raw: tpl[1] }); continue }
    const expr = attrs.match(/\btitle=\{([^]*?)\}\s*(?:\w+=|$)/); if (expr) { for (const s of expr[1].matchAll(/'([^']+)'|`([^`$]+)/g)) out.push({ title: (s[1] || s[2]).trim() + (s[2] ? 'X' : ''), raw: expr[1] }) }
  }
  return out
}

describe('the guide covers the app', () => {
  it('every page has a guide with a summary and its cards', () => {
    for (const path of Object.keys(PAGE_TITLES).filter(p => p !== '/help')) { const g = guideFor(path); expect(g, path).toBeTruthy(); expect(g!.summary.length, path).toBeGreaterThan(20); expect(g!.cards.length, path).toBeGreaterThan(0) }
    expect(new Set(GUIDE.map(p => p.path)).size).toBe(GUIDE.length)
  })
  it('every card on every page has help', () => {
    const missing: string[] = []
    for (const [file, src] of Object.entries(SOURCES)) {
      const f = file.split('/').pop()!; const name = f.replace(/\.tsx$/, ''); const routes = ROUTES[name]; const titles = cardTitles(src)
      if (!routes) { if (titles.length) missing.push(`${f}: not mapped to a route`); continue }
      for (const t of titles) if (!routes.some(r => cardHelp(r, t.title))) missing.push(`${f} → ${routes.join('/')}: "${t.raw}"`)
    }
    expect(missing).toEqual([])
  })
  it('every report section has help', () => { for (const [, title] of ALL_SECTIONS) expect(cardHelp('/reports', title), title).toBeTruthy() })
  it('every entry is complete: what each card is for, every field defined, no duplicates', () => {
    for (const p of GUIDE) {
      const seen = new Set<string>()
      for (const c of p.cards) {
        expect(c.what.length, `${p.path} ${c.title}`).toBeGreaterThan(15); expect(seen.has(c.title.toLowerCase()), `${p.path} duplicate ${c.title}`).toBe(false); seen.add(c.title.toLowerCase())
        for (const f of c.fields || []) { expect(f.term.trim().length, `${p.path} ${c.title}`).toBeGreaterThan(0); expect(f.text.length, `${p.path} ${c.title} · ${f.term}`).toBeGreaterThan(8) }
        if (c.match) expect(() => new RegExp(c.match!)).not.toThrow()
      }
      for (const t of p.tasks || []) { expect(t.q.endsWith('?'), t.q).toBe(true); expect(t.steps.length, t.q).toBeGreaterThan(0) }
      for (const l of p.links || []) expect(PAGE_TITLES[l[0]], `${p.path} links to ${l[0]}`).toBeTruthy()
    }
    for (const s of GENERAL.start) expect(PAGE_TITLES[s.to], s.to).toBeTruthy()
  })
  it('looks cards up by exact heading or pattern', () => {
    expect(cardHelp('/accounts', 'Property & vehicles')?.what).toMatch(/Homes, cars/)
    expect(cardHelp('/accounts', 'property  &  VEHICLES')).toBeTruthy()
    expect(cardHelp('/accounts', 'No such card')).toBeNull(); expect(cardHelp('/nowhere', 'Liquidity')).toBeNull()
  })
  it('the glossary is A–Z with one entry per term, and tasks are collected', () => {
    const g = glossaryAll(); const names = g.map(t => t.term.toLowerCase())
    expect(new Set(names).size).toBe(names.length); expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })))
    expect(g.find(t => t.term === 'Utilization')?.path).toBe('/accounts'); expect(g.find(t => t.term === 'Safe to spend')?.path).toBeNull()
    expect(tasksAll().length).toBeGreaterThan(GENERAL.tasks.length)
  })
  it('search finds cards, fields, tasks and terms; every word must match', () => {
    const r = searchGuide('loan to value'); expect(r[0]).toMatchObject({ path: '/accounts' })
    expect(searchGuide('utilization').some(h => h.kind === 'term' && h.title === 'Utilization')).toBe(true)
    expect(searchGuide('record credit card payment').some(h => h.kind === 'task')).toBe(true)
    expect(searchGuide('bank sync failed').some(h => h.kind === 'faq')).toBe(true)
    expect(searchGuide('zzzzqqq')).toEqual([]); expect(searchGuide('  ')).toEqual([])
  })
})
