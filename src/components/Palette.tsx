// Command palette (0.19.0): Ctrl-K / Cmd-K / "/" — jump to a page, an account, a payee, a bill or a goal; type an amount to find a transaction.
// Keyboard: ↑ ↓ to move, Enter to open, Esc to close. Everything it lists already exists on a page; it only gets you there faster.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../app/store'
import { VIEWS } from './Layout'
import { linkTo } from '../lib/focus'
import { fm2 } from '../lib/money'
import { fmtD } from '../lib/dates'
import { merchantKey } from '../lib/intelligence'
import { allowedPaths } from '../lib/access'

export interface Hit { kind: 'page' | 'account' | 'payee' | 'bill' | 'goal' | 'transaction' | 'action'; title: string; sub?: string; to: string; key: string }
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s.$-]/g, ' ').trim()
/** Rank candidates for a query: pages, then accounts, bills, goals, payees and (for a number) matching transaction amounts. */
export function search(q: string, data: ReturnType<typeof useStore.getState>['data'], visiblePaths: Set<string>): Hit[] {
  const needle = norm(q); const out: Hit[] = []
  const score = (text: string) => { const t = norm(text); if (!needle) return 1; if (t === needle) return 100; if (t.startsWith(needle)) return 60; const words = needle.split(/\s+/); if (words.every(w => t.includes(w))) return 30; return 0 }
  for (const v of VIEWS) if (visiblePaths.has(v.path)) { const sc = Math.max(score(v.title), score(v.zone) / 2, score(v.sub) / 4); if (sc) out.push({ kind: 'page', title: v.title, sub: v.sub, to: v.path, key: 'p' + v.path, ...( { sc } as object) }) }
  if (needle) {
    for (const a of data.accounts.filter(a => a.status === 'Active')) { const sc = score(a.name + ' ' + (a.institution || '')); if (sc) out.push({ kind: 'account', title: a.name, sub: `${a.institution || ''} · balance ${fm2(a.balance)}`, to: linkTo('/accounts', a.id), key: 'a' + a.id, ...( { sc } as object) }) }
    for (const r of data.recurring.filter(r => r.status === 'Active')) { const sc = score(r.name + ' ' + (r.payee || '')); if (sc) out.push({ kind: 'bill', title: r.name, sub: `${fm2(r.amount)} · ${r.frequency.replace(/_/g, ' ')}${r.next_due ? ' · next ' + fmtD(r.next_due) : ''}`, to: linkTo('/bills', r.id), key: 'b' + r.id, ...( { sc } as object) }) }
    for (const g of data.goals.filter(g => g.status === 'Active')) { const sc = score(g.name); if (sc) out.push({ kind: 'goal', title: g.name, sub: `target ${fm2(g.target_amount)}`, to: linkTo('/goals', g.id), key: 'g' + g.id, ...( { sc } as object) }) }
    const seen = new Set<string>()
    for (const t of data.transactions.slice().sort((a, b) => b.date.localeCompare(a.date))) { if (!t.payee) continue; const k = merchantKey(t.payee); if (seen.has(k)) continue; const sc = score(t.payee); if (sc) { seen.add(k); out.push({ kind: 'payee', title: t.payee.trim(), sub: `last ${fmtD(t.date)} · ${fm2(t.amount)}`, to: linkTo('/transactions', t.id), key: 'y' + k, ...( { sc } as object) }) } if (seen.size > 8) break }
    const amt = Number(needle.replace(/[$,]/g, '')); if (isFinite(amt) && amt > 0 && /^\$?[\d,]+(\.\d{1,2})?$/.test(needle)) { for (const t of data.transactions.filter(t => Math.abs(t.amount - amt) < 0.005).slice(0, 6)) out.push({ kind: 'transaction', title: `${fm2(t.amount)} · ${t.payee || 'no payee'}`, sub: fmtD(t.date), to: linkTo('/transactions', t.id), key: 't' + t.id, ...( { sc: 50 } as object) }) }
  }
  return (out as Array<Hit & { sc: number }>).sort((a, b) => b.sc - a.sc).slice(0, 12)
}
export function Palette({ onClose }: { onClose: () => void }) {
  const nav = useNavigate(); const data = useStore(s => s.data); const mode = useStore(s => s.mode); const modules = useStore(s => s.modules)
  const [q, setQ] = useState(''); const [ix, setIx] = useState(0); const ref = useRef<HTMLInputElement>(null)
  const visible = useMemo(() => new Set(allowedPaths(mode === 'demo' ? null : modules)), [mode, modules])
  const hits = useMemo(() => search(q, data, visible), [q, data, visible])
  useEffect(() => { ref.current?.focus() }, []); useEffect(() => { setIx(0) }, [q])
  const go = (h: Hit) => { onClose(); nav(h.to) }
  const key = (e: React.KeyboardEvent) => { if (e.key === 'ArrowDown') { e.preventDefault(); setIx(i => Math.min(hits.length - 1, i + 1)) } else if (e.key === 'ArrowUp') { e.preventDefault(); setIx(i => Math.max(0, i - 1)) } else if (e.key === 'Enter') { e.preventDefault(); if (hits[ix]) go(hits[ix]) } else if (e.key === 'Escape') onClose() }
  return <div className="modalBack" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><div className="modal palette" role="dialog" aria-label="Go to">
    <input ref={ref} className="inp pal-in" value={q} onChange={e => setQ(e.target.value)} onKeyDown={key} placeholder="Jump to a page, account, bill, goal or payee — or type an amount" aria-label="Search" aria-controls="pal-list" aria-activedescendant={hits[ix] ? 'pal-' + hits[ix].key : undefined} role="combobox" aria-expanded="true" />
    <ul id="pal-list" role="listbox" className="pal-list">{hits.map((h, i) => <li key={h.key} id={'pal-' + h.key} role="option" aria-selected={i === ix} className={i === ix ? 'on' : ''} onMouseEnter={() => setIx(i)} onMouseDown={e => { e.preventDefault(); go(h) }}><span className="pal-kind">{h.kind}</span><span className="pal-title">{h.title}</span>{h.sub && <span className="pal-sub">{h.sub}</span>}</li>)}{hits.length === 0 && <li className="pal-empty">Nothing matches.</li>}</ul>
    <div className="pal-foot"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>↵</kbd> open · <kbd>esc</kbd> close · <kbd>?</kbd> all shortcuts</div>
  </div></div>
}
/** The shortcut cheat-sheet (press ?). */
export const SHORTCUTS: Array<[string, string]> = [['Ctrl K  or  /', 'Jump to a page, account, bill, goal or payee'], ['N', 'New transaction (on the Transactions page)'], ['G then D / T / B / A / F / P / R / S', 'Go to Dashboard / Transactions / Bills / Accounts / Forecast / Plan / Reports / Settings'], ['L', 'Lock the app now'], ['Ctrl Z', 'Undo the last ledger edit'], ['[  and  ]', 'Back / forward'], ['Esc', 'Close a dialog'], ['?', 'This list']]
export function ShortcutsHelp() { return <div><table className="tbl"><caption className="sr-only">Keyboard shortcuts</caption><tbody>{SHORTCUTS.map(([k, w]) => <tr key={k}><td style={{ whiteSpace: 'nowrap' }}>{k.split('  ').map((p, i) => p === 'or' || p === 'then' || p === 'and' ? <span key={i} style={{ color: 'var(--ink-3)', margin: '0 6px' }}>{p}</span> : <kbd key={i}>{p}</kbd>)}</td><td>{w}</td></tr>)}</tbody></table><div className="note">Shortcuts are ignored while you are typing in a field.</div></div> }
