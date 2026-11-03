// Click-through highlighting: a link may carry ?focus=<record id>. The page that opens scrolls to the element with data-id=<id>,
// brings it into view and pulses it, so the item the link pointed at is easy to find.
export const FOCUS_PARAM = 'focus'
/** Build a link to a page that lands on one record. */
export const linkTo = (path: string, id?: string | null) => id ? `${path}?${FOCUS_PARAM}=${encodeURIComponent(id)}` : path
export const focusIdFrom = (search: string) => { try { return new URLSearchParams(search).get(FOCUS_PARAM) } catch { return null } }
let timer: ReturnType<typeof setTimeout> | null = null
/** Find the element, scroll it into view and pulse it. Returns true when found. */
export function highlight(id: string, attempt = 0): boolean {
  if (typeof document === 'undefined') return false
  const el = document.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)
  if (!el) { if (attempt < 8) setTimeout(() => highlight(id, attempt + 1), 150); return false }   // tables render a tick later
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  document.querySelectorAll('.focus-hit').forEach(x => x.classList.remove('focus-hit'))
  el.classList.add('focus-hit'); if (timer) clearTimeout(timer); timer = setTimeout(() => el.classList.remove('focus-hit'), 6000)
  return true
}
