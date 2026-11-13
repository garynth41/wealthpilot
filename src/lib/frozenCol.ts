// Frozen first column (0.28.2). When a wide table scrolls sideways its first column stays put, like a frozen column in a spreadsheet
// (styles.css "frozen first column"). The shared Table freezes its tick box, its row number and its first column together and works out
// where each one sits (lib/frozenCol.ts setFrozenLefts); a table written on a page freezes its first cell. This also marks a table area
// that has been scrolled sideways (.sx), so a soft shadow shows where the scrolled columns slide under the frozen one.

/** One listener for every table area in the app: scroll events do not bubble, but they reach a capturing listener on the document. */
export function installFrozenEdge(doc: Document = document): () => void {
  const onScroll = (e: Event) => {
    const t = e.target as Element | null
    if (t && t.nodeType === 1 && t.classList.contains('tblwrap')) t.classList.toggle('sx', (t as HTMLElement).scrollLeft > 0)
  }
  doc.addEventListener('scroll', onScroll, { capture: true, passive: true })
  return () => doc.removeEventListener('scroll', onScroll, { capture: true })
}

/** The left offset of each frozen heading cell (th.fz, in order) is the width of the frozen cells before it. They are written to the table
 *  as --fz0, --fz1, … for the .fz0, .fz1, … cells of every row. Returns the offsets, for tests. */
export function setFrozenLefts(table: HTMLTableElement): number[] {
  const out: number[] = []; let x = 0
  table.querySelectorAll<HTMLElement>(':scope > thead > tr > th.fz').forEach((th, i) => { out.push(x); table.style.setProperty(`--fz${i}`, `${x}px`); x += th.offsetWidth })
  return out
}
