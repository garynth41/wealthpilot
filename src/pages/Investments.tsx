import { useEffect, useMemo, useRef, useState } from 'react'
import { useData } from '../app/hooks'
import type { Holding, RetirementInputs } from '../app/data/types'
import { ASSET_CLASS_LABEL } from '../app/data/types'
import { Card, KPI, Btn, Pill, Note, Field, Seg, Empty, useConfirm } from '../components/ui'
import { Table, type Col } from '../components/Table'
import { Chart, C, PALETTE, Gauge, cssVar } from '../components/Chart'
import { portfolio, holdingValue, holdingGain, retirementAssets } from '../lib/portfolio'
import { projectRetirement, safeWithdrawal, RETIREMENT_DEFAULTS, type MonteCarlo } from '../lib/retirement'
import { fmtMoney, fm2, fmtPct, parseNum } from '../lib/money'
import { today } from '../lib/dates'

const SECTORS = ['Diversified', 'Fixed income', 'Cash', 'Technology', 'Healthcare', 'Financials', 'Consumer', 'Industrials', 'Energy', 'Utilities', 'Real estate', 'Communication', 'Materials', 'Crypto', 'Other']
export function InvestmentsPage() {
  const { data, settings, saveSettings, insert, update, remove, guarded, canEdit, accts, acctLabels } = useData(); const confirm = useConfirm(); const c = C(); const pal = PALETTE()
  const invAccts = accts.filter(a => a.kind === 'investment' || a.kind === 'retirement'); const [acctF, setAcctF] = useState('')
  const pf = useMemo(() => portfolio(data, acctF || null), [data, acctF]); const ra = useMemo(() => retirementAssets(data), [data])
  const cols: Col<Holding>[] = [
    { k: 'account_id', label: 'Account', type: 'select', opts: ['', ...invAccts.map(a => a.id)], labels: { '': '—', ...acctLabels }, w: 150 }, { k: 'symbol', label: 'Symbol', type: 'text', w: 80 }, { k: 'name', label: 'Name', type: 'text', w: 180 },
    { k: 'asset_class', label: 'Class', type: 'select', opts: Object.keys(ASSET_CLASS_LABEL), labels: ASSET_CLASS_LABEL, w: 120 }, { k: 'sector', label: 'Sector', type: 'select', opts: ['', ...SECTORS], labels: { '': '—' }, w: 120 }, { k: 'risk', label: 'Risk', type: 'select', opts: ['low', 'medium', 'high'], labels: { low: 'Low', medium: 'Medium', high: 'High' }, w: 90 },
    { k: 'quantity', label: 'Quantity', type: 'number', cls: 'num', w: 90 }, { k: 'price', label: 'Price', type: 'money', cls: 'num', w: 100 }, { k: 'price_as_of', label: 'Price as of', type: 'date' }, { k: 'cost_basis', label: 'Cost basis', type: 'money', cls: 'num', w: 110 },
    { k: '_v', label: 'Value', type: 'ro', cls: 'num', fmt: h => <b>{fm2(holdingValue(h))}</b>, sortVal: h => holdingValue(h) }, { k: '_g', label: 'Gain / loss', type: 'ro', cls: 'num', fmt: h => { const g = holdingGain(h); return <span style={{ color: g >= 0 ? 'var(--good)' : 'var(--crit)' }}>{(g >= 0 ? '+' : '') + fm2(g)}{h.cost_basis > 0 ? ` (${Math.round(g / h.cost_basis * 100)}%)` : ''}</span> }, sortVal: h => holdingGain(h) },
    { k: 'expense_ratio', label: 'Expense %', type: 'number', cls: 'num', w: 80 }, { k: 'yield_pct', label: 'Yield %', type: 'number', cls: 'num', w: 70 }, { k: 'notes', label: 'Notes', type: 'text', w: 140 }]
  const add = () => guarded(() => insert('holdings', { name: 'New holding', asset_class: 'etf', risk: 'medium', quantity: 0, price: 0, cost_basis: 0, price_as_of: today(), account_id: acctF || invAccts[0]?.id || null, sort_order: data.holdings.length + 1 }))
  const pie = (title: string, slices: typeof pf.byClass) => slices.length ? <Chart title={title} data={[{ type: 'pie', labels: slices.map(s => s.label), values: slices.map(s => s.value), hole: .5, textinfo: 'percent', textposition: 'inside', marker: { colors: slices.map((_, i) => pal[i % pal.length]) }, hovertemplate: '%{label}: $%{value:,.0f} (%{percent})<extra></extra>' }]} layout={{ showlegend: true, legend: { orientation: 'h', y: -0.05 } }} height={280} /> : <Empty>No holdings yet.</Empty>
  const staleDays = pf.holdings.filter(h => h.price_as_of && h.price_as_of < today()).length
  return <>
    <div className="kpis" style={{ marginBottom: 16 }}>
      <KPI l="Portfolio value" v={fmtMoney(pf.value)} cls="info" s={`${pf.holdings.length} holding${pf.holdings.length === 1 ? '' : 's'}${acctF ? ' · ' + acctLabels[acctF] : ''}`} />
      <KPI l="Gain / loss" v={(pf.gain >= 0 ? '+' : '') + fmtMoney(pf.gain)} cls={pf.gain >= 0 ? 'good' : 'crit'} s={pf.gainPct != null ? `${fmtPct(pf.gainPct, 1)} on ${fmtMoney(pf.cost)} cost` : 'no cost basis entered'} />
      <KPI l="Retirement assets" v={fmtMoney(ra.retirement)} cls="good" s={`taxable ${fmtMoney(ra.taxable)} · total ${fmtMoney(ra.total)}`} />
      <KPI l="Growth share" v={fmtPct(pf.growthShare)} cls={pf.growthShare == null ? 'idle' : pf.growthShare > 0.85 ? 'warn' : 'info'} s="stocks, ETFs, crypto vs bonds & cash" />
      <KPI l="Weighted expense ratio" v={pf.weightedExpense == null ? '—' : pf.weightedExpense.toFixed(2) + '%'} cls={pf.weightedExpense == null ? 'idle' : pf.weightedExpense > 0.5 ? 'warn' : 'good'} s={pf.estYield != null ? `est. income ${fmtMoney(pf.estYield)}/yr` : 'enter expense ratios on funds'} />
    </div>
    {pf.concentrationWarning && <div className="banner warn" style={{ marginBottom: 12 }}>{pf.concentrationWarning}.</div>}
    <div className="grid g12">
      <Card span={12} title="Holdings" hint="positions in your investment and retirement accounts · value = quantity × price · update prices when you check your statements" right={<span className="btnrow"><select className="inp" style={{ width: 'auto', padding: '4px 8px' }} value={acctF} onChange={e => setAcctF(e.target.value)}><option value="">All accounts</option>{invAccts.map(a => <option key={a.id} value={a.id}>{acctLabels[a.id]}</option>)}</select>{canEdit && <Btn primary sm onClick={add}>+ Add holding</Btn>}</span>}>
        <Table rows={pf.holdings} cols={cols} editable={canEdit} name="holdings" defaultSort={{ k: '_v', dir: -1 }} onChange={(h, k, v) => guarded(() => update('holdings', h.id, { [k]: v === '' ? null : v, ...(k === 'price' ? { price_as_of: today() } : {}) } as Partial<Holding>))} onDelete={async h => { if (await confirm(`Delete ${h.symbol || h.name}?`)) guarded(() => remove('holdings', h.id), 'Deleted') }} empty="No holdings yet — add the funds and stocks in your 401(k), IRA and brokerage accounts." />
        {staleDays > 0 && <Note>{staleDays} price{staleDays === 1 ? ' is' : 's are'} older than today. Prices are entered by hand (there is no market-data feed); the account's balance on the Accounts page is used wherever it is larger than the itemised holdings.</Note>}
      </Card>
      <Card span={4} title="Asset allocation">{pie('Asset allocation', pf.byClass)}</Card>
      <Card span={4} title="Sector allocation">{pie('Sector allocation', pf.bySector)}</Card>
      <Card span={4} title="Risk allocation">{pie('Risk allocation', pf.byRisk)}<div className="tblwrap"><table className="tbl"><tbody>{pf.byRisk.map(s => <tr key={s.key}><td>{s.label}</td><td className="num">{fmtMoney(s.value)}</td><td className="num">{Math.round(s.pct * 100)}%</td></tr>)}</tbody></table></div></Card>
      <Retirement balance={ra.total} inputs={{ ...RETIREMENT_DEFAULTS, ...(settings.retirement || {}) }} onSave={i => guarded(() => saveSettings({ retirement: i }), 'Planner inputs saved')} canEdit={canEdit} c={c} />
    </div>
  </>
}

function Retirement({ balance, inputs, onSave, canEdit, c }: { balance: number; inputs: RetirementInputs; onSave: (i: RetirementInputs) => void; canEdit: boolean; c: ReturnType<typeof C> }) {
  const [i, setI] = useState<RetirementInputs>(inputs); useEffect(() => setI(inputs), [inputs])
  const [runs, setRuns] = useState<'1000' | '5000' | '10000'>('1000'); const [mc, setMc] = useState<MonteCarlo | null>(null); const [busy, setBusy] = useState(false); const worker = useRef<Worker | null>(null)
  const [custom, setCustom] = useState('4.5')
  const proj = useMemo(() => projectRetirement(balance, i), [balance, i])
  const swr = useMemo(() => safeWithdrawal(proj.real, i, [...new Set([0.03, 0.04, 0.05, ...(parseNum(custom) ? [Math.round(parseNum(custom)! * 100) / 10000] : [])])].sort((a, b) => a - b)), [proj.real, i, custom])
  const set = (k: keyof RetirementInputs, v: string) => { const n = parseNum(v); if (n == null) return; setI(x => ({ ...x, [k]: ['expectedReturn', 'inflation', 'returnStdDev'].includes(k) ? n / 100 : n })) }
  const pct = (k: 'expectedReturn' | 'inflation' | 'returnStdDev') => (i[k] * 100).toFixed(1)
  const simulate = () => { setBusy(true); worker.current?.terminate(); const w = new Worker(new URL('../lib/mc.worker.ts', import.meta.url), { type: 'module' }); worker.current = w
    w.onmessage = (e: MessageEvent<MonteCarlo>) => { setMc(e.data); setBusy(false); w.terminate() }; w.onerror = () => { setBusy(false); w.terminate() }; w.postMessage({ balance, inputs: i, runs: +runs, seed: Date.now() % 100000 }) }
  useEffect(() => () => worker.current?.terminate(), [])
  const readyCls = proj.readiness >= 90 ? c.good : proj.readiness >= 60 ? c.warn : c.crit
  const steps = [{ range: [0, 60] as [number, number], color: cssVar('--crit-soft') }, { range: [60, 90] as [number, number], color: cssVar('--warn-soft') }, { range: [90, 100] as [number, number], color: cssVar('--good-soft') }]
  const num = (label: string, k: keyof RetirementInputs, hint?: string, isPct = false) => <Field label={label} hint={hint}><input className="inp" inputMode="decimal" defaultValue={isPct ? pct(k as 'expectedReturn') : String(i[k])} key={`${k}-${i[k]}`} onBlur={e => set(k, e.target.value)} /></Field>
  return <>
    <Card span={5} title="Retirement planner" hint="today's dollars · contributions grow with inflation" right={canEdit ? <Btn sm primary onClick={() => onSave(i)}>Save inputs</Btn> : undefined}>
      <div className="grid3">{num('Current age', 'currentAge')}{num('Retire at', 'retireAge')}{num('Plan to age', 'lifeExpectancy')}</div>
      <div className="grid3">{num('Contribution / yr', 'annualContribution', 'incl. employer match')}{num('Expected return %', 'expectedReturn', 'nominal', true)}{num('Inflation %', 'inflation', undefined, true)}</div>
      <div className="grid3">{num('Income wanted / yr', 'desiredIncome', 'in retirement, today\'s $')}{num('Social Security / yr', 'socialSecurity', 'expected benefit')}{num('Income today / yr', 'currentIncome', 'for the replacement ratio')}</div>
      <div className="grid3">{num('Return volatility %', 'returnStdDev', 'std dev, for Monte Carlo', true)}</div>
      <Note>Starting balance: <b>{fmtMoney(balance)}</b> — your retirement + investment accounts (the larger of each account's balance and its itemised holdings). Readiness = projected portfolio ÷ the portfolio needed to fund (income wanted − Social Security) at a 4% withdrawal rate.</Note>
    </Card>
    <Card span={7} title="Projection" hint={`${proj.years} years to retirement · real return ${(proj.realRate * 100).toFixed(1)}%/yr`}>
      <div className="kpis" style={{ marginBottom: 10 }}>
        <KPI l="At retirement (today's $)" v={fmtMoney(proj.real)} cls="info" s={`${fmtMoney(proj.nominal)} nominal`} />
        <KPI l="Needed" v={fmtMoney(proj.needed)} cls={proj.shortfall ? 'warn' : 'good'} s={proj.shortfall ? `shortfall ${fmtMoney(proj.shortfall)}` : 'funded'} />
        <KPI l="Sustainable income" v={fmtMoney(proj.sustainableIncome) + '/yr'} cls={proj.sustainableIncome >= i.desiredIncome ? 'good' : 'warn'} s={`4% rule + Social Security · want ${fmtMoney(i.desiredIncome)}`} />
        <KPI l="Income replacement" v={fmtPct(proj.replacementRatio)} cls={proj.replacementRatio == null ? 'idle' : proj.replacementRatio >= 0.7 ? 'good' : 'warn'} s="of today's income · 70–80% is the usual target" />
      </div>
      <div className="grid g12"><div style={{ gridColumn: 'span 5' }}><Gauge value={proj.readiness} max={100} label={`${proj.readiness} / 100`} color={readyCls} steps={steps} />{proj.contributionForTarget != null && <Note>To fully fund the plan: contribute <b>{fmtMoney(proj.contributionForTarget)}/yr</b> (today's dollars) instead of {fmtMoney(i.annualContribution)}.</Note>}</div>
        <div style={{ gridColumn: 'span 7' }}><Chart title="Projected balance" data={[{ type: 'scatter', mode: 'lines', name: "Today's dollars", x: proj.path.map(p => p.age), y: proj.path.map(p => p.real), line: { color: c.accent, width: 2 }, fill: 'tozeroy', fillcolor: c.accentSoft, hovertemplate: 'age %{x}: $%{y:,.0f}<extra></extra>' }, { type: 'scatter', mode: 'lines', name: 'Nominal', x: proj.path.map(p => p.age), y: proj.path.map(p => p.nominal), line: { color: c.idle, width: 1, dash: 'dot' }, hovertemplate: 'age %{x}: $%{y:,.0f}<extra></extra>' }, { type: 'scatter', mode: 'lines', name: 'Needed', x: [i.currentAge, i.retireAge], y: [proj.needed, proj.needed], line: { color: c.crit, width: 1, dash: 'dash' }, hoverinfo: 'skip' }]} layout={{ showlegend: true, yaxis: { tickprefix: '$' }, xaxis: { title: { text: 'Age' } } }} height={260} /></div></div>
    </Card>
    <Card span={7} title="Monte Carlo simulation" hint="random yearly returns around your expected return · success = money lasts to the plan age" right={<span className="btnrow"><Seg value={runs} options={[['1000', '1,000 runs'], ['5000', '5,000'], ['10000', '10,000']]} onChange={setRuns} /><Btn primary sm onClick={simulate} disabled={busy}>{busy ? 'Running…' : mc ? 'Run again' : 'Run simulation'}</Btn></span>}>
      {!mc ? <Empty>Run the simulation to see the range of outcomes. 10,000 runs take a few seconds and run in the background.</Empty> : <>
        <div className="kpis" style={{ marginBottom: 10 }}>
          <KPI l="Success rate" v={fmtPct(mc.successRate)} cls={mc.successRate >= 0.85 ? 'good' : mc.successRate >= 0.7 ? 'warn' : 'crit'} s={`${mc.runs.toLocaleString()} runs · ${mc.depletionAges.length} ran out of money`} />
          <KPI l="Median at retirement" v={fmtMoney(mc.medianAtRetirement)} cls="info" s="today's dollars" />
          <KPI l="Median at plan age" v={fmtMoney(mc.median)} cls={mc.median > 0 ? 'good' : 'crit'} s={`10th pct ${fmtMoney(mc.p10)} · 90th ${fmtMoney(mc.p90)}`} />
          {mc.depletionAges.length > 0 && <KPI l="Typical run-out age" v={String(Math.round(mc.depletionAges.reduce((a, b) => a + b, 0) / mc.depletionAges.length))} cls="warn" s={`earliest ${Math.min(...mc.depletionAges)}`} />}
        </div>
        <Chart title="Monte Carlo bands" data={[{ type: 'scatter', mode: 'lines', name: '90th percentile', x: mc.bands.map(b => b.age), y: mc.bands.map(b => b.p90), line: { color: c.good, width: 1 }, hovertemplate: 'age %{x}: $%{y:,.0f}<extra>90th</extra>' }, { type: 'scatter', mode: 'lines', name: 'Median', x: mc.bands.map(b => b.age), y: mc.bands.map(b => b.p50), line: { color: c.accent, width: 2 }, fill: 'tonexty', fillcolor: c.accentSoft, hovertemplate: 'age %{x}: $%{y:,.0f}<extra>median</extra>' }, { type: 'scatter', mode: 'lines', name: '10th percentile', x: mc.bands.map(b => b.age), y: mc.bands.map(b => b.p10), line: { color: c.crit, width: 1 }, fill: 'tonexty', fillcolor: cssVar('--crit-soft'), hovertemplate: 'age %{x}: $%{y:,.0f}<extra>10th</extra>' }, { type: 'scatter', mode: 'lines', name: 'Retirement', x: [i.retireAge, i.retireAge], y: [0, Math.max(...mc.bands.map(b => b.p90))], line: { color: c.ink3, width: 1, dash: 'dot' }, hoverinfo: 'skip' }]} layout={{ showlegend: true, yaxis: { tickprefix: '$', rangemode: 'tozero' }, xaxis: { title: { text: 'Age' } } }} height={280} />
        <Note>Each run draws a return every year from a normal distribution (mean {pct('expectedReturn')}%, std dev {pct('returnStdDev')}%), adds contributions until age {i.retireAge}, then withdraws {fmtMoney(Math.max(0, i.desiredIncome - i.socialSecurity))}/yr (inflation-adjusted) to age {i.lifeExpectancy}.</Note></>}
    </Card>
    <Card span={5} title="Safe withdrawal rate" hint={`starting from ${fmtMoney(proj.real)} at retirement · income includes Social Security`}>
      <div className="tblwrap"><table className="tbl"><thead><tr><th>Rate</th><th className="num">Income / yr</th><th>Lasts</th><th className="num">Left at {i.lifeExpectancy}</th></tr></thead><tbody>
        {swr.map(r => <tr key={r.rate}><td><b>{(r.rate * 100).toFixed(1)}%</b></td><td className="num">{fmtMoney(r.annualIncome)}</td><td>{r.yearsLast == null ? <Pill cls="good">indefinitely</Pill> : r.lastsToLifeExpectancy ? <Pill cls="good">past age {i.lifeExpectancy} ({r.yearsLast} yrs)</Pill> : <Pill cls="crit">{r.yearsLast} years → runs out at {i.retireAge + r.yearsLast}</Pill>}</td><td className="num">{fmtMoney(r.endingBalance)}</td></tr>)}
      </tbody></table></div>
      <Field label="Custom rate %"><input className="inp" inputMode="decimal" value={custom} onChange={e => setCustom(e.target.value)} style={{ maxWidth: 120 }} /></Field>
      <Note>Deterministic: withdraws rate × starting balance each year, inflation-adjusted, at the expected real return. The 4% rule is calibrated to ~30 years; longer horizons favour 3–3.5%.</Note>
    </Card>
  </>
}
