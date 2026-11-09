// Drag-resizable columns for every data table (0.26.0). The shared <Table> component keeps its own React state for widths and only
// borrows `startColumnDrag`; the ~70 tables written by hand on the pages (<table class="tbl">) get their grips from `installColumnResize`,
// which adds a .colgrip to each heading cell, sets the width inline on the th while it is dragged, and remembers it per table per browser.
// Pointer events cover mouse, pen and touch alike (the grip's CSS sets touch-action:none so a finger drags instead of scrolling).
// Tables are told apart by route + caption + heading labels, so the same table keeps its widths across visits; all widths live in one
// localStorage key, capped to the newest MAX_TABLES tables so it cannot grow forever.
import { useEffect, type PointerEvent as ReactPointerEvent } from 'react'
import { LS } from '../app/config'
import './colResize.css'

export const MIN_COL_WIDTH = 48
/** Tables beyond this many (oldest first) are dropped from storage. */
export const MAX_TABLES = 200
const KEY = LS('colw')
/** The value <Table> puts in data-colresize so the scanner leaves it alone. */
export const REACT_MARK = 'react'
const DOM_MARK = 'dom'
const TABLES = `table.tbl:not([data-colresize="${REACT_MARK}"])`

type Widths = Record<string, number>
type Store = Record<string, Widths>

// ---- storage (every access guarded: private mode, a full quota or a blocked origin just means widths do not persist) ----
function readStore(): Store { try { const v: unknown = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v as Store : {} } catch { return {} } }
function writeStore(s: Store) { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* not persisted */ } }
/** The saved widths of one table ({} when none). */
export function loadWidths(key: string): Widths { const w = readStore()[key]; return w && typeof w === 'object' ? { ...w } : {} }
/** Save one table's widths (an empty set deletes it). The table moves to the newest slot; the oldest beyond MAX_TABLES fall off. */
export function saveWidths(key: string, w: Widths) {
  const s = readStore(); delete s[key]
  const clean: Widths = {}; for (const k of Object.keys(w)) { const v = w[k]; if (typeof v === 'number' && Number.isFinite(v) && v >= MIN_COL_WIDTH) clean[k] = Math.round(v) }
  if (Object.keys(clean).length) s[key] = clean
  const keys = Object.keys(s); for (let i = 0; i < keys.length - MAX_TABLES; i++) delete s[keys[i]]
  writeStore(s)
}

// ---- identity ----
/** The visible text of a heading cell (screen-reader-only text, the sort arrow, the grip and any controls left out). */
function headText(el: Element): string {
  let out = ''
  el.childNodes.forEach(n => { if (n.nodeType === 3) out += n.textContent || ''; else if (n.nodeType === 1) { const e = n as Element; if (!e.matches('.sr-only, .arrow, .colgrip, button, input, select')) out += headText(e) } })
  return out.replace(/\s+/g, ' ').trim()
}
/** The heading cells of a table's first header row (its own, not a nested table's). */
export function headerCells(table: HTMLElement): HTMLElement[] { const tr = (table as HTMLTableElement).tHead?.rows[0]; return tr ? Array.from(tr.cells).filter(c => c.tagName === 'TH') : [] }
/** The route part of the hash (the app uses a hash router): "#/accounts?focus=x" → "#/accounts". */
export function routePath(): string { return (typeof location !== 'undefined' ? location.hash || '' : '').split('?')[0] }
/** What a table is remembered by: route + caption + heading labels. Two renders of the same table give the same key. */
export function tableKey(table: HTMLElement): string {
  const cap = ((table as HTMLTableElement).caption?.textContent || '').replace(/\s+/g, ' ').trim()
  return [routePath(), cap, headerCells(table).map(headText).join('|')].join('::')
}
/** A column is remembered by its label when it has a unique one, else by its position ("#3"). */
export function colKey(ths: HTMLElement[], i: number): string { const lab = headText(ths[i]); return lab && ths.findIndex(t => headText(t) === lab) === i ? lab : '#' + i }

// ---- the drag ----
const frame = (fn: () => void): number => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : (setTimeout(fn, 16) as unknown as number)
const unframe = (id: number) => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); else clearTimeout(id) }
type AnyPointerEvent = PointerEvent | ReactPointerEvent<Element>

/** Start resizing the column headed by `th` from a pointerdown on its grip. `onWidth` gets each new width (never under MIN_COL_WIDTH)
 *  as the pointer moves; `onEnd` runs once when the pointer is lifted or the browser cancels the gesture. Mouse, pen and touch alike. */
