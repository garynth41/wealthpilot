import { useDefaultAccount } from '../app/hooks'
import { useMemo, useState } from 'react'
import { useData } from '../app/hooks'
import type { PlannedItem } from '../app/data/types'
import { Card, KPI, Btn, Note, Pill, AList, useConfirm } from '../components/ui'
import { Chart, C, Gauge } from '../components/Chart'
import { Table, type Col } from '../components/Table'
import { cashCalendar, burn, runwayProjection, cashAccounts, everydayAccount } from '../lib/forecast'
import { acctLabel, balanceOf } from '../lib/accounts'
import { ForecastAccuracy } from '../components/ForecastAccuracy'
import { useStore } from '../app/store'
import { fmtMoney, sum } from '../lib/money'
import { addDays, fmtD, fmtDY, today, diffDays } from '../lib/dates'
import { Link, useSearchParams } from 'react-router-dom'
import { ScenarioBar } from '../components/Scenarios'
import { CashCalendar } from '../components/CashCalendar'
import { normalize } from '../lib/scenarios'
import { hasMoneyData } from '../lib/onboarding'

const CATS = ['Employer payout', 'Tax refund', 'Bonus', 'Gift', 'Sale', 'Health coverage', 'Vehicle', 'Home', 'Medical', 'Insurance', 'Education', 'Family', 'Travel', 'Legal / fees', 'Transfer', 'Other']
export function ForecastPage() {
  const { data, settings, insert, update, remove, guarded, canEdit } = useData(); const confirm = useConfirm(); const modules = useStore(x => x.modules)
  const [days, setDays] = useState(60); const [cut, setCut] = useState(0); const [lean, setLean] = useState(false); const [extraInc, setExtraInc] = useState(0); const [incEnd, setIncEnd] = useState('')
  // 0.35.0: two tabs — the weeks ahead, and the long range — kept in the address so a link or the back button lands on the right one
  const [sp, setSp] = useSearchParams(); const tab: 'near' | 'long' = sp.get('view') === 'long' ? 'long' : 'near'
  const go = (v: 'near' | 'long') => setSp(p => { const n = new URLSearchParams(p); if (v === 'long') n.set('view', 'long'); else n.delete('view'); return n }, { replace: true })
  // one cash account on its own, or all cash together (the choice is dropped if the account goes away)
  const cash = useMemo(() => cashAccounts(data, settings).map(a => ({ id: a.id, name: acctLabel(a, data.accounts), bal: balanceOf(a, data) })), [data, settings]); const home = useMemo(() => everydayAccount(data, settings)?.id || null, [data, settings])
  // 0.36.0: with a default account that is one of the cash accounts, the calendar opens on it; "All cash together" is one pick away and lasts for the visit
  const def = useDefaultAccount(); const [scope0, setScope] = useState<string | null | undefined>(undefined)
  const scope = scope0 === undefined ? (cash.length > 1 && def.id && cash.some(a => a.id === def.id) ? def.id : null) : scope0 && cash.some(a => a.id === scope0) ? scope0 : null
  const t = today(); const cal = useMemo(() => cashCalendar(data, settings, days, { accountId: scope }), [data, settings, days, scope]); const wide = useMemo(() => (days >= 120 ? cal : cashCalendar(data, settings, 120, { accountId: scope })), [data, settings, days, scope, cal])
  // the gauge's reserve check is about all cash together, whatever the calendar is showing
  const wideAll = useMemo(() => (scope ? cashCalendar(data, settings, days) : cal), [data, settings, days, scope, cal])
  const b = useMemo(() => burn(data, settings), [data, settings])
  const proj = useMemo(() => runwayProjection(data, settings), [data, settings]); const leanP = useMemo(() => runwayProjection(data, settings, { leanOnly: true }), [data, settings])
  const what = useMemo(() => runwayProjection(data, settings, { cutPct: cut, leanOnly: lean, extraIncome: extraInc, incomeEndsOn: incEnd || null }), [data, settings, cut, lean, extraInc, incEnd]); const changed = cut || lean || extraInc || incEnd
  const pm = proj.zeroAt ? diffDays(proj.zeroAt, t) / 30.44 : Infinity, pmf = proj.floorAt ? diffDays(proj.floorAt, t) / 30.44 : Infinity, lm = leanP.zeroAt ? diffDays(leanP.zeroAt, t) / 30.44 : Infinity
  const cls = (m: number) => m >= settings.runwayGreen ? 'good' : m >= settings.runwayYellow ? 'warn' : 'crit'; const fmtM = (m: number) => !isFinite(m) ? '24+ mo' : m >= 24 ? (m / 12).toFixed(1) + ' yrs' : m.toFixed(1) + ' mo'
  const c = C(); const plannedOpen = data.planned.filter(p => p.status === 'Planned').length
  const onPlan = canEdit ? (row: { date: string; label: string; amount: number }) => guarded(() => insert('planned', { ...row, category: 'Other', status: 'Planned' }), `Added to your plan on ${fmtD(row.date)}`) : undefined
  const cols: Col<PlannedItem>[] = [{ k: 'date', label: 'Date', type: 'date', required: true }, { k: 'label', label: 'What', type: 'text', w: 170, required: true }, { k: 'category', label: 'Category', type: 'select', opts: CATS, w: 130 }, { k: 'amount', label: 'Amount (+ in / − out)', type: 'money', cls: 'num', placeholder: '-650 or 2,400', signed: true, required: true }, { k: 'status', label: 'Status', type: 'select', opts: ['Planned', 'Done', 'Cancelled'], w: 100 }, { k: 'notes', label: 'Notes', type: 'text', w: 180 }, { k: 'ref', label: 'ID', type: 'ro', cls: 'id' }]
  const runwaySub = <>{proj.zeroAt ? 'cash out ' + fmtDY(proj.zeroAt) : 'cash stays positive for 24 months'}{settings.reserveFloor ? <> · to your reserve: {fmtM(pmf)}</> : null}</>
  return <>
    <div className="pgtabs" role="tablist" aria-label="Forecast views">
      <button type="button" role="tab" id="fc-tab-near" aria-selected={tab === 'near'} aria-controls="fc-panel" className={tab === 'near' ? 'on' : ''} onClick={() => go('near')}>Next {days} days</button>
      <button type="button" role="tab" id="fc-tab-long" aria-selected={tab === 'long'} aria-controls="fc-panel" className={tab === 'long' ? 'on' : ''} onClick={() => go('long')}>Long range</button>
    </div>
    <div id="fc-panel" role="tabpanel" aria-labelledby={tab === 'near' ? 'fc-tab-near' : 'fc-tab-long'}>
    {tab === 'near' ? <div className="kpis" style={{ marginBottom: 16 }}>
      <KPI l={cal.account ? `${cal.account.name} today` : 'Cash today'} v={fmtMoney(cal.start)} cls="info" s={cal.account ? 'this account on its own' : 'accounts that count as cash'} /><KPI l="Money in" v={fmtMoney(cal.inTot)} cls="good" s={`next ${days} days`} /><KPI l="Money out" v={fmtMoney(cal.outTot)} cls="warn" s={`next ${days} days · ends at ${fmtMoney(cal.end)}`} />
      <KPI l="Runway" v={fmtM(pm)} cls={cls(pm)} s={runwaySub} /></div>
    : <div className="kpis" style={{ marginBottom: 16 }}>
      <KPI l="Cash today" v={fmtMoney(b.cash)} cls="info" s="accounts that count as cash" /><KPI l="Monthly burn" v={b.net > 0 ? fmtMoney(b.net) : 'Covered'} cls={b.net > 0 ? 'warn' : 'good'} s={b.net > 0 ? `${fmtMoney(b.expenses)} out vs ${fmtMoney(b.income)} in` : `income exceeds spending by ${fmtMoney(-b.net)}/mo`} />
      <KPI l="Runway" v={fmtM(pm)} cls={cls(pm)} s={<>{runwaySub} · essentials only: {fmtM(lm)}</>} /><KPI l="Lowest cash in 24 months" v={fmtMoney(proj.minCash)} cls={proj.minCash <= 0.5 ? 'crit' : settings.reserveFloor && proj.minCash < settings.reserveFloor ? 'warn' : 'good'} s={`essentials cost ${fmtMoney(proj.essentials)}/mo`} /></div>}
    <div className="grid g12">
      {!hasMoneyData(data) && <div className="span12 banner info">The forecast is built from your <Link to="/accounts">account balances</Link>, <Link to="/income">pay schedules</Link>, <Link to="/bills">bills</Link> and recent spending — add those and the calendar, runway and projection fill in.</div>}
      {tab === 'near' ? <>
      <Card span={12} title="Cash calendar" hint="what you will have in the bank each day · paychecks, bills, subscriptions, card and loan payments, planned items and everyday spending at your recent pace">
        <CashCalendar cal={cal} days={days} onDays={setDays} wide={wide} accounts={cash} scope={scope} onScope={setScope} home={home} onPlan={onPlan} defaultId={def.id} />
        <p className="cc-sub" style={{ marginTop: 10 }}>{plannedOpen ? `${plannedOpen} planned one-off item${plannedOpen === 1 ? ' is' : 's are'} in this calendar.` : 'One-off money in or out you already know about belongs in the calendar too.'} <button type="button" className="linkbtn" onClick={() => go('long')}>Planned one-off items are under Long range →</button></p></Card>
      <Card span={12} title="How accurate was last month's forecast?" hint="each month's forecast is saved, then checked against what really happened">
        <ForecastAccuracy data={data} settings={settings} canSave={canEdit && modules === null} /></Card>
      </> : <>
      <Card span={12} title="24-month projection" hint="income continues, bills and everyday spending at the recent pace, debt payments stop when paid off, planned items on their dates">
        <Chart title="24-month projection" data={[{ type: 'scatter', name: 'Projected cash', mode: 'lines+markers', x: proj.xs, y: proj.ys, fill: 'tozeroy', fillcolor: c.ground, line: { color: c.ink, width: 2 }, marker: { size: 5 }, hovertemplate: '%{x|%b %Y}: $%{y:,.0f}<extra>projected</extra>' }, ...(changed ? [{ type: 'scatter' as const, name: 'What-if', mode: 'lines' as const, x: what.xs, y: what.ys, line: { color: c.good, width: 2, dash: 'dot' as const }, hovertemplate: '%{x|%b %Y}: $%{y:,.0f}<extra>what-if</extra>' }] : []), { type: 'scatter', name: 'Essentials only', mode: 'lines', x: leanP.xs, y: leanP.ys, line: { color: c.idle, width: 1.5, dash: 'dash' }, hovertemplate: '%{x|%b %Y}: $%{y:,.0f}<extra>essentials only</extra>' }, ...(data.snapshots.length ? [{ type: 'scatter' as const, name: 'Recorded', mode: 'markers' as const, x: data.snapshots.map(s => s.date), y: data.snapshots.map(s => +s.cash), marker: { color: c.warn, size: 9, symbol: 'diamond' }, hovertemplate: '%{x|%b %d}: $%{y:,.0f}<extra>recorded</extra>' }] : [])]} layout={{ showlegend: true, yaxis: { tickprefix: '$', rangemode: 'tozero' }, xaxis: { type: 'date', tickformat: '%b %Y' }, shapes: [...(settings.reserveFloor ? [{ type: 'line' as const, x0: proj.xs[0], x1: proj.xs[proj.xs.length - 1], y0: settings.reserveFloor, y1: settings.reserveFloor, line: { color: c.crit, width: 1, dash: 'dot' as const } }] : []), ...(proj.zeroAt ? [{ type: 'line' as const, x0: proj.zeroAt, x1: proj.zeroAt, y0: 0, y1: 1, yref: 'paper' as const, line: { color: c.crit, width: 1.5, dash: 'dash' as const } }] : [])] }} height={300} /></Card>
      <Card span={6} title="What if…" hint="scenario against the projection">
        <ScenarioBar kind="forecast" current={{ cutPct: cut, leanOnly: lean, extraIncome: extraInc, incomeEndsOn: incEnd || null }} onLoad={x => { const v = normalize('forecast', x); setCut(v.cutPct); setLean(v.leanOnly); setExtraInc(v.extraIncome); setIncEnd(v.incomeEndsOn || '') }} compact />
        <div><label htmlFor="wi-cut" style={{ fontSize: 12, color: 'var(--ink-2)' }}>Cut everyday + bill spending by <b>{cut}</b>%</label><input id="wi-cut" className="rng" type="range" min={0} max={60} step={5} value={cut} onChange={e => setCut(+e.target.value)} aria-valuetext={`${cut}%`} /></div>
        <div style={{ marginTop: 6 }}><label htmlFor="wi-extra" style={{ fontSize: 12, color: 'var(--ink-2)' }}>Extra income <b>{fmtMoney(extraInc)}</b>/month (raise, side work)</label><input id="wi-extra" className="rng" type="range" min={0} max={3000} step={100} value={extraInc} onChange={e => setExtraInc(+e.target.value)} aria-valuetext={`${fmtMoney(extraInc)} a month`} /></div>
        <div className="grid2" style={{ marginTop: 8 }}><div className="field"><label htmlFor="wi-stop">Current income stops on</label><input id="wi-stop" className="inp" type="date" value={incEnd} onChange={e => setIncEnd(e.target.value)} /></div><div className="field"><label>&nbsp;</label><label className="gm-ign" style={{ fontSize: 13 }}><input type="checkbox" checked={lean} onChange={e => setLean(e.target.checked)} /> Essentials only</label></div></div>
        <div className="scen"><div className="box"><div className="l">Projection</div><div className="v">{fmtM(pm)}</div><div className="s">{proj.zeroAt ? 'cash reaches zero ' + fmtDY(proj.zeroAt) : 'stays positive for 24 months'}{proj.floorAt ? ' · floor ' + fmtD(proj.floorAt) : ''}</div></div><div className="box"><div className="l">What-if</div><div className="v" style={{ color: `var(--${what.zeroAt && proj.zeroAt && what.zeroAt < proj.zeroAt ? 'crit' : 'good'})` }}>{what.zeroAt ? fmtM(diffDays(what.zeroAt, t) / 30.44) : '24+ mo'}</div><div className="s">{changed ? (what.zeroAt ? 'zero ' + fmtDY(what.zeroAt) : 'stays positive for 24 months') + ` · low point ${fmtMoney(what.minCash)}` : 'move a slider to compare'}</div></div></div>
        <Note>Save a what-if as a scenario to keep it ("job change in March") and compare it with others. For extra money spread across debt, goals and retirement, use the <Link to="/plan">Plan</Link>. Burn is built from: bills & subscriptions {fmtMoney(b.fixed)} + everyday spending {fmtMoney(b.variable)} + loan payments {fmtMoney(b.debt)}{b.relief ? ` − hardship relief ${fmtMoney(b.relief)}` : ''} = {fmtMoney(b.expenses)}/mo against {fmtMoney(b.income)}/mo income.{b.cards > 0.005 ? ` Card payments (${fmtMoney(b.cards)}/mo planned) are not added: what you buy on the cards is already in bills and everyday spending.` : ''}</Note></Card>
      <Card span={6} title="Runway gauge" hint="months to zero in the projection"><Gauge value={isFinite(pm) ? pm : 24} max={24} color={{ good: c.good, warn: c.warn, crit: c.crit }[cls(pm)]} steps={[{ range: [0, settings.runwayYellow], color: c.critSoft }, { range: [settings.runwayYellow, settings.runwayGreen], color: cssSoft('--warn-soft') }, { range: [settings.runwayGreen, 24], color: c.accentSoft }]} label={isFinite(pm) ? pm.toFixed(1) + ' mo' : '24+ mo'} /><div style={{ textAlign: 'center' }}><Pill cls={cls(pm)}>{cls(pm) === 'good' ? `Green · ${settings.runwayGreen}+ months` : cls(pm) === 'warn' ? `Yellow · ${settings.runwayYellow}–${settings.runwayGreen} months` : `Red · under ${settings.runwayYellow} months`}</Pill></div>
        <AList items={[{ c: cls(pm), t: 'Runway band', m: isFinite(pm) ? `${pm.toFixed(1)} months to zero${settings.reserveFloor && isFinite(pmf) ? `, ${pmf.toFixed(1)} to the floor` : ''}` : 'Cash stays positive for the next 24 months' }, { c: (b.debt + b.cards) / Math.max(1, b.income) > 0.36 ? 'crit' : (b.debt + b.cards) / Math.max(1, b.income) > 0.2 ? 'warn' : 'good', t: 'Debt payments vs income', m: `${fmtMoney(b.debt + b.cards)}/mo of card and loan payments = ${b.income ? Math.round((b.debt + b.cards) / b.income * 100) + '% of take-home' : 'no income entered'}` }, { c: settings.reserveFloor ? (wideAll.firstFloor ? 'crit' : 'good') : 'idle', t: 'Reserve floor', m: settings.reserveFloor ? (wideAll.firstFloor ? `Breached ${fmtDY(wideAll.firstFloor)} in the calendar` : `Held for the next ${days} days`) : 'Not set — Settings → General → Planning thresholds' }]} /></Card>
      <Card span={12} title="Planned one-off items" hint="money in or out on a date — refunds, bonuses, repairs, tuition, trips" right={canEdit ? <Btn primary sm onClick={() => guarded(() => insert('planned', { date: addDays(t, 14), label: 'Planned item', category: 'Other', amount: 0, status: 'Planned' }), 'Added — fill in the row')}>+ Add item</Btn> : undefined}>
        <Table rows={data.planned.slice().sort((a, b) => a.date.localeCompare(b.date))} cols={cols} editable={canEdit} onChange={(r, k, v) => guarded(() => update('planned', r.id, { [k]: v } as Partial<PlannedItem>))} onDelete={async r => { if (await confirm(`Delete ${r.label}?`)) guarded(() => remove('planned', r.id)) }} rowCls={r => r.status === 'Done' ? 'st-good' : r.status === 'Cancelled' ? 'st-idle ex-off' : (+r.amount || 0) < 0 ? 'st-warn' : 'st-info'} search={false} />
        <Note>Planned items flow into the calendar and the projection; mark them Done when they happen (and log the transaction). Total planned: in {fmtMoney(sum(data.planned.filter(p => p.status === 'Planned' && p.amount > 0).map(p => p.amount)))} · out {fmtMoney(-sum(data.planned.filter(p => p.status === 'Planned' && p.amount < 0).map(p => p.amount)))}.</Note></Card>
      </>}
    </div>
    </div>
  </>
}
const cssSoft = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
