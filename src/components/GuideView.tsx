// Renders the guide (0.24.1) — one page's help, a card's section, tasks, the glossary and search results. Shared by the help drawer
// and the Help Center page so both read the same way.
import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { GuideCard, GuidePage, GuideTask } from '../lib/guide/types'
import { cardAnchor, titleOf, type Hit, type TermEntry } from '../lib/guide'

const Fields = ({ items }: { items: Array<{ term: string; text: string }> }) => <dl className="g-fields">{items.map(f => <div key={f.term}><dt>{f.term}</dt><dd>{f.text}</dd></div>)}</dl>

export function CardGuide({ c, open, focused }: { c: GuideCard; open?: boolean; focused?: boolean }) {
  return <details className={`g-card ${focused ? 'g-focus' : ''}`} id={cardAnchor(c.title)} open={open}>
    <summary><span className="g-ct">{c.title}</span></summary>
    <div className="g-cbody">
      <p className="g-what">{c.what}</p>
      {c.how?.length ? <><h4>How to use it</h4><ol className="g-steps">{c.how.map((s, i) => <li key={i}>{s}</li>)}</ol></> : null}
      {c.fields?.length ? <><h4>What everything means</h4><Fields items={c.fields} /></> : null}
      {c.tips?.length ? <><h4>Good to know</h4><ul className="g-tips">{c.tips.map((s, i) => <li key={i}>{s}</li>)}</ul></> : null}
    </div>
  </details>
}

export function TaskGuide({ t, open, page }: { t: GuideTask & { path?: string | null }; open?: boolean; page?: boolean }) {
  return <details className="g-card g-task" open={open}><summary><span className="g-ct">{t.q}</span>{page && t.path ? <span className="g-where">{titleOf(t.path)}</span> : null}</summary>
    <div className="g-cbody"><ol className="g-steps">{t.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>{page && t.path ? <Link className="btn sm" to={t.path}>Open {titleOf(t.path)}</Link> : null}</div></details>
}

/** A whole page's guide. `focus` opens and scrolls to one card. */
export function PageGuide({ g, focus, expandAll, onNavigate }: { g: GuidePage; focus?: string | null; expandAll?: boolean; onNavigate?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!focus) return; const el = ref.current?.querySelector<HTMLElement>('#' + cardAnchor(focus)); if (el) { (el as HTMLDetailsElement).open = true; requestAnimationFrame(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' })) } }, [focus, g.path])
  return <div className="g-page" ref={ref}>
    <p className="g-summary">{g.summary}</p>
    {g.start?.length ? <section><h3>Getting started</h3><ol className="g-steps">{g.start.map((s, i) => <li key={i}>{s}</li>)}</ol></section> : null}
    {g.top?.length ? <section><h3>The numbers at the top</h3><Fields items={g.top} /></section> : null}
    <section><h3>Each card on this page</h3><p className="g-hint">Open a card to see how to use it and what each number, column and button means. The ? beside a card's heading opens it here.</p>
      {g.cards.map(c => <CardGuide key={c.title} c={c} open={expandAll || focus === c.title} focused={focus === c.title} />)}</section>
    {g.tasks?.length ? <section><h3>How do I…</h3>{g.tasks.map(t => <TaskGuide key={t.q} t={t} />)}</section> : null}
    {g.glossary?.length ? <section><h3>Words used here</h3><dl className="g-fields">{g.glossary.map(t => <div key={t.term}><dt>{t.term}</dt><dd>{t.def}</dd></div>)}</dl></section> : null}
    {g.links?.length ? <section><h3>Related</h3><ul className="g-links">{g.links.map(([to, l]) => <li key={to}><Link to={to} onClick={onNavigate}>{l}</Link></li>)}</ul></section> : null}
  </div>
}

export function Glossary({ terms, filter, level = 4 }: { terms: TermEntry[]; filter?: string; /** heading level of the letters: 4 under a section heading (the drawer), 3 on the Help Center */ level?: 3 | 4 }) {
  const H = level === 3 ? 'h3' : 'h4'
  const f = (filter || '').trim().toLowerCase(); const list = f ? terms.filter(t => (t.term + ' ' + t.def).toLowerCase().includes(f)) : terms
  const letters = [...new Set(list.map(t => t.term[0].toUpperCase()))]
  return <div className="g-gloss">
    {!f && letters.length > 6 && <nav className="g-letters" aria-label="Jump to letter">{letters.map(l => <a key={l} href={`#gl-${l}`} onClick={e => { e.preventDefault(); document.getElementById('gl-' + l)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>{l}</a>)}</nav>}
    {letters.map(l => <section key={l} id={'gl-' + l}><H>{l}</H><dl className="g-fields">{list.filter(t => t.term[0].toUpperCase() === l).map(t => <div key={t.term}><dt>{t.term}</dt><dd>{t.def}{t.path ? <> <Link to={t.path} className="g-where">{titleOf(t.path)}</Link></> : null}</dd></div>)}</dl></section>)}
    {!list.length && <p className="g-hint">No term matches “{filter}”.</p>}
  </div>
}

const KIND: Record<Hit['kind'], string> = { page: 'Page', card: 'Card', task: 'How do I', term: 'Term', faq: 'Troubleshooting' }
export function SearchResults({ hits, q, onPick }: { hits: Hit[]; q: string; onPick: (h: Hit) => void }): ReactNode {
  if (!q.trim()) return null
  if (!hits.length) return <p className="g-hint" role="status">Nothing found for “{q}”. Try a shorter word, or the name of a button or a number you see on screen.</p>
  return <ul className="g-hits" role="list" aria-label={`${hits.length} result${hits.length === 1 ? '' : 's'}`}>{hits.map((h, i) => <li key={i}><button type="button" onClick={() => onPick(h)}>
    <span className={`g-kind k-${h.kind}`}>{KIND[h.kind]}</span><b>{h.title}</b><span className="g-where">{titleOf(h.path)}</span><span className="g-snip">{h.snippet}</span></button></li>)}</ul>
}
