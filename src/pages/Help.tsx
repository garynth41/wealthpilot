// Help Center (0.24.1): the whole guide in one place — start here, the basics, every page and card, "How do I…", troubleshooting,
// the glossary and keyboard shortcuts — with one search box. Deep links: /help?topic=<path|start|tasks|faq|glossary|keys>&card=<heading>
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { GUIDE, GENERAL, guideFor, glossaryAll, tasksAll, searchGuide, titleOf, type Hit } from '../lib/guide'
import { PageGuide, TaskGuide, Glossary, SearchResults } from '../components/GuideView'
import { ShortcutsHelp } from '../components/Palette'
import { VIEWS } from '../components/Layout'
import { Btn } from '../components/ui'

const TOPICS: Array<[string, string]> = [['start', 'Start here'], ['basics', 'The basics'], ['tasks', 'How do I…'], ['faq', 'Troubleshooting'], ['glossary', 'Glossary'], ['keys', 'Keyboard shortcuts']]

export function HelpPage() {
  const [sp, setSp] = useSearchParams(); const nav = useNavigate()
  const topic = sp.get('topic') || 'start'; const card = sp.get('card'); const [q, setQ] = useState(sp.get('q') || ''); const [gq, setGq] = useState(''); const [all, setAll] = useState(false)
  const go = (t: string, c?: string | null) => { setQ(''); setAll(false); const n = new URLSearchParams({ topic: t }); if (c) n.set('card', c); setSp(n); if (!c) window.scrollTo({ top: 0 }) }
  useEffect(() => { if (!card) window.scrollTo({ top: 0 }) }, [topic, card])
  const hits = useMemo(() => searchGuide(q, 60), [q])
  const pick = (h: Hit) => { if (h.kind === 'faq') go('faq'); else if (h.kind === 'term' && !h.path) { go('glossary'); setGq(h.title) } else if (h.kind === 'task' && !h.path) go('tasks'); else if (h.path) go(h.path, h.card || null) }
  const zones = [...new Set(VIEWS.map(v => v.zone))]; const g = topic.startsWith('/') ? guideFor(topic) : null
  const tasks = tasksAll()
  return <div className="helpcenter">
    <div className="hc-search"><input className="inp" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search the help — e.g. “safe to spend”, “record payment”, “utilization”, “sync failed”" aria-label="Search the Help Center" autoFocus />
      {q && <span className="g-hint">{hits.length} result{hits.length === 1 ? '' : 's'}</span>}</div>
    <div className="hc-grid">
      <nav className="hc-index" aria-label="Help topics">
        <select className="inp hc-pick" value={topic} onChange={e => go(e.target.value)} aria-label="Help topic">{TOPICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}{zones.map(z => <optgroup key={z} label={z}>{VIEWS.filter(v => v.zone === z && v.path !== '/help').map(v => <option key={v.path} value={v.path}>{v.title}</option>)}</optgroup>)}</select>
        <ul className="hc-list">{TOPICS.map(([k, l]) => <li key={k}><button type="button" className={topic === k && !q ? 'on' : ''} onClick={() => go(k)}>{l}</button></li>)}</ul>
        {zones.map(z => { const vs = VIEWS.filter(v => v.zone === z && v.path !== '/help'); return vs.length ? <div key={z}><div className="hc-zone">{z}</div><ul className="hc-list">{vs.map(v => <li key={v.path}><button type="button" className={topic === v.path && !q ? 'on' : ''} onClick={() => go(v.path)}>{v.title}</button></li>)}</ul></div> : null })}
      </nav>
      <div className="hc-main">
        {q ? <SearchResults hits={hits} q={q} onPick={pick} /> : g ? <article aria-labelledby="hc-h">
          <div className="hc-head"><h2 id="hc-h">{titleOf(g.path)}</h2><span className="btnrow"><Btn sm onClick={() => setAll(a => !a)}>{all ? 'Collapse all cards' : 'Expand all cards'}</Btn><Link className="btn sm primary" to={g.path}>Open {titleOf(g.path)}</Link></span></div>
          <PageGuide g={g} focus={card} expandAll={all} />
        </article> : topic === 'basics' ? <article><h2>The basics</h2><p className="g-summary">{GENERAL.intro}</p>{GENERAL.basics.map(b => <section key={b.h}><h4>{b.h}</h4><ul className="g-tips">{b.items.map((t, i) => <li key={i}>{t}</li>)}</ul></section>)}</article>
        : topic === 'tasks' ? <article><h2>How do I…</h2><p className="g-hint">Every step-by-step answer in the app, by page.</p>
          <section><h4>Anywhere in the app</h4>{tasks.filter(t => !t.path).map(t => <TaskGuide key={t.q} t={t} />)}</section>
          {GUIDE.filter(p => p.tasks?.length).map(p => <section key={p.path}><h4>{titleOf(p.path)}</h4>{p.tasks!.map(t => <TaskGuide key={t.q} t={{ ...t, path: p.path }} page />)}</section>)}</article>
        : topic === 'faq' ? <article><h2>Troubleshooting</h2>{GENERAL.faq.map(f => <details key={f.q} className="g-card"><summary><span className="g-ct">{f.q}</span></summary><div className="g-cbody"><ul className="g-tips">{f.a.map((t, i) => <li key={i}>{t}</li>)}</ul></div></details>)}</article>
        : topic === 'glossary' ? <article><h2>Glossary</h2><input className="inp" type="search" value={gq} onChange={e => setGq(e.target.value)} placeholder="Filter terms" aria-label="Filter glossary terms" style={{ maxWidth: 320, marginBottom: 8 }} /><Glossary terms={glossaryAll()} filter={gq} /></article>
        : topic === 'keys' ? <article><h2>Keyboard shortcuts</h2><ShortcutsHelp /><p className="g-hint">F1 opens help for the page you are on; Esc closes it. H hides or shows amounts.</p></article>
        : <article><h2>Start here</h2><p className="g-summary">{GENERAL.intro}</p>
          <ol className="hc-steps">{GENERAL.start.map(s => <li key={s.title}><b>{s.title}</b><span>{s.text}</span><span className="btnrow"><Link to={s.to} className="btn sm">Open {titleOf(s.to)}</Link><button type="button" className="btn sm" onClick={() => go(s.to)}>Read the guide</button></span></li>)}</ol>
          <section><h4>Every page</h4><div className="hc-tiles">{VIEWS.filter(v => v.path !== '/help').map(v => { const pg = guideFor(v.path); return <button type="button" key={v.path} className="hc-tile" onClick={() => go(v.path)}><b>{v.title}</b><span>{pg?.summary || v.sub}</span><small>{pg ? `${pg.cards.length} card${pg.cards.length === 1 ? '' : 's'} explained${pg.tasks?.length ? ` · ${pg.tasks.length} how-tos` : ''}` : ''}</small></button> })}</div></section>
          <p className="g-hint">Tip: the small ? beside any card's heading opens help for exactly that card. <button type="button" className="btn sm" onClick={() => nav('/')}>Back to the dashboard</button></p></article>}
      </div>
    </div>
  </div>
}
