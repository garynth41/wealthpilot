// Start here (0.29.0): setting Cresari up from nothing, step by step. The steps and what each one checks live in lib/startGuide.ts; this
// page shows them in order with where to click, ticks each one off from the household's own data, and points at the next one.
import { Link } from 'react-router-dom'
import { useData } from '../app/hooks'
import { Card, Note } from '../components/ui'
import { InstallSteps } from '../components/Install'
import { FeedbackButton } from '../components/Feedback'
import { GATHER, START_STEPS, startProgress, startState, type StartStep, type StepState } from '../lib/startGuide'

export function StartPage() {
  const { data, settings, mode } = useData()
  const state = startState(data, settings); const pr = startProgress(state)
  const phases = [...new Set(START_STEPS.map(s => s.phase))]
  const pct = Math.round(pr.done / Math.max(1, pr.total) * 100)
  return <div className="grid g12 start">
    <Card span={12} title="Your progress" hint={pr.all ? 'every required step is done — the rest are optional' : `${pr.done} of ${pr.total} required steps done · about ${pr.minutesLeft} minutes of steps left`}>
      <div className="mix" style={{ height: 10, marginBottom: 10 }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress"><span style={{ width: pct + '%', background: 'var(--good)' }} /></div>
      {pr.next ? <p style={{ margin: 0 }}>Next: <b>{pr.next.title}</b> — {pr.next.why} <a className="btn sm primary" href={'#start-' + pr.next.key}>Go to step {START_STEPS.indexOf(pr.next) + 1}</a></p>
        : <p style={{ margin: 0 }}>You are set up. Keep the weekly check-in (step {START_STEPS.findIndex(s => s.key === 'routine') + 1}) and your numbers stay true.</p>}
      <Note>Each step ticks itself off from your own data — there is nothing to mark by hand. Stop whenever you like and come back here from the menu (Help → Start here).{mode === 'demo' ? ' You are in the demo, so most steps are already done with sample data: read them to see how setup works, then create your own account.' : ''}</Note>
    </Card>
    <Card span={6} title="Before you start" hint="have these at hand — about 10 minutes to gather">
      <ul className="start-list">{GATHER.map((g, i) => <li key={i}>{g}</li>)}</ul>
      <Note>Missing something? Skip it and come back — every step can be done later or changed at any time.</Note>
    </Card>
    <Card span={6} title="Install the app" hint="so it opens from your home screen like any other app"><InstallSteps /></Card>
    {phases.map(ph => <section key={ph} className="start-phase" aria-label={ph} style={{ gridColumn: 'span 12' }}>
      <h2 className="phase">{ph}</h2>
      <div className="grid g12">{START_STEPS.filter(s => s.phase === ph).map(s => <StepCard key={s.key} step={s} n={START_STEPS.indexOf(s) + 1} st={state[s.key]} next={pr.next?.key === s.key} />)}</div>
    </section>)}
    <Card span={12} title="Stuck, or something unclear?" hint="tell us — every note is read">
      <p style={{ marginTop: 0 }}>If a step did not match what you saw, or a word did not make sense, that is exactly the feedback that helps most.</p>
      <FeedbackButton pageTitle="Start here" />
    </Card>
  </div>
}

function StepCard({ step: s, n, st, next }: { step: StartStep; n: number; st: StepState | undefined; next: boolean }) {
  const done = st?.done === true
  const status = st?.done == null ? <span className="pill">habit</span> : done ? <span className="pill good">✓ Done</span> : next ? <span className="pill warn">Next</span> : <span className="pill">To do</span>
  const body = <>
    <p className="why">{s.why}</p>
    {s.need && <p className="note" style={{ margin: '0 0 6px' }}>Have at hand: {s.need}.</p>}
    <ol className="start-steps">{s.steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
    {s.tips?.length ? <ul className="start-tips">{s.tips.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}
    <Link className={`btn sm${done ? '' : ' primary'}`} to={s.to}>{s.toLabel} →</Link>
  </>
  return <Card span={12} id={'start-' + s.key} className={`start-step${done ? ' is-done' : ''}${next ? ' is-next' : ''}`} help="Setup step"
    title={`${n}. ${s.title}`} hint={`about ${s.minutes} min${s.optional ? ' · optional' : ''} · ${st?.detail || ''}`} right={status}>
    {done ? <details><summary>Show the steps again</summary>{body}</details> : body}
  </Card>
}
