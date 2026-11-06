// The per-page help drawer (0.23.0): opens from the ⓘ Help button or F1, closes with Esc or a click outside. Content in lib/help.ts.
import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { helpFor } from '../lib/help'
import { ShortcutsHelp } from './Palette'

export function HelpDrawer({ path, title, onClose }: { path: string; title: string; onClose: () => void }) {
  const h = helpFor(path); const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { const prev = document.activeElement as HTMLElement | null; ref.current?.querySelector<HTMLElement>('button')?.focus()
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', k); return () => { window.removeEventListener('keydown', k); prev?.focus?.() } }, [onClose])
  return <>
    <div className="helpback" onClick={onClose} aria-hidden="true" />
    <div className="helpdrawer" role="dialog" aria-modal="true" aria-labelledby="help-title" ref={ref}>
      <div className="hd-head"><h2 id="help-title">Help · {title}</h2><button className="btn sm" onClick={onClose} aria-label="Close help">✕</button></div>
      <div className="hd-body">
        {h ? <><p className="hd-intro">{h.intro}</p>
          {h.sections.map(s => <section key={s.h}><h3>{s.h}</h3><ul>{s.items.map((t, i) => <li key={i}>{t}</li>)}</ul></section>)}
          {h.links?.length ? <section><h3>Related</h3><ul>{h.links.map(([to, l]) => <li key={to}><Link to={to} onClick={onClose}>{l}</Link></li>)}</ul></section> : null}</>
          : <p className="hd-intro">No help for this page yet.</p>}
        <section><h3>Keyboard</h3><ShortcutsHelp /></section>
      </div>
    </div>
  </>
}