export function startColumnDrag(th: HTMLElement, e: AnyPointerEvent, onWidth: (w: number) => void, onEnd?: () => void) {
  if (e.button > 0) return   // a secondary button does not drag
  e.preventDefault(); e.stopPropagation()
  const grip = (e.currentTarget || e.target) as HTMLElement | null
  const id = e.pointerId, startX = e.clientX, startW = th.getBoundingClientRect().width
  if (grip && typeof grip.setPointerCapture === 'function') { try { grip.setPointerCapture(id) } catch { /* not capturable: window listeners below still follow the pointer */ } }
  grip?.classList.add('active')
  const same = (ev: PointerEvent) => ev.pointerId == null || id == null || ev.pointerId === id
  const move = (ev: PointerEvent) => { if (!same(ev)) return; ev.preventDefault(); onWidth(Math.max(MIN_COL_WIDTH, Math.round(startW + ev.clientX - startX))) }
  const end = (ev: PointerEvent) => { if (!same(ev)) return; stop() }
  const stop = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end)
    grip?.classList.remove('active'); if (grip && typeof grip.releasePointerCapture === 'function') { try { grip.releasePointerCapture(id) } catch { /* already released */ } }
    onEnd?.()
  }
  window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end)
}

// ---- hand-written tables ----
function setWidth(th: HTMLElement, px: number | null) { const v = px == null ? '' : px + 'px'; th.style.width = v; th.style.minWidth = v; th.style.maxWidth = v }

/** Put every column of `table` back to its natural width and forget what was saved for it. */
export function resetColumnWidths(table: HTMLElement) { headerCells(table).forEach(th => setWidth(th, null)); saveWidths(tableKey(table), {}) }

function makeGrip(table: HTMLTableElement, th: HTMLElement): HTMLSpanElement {
  const g = document.createElement('span'); g.className = 'colgrip'; g.title = 'Drag to resize · double-click to reset'; g.setAttribute('aria-hidden', 'true')
  g.addEventListener('pointerdown', e => {
    const ths = headerCells(table), key = tableKey(table), ck = colKey(ths, ths.indexOf(th)); let last: number | null = null
    startColumnDrag(th, e, w => { last = w; setWidth(th, w) }, () => { if (last != null) saveWidths(key, { ...loadWidths(key), [ck]: last }) })
  })
  g.addEventListener('click', e => e.stopPropagation())   // the click that ends a drag must not sort the column
  g.addEventListener('dblclick', e => { e.preventDefault(); e.stopPropagation(); const ths = headerCells(table), key = tableKey(table), w = loadWidths(key); delete w[colKey(ths, ths.indexOf(th))]; saveWidths(key, w); setWidth(th, null) })
  return g
}

/** Give one table its grips (a th that already has one is left alone) and apply its saved widths. Safe to run again. */
export function prepareTable(table: HTMLTableElement) {
  if (table.getAttribute('data-colresize') === REACT_MARK) return
  const ths = headerCells(table); if (!ths.length) return   // no heading row (yet): nothing to take hold of
  if (table.getAttribute('data-colresize') !== DOM_MARK) table.setAttribute('data-colresize', DOM_MARK)
  const saved = loadWidths(tableKey(table))
  ths.forEach((th, i) => { if (!Array.from(th.children).some(c => c.classList.contains('colgrip'))) th.appendChild(makeGrip(table, th)); const w = saved[colKey(ths, i)]; if (typeof w === 'number' && w >= MIN_COL_WIDTH && th.style.width !== w + 'px') setWidth(th, w) })
}

/** Make every hand-written table.tbl under `root` resizable now, and keep watching so tables rendered later (route changes, tabs,
 *  pagination, dialogs) get grips too. Tables marked data-colresize="react" (the shared <Table>) are skipped. Returns a stop function. */
export function installColumnResize(root: HTMLElement | Document = document): () => void {
  const scan = () => root.querySelectorAll<HTMLTableElement>(TABLES).forEach(prepareTable)
  scan()
  let raf = 0; const later = () => { if (raf) return; raf = frame(() => { raf = 0; scan() }) }
  // only added elements matter (a new table, a new heading cell); the inline widths this module sets are attribute changes and are not watched
  const mo = new MutationObserver(recs => { for (const r of recs) for (const n of Array.from(r.addedNodes)) if (n.nodeType === 1) { later(); return } })
  const target = root instanceof Document ? root.documentElement : root
  mo.observe(target, { childList: true, subtree: true })
  return () => { mo.disconnect(); if (raf) { unframe(raf); raf = 0 } }
}

/** Call once in Layout: turns grips on for every hand-written table and keeps them on while the app runs. */
export function useColumnResize() { useEffect(() => installColumnResize(document), []) }
