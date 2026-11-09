// Click-through highlighting: a link may carry ?focus=<record id>. The page that opens scrolls to the element with data-id=<id>,
// brings it into view and marks it. The mark stays (0.26.0) until another link-through, the page changes, or clearHighlight() —
// before it faded after six seconds, which lost the row while the user was still reading it.
export const FOCUS_PARAM = 'focus'
/** Build a link to a page that lands on one record. */
export const linkTo = (path: string, id?: string | null) => id ? `${path}${path.includes('?') ? '&' : '?'}${FOCUS_PARAM}=${encodeURIComponent(id)}` : path
export const focusIdFrom = (search: string) => { try { return new URLSearchParams(search).get(FOCUS_PARAM) } catch { return null } }
/** Remove the mark from whatever is highlighted. */
export function clearHighlight() { if (typeof document !== 'undefined') document.querySelectorAll('.focus-hit').forEach(x => x.classList.remove('focus-hit')) }
/** Find the element, scroll it into view and mark it. Returns true when found. */
export function highlight(id: string, attempt = 0): boolean {
  if (typeof document === 'undefined') return false
  const el = document.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)
  if (!el) { if (attempt < 8) setTimeout(() => highlight(id, attempt + 1), 150); return false }   // tables render a tick later
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  clearHighlight(); el.classList.add('focus-hit')
  return true
}
