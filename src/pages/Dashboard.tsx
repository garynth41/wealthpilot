import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../app/hooks'
import { Card, KPI, Btn, Pill, Note, AList, Seg, useModal } from '../components/ui'
import { Chart, cssVar, C, Gauge } from '../components/Chart'
import { spanFor, findPeriod } from '../lib/periods'
import { periodStat, rangeStat } from '../lib/budget'
import { upcoming, STATUS_PILL } from '../lib/recurring'
import { cashCalendar, burn, runwayProjection, netWorthSeries, safeToSpend } from '../lib/forecast'
import { cashOnHand, netWorth, liabilities, debtDueState, acctLabel, debtBal } from '../lib/accounts'
import { accountState, type RTxn } from '../lib/reconcile'
import { debtTotals } from '../lib/debts'
import { goalProgress } from '../lib/goals'
import { payDates } from '../lib/paySchedule'
import { isOpenItem } from '../lib/email/apply'
import { fmtMoney, sum } from '../lib/money'
import { addDays, diffDays, fmtD, fmtDY, today } from '../lib/dates'
import { AddTxn } from './Transactions'
import { linkTo } from '../lib/focus'

export function DashboardPage() { return <Dashboard /> }
export function Dashboard() {
  const [view, setView] = useState<'overview' | 'balances'>('overview')
  const { data, settings, canEdit } = useData(); const { open, close } = useModal(); const t = today(); const c = C()
  const sp = spanFor(data, settings); const period = findPeriod(data, sp); const ps = useMemo(() => (period ? periodStat(data, settings, period) : null), [data, settings, period])
  const cash = cashOnHand(data, settings); const nw = netWorth(data); const b = useMemo(() => burn(data, settings), [data, settings]); const sts = useMemo(() => safeToSpend(data, settings), [data, settings]); const cal = useMemo(() => cashCalendar(data, settings, 30), [data, settings]); const proj = useMemo(() => runwayProjection(data, settings), [data, settings])
  const pm = proj.zeroAt ? diffDays(proj.zeroAt, t) / 30.44 : Infinity; const cls = pm >= settings.runwayGreen ? 'good' : pm >= settings.runwayYellow ? 'warn' : 'crit'
  const up = useMemo(() => upcoming(data, addDays(t, -30), addDays(t, 14)).filter(u => !['paid', 'skipped'].includes(u.status)), [data, t]); const over = up.filter(u => u.status === 'overdue')
  const dt = debtTotals(data); const nws = netWorthSeries(data); const prev = nws.length > 1 ? nws[nws.length - 2] : null
  const nextPay = data.paySchedules.filter(p => p.status === 'Active').flatMap(p => payDates(p, t, addDays(t, 60)).map(d => ({ p, d }))).sort((a, b) => a.d.localeCompare(b.d))[0]
  const goals = data.goals.filter(g => g.status === 'Active').map(g => ({ g, p: goalProgress(data, g) })).sort((a, b) => a.g.priority - b.g.priority).slice(0, 4)
  const attention: Array<{ c: string; t: string; m: string; d?: string; id?: string }> = []
  over.forEach(u => attention.push({ c: 'crit', id: u.r.id, t: `${u.r.name} is overdue`, m: `${fmtMoney(u.amount)} was due ${fmtDY(u.date)}`, d: 'Bills' }))
  { const fail = data.audit.find(e => e.kind === 'sync' || e.kind === 'sync_failure'); if (fail && fail.kind === 'sync_failure') attention.push({ c: 'crit', t: 'Bank sync failed', m: fail.summary.replace(/^Bank sync failed: /, '') + ' — balances kept from the last good sync', d: 'Cash & Account Operations' }) }
  data.accounts.filter(a => a.status === 'Active' && a.bank_balance != null).forEach(a => { const s = accountState(a, data.transactions as unknown as RTxn[]); if (Math.abs(s.variance) >= 1) attention.push({ c: 'warn', id: a.id, t: `${acctLabel(a, data.accounts)}: book differs from verified balance`, m: `${fmtMoney(Math.abs(s.variance))} unexplained — reconcile`, d: 'Reconcile' }); else if (s.outstandingChecksCount && s.outstandingChecks > 0 && !a.last_reconciled_on) attention.push({ c: 'info', id: a.id, t: `${acctLabel(a, data.accounts)}: ${s.outstandingChecksCount} outstanding`, m: `${fmtMoney(s.outstandingChecks)} not yet at the bank`, d: 'Reconcile' }) })
  liabilities(data).filter(a => debtDueState(a).cls === 'crit').forEach(a => attention.push({ c: 'crit', id: a.id, t: `${acctLabel(a, data.accounts)} payment overdue`, m: `minimum ${fmtMoney(a.minimum_payment)} was due ${fmtDY(a.due_date!)}`, d: 'Accounts' }))
  data.emailItems.filter(x => (isOpenItem(x) && ['pastdue', 'declined'].includes(x.kind)) || (x.kind === 'alert' && x.status === 'Alert')).forEach(x => attention.push({ c: 'crit', id: x.id, t: `${x.payee}: ${x.kind === 'declined' ? 'payment declined' : x.kind === 'alert' ? 'bank alert' : 'past due'}`, m: x.amount != null ? fmtMoney(x.amount) : 'see the email', d: 'Email' }))
  if (cal.firstZero) attention.push({ c: 'crit', t: `Cash runs out ${fmtDY(cal.firstZero)}`, m: 'in the 30-day calendar — move a bill or add income', d: 'Forecast' }); else if (cal.firstFloor) attention.push({ c: 'warn', t: `Below your reserve floor on ${fmtDY(cal.firstFloor)}`, m: `lowest point ${fmtMoney(cal.low.bal)}`, d: 'Forecast' })
  if (ps && ps.pace != null && ps.pace > 1.1) attention.push({ c: 'warn', t: 'Variable spending is ahead of pace', m: `${Math.round(ps.pace * 100)}% of the pro-rated budget`, d: 'Budget' })
  ps?.lines.filter(l => l.state === 'crit').slice(0, 3).forEach(l => attention.push({ c: 'warn', t: `${l.cat.name} is over budget`, m: `${fmtMoney(l.actual)} of ${fmtMoney(l.available)}`, d: 'Budget' }))
  if (ps && ps.uncat > 0) attention.push({ c: 'info', t: `${fmtMoney(ps.uncat)} uncategorized this period`, m: 'categorize it so the budget is right', d: 'Transactions' })
  data.hardship.filter(h => !['Closed', 'Not needed', 'Declined', 'Enrolled'].includes(h.status) && h.next_followup && h.next_followup <= t).forEach(h => attention.push({ c: 'warn', id: h.id, t: `Call ${h.entity}`, m: `follow-up ${h.next_followup === t ? 'today' : 'was ' + fmtDY(h.next_followup!)}`, d: 'Hardship' }))
  if (!attention.length) attention.push({ c: 'good', t: 'Nothing needs attention', m: 'bills are on track, cash is above the floor, the budget is within plan' })
  const last30 = rangeStat(data, addDays(t, -29), t); const grpRows = Object.entries(last30.byGroup).sort((a, b) => b[1] - a[1]).slice(0, 7)
  const link: Record<string, string> = { Bills: '/bills', Accounts: '/accounts', Email: '/email', Forecast: '/forecast', Budget: '/budget', Transactions: '/transactions', Hardship: '/hardship', Reconcile: '/reconcile', 'Cash & Account Operations': '/connections' }
  return <>
    <div style={{ marginBottom: 14 }}><Seg value={view} options={[['overview', 'Overview'], ['balances', 'Account balances']]} onChange={setView} /></div>
    {view === 'balances' && <div className="grid g12">
      <Card span={12} title="Account balances" hint="as you last updated them"><div className="kpis">{data.accounts.filter(a => a.status === 'Active').sort((a, b) => a.sort_order - b.sort_order).map(a => { const li = liabilities(data).includes(a); const st = li ? debtDueState(a) : null; return <div key={a.id} className={`kpi ${li ? (st!.cls === 'info' ? 'wait' : st!.cls) : 'good'}`}><div className="l"><Link to={linkTo('/accounts', a.id)} style={{ color: 'inherit' }}>{acctLabel(a, data.accounts)}</Link></div><div className="v" style={{ fontSize: 20 }}>{li ? '−' : ''}{fmtMoney(li ? debtBal(a) : a.balance)}</div><div className="s">{li ? `${st!.label}${a.minimum_payment ? ' · min ' + fmtMoney(a.minimum_payment) : ''}` : a.balance_as_of ? `as of ${fmtD(a.balance_as_of)}` : a.kind}</div></div> })}</div></Card>
    </div>}
    {view === 'overview' && <>
    <div className="kpis" style={{ marginBottom: 16 }}>
      <KPI l="Safe to spend" v={fmtMoney(sts.safe)} cls={sts.short > 0 ? 'crit' : sts.safe < sts.perDay * 3 ? 'warn' : 'good'} s={sts.short > 0 ? `${fmtMoney(sts.short)} short of what is committed before ${sts.payday ? 'payday ' + fmtDY(sts.payday) : fmtDY(sts.until)}` : `${fmtMoney(Math.round(sts.perDay))}/day for ${sts.days} day${sts.days === 1 ? '' : 's'} · ${fmtMoney(sts.committed)} committed${sts.payday ? ' until payday ' + fmtDY(sts.payday) : ''}`} />
      <KPI l="Cash on hand" v={fmtMoney(cash)} cls="good" s={settings.reserveFloor ? `${cash >= settings.reserveFloor ? fmtMoney(cash - settings.reserveFloor) + ' above' : fmtMoney(settings.reserveFloor - cash) + ' below'} the ${fmtMoney(settings.reserveFloor)} floor` : 'checking + savings + cash'} />
      <KPI l={ps ? `Left to spend · ${sp.label}` : 'Budget'} v={ps ? fmtMoney(ps.left) : '—'} cls={!ps ? 'idle' : ps.left < 0 ? 'crit' : ps.pace != null && ps.pace > 1 ? 'warn' : 'good'} s={ps ? `${fmtMoney(ps.spA)} of ${fmtMoney(ps.spB)} spent · ${Math.round(ps.elapsed * 100)}% of period gone` : 'start a period on the Budget page'} />
      <KPI l="Due next 14 days" v={fmtMoney(sum(up.filter(u => u.date >= t && u.r.kind !== 'income').map(u => u.amount)))} cls={over.length ? 'crit' : up.length ? 'warn' : 'good'} s={over.length ? `${over.length} overdue` : `${up.filter(u => u.date >= t).length} payments`} />
      <KPI l="Next paycheck" v={nextPay ? fmtD(nextPay.d) : '—'} cls="info" s={nextPay ? `${fmtMoney(nextPay.p.net_amount)} · in ${diffDays(nextPay.d, t)} days` : 'add a pay schedule'} />
      <KPI l="Runway" v={!isFinite(pm) ? '24+ mo' : pm.toFixed(1) + ' mo'} cls={cls} s={b.net > 0 ? `burning ${fmtMoney(b.net)}/mo` : `saving ${fmtMoney(-b.net)}/mo`} />
      <KPI l="Debt" v={fmtMoney(dt.balance)} cls={dt.balance ? 'warn' : 'good'} s={dt.balance ? `${fmtMoney(dt.planned)}/mo planned · ${dt.limit ? Math.round(dt.util * 100) + '% utilization' : 'set limits'}` : 'debt-free'} />
      <KPI l="Net worth" v={fmtMoney(nw.net)} cls={nw.net >= 0 ? 'good' : 'crit'} s={prev ? `${nw.net - prev.net >= 0 ? '+' : ''}${fmtMoney(nw.net - prev.net)} since ${fmtD(prev.date)}` : 'record a snapshot on Accounts'} />
      <KPI l="Savings rate" v={ps?.rate != null ? Math.round(ps.rate * 100) + '%' : last30.income ? Math.round(last30.net / last30.income * 100) + '%' : '—'} cls={(ps?.rate ?? (last30.income ? last30.net / last30.income : 0)) >= settings.savingsTargetPct / 100 ? 'good' : 'warn'} s={ps?.rate != null ? 'this period' : 'last 30 days'} /></div>
    {canEdit && <div className="btnrow" style={{ marginBottom: 14 }}><Btn primary onClick={() => open(<AddTxn onDone={close} />, { wide: true })}>+ Log a transaction</Btn><Link className="btn" to="/bills">Pay a bill</Link><Link className="btn" to="/email">Check email</Link><Link className="btn" to="/accounts">Update balances</Link></div>}
    <div className="grid g12">
      <Card span={5} title="Needs attention" hint="what to do today"><AList items={attention.map(a => ({ c: a.c, t: a.d ? <Link to={linkTo(link[a.d] || '/', a.id)}>{a.t}</Link> : a.t, m: a.m }))} /></Card>
      <Card span={7} className="fill" title="Cash — next 30 days" hint="balance on top · each day's money in and out below"><Chart fill title="Cash — next 30 days" data={cashChartData(cal, c)} layout={cashChartLayout(cal, c)} height={300} /><Note>Lowest point {fmtMoney(cal.low.bal)} on {fmtDY(cal.low.date)} · in {fmtMoney(cal.inTot)} · out {fmtMoney(cal.outTot)} · hover a day for its paychecks and bills · <Link to="/forecast">full forecast</Link></Note></Card>
      <Card span={6} title="Coming up" hint="next 14 days">{up.length ? <div className="tblwrap" style={{ maxHeight: 300 }}><table className="tbl"><thead><tr><th>Date</th><th>Item</th><th className="num">Amount</th><th>Status</th></tr></thead><tbody>{up.map((u, i) => <tr key={i} className={`st-${STATUS_PILL[u.status].cls === 'info' ? 'wait' : STATUS_PILL[u.status].cls}`}><td>{fmtD(u.date)}</td><td><Link to={linkTo('/bills', u.r.id)}>{u.r.name}</Link></td><td className="num">{fmtMoney(u.amount)}</td><td><Pill cls={STATUS_PILL[u.status].cls}>{STATUS_PILL[u.status].label}</Pill></td></tr>)}</tbody></table></div> : <div className="empty">Nothing due in the next two weeks.</div>}<Note><Link to="/bills">All bills & subscriptions →</Link></Note></Card>
      <Card span={6} title={ps ? `Budget · ${sp.label}` : 'Budget'} hint="planned vs spent by group">{ps ? <>{Object.entries(ps.lines.reduce<Record<string, { p: number; a: number }>>((g, l) => { const k = l.cat.group || 'Other'; g[k] = g[k] || { p: 0, a: 0 }; g[k].p += l.available; g[k].a += l.actual; return g }, {})).sort((a, b) => b[1].p - a[1].p).map(([k, v]) => <div key={k} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 110px', gap: 10, alignItems: 'center', padding: '5px 0', borderTop: '1px solid var(--line-2)' }}><span>{k}</span><span className="usebar" style={{ width: '100%' }}><i style={{ width: Math.min(100, v.p ? Math.round(v.a / v.p * 100) : v.a > 0 ? 100 : 0) + '%', background: `var(--${v.a > v.p ? 'crit' : v.a > v.p * 0.9 ? 'warn' : 'good'})` }} /></span><span className="num" style={{ textAlign: 'right', fontSize: 12.5 }}>{fmtMoney(v.a)} / {fmtMoney(v.p)}</span></div>)}<Note><Link to="/budget">Open the budget →</Link></Note></> : <div className="empty"><Link to="/budget">Start this period's budget</Link></div>}</Card>
      <Card span={4} title="Runway" hint="months to zero in the 24-month projection"><Gauge value={isFinite(pm) ? pm : 24} max={24} color={{ good: c.good, warn: c.warn, crit: c.crit }[cls]} steps={[{ range: [0, settings.runwayYellow], color: c.critSoft }, { range: [settings.runwayYellow, settings.runwayGreen], color: getComputedStyle(document.documentElement).getPropertyValue('--warn-soft').trim() }, { range: [settings.runwayGreen, 24], color: c.accentSoft }]} label={isFinite(pm) ? pm.toFixed(1) + ' mo' : '24+ mo'} /><Note>{proj.zeroAt ? `Cash out ${fmtDY(proj.zeroAt)} at the current pace` : 'Cash stays positive for the next 24 months'}</Note></Card>
      <Card span={4} title="Goals" hint="top priorities">{goals.length ? goals.map(({ g, p }) => <div key={g.id} style={{ marginBottom: 10 }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><Link to={linkTo('/goals', g.id)}>{g.name}</Link><span style={{ color: 'var(--ink-3)' }}>{fmtMoney(p.saved)} / {fmtMoney(g.target_amount)}</span></div><div className="mix" style={{ height: 8, marginTop: 4 }}><span style={{ width: Math.round(p.pct * 100) + '%', background: g.color || 'var(--accent)' }} /></div>{p.onTrack === false && <div className="note" style={{ marginTop: 2, color: 'var(--warn)' }}>behind — need {fmtMoney(p.needPerMonth || 0)}/mo</div>}</div>) : <div className="empty">No goals yet.</div>}<Note><Link to="/goals">All goals →</Link></Note></Card>
      <Card span={4} title="Spending · last 30 days" hint="by group">{grpRows.length ? <AList items={grpRows.map(([k, v]) => ({ c: 'info', t: k, d: fmtMoney(v) }))} /> : <div className="empty">No spending logged yet.</div>}<Note>Total {fmtMoney(last30.spend)} · debt payments {fmtMoney(last30.debt)} · <Link to="/trends">trends →</Link></Note></Card>
    </div>
  </>}
  </>
}

type Cal = ReturnType<typeof cashCalendar>; type Cc = ReturnType<typeof C>
/** Two bands sharing the date axis: the projected balance (step line, ink, filled) with paydays and the low point marked, and under it each day's inflows (green) and outflows (orange) as bars. */
function cashChartData(cal: Cal, c: Cc) {
  const days = cal.daily.map(x => x.d); const inBy = new Map<string, number>(), outBy = new Map<string, number>(), labels = new Map<string, string[]>()
  for (const it of cal.items) { if (it.amt >= 0) inBy.set(it.date, (inBy.get(it.date) || 0) + it.amt); else outBy.set(it.date, (outBy.get(it.date) || 0) + it.amt); labels.set(it.date, [...(labels.get(it.date) || []), `${it.amt >= 0 ? '+' : '−'}$${Math.abs(it.amt).toFixed(0)} ${it.label}`]) }
  const txt = (d: string) => (labels.get(d) || []).join('<br>')
  const pays = cal.items.filter(i => i.src === 'pay' && i.amt > 0 && i.bal != null)
  return [
    { type: 'scatter' as const, mode: 'lines' as const, name: 'Balance', x: days, y: cal.daily.map(x => x.bal), line: { color: c.ink, width: 2.5, shape: 'hv' as const }, fill: 'tozeroy' as const, fillcolor: cssVar('--ground'), hovertemplate: '%{x|%a %b %d} · balance <b>$%{y:,.0f}</b><extra></extra>' },
    { type: 'scatter' as const, mode: 'markers' as const, name: 'Payday', x: pays.map(i => i.date), y: pays.map(i => i.bal!), marker: { color: c.good, size: 11, symbol: 'diamond', line: { color: cssVar('--surface'), width: 1.5 } }, text: pays.map(i => `+$${i.amt.toFixed(0)} ${i.label}`), hovertemplate: '%{x|%a %b %d} · %{text}<extra></extra>' },
    { type: 'scatter' as const, mode: 'markers' as const, name: 'Lowest point', x: [cal.low.date], y: [cal.low.bal], marker: { color: cssVar('--gold'), size: 13, line: { color: cssVar('--surface'), width: 2 } }, hovertemplate: '%{x|%a %b %d} · lowest point <b>$%{y:,.0f}</b><extra></extra>' },
    { type: 'bar' as const, name: 'Money in', x: days, y: days.map(d => inBy.get(d) || 0), yaxis: 'y2', marker: { color: c.good }, text: days.map(txt), textposition: 'none' as const, hovertemplate: '%{x|%a %b %d}<br>%{text}<extra></extra>' },
    { type: 'bar' as const, name: 'Money out', x: days, y: days.map(d => outBy.get(d) || 0), yaxis: 'y2', marker: { color: c.warn }, text: days.map(txt), textposition: 'none' as const, hovertemplate: '%{x|%a %b %d}<br>%{text}<extra></extra>' }]
}
function cashChartLayout(cal: Cal, c: Cc) {
  const ys = cal.daily.map(x => x.bal).concat(cal.floor ? [cal.floor] : []); const lo = Math.min(0, ...ys), hi = Math.max(...ys); const pad = Math.max(200, (hi - lo) * 0.12)
  const x0 = cal.daily[0].d, x1 = cal.daily[cal.daily.length - 1].d
  return { showlegend: false, barmode: 'relative' as const, bargap: 0.3, hovermode: 'x unified' as const, margin: { t: 28, b: 34, l: 54, r: 14 },
    xaxis: { type: 'date' as const, tickformat: '%b %d', showgrid: false, anchor: 'y2' as const },
    yaxis: { domain: [0.36, 1], tickprefix: '$', range: [Math.max(0, Math.min(...ys) - pad), hi + pad], fixedrange: true, zeroline: false },
    yaxis2: { domain: [0, 0.27], tickformat: '$~s', nticks: 3, showgrid: false, zeroline: true, zerolinecolor: c.line, fixedrange: true },
    shapes: cal.floor ? [{ type: 'line' as const, x0, x1, y0: cal.floor, y1: cal.floor, line: { color: c.crit, width: 1, dash: 'dot' as const } }] : [],
    annotations: [
      { x: cal.low.date, y: cal.low.bal, yref: 'y' as const, text: `low ${fmtMoney(cal.low.bal)}`, showarrow: true, arrowhead: 0, arrowcolor: cssVar('--gold'), ax: 0, ay: -30, font: { size: 12, color: c.ink2 }, bgcolor: cssVar('--surface'), bordercolor: cssVar('--gold'), borderwidth: 1, borderpad: 3 },
      ...(cal.floor ? [{ x: x0, y: cal.floor, yref: 'y' as const, text: `floor ${fmtMoney(cal.floor)}`, showarrow: false, xanchor: 'left' as const, yanchor: 'bottom' as const, font: { size: 11, color: c.crit }, bgcolor: cssVar('--surface'), borderpad: 2 }] : []),
      { x: x0, y: 1, xref: 'x' as const, yref: 'y2 domain' as const, text: 'in / out per day', showarrow: false, xanchor: 'left' as const, yanchor: 'bottom' as const, font: { size: 11, color: c.ink3 } }] }
}
