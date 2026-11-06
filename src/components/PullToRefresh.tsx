// Pull to refresh (0.23.0): on a touch screen, pulling down at the very top of the page reloads the household from the server
// (in the demo it re-reads this browser's copy). Mouse and keyboard users never see it.
import { useRef, useState, type ReactNode } from 'react'
import { useStore } from '../app/store'

const TRIGGER = 70
export function PullToRefresh({ children }: { children: ReactNode }) {
  const start = useRef<{ y: number; x: number } | null>(null); const [pull, setPull] = useState(0); const [busy, setBusy] = useState(false)
  const onStart = (e: React.TouchEvent) => { if (busy || window.scrollY > 0 || e.touches.length !== 1 || document.querySelector('.modal, .helpdrawer')) { start.current = null; return } start.current = { y: e.touches[0].clientY, x: e.touches[0].clientX } }
  const onMove = (e: React.TouchEvent) => { const s = start.current; if (!s) return; const dy = e.touches[0].clientY - s.y, dx = Math.abs(e.touches[0].clientX - s.x)
    if (dx > Math.abs(dy) || window.scrollY > 0) { start.current = null; setPull(0); return } setPull(dy > 0 ? Math.min(110, dy * 0.55) : 0) }
  const onEnd = async () => { const p = pull; start.current = null; setPull(0)
    if (p >= TRIGGER * 0.55) { setBusy(true); try { await useStore.getState().refresh(); useStore.getState().toast('Up to date') } finally { setBusy(false) } } }
  return <div onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={() => { start.current = null; setPull(0) }}>
    {(pull > 4 || busy) && <div className="ptr" style={{ height: busy ? 44 : pull }} aria-live="polite">{busy ? 'Refreshing…' : pull >= TRIGGER * 0.55 ? 'Release to refresh' : 'Pull to refresh'}</div>}
    {children}
  </div>
}
