// Plan (0.20.0): one timeline for cash, debt payoff, goal contributions and retirement saving. An extra amount per month is allocated
// once — by the rule you pick — and "Apply this plan" writes the result where the other pages read it (goal contributions, retirement
// contribution, and the Debts page's extra payment), so every page agrees.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../app/hooks'
import { Card, KPI, Btn, Note, Seg, Field, Pill, useModal, MHead, MBody, MFoot } from '../components/ui'
import { Chart, C } from '../components/Chart'
import { ScenarioBar } from '../components/Scenarios'
import { buildPlan, normalizePlan, applyPlanPatches, affordableExtra, type PlanAssumptions, type AllocMode } from '../lib/plan'
import { RETIREMENT_DEFAULTS } from '../lib/retirement'
import { fmtMoney, fm2, sum } from '../lib/money'
import { fmtDY, fmtD, diffDays, today } from '../lib/dates'
import { acctLabel } from '../lib/accounts'
import { hasMoneyData } from '../lib/onboarding'
import { isLiability } from '../lib/accounts'

const MODES: Array<[AllocMode, string]> = [['debt_first', 'Debt first'], ['goals_first', 'Goals first'], ['retirement_first', 'Retirement first'], ['split', 'Split']]
export function PlanPage() {
  const { data, settings, saveSettings, update, guarded, canEdit } = useData(); const { open, close } = useModal(); const c = C()
  const [a, setA] = useState<PlanAssumptions>(() => normalizePlan(settings.plan?.assumptions as Partial<PlanAssumptions> | undefined))
  const set = (p: Partial<PlanAssumptions>) => setA(x => normalizePlan({ ...x, ...p }))
  const r = useMemo(() => buildPlan(data, settings, a), [data, settings, a])
  const base = useMemo(() => buildPlan(data, settings, { ...a, extra: 0, rollFreed: false }), [data, settings, a])
  const noExtraKey = JSON.stringify({ ...a, extra: 0 }); const af = useMemo(() => affordableExtra(data, settings, { ...a, extra: 0 }), [data, settings, noExtraKey])   // eslint-disable-line react-hooks/exhaustive-deps
  const t = today(); const last = r.months[r.months.length - 1]
  const reached = r.goals.filter(g => g.reachedOn), baseReached = base.goals.filter(g => g.reachedOn)
  const sooner = r.debtFreeMonth != null && base.debtFreeMonth != null ? base.debtFreeMonth - r.debtFreeMonth : r.debtFreeMonth != null && base.debtFreeMonth == null ? null : 0
  const max = Math.max(1000, Math.ceil((r.months[0]?.income || 0) * 0.5 / 100) * 100, Math.ceil(af.max * 1.5 / 100) * 100)
  const applied = settings.plan; const appliedMatches = applied && JSON.stringify(normalizePlan(applied.assumptions as Partial<PlanAssumptions>)) === JSON.stringify(a)
  const apply = () => { const p = applyPlanPatches(data, settings, r); const ri = { ...RETIREMENT_DEFAULTS, ...(settings.retirement || {}) }
    open(<><MHead title="Apply this plan" /><MBody>
      <p className="note" style={{ marginTop: 0 }}>This writes this month's allocation where the other pages read it. A later apply replaces these amounts; it never adds to them.</p>
      <ul className="alist">
        <li><span className="dot info" /><div><b>Debt</b><div className="m">{p.plan.debtExtra > 0 ? <>The Debts page starts its extra-payment slider at {fm2(p.plan.debtExtra)}/mo ({a.strategy}{r.now.focus ? `, focus: ${acctLabel(r.now.focus, data.accounts)}` : ''}).</> : 'No extra to debt this month.'}</div></div></li>
        {p.goals.map(g => { const goal = data.goals.find(x => x.id === g.id)!; return <li key={g.id}><span className="dot good" /><div><b>{goal.name}</b><div className="m">monthly contribution {fm2(g.from)} → <b>{fm2(g.to)}</b></div></div></li> })}
        <li><span className="dot info" /><div><b>Retirement</b><div className="m">{Math.abs(p.retirement.to - p.retirement.from) > 0.005 ? <>contribution {fmtMoney(p.retirement.from)}/yr → <b>{fmtMoney(p.retirement.to)}/yr</b></> : `unchanged at ${fmtMoney(ri.annualContribution)}/yr`}</div></div></li>
      </ul>
    </MBody><MFoot><Btn onClick={close}>Cancel</Btn><Btn primary onClick={() => guarded(async () => {
      for (const g of p.goals) await update('goals', g.id, { monthly_contribution: g.to })
      await saveSettings({ plan: p.plan, retirement: { ...ri, annualContribution: p.retirement.to } }); close()
    }, 'Plan applied — Debts, Goals and Retirement now use it')}>Apply</Btn></MFoot></>) }
  const clearApplied = () => guarded(async () => { if (!applied) return; const p = applyPlanPatches(data, settings, { ...r, now: { debt: 0, goals: {}, retirement: 0, cash: 0, focus: null } })
    for (const g of p.goals) await update('goals', g.id, { monthly_contribution: g.to }); const ri = { ...RETIREMENT_DEFAULTS, ...(settings.retirement || {}) }
    await saveSettings({ plan: undefined, retirement: { ...ri, annualContribution: p.retirement.to } }) }, 'Plan removed — contributions are back to what they were')

  const xs = r.months.map(m => m.date)
  const rows = r.months
  return <>
    <div className="kpis" style={{ marginBottom: 16 }}>
      <KPI l="Debt-free on" v={!data.accounts.some(x => x.status === 'Active' && isLiability(x)) ? 'No debt' : r.debtFree ? fmtDY(r.debtFree) : `beyond ${a.months} mo`} cls={r.debtFree ? 'good' : 'warn'} s={sooner ? `${sooner} month${sooner === 1 ? '' : 's'} sooner than today's plan` : base.debtFree ? `today's plan: ${fmtDY(base.debtFree)}` : 'no debt in the plan'} />
      <KPI l="Interest" v={fmtMoney(r.interest)} cls={r.interest < base.interest ? 'good' : 'info'} s={r.interest < base.interest - 0.5 ? `saves ${fmtMoney(base.interest - r.interest)}` : `over ${a.months} months`} />
      <KPI l="Goals reached" v={`${reached.length} of ${r.goals.length}`} cls={reached.length >= baseReached.length ? 'good' : 'warn'} s={`today's plan: ${baseReached.length}`} />
      <KPI l="Lowest unallocated cash" v={fmtMoney(r.low.cash)} cls={r.low.cash < 0 ? 'crit' : r.floor && r.low.cash < r.floor ? 'warn' : 'good'} s={r.zeroAt ? `below zero ${fmtD(r.zeroAt)}` : r.floorBreach ? `below the floor ${fmtD(r.floorBreach)}` : fmtDY(r.low.date)} />
      <KPI l={`Retirement in ${a.months} mo`} v={fmtMoney(r.endRetire)} cls="info" s={r.totals.retireExtra ? `+${fmtMoney(r.endRetire - base.endRetire)} from the plan` : "today's dollars"} />
      <KPI l="Net worth change" v={(last?.netWorthDelta ?? 0) >= 0 ? '+' + fmtMoney(last?.netWorthDelta ?? 0) : fmtMoney(last?.netWorthDelta ?? 0)} cls={(last?.netWorthDelta ?? 0) >= 0 ? 'good' : 'crit'} s={`over ${a.months} months`} />
    </div>
    {applied && <div className={`banner ${appliedMatches ? 'good' : ''}`} style={{ marginBottom: 12 }}>{appliedMatches ? <><b>This plan is applied</b> since {fmtDY(applied.appliedAt.slice(0, 10))} — the Debts, Goals and Retirement pages use it.</> : <><b>A different plan is applied</b> ({fmtDY(applied.appliedAt.slice(0, 10))}: {fm2(applied.debtExtra)}/mo to debt{Object.keys(applied.goalExtra).length ? `, ${fm2(sum(Object.values(applied.goalExtra)))}/mo to goals` : ''}{applied.retireExtra ? `, ${fm2(applied.retireExtra)}/mo to retirement` : ''}). Apply these sliders to replace it.</>}{canEdit && <span style={{ marginLeft: 8 }}><Btn sm onClick={clearApplied}>Remove applied plan</Btn></span>}</div>}
    {!hasMoneyData(data) ? <div className="banner info" style={{ marginBottom: 12 }}><b>The plan needs something to plan with.</b> Add your <Link to="/accounts">accounts</Link>, <Link to="/income">income</Link> and <Link to="/bills">bills</Link>; then this page shows where extra money does the most good.</div>
      : af.full && !af.baselineBreaches ? <div className="banner info" style={{ marginBottom: 12 }}><b>Nothing needs extra money right now.</b> There is no debt left to pay down, every goal is full and retirement is fully funded, so any extra stays as cash. Add a goal on <Link to="/goals">Goals</Link> or raise the income you want in retirement on <Link to="/investments">Investments</Link> to put it to work.</div>
      : af.baselineBreaches || af.max === 0 ? <div className="banner crit" style={{ marginBottom: 12 }}><b>No room for extra money yet.</b> {af.baselineBreaches ? <>Even with nothing extra, unallocated cash drops below {af.floor ? `your ${fmtMoney(af.floor)} floor` : 'zero'}{af.breachOn ? ` on ${fmtDY(af.breachOn)}` : ''}</> : <>Today's plan already takes unallocated cash down to {fmtMoney(base.low.cash)} ({fmtDY(base.low.date)}){af.floor ? `, right at your ${fmtMoney(af.floor)} floor` : ''}</>} — spending, goal contributions and debt payments use what comes in. Try the spending and income what-ifs below, or lower a goal's monthly contribution, and this figure updates.</div>
      : a.extra > af.max ? <div className="banner warn" style={{ marginBottom: 12 }}><b>{fmtMoney(a.extra)}/mo is more than the budget allows.</b> Unallocated cash would drop below {af.floor ? `your ${fmtMoney(af.floor)} floor` : 'zero'}{(af.floor ? r.floorBreach : r.zeroAt) ? ` on ${fmtDY((af.floor ? r.floorBreach : r.zeroAt) || '')}` : ''}. Up to <b>{fmtMoney(af.max)}/mo</b> fits over the next {a.months} months. <Btn sm onClick={() => set({ extra: af.max })}>Use {fmtMoney(af.max)}</Btn></div>
      : <div className="banner good" style={{ marginBottom: 12 }}>Up to <b>{fmtMoney(af.max)}/mo</b> extra fits without unallocated cash dropping below {af.floor ? `your ${fmtMoney(af.floor)} floor` : 'zero'} over the next {a.months} months{a.extra > 0 && a.extra < af.max ? ` — ${fmtMoney(af.max - a.extra)}/mo more is available` : ''}.{a.extra === 0 ? <> <Btn sm onClick={() => set({ extra: af.max })}>Use {fmtMoney(af.max)}</Btn></> : null}</div>}
    <div className="grid g12">
      <Card span={5} title="Your extra money" hint="on top of every planned payment and contribution">
        <ScenarioBar kind="plan" current={a as unknown as Record<string, unknown>} onLoad={x => setA(normalizePlan(x as Partial<PlanAssumptions>))} />
        <Field label={`Extra per month: ${fmtMoney(a.extra)}`}><input className="rng" type="range" min={0} max={max} step={25} value={a.extra} onChange={e => set({ extra: +e.target.value })} aria-label="Extra per month" /></Field>
        <div style={{ marginBottom: 8 }}><Seg value={a.mode} options={MODES} onChange={mode => set({ mode })} /></div>
        {a.mode === 'split' && <div className="grid3">{(['debt', 'goals', 'retirement'] as const).map(k => <Field key={k} label={`${k[0].toUpperCase() + k.slice(1)} ${Math.round(a.split[k] / ((a.split.debt + a.split.goals + a.split.retirement) || 1) * 100)}%`}><input className="rng" type="range" min={0} max={100} step={5} value={a.split[k]} onChange={e => set({ split: { ...a.split, [k]: +e.target.value } })} aria-label={`${k} share`} /></Field>)}</div>}
        <div className="grid2"><Field label="Debt order"><select className="inp" value={a.strategy} onChange={e => set({ strategy: e.target.value as PlanAssumptions['strategy'] })}><option value="avalanche">Avalanche · highest rate first</option><option value="snowball">Snowball · smallest balance first</option></select></Field>
          <Field label="Horizon"><select className="inp" value={a.months} onChange={e => set({ months: +e.target.value })}>{[24, 36, 60, 120].map(n => <option key={n} value={n}>{n} months{n >= 60 ? ` (${n / 12} years)` : ''}</option>)}</select></Field></div>
        <label className="gm-ign" style={{ fontSize: 13 }}><input type="checkbox" checked={a.rollFreed} onChange={e => set({ rollFreed: e.target.checked })} /> when the last debt is paid, keep its payments working (they join the extra)</label>
        <details style={{ marginTop: 10 }}><summary style={{ cursor: 'pointer', fontSize: 13 }}>Income and spending what-ifs</summary>
          <Field label={`Cut bills + everyday spending by ${a.cutPct}%`}><input className="rng" type="range" min={0} max={50} step={5} value={a.cutPct} onChange={e => set({ cutPct: +e.target.value })} aria-label="Spending cut" /></Field>
          <div className="grid2"><Field label="Extra income / month"><input className="inp" inputMode="decimal" value={a.extraIncome || ''} placeholder="0" onChange={e => set({ extraIncome: +e.target.value.replace(/[^\d.]/g, '') || 0 })} /></Field><Field label="Current income stops on"><input className="inp" type="date" value={a.incomeEndsOn || ''} onChange={e => set({ incomeEndsOn: e.target.value || null })} /></Field></div>
        </details>
        {canEdit && <div className="btnrow" style={{ marginTop: 12 }}><Btn primary onClick={apply} disabled={!!appliedMatches}>{appliedMatches ? 'Applied' : 'Apply this plan…'}</Btn><Btn onClick={() => setA(normalizePlan({}))}>Reset sliders</Btn></div>}
        <Note>The plan starts from today's balances, pay schedules, bills, planned items and every account's planned payment — it only decides where the <b>extra</b> goes. Base retirement contributions come out of pay; only extra sent to retirement leaves cash.</Note>
      </Card>
      <Card span={7} title="Where this month's extra goes" hint={a.extra ? `${fmtMoney(a.extra)} · ${MODES.find(m => m[0] === a.mode)![1].toLowerCase()}` : 'move the slider to allocate extra money'}>
        <div className="plan-alloc">
          <div className={`b${r.now.debt > 0 ? ' on' : ''}`}><div className="l">Debt</div><div className="v">{fmtMoney(r.now.debt)}</div><div className="s">{r.now.focus ? `to ${acctLabel(r.now.focus, data.accounts)}` : r.startDebt ? '—' : 'no debt'}</div></div>
          <div className={`b${sum(Object.values(r.now.goals)) > 0 ? ' on' : ''}`}><div className="l">Goals</div><div className="v">{fmtMoney(sum(Object.values(r.now.goals)))}</div><div className="s">{Object.entries(r.now.goals).map(([id, v]) => `${data.goals.find(g => g.id === id)?.name} ${fmtMoney(v)}`).join(' · ') || (r.goals.length ? '—' : 'no active goals')}</div></div>
          <div className={`b${r.now.retirement > 0 ? ' on' : ''}`}><div className="l">Retirement</div><div className="v">{fmtMoney(r.now.retirement)}</div><div className="s">{r.now.retirement ? `${fmtMoney(r.now.retirement * 12)}/yr more` : r.retireNeed <= 0.005 ? 'fully funded — needs nothing more' : '—'}</div></div>
          <div className="b"><div className="l">Stays as cash</div><div className="v">{fmtMoney(r.now.cash)}</div><div className="s">{r.now.cash > 0 ? 'nowhere left to send it' : '—'}</div></div>
        </div>
        <h3 style={{ margin: '14px 0 4px', fontSize: 14 }}>Milestones</h3>
        <div>
          {r.startDebt > 0 && <div className="mile"><span className="d">{r.debtFree ? fmtD(r.debtFree) + ' ' + r.debtFree.slice(0, 4) : '—'}</span><span className="t">Debt-free{r.debtFree && base.debtFree && r.debtFree < base.debtFree ? <> · <Pill cls="good">{sooner} mo sooner</Pill></> : !r.debtFree ? ` — not within ${a.months} months` : ''}</span><span>{fmtMoney(r.startDebt)} today</span></div>}
          {r.goals.map(g => { const b0 = base.goals.find(x => x.goal.id === g.goal.id); return <div key={g.goal.id} className="mile"><span className="d">{g.reachedOn ? (g.reachedOn === t ? 'already' : fmtD(g.reachedOn) + ' ' + g.reachedOn.slice(0, 4)) : '—'}</span><span className="t">{g.goal.name} reached{g.goal.target_date ? ` (target ${fmtDY(g.goal.target_date)})` : ''}{g.reachedOn && b0?.reachedOn && g.reachedOn < b0.reachedOn ? <> · <Pill cls="good">{Math.round(diffDays(b0.reachedOn, g.reachedOn) / 30.44)} mo sooner</Pill></> : !g.reachedOn ? ` — not within ${a.months} months` : ''}</span><span>{fmtMoney(g.target)}</span></div> })}
          {r.floorBreach && <div className="mile"><span className="d">{fmtD(r.floorBreach) + ' ' + r.floorBreach.slice(0, 4)}</span><span className="t" style={{ color: 'var(--crit)' }}>Unallocated cash drops below your {fmtMoney(r.floor)} floor</span><span /></div>}
          {!r.startDebt && !r.goals.length && <div className="empty">Add debts on <Link to="/accounts">Accounts</Link> or goals on <Link to="/goals">Goals</Link> to see milestones.</div>}
        </div>
      </Card>
      <Card span={12} title="One timeline" hint="unallocated cash, debt left and goal savings · dashed = today's plan without the extra · dotted = your reserve floor · retirement growth is in the KPI above and the table">
        <Chart title="One timeline" data={[
          { type: 'scatter', mode: 'lines', name: 'Debt', x: xs, y: rows.map(m => m.debtBal), line: { color: c.crit, width: 2 }, fill: 'tozeroy', fillcolor: 'rgba(194,65,12,0.10)', hovertemplate: '%{x|%b %Y}: $%{y:,.0f}<extra>debt</extra>' },
          { type: 'scatter', mode: 'lines', name: 'Debt · today\'s plan', x: xs, y: base.months.map(m => m.debtBal), line: { color: c.crit, width: 1, dash: 'dash' }, hovertemplate: '%{x|%b %Y}: $%{y:,.0f}<extra>today\'s plan</extra>' },
          { type: 'scatter', mode: 'lines', name: 'Goal savings', x: xs, y: rows.map(m => m.goalsSaved), line: { color: c.good, width: 2 }, hovertemplate: '%{x|%b %Y}: $%{y:,.0f}<extra>goals</extra>' },
          { type: 'scatter', mode: 'lines', name: 'Unallocated cash', x: xs, y: rows.map(m => m.cash), line: { color: c.ink, width: 2.5 }, hovertemplate: '%{x|%b %Y}: $%{y:,.0f}<extra>cash</extra>' },
        ]} layout={{ showlegend: true, xaxis: { type: 'date', tickformat: '%b %Y' }, yaxis: { tickprefix: '$', tickformat: '~s' }, shapes: r.floor ? [{ type: 'line', x0: xs[0], x1: xs[xs.length - 1], y0: r.floor, y1: r.floor, line: { color: c.crit, width: 1, dash: 'dot' } }] : [] }} height={320} />
      </Card>
      <Card span={12} title="Month by month" hint="every dollar of extra lands in exactly one column">
        <div className="tblwrap" style={{ maxHeight: 460 }}><table className="tbl"><caption className="sr-only">Plan month by month</caption><thead><tr><th scope="col">Month</th><th scope="col" className="num">Income</th><th scope="col" className="num">Spending</th><th scope="col" className="num">Debt payments</th><th scope="col" className="num">Goal contributions</th><th scope="col" className="num">Extra to retirement</th><th scope="col" className="num">Planned items</th><th scope="col" className="num">Unallocated cash</th><th scope="col" className="num">Debt left</th><th scope="col" className="num">Goals saved</th><th scope="col" className="num">Retirement</th></tr></thead>
          <tbody>{rows.map(m => <tr key={m.date} className={m.cash < 0 ? 'st-crit' : r.floor && m.cash < r.floor ? 'st-warn' : ''}><td>{new Date(m.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</td><td className="num">{fmtMoney(m.income)}</td><td className="num">{fmtMoney(m.spend)}</td><td className="num">{fmtMoney(m.debtBase + m.debtExtra)}{m.debtExtra > 0 && <small style={{ color: 'var(--good)' }}> +{fmtMoney(m.debtExtra)}</small>}</td><td className="num">{fmtMoney(m.goalBase + m.goalExtra)}{m.goalExtra > 0 && <small style={{ color: 'var(--good)' }}> +{fmtMoney(m.goalExtra)}</small>}</td><td className="num">{m.retireExtra ? fmtMoney(m.retireExtra) : '—'}</td><td className="num">{m.events ? fmtMoney(m.events) : '—'}</td><td className="num"><b>{fmtMoney(m.cash)}</b></td><td className="num">{fmtMoney(m.debtBal)}</td><td className="num">{fmtMoney(m.goalsSaved)}</td><td className="num">{fmtMoney(m.retireBal)}</td></tr>)}</tbody></table></div>
        <Note>Unallocated cash = cash on hand minus what goals already hold in cash accounts; goal contributions are set aside each month. Debt uses every account's planned payment at that month's rate (promotional rates step up on their end date — see <Link to="/debts">Debts</Link>). Spending is your recent average from the <Link to="/forecast">Forecast</Link>.</Note>
      </Card>
    </div>
  </>
}
