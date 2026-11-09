// Column resizing (0.26.0): table identity, saved widths, reset, and the pointer drag itself.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tableKey, colKey, headerCells, loadWidths, saveWidths, resetColumnWidths, startColumnDrag, installColumnResize, prepareTable, MIN_COL_WIDTH, MAX_TABLES } from './colResize'
import { LS } from '../app/config'

const KEY = LS('colw')
const html = (cap: string, heads: string[], cls = 'tbl') => `<div class="tblwrap"><table class="${cls}">${cap ? `<caption class="sr-only">${cap}</caption>` : ''}<thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody><tr>${heads.map(() => '<td>x</td>').join('')}</tr></tbody></table></div>`
function mount(cap: string, heads: string[], cls?: string): HTMLTableElement { const d = document.createElement('div'); d.innerHTML = html(cap, heads, cls); document.body.appendChild(d); return d.querySelector('table')! }
const pe = (type: string, init: PointerEventInit & { clientX?: number }) => { const E = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent; return new E(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, ...init } as PointerEventInit) as PointerEvent }
const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()))
const stored = () => JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, Record<string, number>>

let stop: (() => void) | null = null
beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; location.hash = '#/accounts?focus=abc' })
afterEach(() => { stop?.(); stop = null })

describe('table identity', () => {
  it('is the route (without the query), the caption and the heading labels, and is stable across renders', () => {
    const a = mount('Saved scores', ['Date', 'Whose', 'Score', ''])
    const k = tableKey(a)
    expect(k).toBe('#/accounts::Saved scores::Date|Whose|Score|')
    a.parentElement!.remove()
    expect(tableKey(mount('Saved scores', ['Date', 'Whose', 'Score', '']))).toBe(k)
    location.hash = '#/accounts?focus=zzz&tab=2'
    expect(tableKey(a)).toBe(k)   // the query part of the hash does not matter
  })
  it('differs by route, caption and headings; grips and sort arrows do not count as label text', () => {
    const a = mount('A', ['Date', 'Amount']); const b = mount('B', ['Date', 'Amount']); const c = mount('A', ['Date', 'Balance'])
    expect(tableKey(a)).not.toBe(tableKey(b)); expect(tableKey(a)).not.toBe(tableKey(c))
    const k = tableKey(a); prepareTable(a); headerCells(a)[0].insertAdjacentHTML('beforeend', '<span class="arrow">▲</span><span class="sr-only">sorted</span>')
    expect(tableKey(a)).toBe(k)
  })
  it('names a column by its label when unique, else by its position', () => {
    const t = mount('', ['Date', 'Amount', '', 'Amount', ''])
    const ths = headerCells(t)
    expect(ths.map((_, i) => colKey(ths, i))).toEqual(['Date', 'Amount', '#2', '#3', '#4'])
  })
})

describe('saved widths', () => {
  it('persist in one key, reload, and drop the oldest tables past the cap', () => {
    saveWidths('t1', { Date: 120, Amount: 90 })
    expect(loadWidths('t1')).toEqual({ Date: 120, Amount: 90 })
    expect(Object.keys(stored())).toEqual(['t1'])
    saveWidths('t1', { Date: 130 })                       // a save replaces the table's entry
    expect(loadWidths('t1')).toEqual({ Date: 130 })
    saveWidths('t1', { Date: 10, Amount: Number.NaN })    // nothing under the minimum or not a number is kept
    expect(loadWidths('t1')).toEqual({}); expect(stored().t1).toBeUndefined()
    for (let i = 0; i < MAX_TABLES + 5; i++) saveWidths('t' + i, { a: 100 + i })
    const keys = Object.keys(stored()); expect(keys.length).toBe(MAX_TABLES); expect(keys[0]).toBe('t5'); expect(keys.at(-1)).toBe('t' + (MAX_TABLES + 4))
    saveWidths('t5', { a: 999 }); expect(Object.keys(stored()).at(-1)).toBe('t5')   // touching a table makes it the newest
  })
  it('survive garbage in storage', () => {
    localStorage.setItem(KEY, '{not json'); expect(loadWidths('x')).toEqual({})
    localStorage.setItem(KEY, '[1,2]'); expect(loadWidths('x')).toEqual({})
    saveWidths('x', { a: 60 }); expect(loadWidths('x')).toEqual({ a: 60 })
  })
})

