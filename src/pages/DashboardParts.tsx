// Dashboard extras (0.23.0): the first-run checklist card and the "Arrange dashboard" dialog. Engines in lib/onboarding.ts and lib/dashLayout.ts.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../app/hooks'
import { Btn, Card, Note, MHead, MBody, MFoot } from '../components/ui'
import { setupSteps, setupProgress } from '../lib/onboarding'
import { moveCard, toggleCard, saveLayout, normalizeLayout, type DashLayout } from '../lib/dashLayout'

/** [key, label] in the default order. */
export const DASH_CARDS: Array<[string, string]> = [['setup', 'Getting started checklist'], ['paycheck', 'Paycheck landed'], ['attention', 'Needs attention'], ['cash', 'Cash — next 30 days'], ['upcoming', 'Coming up'], ['budget', 'Budget'], ['runway', 'Runway'], ['goals', 'Goals'], ['spending', 'Spending · last 30 days']]

export function SetupCard() {
  const { data, settings, saveSettings, guarded, canEdit } = useData(); const steps = setupSteps(data, settings); const pr = setupProgress(steps)
  if (pr.all || settings.setupDismissed) return null
  return <Card span={12} title="Get set up" hint={`${pr.done} of ${pr.total} steps · each one is ticked from your own data`} right={canEdit ? <Btn sm onClick={() => guarded(() => saveSettings({ setupDismissed: true }), 'Checklist hidden — bring it back under Settings → General')}>Hide</Btn> : undefined}>
    <div className="mix" style={{ height: 8, marginBottom: 10 }}><span style={{ width: Math.round(pr.done / Math.max(1, pr.total) * 100) + '%', background: 'var(--good)' }} /></div>
    <p className="note" style={{ margin: '0 0 8px' }}>New to this? <Link to="/start">Start here</Link> walks through every step — what to have at hand, where to click and what each step is for.</p>
    <ol className="setup">{steps.map(x => <li key={x.key} className={x.done ? 'done' : ''}><span className="tick" aria-hidden>{x.done ? '✓' : ''}</span><span><b>{x.label}</b>{x.optional ? <span className="note" style={{ display: 'inline', margin: '0 0 0 6px' }}>optional</span> : null}<span className="note" style={{ display: 'block', margin: 0 }}>{x.why}</span></span>{!x.done && <Link className="btn sm" to={x.to}>{x === pr.next ? 'Start' : 'Go'}</Link>}<span className="sr-only">{x.done ? 'done' : 'not done'}</span></li>)}</ol>
  </Card>
}

export function ArrangeDashboard({ layout, onChange, onDone }: { layout: DashLayout; onChange: (l: DashLayout) => void; onDone: () => void }) {
  const [l, setL] = useState(layout); const label = Object.fromEntries(DASH_CARDS)
  const set = (n: DashLayout) => { setL(n); saveLayout(n); onChange(n) }
  return <><MHead title="Arrange dashboard" /><MBody>
    <Note>Move cards up or down and untick the ones you do not need. Saved on this device only.</Note>
    <ol className="arrange">{l.order.map((k, i) => <li key={k}><label><input type="checkbox" checked={!l.hidden.includes(k)} onChange={e => set(toggleCard(l, k, e.target.checked))} /> {label[k] || k}</label>
      <span className="btnrow"><button type="button" className="btn sm" onClick={() => set(moveCard(l, k, -1))} disabled={i === 0} aria-label={`Move ${label[k]} up`}>↑</button><button type="button" className="btn sm" onClick={() => set(moveCard(l, k, 1))} disabled={i === l.order.length - 1} aria-label={`Move ${label[k]} down`}>↓</button></span></li>)}</ol>
  </MBody><MFoot><Btn onClick={() => set(normalizeLayout(null, DASH_CARDS.map(c => c[0])))}>Reset to default</Btn><Btn primary onClick={onDone}>Done</Btn></MFoot></>
}
