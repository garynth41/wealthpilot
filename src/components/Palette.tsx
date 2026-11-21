// Search (0.36.0; the command palette of 0.19.0 grown into a search of everything): the box at the top of every page, Ctrl-K / Cmd-K / "/".
// It looks through pages, accounts, bills, goals and planned items by name, every transaction on file (payee, memo, category, account,
// tags, date, amount) and the activity log — lib/search.ts. Keyboard: ↑ ↓ to move, Enter to open, Esc to close.
// "See all" opens the ledger on exactly the transactions that matched, or the activity log filtered the same way.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../app/store'
import { VIEWS } from './Layout'
import { allowedPaths } from '../lib/access'
import { buildIndex, searchAll, ledgerSearchLink, type Hit } from '../lib/search'
import { useLayer, useDialogFocus, trapTab } from './ui'

const KIND: Record<Hit['kind'], string> = { page: 'Page', account: 'Account', bill: 'Bill', goal: 'Goal', planned: 'Planned', transaction: 'Transaction', activity: 'Activity', more: '' }
export function Palette({ onClose }: { onClose: () => void }) {
  const nav = useNavigate(); const data = useStore(s => s.data); const mode = useStore(s => s.mode); const modules = useStore(s => s.modules); const appAdmin = useStore(s => s.appAdmin)
  const [q, setQ] = useState(''); const [ix, setIx] = useState(0); const ref = useRef<HTMLInputElement>(null); const box = useRef<HTMLDivElement>(null)
  const pages = useMemo(() => { const ok = new Set(allowedPaths(mode === 'demo' ? null : modules).filter(p => p !== '/feedback' || appAdmin === true)); return VIEWS.filter(v => ok.has(v.path)) }, [mode, modules, appAdmin])   // Feedback & testers: the operator only
  const index = useMemo(() => buildIndex(data), [data])
  const r = useMemo(() => searchAll(q, index, data, pages), [q, index, data, pages])
  // one list for the keyboard: each group's hits, then its "see all" row
  const groups = useMemo(() => {
    const g: Array<{ label: string; hits: Hit[] }> = []
    if (r.go.length) g.push({ label: q.trim() ? 'Go to' : 'Pages', hits: r.go })
    if (r.txnTotal) g.push({ label: `Transactions · ${r.txnTotal} match${r.txnTotal === 1 ? '' : 'es'}`, hits: [...r.transactions, ...(r.txnTotal > 1 ? [{ kind: 'more' as const, key: 'more-t', title: r.txnTotal > r.transactions.length ? `See all ${r.txnTotal} transactions in the ledger` : `Open these ${r.txnTotal} in the ledger`, to: ledgerSearchLink(r.txnIds, q, typeof sessionStorage !== 'undefined' ? sessionStorage : null) }] : [])] })
    if (r.actTotal) g.push({ label: `Activity log · ${r.actTotal} match${r.actTotal === 1 ? '' : 'es'}`, hits: [...r.activity, ...(r.actTotal > r.activity.length ? [{ kind: 'more' as const, key: 'more-a', title: `See all ${r.actTotal} in the activity log`, to: `/settings?tab=activity&q=${encodeURIComponent(q.trim())}` }] : [])] })
    return g
  }, [r, q])
  const flat = useMemo(() => groups.flatMap(g => g.hits), [groups])
  useLayer(true, onClose); useDialogFocus(box, { initial: '.pal-in' }); useEffect(() => { setIx(0) }, [q])
  useEffect(() => { document.getElementById('pal-' + flat[ix]?.key)?.scrollIntoView({ block: 'nearest' }) }, [ix, flat])
  const go = (h: Hit) => { onClose(); nav(h.to) }
  const key = (e: React.KeyboardEvent) => { if (e.key === 'ArrowDown') { e.preventDefault(); setIx(i => Math.min(flat.length - 1, i + 1)) } else if (e.key === 'ArrowUp') { e.preventDefault(); setIx(i => Math.max(0, i - 1)) } else if (e.key === 'Enter') { e.preventDefault(); if (flat[ix]) go(flat[ix]) } else if (e.key === 'Escape') { e.preventDefault(); onClose() } }
  let n = -1
  return <div className="modalBack" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><div className="modal palette" role="dialog" aria-modal="true" aria-label="Search" ref={box} tabIndex={-1} onKeyDown={e => trapTab(e, box.current)}>
    <input ref={ref} className="inp pal-in" type="search" value={q} onChange={e => setQ(e.target.value)} onKeyDown={key} placeholder="Search transactions, activity, accounts, bills, goals and pages" aria-label="Search everything" aria-controls="pal-list" aria-activedescendant={flat[ix] ? 'pal-' + flat[ix].key : undefined} role="combobox" aria-expanded="true" autoComplete="off" spellCheck={false} />
    <div id="pal-list" role="listbox" aria-label="Results" className="pal-list">
      {groups.map(g => <div key={g.label} role="group" aria-label={g.label}><div className="pal-group" aria-hidden="true">{g.label}</div>
        {g.hits.map(h => { n++; const i = n; return <div key={h.key} id={'pal-' + h.key} role="option" aria-selected={i === ix} className={`pal-hit${i === ix ? ' on' : ''}${h.kind === 'more' ? ' more' : ''}`} onMouseEnter={() => setIx(i)} onMouseDown={e => { e.preventDefault(); go(h) }}>{h.kind !== 'more' && <span className="pal-kind">{KIND[h.kind]}</span>}<span className="pal-title">{h.title}{h.kind === 'more' ? ' →' : ''}</span>{h.sub && <span className="pal-sub">{h.sub}</span>}</div> })}</div>)}
      {flat.length === 0 && <div className="pal-empty">Nothing matches “{q.trim()}”. Try fewer words, a payee, an amount such as 45.20, or a date such as Nov 12.</div>}
    </div>
    <div className="pal-foot" role="status" aria-live="polite">{q.trim() ? <span className="sr-only">{r.go.length} places, {r.txnTotal} transactions and {r.actTotal} activity entries match. </span> : null}<kbd>↑</kbd><kbd>↓</kbd> move · <kbd>↵</kbd> open · <kbd>esc</kbd> close · several words narrow the search · a number finds an amount</div>
  </div></div>
}
/** The shortcut cheat-sheet (press ?). */
export const SHORTCUTS: Array<[string, string]> = [['Ctrl K  or  /', 'Search everything: transactions, the activity log, accounts, bills, goals and pages'], ['N', 'New transaction (on the Transactions page)'], ['G then D / T / B / A / F / P / R / S', 'Go to Dashboard / Transactions / Bills / Accounts / Forecast / Plan / Reports / Settings'], ['L', 'Lock the app now'], ['H', 'Hide or show amounts (privacy mode)'], ['F1', 'Help for this page'], ['Ctrl Z', 'Undo the last ledger edit'], ['[  and  ]', 'Back / forward'], ['Esc', 'Close a dialog'], ['?', 'This list']]
export function ShortcutsHelp() { return <div><table className="tbl"><caption className="sr-only">Keyboard shortcuts</caption><tbody>{SHORTCUTS.map(([k, w]) => <tr key={k}><td style={{ whiteSpace: 'nowrap' }}>{k.split('  ').map((p, i) => p === 'or' || p === 'then' || p === 'and' ? <span key={i} style={{ color: 'var(--ink-3)', margin: '0 6px' }}>{p}</span> : <kbd key={i}>{p}</kbd>)}</td><td>{w}</td></tr>)}</tbody></table><div className="note">Shortcuts are ignored while you are typing in a field.</div></div> }