describe('startColumnDrag', () => {
  function th(width: number): HTMLElement { const t = mount('', ['Payee']); const el = headerCells(t)[0]; el.getBoundingClientRect = () => ({ width, height: 30, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 30, toJSON() { return {} } }); return el }
  it('reports the start width plus the pointer movement, never under the minimum, and stops at pointerup', () => {
    const el = th(200); const grip = document.createElement('span'); el.appendChild(grip)
    const seen: number[] = []; let ended = 0
    grip.addEventListener('pointerdown', e => startColumnDrag(el, e, w => seen.push(w), () => ended++))
    grip.dispatchEvent(pe('pointerdown', { clientX: 100 }))
    expect(grip.classList.contains('active')).toBe(true)
    window.dispatchEvent(pe('pointermove', { clientX: 130 }))
    window.dispatchEvent(pe('pointermove', { clientX: 95 }))
    window.dispatchEvent(pe('pointermove', { clientX: -500 }))
    expect(seen).toEqual([230, 195, MIN_COL_WIDTH])
    window.dispatchEvent(pe('pointerup', { clientX: -500 }))
    expect(ended).toBe(1); expect(grip.classList.contains('active')).toBe(false)
    window.dispatchEvent(pe('pointermove', { clientX: 300 }))
    expect(seen.length).toBe(3)
  })
  it('ends on pointercancel too (a touch the browser takes over) and ignores a secondary button', () => {
    const el = th(100); const grip = document.createElement('span'); el.appendChild(grip)
    const seen: number[] = []; let ended = 0
    grip.addEventListener('pointerdown', e => startColumnDrag(el, e, w => seen.push(w), () => ended++))
    grip.dispatchEvent(pe('pointerdown', { clientX: 0, button: 2 }))
    window.dispatchEvent(pe('pointermove', { clientX: 50 })); expect(seen).toEqual([])
    grip.dispatchEvent(pe('pointerdown', { clientX: 0 }))
    window.dispatchEvent(pe('pointermove', { clientX: 50 })); expect(seen).toEqual([150])
    window.dispatchEvent(pe('pointercancel', { clientX: 50 })); expect(ended).toBe(1)
  })
})

describe('installColumnResize', () => {
  it('adds one grip per heading, sets and saves the width on drag, reloads it, and clears on reset', async () => {
    const t = mount('Saved scores', ['Date', 'Whose', 'Score'])
    headerCells(t)[0].getBoundingClientRect = () => ({ width: 80 } as DOMRect)
    stop = installColumnResize(document)
    expect(t.getAttribute('data-colresize')).toBe('dom')
    const grips = t.querySelectorAll('th > .colgrip'); expect(grips.length).toBe(3)
    stop(); stop = installColumnResize(document); expect(t.querySelectorAll('th > .colgrip').length).toBe(3)   // installing again adds nothing
    let sorted = 0; headerCells(t)[0].addEventListener('click', () => sorted++)
    grips[0].dispatchEvent(pe('pointerdown', { clientX: 10 }))
    window.dispatchEvent(pe('pointermove', { clientX: 60 }))
    expect(headerCells(t)[0].style.width).toBe('130px'); expect(headerCells(t)[0].style.minWidth).toBe('130px'); expect(headerCells(t)[0].style.maxWidth).toBe('130px')
    expect(stored()).toEqual({})                                                        // saved when the pointer lifts, not on every move
    window.dispatchEvent(pe('pointerup', { clientX: 60 }))
    grips[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); expect(sorted).toBe(0)   // the click that ends a drag does not sort
    const key = tableKey(t); expect(stored()).toEqual({ [key]: { Date: 130 } })
    // the same table rendered again (a route change, a re-render) comes back at the saved width once the observer has seen it
    t.parentElement!.remove(); const t2 = mount('Saved scores', ['Date', 'Whose', 'Score']); await frame(); await frame()
    expect(t2.getAttribute('data-colresize')).toBe('dom'); expect(headerCells(t2)[0].style.width).toBe('130px'); expect(headerCells(t2)[1].style.width).toBe('')
    // double-click on a grip puts that column back and forgets it
    t2.querySelector('th > .colgrip')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    expect(headerCells(t2)[0].style.width).toBe(''); expect(stored()).toEqual({})
    // resetColumnWidths clears every column and the saved entry
    saveWidths(key, { Date: 99, Score: 77 }); prepareTable(t2); expect(headerCells(t2)[2].style.width).toBe('77px')
    resetColumnWidths(t2); expect(headerCells(t2).map(h => h.style.width)).toEqual(['', '', '']); expect(stored()).toEqual({})
  })
  it('leaves the shared <Table> (data-colresize="react") and tables without a heading row alone', async () => {
    const d = document.createElement('div'); d.innerHTML = '<table class="tbl tbl-grid" data-colresize="react"><thead><tr><th>A</th></tr></thead></table><table class="tbl"><tbody><tr><td>only body</td></tr></tbody></table>'; document.body.appendChild(d)
    stop = installColumnResize(document); await frame()
    expect(d.querySelectorAll('.colgrip').length).toBe(0)
    expect(d.querySelectorAll('table')[1].hasAttribute('data-colresize')).toBe(false)
  })
})
