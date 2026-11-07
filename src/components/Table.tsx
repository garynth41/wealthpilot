import { useMemo, useState, useRef, useEffect, type ReactNode } from 'react'
import { saveFile } from '../app/native'
import { parseNum, fm2 } from '../lib/money'
import { fmtD } from '../lib/dates'
import { rangeProblem } from '../lib/validate'
import { Btn } from './ui'
import { LS } from '../app/config'
import { useStore } from '../app/store'
import { useLocation } from 'react-router-dom'
import { focusIdFrom, highlight } from '../lib/focus'
import { unmasked } from '../lib/display'

/** Download rows as CSV or Excel. Values are the displayed text (labels, formatted money) so the file reads like the screen. */
export async function exportTable(name: string, headers: string[], body: Array<Array<string | number>>, fmt: 'csv' | 'xlsx') {
  const file = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}`
  if (fmt === 'csv') { const esc = (v: string | number) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t }; const text = (headers.length ? [headers, ...body] : body).map(r => r.map(esc).join(',')).join('\r\n'); await dl(new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' }), file + '.csv'); return }
  const XLSX = await import('xlsx'); const ws = XLSX.utils.aoa_to_sheet(headers.length ? [headers, ...body] : body); ws['!cols'] = headers.map((h, i) => ({ wch: Math.min(48, Math.max(h.length, ...body.map(r => String(r[i] ?? '').length)) + 2) }))
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31) || 'Sheet1'); const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer; await saveFile(file + '.xlsx', buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
}
const dl = (blob: Blob, filename: string) => saveFile(filename, blob, blob.type || 'text/csv')

/** A column. Money cells refuse negatives unless `signed` (an amount that can go either way, like a balance or a planned item's ±);
 *  `min` / `max` bound numbers; `required` cells refuse an empty value and put the old one back (0.25.1). */
export interface Col<R> { k: string; label: string; type?: 'text' | 'number' | 'money' | 'date' | 'select' | 'ro' | 'bool' | 'int'; opts?: string[]; labels?: Record<string, string>; w?: number; cls?: string; fmt?: (r: R) => ReactNode; sortVal?: (r: R) => string | number | null; min?: number; max?: number; placeholder?: string; required?: boolean; signed?: boolean }
interface Props<R extends { id: string }> { rows: R[]; cols: Col<R>[]; onChange?: (row: R, k: string, v: unknown) => void; onDelete?: (row: R) => void; onAdd?: () => void; addLabel?: string; rowCls?: (r: R) => string; foot?: ReactNode; editable?: boolean; search?: boolean; empty?: string; maxH?: number; defaultSort?: { k: string; dir: 1 | -1 }; deleteLabel?: (r: R) => string; actions?: (r: R) => ReactNode; id?: string; pageSize?: number; name?: string; exportable?: boolean; selected?: Set<string>; onSelect?: (ids: Set<string>) => void; caption?: string; /** phones (0.23.0): a sideways swipe on a card */ onSwipe?: (row: R, dir: 'left' | 'right') => void; swipeHint?: string; /** how a screen reader names one row ("Kroger, $42.50, Nov 3") — for its checkbox and delete button */ rowLabel?: (r: R) => string }
let cardsPref = (() => { try { return localStorage.getItem('wealthpilot.tblMode') || 'cards' } catch { return 'cards' } })()
/** A row's name from its usual fields: who or what, the amount, the date. */
function defaultRowLabel(r: unknown): string {
  const o = r as Record<string, unknown>
  const name = ['payee', 'name', 'label', 'entity', 'symbol', 'title', 'pattern'].map(k => o[k]).find(v => typeof v === 'string' && v.trim()) as string | undefined
  const date = ['date', 'due_date', 'next_due', 'as_of', 'statement_date'].map(k => o[k]).find(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) as string | undefined
  const amount = typeof o.amount === 'number' || (typeof o.amount === 'string' && o.amount !== '') ? fm2(o.amount as number) : ''
  return [name?.trim(), amount, date ? fmtD(date.slice(0, 10)) : ''].filter(Boolean).join(', ')
}

export function Table<R extends { id: string }>({ rows, cols, onChange, onDelete, onAdd, addLabel = 'Add', rowCls, foot, editable = true, search = true, empty = 'Nothing here yet.', maxH, defaultSort, actions, id, pageSize = 50, name = 'table', selected, onSelect, caption, exportable = true, onSwipe, swipeHint, rowLabel }: Props<R>) {
  const sw = useRef<{ id: string; x: number; y: number } | null>(null)
  const swipeProps = (r: R) => onSwipe ? { onTouchStart: (e: React.TouchEvent) => { sw.current = { id: r.id, x: e.touches[0].clientX, y: e.touches[0].clientY } }, onTouchEnd: (e: React.TouchEvent) => { const st = sw.current; sw.current = null; if (!st || st.id !== r.id) return; const t = e.changedTouches[0]; const dx = t.clientX - st.x, dy = t.clientY - st.y; if (Math.abs(dx) > 70 && Math.abs(dy) < 45) onSwipe(r, dx < 0 ? 'left' : 'right') } } : {}
  const [q, setQ] = useState(''); const [sort, setSort] = useState<{ k: string; dir: 1 | -1 } | null>(defaultSort || null); const [mode, setMode] = useState(cardsPref)
  const [page, setPage] = useState(0); const [size, setSize] = useState(pageSize); const [picker, setPicker] = useState(false)
  const prefKey = LS(`tbl.${id || name}`)
  const [hidden, setHidden] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(prefKey + '.hidden') || '[]') } catch { return [] } })
  const [widths, setWidths] = useState<Record<string, number>>(() => { try { return JSON.parse(localStorage.getItem(prefKey + '.widths') || '{}') } catch { return {} } })
  useEffect(() => { try { localStorage.setItem(prefKey + '.hidden', JSON.stringify(hidden)); localStorage.setItem(prefKey + '.widths', JSON.stringify(widths)) } catch { /* */ } }, [hidden, widths, prefKey])
  const visCols = useMemo(() => cols.filter(c => !hidden.includes(c.k)), [cols, hidden])
  useEffect(() => { setPage(0) }, [q, rows.length, size])
  const focusId = focusIdFrom(useLocation().search)
  const drag = useRef<{ k: string; x: number; w: number } | null>(null)
  const onDragStart = (k: string, e: React.MouseEvent<HTMLSpanElement>) => { e.preventDefault(); e.stopPropagation(); const th = (e.target as HTMLElement).closest('th') as HTMLElement; drag.current = { k, x: e.clientX, w: th.getBoundingClientRect().width }
    const move = (ev: MouseEvent) => { if (!drag.current) return; setWidths(w => ({ ...w, [drag.current!.k]: Math.max(48, Math.round(drag.current!.w + ev.clientX - drag.current!.x)) })) }
    const up = () => { drag.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }; window.addEventListener('mousemove', move); window.addEventListener('mouseup', up) }
  const autoFit = () => setWidths({})
  const get = (r: R, k: string) => (r as unknown as Record<string, unknown>)[k]
  const shown = useMemo(() => {
    let out = rows
    if (q.trim()) { const needle = q.trim().toLowerCase(); out = out.filter(r => cols.some(c => { const v = c.fmt ? textOf(c.fmt(r)) : c.labels ? c.labels[String(get(r, c.k) ?? '')] ?? get(r, c.k) : get(r, c.k); return String(v ?? '').toLowerCase().includes(needle) })) }
    if (sort) { const c = cols.find(x => x.k === sort.k); const sv = (r: R) => { if (c?.sortVal) return c.sortVal(r); const v = get(r, sort.k); if (c?.type === 'select' && c.opts) return c.opts.indexOf(String(v)); return v == null || v === '' ? null : (typeof v === 'number' ? v : String(v).toLowerCase()) }
      out = out.slice().sort((a, b) => { const x = sv(a), y = sv(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * sort.dir }) }
    return out
  }, [rows, q, sort, cols])
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width:900px)').matches
  // An edit the table or the store refused leaves the cell showing what was typed; bumping the cell's key re-mounts it with the saved value.
  const nonces = useRef(new Map<string, number>()); const [, rerender] = useState(0)
  const nonce = (r: R, c: Col<R>) => nonces.current.get(r.id + '\u0000' + c.k) || 0
  const resync = (r: R, c: Col<R>) => { const k = r.id + '\u0000' + c.k; nonces.current.set(k, (nonces.current.get(k) || 0) + 1); rerender(n => n + 1) }
  const refuse = (msg: string) => useStore.getState().toast(msg + ' Nothing was changed.', true)
  const send = (r: R, c: Col<R>, v: unknown) => { onChange?.(r, c.k, v); resync(r, c) }
  const nameOf = (r: R) => (rowLabel ? rowLabel(r) : defaultRowLabel(r)) || 'this row'
  const cell = (r: R, c: Col<R>) => {
    const v = get(r, c.k); const mw = isMobile ? undefined : c.w; const key = String(v ?? '') + '|' + nonce(r, c)
    if (c.type === 'ro' || !editable || !onChange) return c.fmt ? c.fmt(r) : c.type === 'money' ? fm2(v as number) : c.type === 'bool' ? (v ? 'Yes' : '') : c.labels ? c.labels[String(v ?? '')] ?? String(v ?? '') : String(v ?? '')
    if (c.type === 'select') return <select aria-label={c.label} value={String(v ?? '')} onChange={e => onChange(r, c.k, e.target.value === '' ? null : e.target.value)} style={{ minWidth: mw, maxWidth: '100%', width: isMobile ? '100%' : undefined }}>{(c.opts || []).map(o => <option key={o} value={o}>{c.labels ? c.labels[o] ?? o : o}</option>)}</select>
    if (c.type === 'bool') return <input type="checkbox" aria-label={c.label} checked={!!v} onChange={e => onChange(r, c.k, e.target.checked)} />
    // a date that is cleared (Backspace, the picker's Clear) is only saved where the column may be empty; a required one gets its date back
    if (c.type === 'date') return <input type="date" aria-label={c.label} aria-required={c.required || undefined} defaultValue={String(v ?? '').slice(0, 10)} key={key} onBlur={e => { const nv = e.target.value || null; if (nv === (v ?? null)) return; if (!nv && c.required) { e.target.value = String(v ?? '').slice(0, 10); refuse(`${c.label} cannot be empty.`); return } send(r, c, nv) }} />
    if (c.type === 'number' || c.type === 'money' || c.type === 'int') {
      const min = c.min ?? (c.type === 'money' && !c.signed ? 0 : undefined)
      return <input className="num" aria-label={c.label} aria-required={c.required || undefined} inputMode="decimal" defaultValue={v == null || v === '' ? '' : c.type === 'money' ? (+v).toFixed(2) : String(v)} key={key} placeholder={c.placeholder} style={{ width: isMobile ? '100%' : c.w || 96 }} onBlur={e => {
        const raw = e.target.value.trim(); const back = () => { e.target.value = v == null || v === '' ? '' : c.type === 'money' ? (+v).toFixed(2) : String(v) }
        let nv = raw === '' ? null : parseNum(raw)
        if (raw !== '' && nv == null) { back(); refuse(`“${raw.slice(0, 20)}” is not a number.`); return }
        if (nv == null && c.required) { back(); refuse(`${c.label} cannot be empty.`); return }
        if (nv != null) { if (c.type === 'int') nv = Math.round(nv); if (c.type === 'money') nv = Math.round(nv * 100) / 100
          const p = rangeProblem(c.label, nv, min, c.max); if (p) { back(); refuse(p + (min === 0 && c.type === 'money' && c.min == null ? ' Amounts here are always positive.' : '')); return } }
        if (nv !== (v == null || v === '' ? null : +v)) send(r, c, nv) }} />
    }
    return <input aria-label={c.label} aria-required={c.required || undefined} defaultValue={String(v ?? '')} key={key} placeholder={c.placeholder} style={{ minWidth: mw }} onBlur={e => { const nv = e.target.value; if (nv === String(v ?? '')) return; if (c.required && !nv.trim()) { e.target.value = String(v ?? ''); refuse(`${c.label} cannot be empty.`); return } send(r, c, nv) }} />
  }
  const text = (r: R, c: Col<R>): string | number => { const v = get(r, c.k); if (c.fmt) return textOf(c.fmt(r)); if (c.type === 'money') return v == null || v === '' ? '' : +(v as number); if (c.type === 'bool') return v ? 'Yes' : ''; if (c.labels) return c.labels[String(v ?? '')] ?? String(v ?? ''); return v == null ? '' : typeof v === 'number' ? v : String(v) }
  const doExport = (f: 'csv' | 'xlsx') => exportTable(name, visCols.map(c => c.label || c.k), unmasked(() => shown.map(r => visCols.map(c => text(r, c)))), f)   // files keep real figures in privacy mode
  const pages = Math.max(1, Math.ceil(shown.length / size)); const pageRows = shown.slice(page * size, page * size + size); const paged = shown.length > size
  // row selection (0.19.0): a checkbox per row; the header box selects every row that matches the current search, across pages
  const selectable = !!onSelect; const sel = selected || new Set<string>(); const allShownOn = shown.length > 0 && shown.every(r => sel.has(r.id))
  const toggleOne = (id: string) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); onSelect?.(n) }
  const toggleAll = () => { const n = new Set(sel); if (allShownOn) shown.forEach(r => n.delete(r.id)); else shown.forEach(r => n.add(r.id)); onSelect?.(n) }
  const rowBox = (r: R) => selectable ? <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggleOne(r.id)} aria-label={`Select ${nameOf(r)}`} /> : null
  // a link that points at one row: open its page, then pulse it
  const focusIx = focusId ? shown.findIndex(r => r.id === focusId) : -1
  useEffect(() => { if (focusIx >= 0) { const pg = Math.floor(focusIx / size); if (pg !== page) setPage(pg); else setTimeout(() => highlight(focusId!), 50) } }, [focusIx, size, page, focusId])
  const pager = paged ? <div className="pager"><span className="note" style={{ margin: 0 }}>Rows {page * size + 1}–{Math.min(shown.length, (page + 1) * size)} of {shown.length}</span><span className="btnrow"><Btn sm disabled={page === 0} onClick={() => setPage(0)} aria-label="First page">«</Btn><Btn sm disabled={page === 0} onClick={() => setPage(p => p - 1)} aria-label="Previous page">‹</Btn><span className="note" style={{ margin: '0 4px' }}>page {page + 1} / {pages}</span><Btn sm disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)} aria-label="Next page">›</Btn><Btn sm disabled={page >= pages - 1} onClick={() => setPage(pages - 1)} aria-label="Last page">»</Btn></span><select className="inp" style={{ width: 'auto', padding: '4px 6px' }} value={size} onChange={e => setSize(+e.target.value)} aria-label="Rows per page">{[25, 50, 100, 250, 1000].map(n => <option key={n} value={n}>{n} / page</option>)}</select></div> : null
  const head = <div className="tblhead"><span className="n">{shown.length} row{shown.length === 1 ? '' : 's'}</span><span className="sp" />{search && rows.length > 5 && <input className="inp" style={{ width: 200 }} placeholder="Search this table…" aria-label="Search this table" value={q} onChange={e => setQ(e.target.value)} />}{isMobile && <Btn sm onClick={() => { cardsPref = mode === 'cards' ? 'table' : 'cards'; try { localStorage.setItem('wealthpilot.tblMode', cardsPref) } catch { /* */ } setMode(cardsPref) }}>{mode === 'cards' ? '▦ Table' : '▤ Cards'}</Btn>}{exportable && rows.length > 0 && <span className="btnrow"><Btn sm title="Download these rows as CSV" onClick={() => doExport('csv')}>CSV</Btn><Btn sm title="Download these rows as an Excel workbook" onClick={() => doExport('xlsx')}>Excel</Btn></span>}{!isMobile && <span style={{ position: 'relative' }}><Btn sm title="Choose columns" onClick={() => setPicker(p => !p)}>⚙ Columns</Btn>{picker && <div className="colpicker">{cols.map(c => <label key={c.k}><input type="checkbox" checked={!hidden.includes(c.k)} onChange={e => setHidden(h => e.target.checked ? h.filter(x => x !== c.k) : [...h, c.k])} /> {c.label || c.k}</label>)}<div className="btnrow" style={{ marginTop: 6 }}><Btn sm onClick={() => { setHidden([]); autoFit() }}>Reset</Btn><Btn sm onClick={autoFit}>Auto-fit widths</Btn></div></div>}</span>}{onAdd && editable && <Btn sm onClick={onAdd}>+ {addLabel}</Btn>}</div>
  if (!shown.length) return <div id={id}>{head}<div className="empty">{q ? 'No rows match.' : empty}</div></div>
  // phones: one card per row, every value and action visible without scrolling sideways
  if (isMobile && mode === 'cards') return <div id={id}>{head}{onSwipe && swipeHint && <div className="note swipehint">{swipeHint}</div>}<div className="stack">{pageRows.map((r, i) => <div key={r.id} data-id={r.id} {...swipeProps(r)} className="card tcard" style={{ boxShadow: `inset 3px 0 0 var(--${(rowCls?.(r) || '').replace('st-', '').split(' ')[0] || 'line'})` }}><div className="tcard-top"><span className="tcard-n">{rowBox(r)}#{page * size + i + 1}</span>{onDelete && editable && <button type="button" className="del" onClick={() => onDelete(r)} aria-label={`Delete ${nameOf(r)}`}>✕</button>}</div>{visCols.map(c => <div key={c.k} className={`tcard-row${c.type !== 'ro' && editable && onChange && c.type !== 'bool' ? ' ctl' : ''}`}><span className="tcard-l">{c.label}</span><span className="tcard-v">{cell(r, c)}</span></div>)}{actions && <div className="btnrow tcard-act">{actions(r)}</div>}</div>)}</div>{pager}</div>
  return <div id={id}>{head}<div className="tblwrap tblwrap-grid" style={maxH ? { maxHeight: maxH } : undefined}><table className="tbl tbl-grid">{(caption || name !== 'table') && <caption className="sr-only">{caption || name}</caption>}<thead><tr>{selectable && <th style={{ width: 34 }}><input type="checkbox" checked={allShownOn} onChange={toggleAll} aria-label={allShownOn ? 'Clear selection' : `Select all ${shown.length} rows`} title={allShownOn ? 'Clear selection' : `Select all ${shown.length} matching rows`} /></th>}<th style={{ width: 36 }} scope="col">#</th>{visCols.map(c => <th key={c.k} scope="col" aria-sort={sort?.k === c.k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={c.cls} style={widths[c.k] ? { width: widths[c.k], minWidth: widths[c.k], maxWidth: widths[c.k] } : undefined} onClick={() => setSort(s => s && s.k === c.k ? (s.dir === 1 ? { k: c.k, dir: -1 } : null) : { k: c.k, dir: 1 })}>{c.label}{sort?.k === c.k && <span className="arrow">{sort.dir === 1 ? '▲' : '▼'}</span>}<span className="colgrip" onMouseDown={e => onDragStart(c.k, e)} title="Drag to resize" /></th>)}{actions && <th>Actions</th>}{onDelete && editable && <th><span className="sr-only">Delete</span></th>}</tr></thead>
    <tbody>{pageRows.map((r, i) => <tr key={r.id} data-id={r.id} className={(rowCls?.(r) || '') + (sel.has(r.id) ? ' is-selected' : '')}>{selectable && <td>{rowBox(r)}</td>}<td className="rn">{page * size + i + 1}</td>{visCols.map(c => <td key={c.k} className={c.cls} style={widths[c.k] ? { maxWidth: widths[c.k], overflow: 'hidden', textOverflow: 'ellipsis' } : undefined}>{cell(r, c)}</td>)}{actions && <td><span className="btnrow">{actions(r)}</span></td>}{onDelete && editable && <td><button type="button" className="del" onClick={() => onDelete(r)} aria-label={`Delete ${nameOf(r)}`} title="Delete">✕</button></td>}</tr>)}</tbody>{foot && <tfoot>{foot}</tfoot>}</table></div>{pager}</div>
}
function textOf(n: ReactNode): string { if (n == null || typeof n === 'boolean') return ''; if (typeof n === 'string' || typeof n === 'number') return String(n); if (Array.isArray(n)) return n.map(textOf).join(' '); if (typeof n === 'object' && 'props' in n) return textOf((n as { props: { children?: ReactNode } }).props.children); return '' }
