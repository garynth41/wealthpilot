// The help drawer (0.23.0, rebuilt 0.24.1): opens from a card's ?, the Help button or F1; closes with Esc or a click outside.
// Three tabs — this page (every card, opened at the one you asked about), "How do I…", and the glossary — plus one search box that
// looks through the whole guide. Loaded on first use (lazy), so the guide's text never slows the first page load.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { guideFor, glossaryAll, tasksAll, searchGuide, GENERAL, type Hit } from '../lib/guide'
import { PageGuide, TaskGuide, Glossary, SearchResults } from './GuideView'
import { Seg } from './ui'
import { ShortcutsHelp } from './Palette'

export type HelpTab = 'page' | 'tasks' | 'glossary'
export default function HelpDrawer({ path, title, card, tab: tab0, onClose, onGo }: { path: string; title: string; card?: string | null; tab?: HelpTab; onClose: () => void; onGo: (path: string | null, card?: string | null) => void }) {
  const g = guideFor(path); const ref = useRef<HTMLDivElement>(null); const body = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<HelpTab>(tab0 || 'page'); const [q, setQ] = useState('')
  useEffect(() => { setTab(tab0 || 'page') }, [tab0, card, path])
  useEffect(() => { const prev = document.activeElement as HTMLElement | null; ref.current?.querySelector<HTMLElement>(card ? 'input' : 'button')?.focus()
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); if (q) setQ(''); else onClose() } }
    window.addEventListener('keydown', k); return () => { window.removeEventListener('keydown', k); prev?.focus?.() } }, [onClose, q, card])
  useEffect(() => { if (!card) body.current?.scrollTo(0, 0) }, [path, card])
  const hits = useMemo(() => searchGuide(q), [q])
  const pageTasks = (g?.tasks || []).map(t => ({ ...t, path })); const others = tasksAll().filter(t => t.path !== path)
  const pick = (h: Hit) => { setQ(''); if (!h.path) { onGo('/help?topic=' + (h.kind === 'faq' ? 'faq' : h.kind === 'task' ? 'tasks' : 'glossary')); return }
    if (h.path === path) { setTab(h.kind === 'task' ? 'tasks' : h.kind === 'term' ? 'glossary' : 'page'); if (h.card) onGo(path, h.card) } else onGo(h.path, h.card || null) }
  const center = `/help?topic=${encodeURIComponent(path)}${card ? `&card=${encodeURIComponent(card)}` : ''}`
  return <>
    <div className="helpback" onClick={onClose} aria-hidden="true" />
    <div className="helpdrawer" role="dialog" aria-modal="true" aria-labelledby="help-title" ref={ref}>
      <div className="hd-head"><h2 id="help-title">Help · {title}</h2><button className="btn sm" onClick={onClose} aria-label="Close help">✕</button></div>
      <div className="hd-tools">
        <input className="inp" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search all help — a button, a number, a word…" aria-label="Search all help" />
        {!q && <Seg value={tab} onChange={setTab} options={[['page', 'This page'], ['tasks', 'How do I…'], ['glossary', 'Glossary']]} />}
      </div>
      <div className="hd-body" ref={body}>
        {q ? <SearchResults hits={hits} q={q} onPick={pick} /> : tab === 'page' ? <>
          {g ? <PageGuide g={g} focus={card} onNavigate={onClose} /> : <p className="hd-intro">{GENERAL.intro}</p>}
          <section><h4>Keyboard</h4><ShortcutsHelp /></section>
        </> : tab === 'tasks' ? <>
          {pageTasks.length > 0 && <section><h4>On this page</h4>{pageTasks.map(t => <TaskGuide key={t.q} t={t} />)}</section>}
          <section><h4>Everywhere else</h4>{others.map(t => <TaskGuide key={(t.path || '') + t.q} t={t} page />)}</section>
        </> : <>
          {g?.glossary?.length ? <section><h4>Used on this page</h4><dl className="g-fields">{g.glossary.map(t => <div key={t.term}><dt>{t.term}</dt><dd>{t.def}</dd></div>)}</dl></section> : null}
          <section><h4>Every term, A–Z</h4><Glossary terms={glossaryAll()} /></section>
        </>}
      </div>
      <div className="hd-foot"><Link to={center} className="btn primary sm" onClick={onClose}>Open the Help Center</Link><span className="g-hint">Every page, getting started, troubleshooting and the full glossary</span></div>
    </div>
  </>
}
