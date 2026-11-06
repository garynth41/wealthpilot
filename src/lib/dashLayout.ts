// Dashboard arrangement (0.23.0): which cards show and in what order, per device. Pure helpers; the Dashboard keeps the choice in
// localStorage so a phone can show three cards while the desktop shows all of them.
export interface DashLayout { order: string[]; hidden: string[] }
export const DASH_KEY = 'wealthpilot.dashLayout'
/** Saved order first (cards that no longer exist dropped), then any card added since, in its default place. */
export function normalizeLayout(saved: Partial<DashLayout> | null | undefined, all: string[]): DashLayout {
  const known = new Set(all); const order = (saved?.order || []).filter(k => known.has(k))
  for (const k of all) if (!order.includes(k)) { const i = all.indexOf(k); const after = all.slice(0, i).reverse().find(x => order.includes(x)); order.splice(after ? order.indexOf(after) + 1 : 0, 0, k) }
  return { order, hidden: (saved?.hidden || []).filter(k => known.has(k)) }
}
export function moveCard(l: DashLayout, key: string, dir: -1 | 1): DashLayout {
  const i = l.order.indexOf(key), j = i + dir; if (i < 0 || j < 0 || j >= l.order.length) return l
  const order = l.order.slice(); [order[i], order[j]] = [order[j], order[i]]; return { ...l, order }
}
export const toggleCard = (l: DashLayout, key: string, show: boolean): DashLayout => ({ ...l, hidden: show ? l.hidden.filter(k => k !== key) : [...new Set([...l.hidden, key])] })
export const visibleCards = (l: DashLayout) => l.order.filter(k => !l.hidden.includes(k))
export function loadLayout(all: string[]): DashLayout { try { return normalizeLayout(JSON.parse(localStorage.getItem(DASH_KEY) || 'null'), all) } catch { return normalizeLayout(null, all) } }
export function saveLayout(l: DashLayout) { try { localStorage.setItem(DASH_KEY, JSON.stringify(l)) } catch { /* private mode */ } }
