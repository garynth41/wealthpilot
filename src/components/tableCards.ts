// Phones (0.25.1): the tables written by hand on the pages (<table class="tbl"> — not the shared Table, which draws its own cards) turn
// into one card per row at 700px and narrower, so every value and button is on screen without scrolling sideways (styles.css "phone
// cards"). CSS cannot know which heading a cell sits under, so this labels each body and footer cell with its column's heading
// (data-label); cells holding a field get data-ctl ("num" for an amount, "wide" for a list, a date or text) and a row that is one
// full-width cell (a group heading) gets data-head. Tables with fewer than four columns fit a phone and stay tables.
// It also makes any table area that still scrolls focusable and named (tabindex, role=region, aria-label), so keyboard and screen-reader
// users can scroll it — only when it actually scrolls and has nothing focusable inside.
const TABLES = 'table.tbl:not(.tbl-grid)'
const MIN_COLS = 4

/** The visible text of a heading cell (screen-reader-only text, the sort arrow and the resize grip left out). */
function headText(el: Element): string {
  let out = ''
  el.childNodes.forEach(n => { if (n.nodeType === 3) out += n.textContent || ''; else if (n.nodeType === 1) { const e = n as Element; if (!e.matches('.sr-only, .arrow, .colgrip, button, input, select')) out += headText(e) } })
  return out.replace(/\s+/g, ' ').trim()
}
const setAttr = (el: Element, k: string, v: string | null) => { if (v == null) { if (el.hasAttribute(k)) el.removeAttribute(k) } else if (el.getAttribute(k) !== v) el.setAttribute(k, v) }

export function labelTable(t: HTMLTableElement) {
  const head = t.tHead?.rows[t.tHead.rows.length - 1]
  const labels: string[] = []
  if (head) for (const th of Array.from(head.cells)) { const txt = th.getAttribute('data-label') ?? headText(th); const span = Math.max(1, th.colSpan || 1); for (let i = 0; i < span; i++) labels.push(span > 1 ? '' : txt) }
  const cards = labels.length >= MIN_COLS
  setAttr(t, 'data-cards', cards ? '' : null)
  const wrap = t.parentElement?.classList.contains('tblwrap') ? t.parentElement : null
  if (wrap) setAttr(wrap, 'data-cards-wrap', cards ? '' : null)
  if (!cards) return
  for (const sec of [...Array.from(t.tBodies), ...(t.tFoot ? [t.tFoot] : [])]) for (const row of Array.from(sec.rows)) {
    let col = 0; const cells = Array.from(row.cells)
    setAttr(row, 'data-head', cells.length === 1 && (cells[0].colSpan || 1) >= labels.length - 1 ? '' : null)
    for (const cell of cells) {
      const span = Math.max(1, cell.colSpan || 1); const lab = span > 1 ? '' : (labels[col] || '')
      setAttr(cell, 'data-label', lab)
      // a field: an amount fits a narrow column; a list, a date or text gets two
      const ctl = cell.querySelector<HTMLElement>('input:not([type="checkbox"]):not([type="radio"]), select, textarea')
      setAttr(cell, 'data-ctl', !ctl ? null : ctl.matches('input.num, input[inputmode="decimal"], input[inputmode="numeric"]') ? 'num' : 'wide')
      // the first value is the card's title ("Chase Freedom", "Gas", "Nov 8 · in 1d") and needs no label — unless it is a bare number like "1"
      const txt = (cell.textContent || '').trim()
      setAttr(cell, 'data-title', sec.tagName === 'TBODY' && cell === cells[0] && !ctl && (txt.length > 4 || /\p{L}/u.test(txt)) ? '' : null)
      col += span
    }
  }
}

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'
/** A table area that scrolls with nothing focusable inside gets a tab stop and a name; one that no longer scrolls loses them again. */
function regions(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('.tblwrap').forEach(w => {
    const auto = w.hasAttribute('data-auto-region')
    if (!auto && w.hasAttribute('tabindex')) return   // the page set its own
    const scrolls = w.clientWidth > 0 && (w.scrollWidth > w.clientWidth + 1 || w.scrollHeight > w.clientHeight + 1)
    if (scrolls && !w.querySelector(FOCUSABLE)) {
      const t = w.querySelector('table'); const cap = t?.caption?.textContent?.trim()
      const heading = w.closest('.card')?.querySelector('.card-head .ch')?.textContent?.trim()
      w.setAttribute('tabindex', '0'); w.setAttribute('role', 'region'); w.setAttribute('aria-label', (cap || heading || 'Table') + ' (scrolls)'); w.setAttribute('data-auto-region', '')
    } else if (auto) { w.removeAttribute('tabindex'); w.removeAttribute('role'); w.removeAttribute('aria-label'); w.removeAttribute('data-auto-region') }
  })
}

/** Watch `root` (the whole app, dialogs included) and keep every hand-written table labelled. Returns a function that stops watching. */
export function installTableCards(root: HTMLElement): () => void {
  root.querySelectorAll<HTMLTableElement>(TABLES).forEach(labelTable)
  let raf = 0
  const later = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; regions(root) }) }
  // labels are set straight away (before the browser paints) so a table never flashes as a table first
  const mo = new MutationObserver(recs => {
    const seen = new Set<HTMLTableElement>()
    for (const r of recs) {
      const el = (r.target.nodeType === 1 ? r.target as Element : r.target.parentElement)
      const t = el?.closest?.('table.tbl') as HTMLTableElement | null; if (t && !t.classList.contains('tbl-grid')) seen.add(t)
      r.addedNodes.forEach(n => { if (n.nodeType !== 1) return; const e = n as Element; if (e.matches(TABLES)) seen.add(e as HTMLTableElement); e.querySelectorAll?.<HTMLTableElement>(TABLES).forEach(x => seen.add(x)) })
    }
    seen.forEach(labelTable); later()
  })
  mo.observe(root, { childList: true, subtree: true, characterData: true })
  let tm: ReturnType<typeof setTimeout> | undefined; const onResize = () => { clearTimeout(tm); tm = setTimeout(() => regions(root), 150) }
  window.addEventListener('resize', onResize); later()
  return () => { mo.disconnect(); window.removeEventListener('resize', onResize); clearTimeout(tm); if (raf) cancelAnimationFrame(raf) }
}
