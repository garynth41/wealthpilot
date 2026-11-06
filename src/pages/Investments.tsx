import { useEffect, useMemo, useRef, useState } from 'react'
import { useData } from '../app/hooks'
import type { Holding, RetirementInputs } from '../app/data/types'
import { ASSET_CLASS_LABEL } from '../app/data/types'
import { Card, KPI, Btn, Pill, Note, Field, Seg, Empty, useConfirm, useModal } from '../components/ui'
import { Table, type Col } from '../components/Table'
import { Chart, C, PALETTE, Gauge, cssVar } from '../components/Chart'
import { portfolio, holdingValue, holdingGain, retirementAssets } from '../lib/portfolio'
import { projectRetirement, safeWithdrawal, RETIREMENT_DEFAULTS, drawdown, guaranteedIncome, ssAnnual, ssStart, type MonteCarlo } from '../lib/retirement'
import { isAutoPriced, priceFreshness, priceAgeDays } from '../lib/prices'
import { ScenarioBar } from '../components/Scenarios'
import { normalize } from '../lib/scenarios'
import { sb } from '../app/supabase'
import { useStore } from '../app/store'
import type { Pension } from '../app/data/types'
import { fmtMoney, fm2, fmtPct, parseNum } from '../lib/money'
import { today } from '../lib/dates'
import { LotsModal, HarvestCard } from './Lots'
import { lotsFor } from '../lib/lots'

const SECTORS = ['Diversified', 'Fixed income', 'Cash', 'Technology', 'Healthcare', 'Financials', 'Consumer', 'Industrials', 'Energy', 'Utilities', 'Real estate', 'Communication', 'Materials', 'Crypto', 'Other']
export function InvestmentsPage() {
  const { data, settings, saveSettings, insert, update, remove, guarded, canEdit, accts, acctLabels, mode, household, refresh } = useData(); const confirm = useConfirm(); const { open, close } = useModal(); const c = C(); const pal = PALETTE(); const [pulling, setPulling] = useState(false)
  const invAccts = accts.filter(a => a.kind === 'investment' || a.kind === 'retirement'); const [acctF, setAcctF] = useState('')
  const pf = useMemo(() => portfolio(data, acctF || null), [data, acctF]); const ra = useMemo(() => retirementAssets(data), [data])
  const cols: Col<Holding>[] = [
    { k: 'account_id', label: 'Account', type: 'select', opts: ['', ...invAccts.map(a => a.id)], labels: { '': '—', ...acctLabels }, w: 150 }, { k: 'symbol', label: 'Symbol', type: 'text', w: 80 }, { k: 'name', label: 'Name', type: 'text', w: 180 },
    { k: 'asset_class', label: 'Class', type: 'select', opts: Object.keys(ASSET_CLASS_LABEL), labels: ASSET_CLASS_LABEL, w: 120 }, { k: 'sector', label: 'Sector', type: 'select', opts: ['', ...SECTORS], labels: { '': '—' }, w: 120 }, { k: 'risk', label: 'Risk', type: 'select', opts: ['low', 'medium', 'high'], labels: { low: 'Low', medium: 'Medium', high: 'High' }, w: 90 },
    { k: 'quantity', label: 'Quantity', type: 'number', cls: 'num', w: 90 }, { k: 'price', label: 'Price', type: 'money', cls: 'num', w: 100 }, { k: 'price_as_of', label: 'Price as of', type: 'date' },
    { k: 'price_source', label: 'Price from', type: 'select', opts: ['auto', 'manual'], labels: { auto: 'Daily feed', manual: 'Typed by hand' }, w: 120 },
    { k: '_fr', label: 'Fresh', type: 'ro', fmt: h => { const f = priceFreshness(h, today()); const age = priceAgeDays(h, today()); return <span className={`fresh fresh-${f}`} title={!isAutoPriced(h) ? 'typed by hand' : 'updated by the daily price feed'}>{age == null ? 'never' : age === 0 ? 'today' : `${age}d`}{isAutoPriced(h) ? '' : ' · manual'}</span> }, sortVal: h => priceAgeDays(h, today()) ?? 9999 }, { k: 'cost_basis', label: 'Cost basis', type: 'money', cls: 'num', w: 110 },
    { k: '_v', label: 'Value', type: 'ro', cls: 'num', fmt: h => <b>{fm2(holdingValue(h))}</b>, sortVal: h => holdingValue(h) }, { k: '_g', label: 'Gain / loss', type: 'ro', cls: 'num', fmt: h => { const g = holdingGain(h); return <span style={{ color: g >= 0 ? 'var(--good)' : 'var(--crit)' }}>{(g >= 0 ? '+' : '') + fm2(g)}{h.cost_basis > 0 ? ` (${Math.round(g / h.cost_basis * 100)}%)` : ''}</span> }, sortVal: h => holdingGain(h) },
    { k: 'expense_ratio', label: 'Expense %', type: 'number', cls: 'num', w: 80 }, { k: 'yield_pct', label: 'Yield %', type: 'number', cls: 'num', w: 70 }, { k: 'notes', label: 'Notes', type: 'text', w: 140 }]
  const add = () => guarded(() => insert('holdings', { name: 'New holding', asset_class: 'etf', risk: 'medium', quantity: 0, price: 0, cost_basis: 0, price_as_of: today(), price_source: 'auto', account_id: acctF || invAccts[0]?.id || null, sort_order: data.holdings.length + 1 }))
  const pie = (title: string, slices: typeof pf.byClass) => slices.length ? <Chart title={title} data={[{ type: 'pie', labels: slices.map(s => s.label), values: slices.map(s => s.value), hole: .5, textinfo: 'percent', textposition: 'inside', marker: { colors: slices.map((_, i) => pal[i % pal.length]) }, hovertemplate: '%{label}: $%{value:,.0f} (%{percent})<extra></extra>' }]} layout={{ showlegend: true, legend: { orientation: 'h', y: -0.05 } }} height={280} /> : <Empty>No holdings yet.</Empty>
  const auto = pf.holdings.filter(isAutoPriced); const stale = auto.filter(h => priceFreshness(h, today()) !== 'fresh').length
  const pull = () => { if (mode !== 'db' || !household) return; setPulling(true); guarded(async () => { try { const { data: r, error } = await sb().functions.invoke('price-feed', { body: { action: 'household', household_id: household.id } }); if (error) throw new Error(/not found|404/i.test(error.message) ? 'The price feed is not deployed yet' : error.message); await refresh(); const x = r as { quoted: number; symbols: number; updated: number; missing: string[] }; useStore.getState().toast(`${x.updated} price${x.updated === 1 ? '' : 's'} updated · ${x.quoted} of ${x.symbols} symbols quoted${x.missing?.length ? ` · no quote for ${x.missing.join(', ')}` : ''}`, !!x.missing?.length && !x.quoted) } finally { setPulling(false) } }) }
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
      <Card span={12} title="Holdings" hint="positions in your investment and retirement accounts · value = quantity × price · update prices when you check your statements" right={<span className="btnrow"><select className="inp" style={{ width: 'auto', padding: '4px 8px' }} value={acctF} onChange={e => setAcctF(e.target.value)} aria-label="Show holdings in"><option value="">All accounts</option>{invAccts.map(a => <option key={a.id} value={a.id}>{acctLabels[a.id]}</option>)}</select>{canEdit && mode === 'db' && auto.length > 0 && <Btn sm onClick={pull} disabled={pulling}>{pulling ? 'Updating…' : 'Update prices now'}</Btn>}{canEdit && <Btn primary sm onClick={add}>+ Add holding</Btn>}</span>}>
        <Table rows={pf.holdings} cols={cols} editable={canEdit} name="holdings" defaultSort={{ k: '_v', dir: -1 }} onChange={(h, k, v) => guarded(() => update('holdings', h.id, { [k]: v === '' ? null : v, ...(k === 'price' ? { price_as_of: today() } : {}) } as Partial<Holding>))} actions={h => h.asset_class === 'cash' ? null : <Btn sm onClick={() => open(<LotsModal h={h} onDone={close} />, { wide: true })} title="Purchase lots: dates and costs for short- and long-term gains" aria-label={`Tax lots for ${h.symbol || h.name} (${lotsFor(data, h.id).length})`}>{lotsFor(data, h.id).length ? `Lots (${lotsFor(data, h.id).length})` : 'Lots'}</Btn>} onDelete={async h => { if (await confirm(`Delete ${h.symbol || h.name}?`)) guarded(() => remove('holdings', h.id), 'Deleted') }} empty="No holdings yet — add the funds and stocks in your 401(k), IRA and brokerage accounts." />
        <Note>{auto.length ? <>{auto.length} holding{auto.length === 1 ? '' : 's'} with a symbol {auto.length === 1 ? 'is' : 'are'} priced by the daily feed after the US close (stocks, ETFs, mutual funds; crypto as e.g. BTC → BTC-USD){stale ? <> · <b>{stale}</b> not updated in the last 4 days{mode === 'demo' ? ' (the offline demo has no feed)' : ''}</> : ''}. </> : null}Set <b>Price from</b> to “Typed by hand” for private assets, cash or anything the feed cannot quote. The account balance on Accounts is used wherever it is larger than the itemised holdings.</Note>
      </Card>
      <HarvestCard />
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
  const setPen = (k: number, p: Partial<Pension>) => setI(x => ({ ...x, pensions: (x.pensions || []).map((y, j) => j === k ? { ...y, ...p } : y) }))
  const dd = useMemo(() => drawdown(proj.real, i), [proj.real, i])
  const simulate = () => { setBusy(true); worker.current?.terminate(); const w = new Worker(new URL('../lib/mc.worker.ts', import.meta.url), { type: 'module' }); worker.current = w
    w.onmessage = (e: MessageEvent<MonteCarlo>) => { setMc(e.data); setBusy(false); w.terminate() }; w.onerror = () => { setBusy(false); w.terminate() }; w.postMessage({ balance, inputs: i, runs: +runs, seed: Date.now() % 100000 }) }
  useEffect(() => () => worker.current?.terminate(), [])
  const readyCls = proj.readiness >= 90 ? c.good : proj.readiness >= 60 ? c.warn : c.crit
  const steps = [{ range: [0, 60] as [number, number], color: cssVar('--crit-soft') }, { range: [60, 90] as [number, number], color: cssVar('--warn-soft') }, { range: [90, 100] as [number, number], color: cssVar('--good-soft') }]
  const num = (label: string, k: keyof RetirementInputs, hint?: string, isPct = false) => <Field label={label} hint={hint}><input className="inp" inputMode="decimal" defaultValue={isPct ? pct(k as 'expectedReturn') : String(i[k])} key={`${k}-${i[k]}`} onBlur={e => set(k, e.target.value)} /></Field>
  return <>
    <Card span={5} title="Retirement planner" hint="today's dollars · contributions grow with inflation" right={canEdit ? <Btn sm primary onClick={() => onSave(i)}>Save inputs</Btn> : undefined}>
      <ScenarioBar kind="retirement" current={i as unknown as Record<string, unknown>} onLoad={x => setI(normalize('retirement', x))} compact />
      <div className="grid3">{num('Current age', 'currentAge')}{num('Retire at', 'retireAge')}{num('Plan to age', 'lifeExpectancy')}</div>
      <div className="grid3">{num('Contribution / yr', 'annualContribution', 'incl. employer match')}{num('Expected return %', 'expectedReturn', 'nominal', true)}{num('Inflation %', 'inflation', undefined, true)}</div>
      <div className="grid3">{num('Income wanted / yr', 'desiredIncome', 'in retirement, today\'s $')}{num('Income today / yr', 'currentIncome', 'for the replacement ratio')}{num('Return volatility %', 'returnStdDev', 'std dev, for Monte Carlo', true)}</div>
      <h3 style={{ margin: '10px 0 4px', fontSize: 14 }}>Guaranteed income</h3>
      <div className="grid3">
        <Field label="Social Security / month" hint="from your SSA statement, today's $"><input className="inp" inputMode="decimal" key={`ss-${ssAnnual(i)}`} defaultValue={String(Math.round(ssAnnual(i) / 12))} onBlur={e => { const n = parseNum(e.target.value); if (n == null) return; setI(x => ({ ...x, ssMonthly: n, socialSecurity: n * 12 })) }} /></Field>
        <Field label="Claim at age" hint="62 – 70"><input className="inp" inputMode="numeric" key={`ssa-${ssStart(i)}`} defaultValue={String(ssStart(i))} onBlur={e => { const n = parseNum(e.target.value); if (n == null) return; setI(x => ({ ...x, ssStartAge: Math.min(70, Math.max(62, Math.round(n))) })) }} /></Field>
        <Field label="Plan on" hint="benefit-cut scenario"><select className="inp" value={String(i.ssHaircut || 0)} onChange={e => setI(x => ({ ...x, ssHaircut: +e.target.value }))}><option value="0">Full benefit</option><option value="0.25">75% (shortfall)</option><option value="1">None</option></select></Field>
      </div>
      <div className="note" style={{ margin: '2px 0 4px' }}>Pensions and annuities</div>
      {(i.pensions || []).map((p, k) => <div key={p.id} className="pens">
        <input className="inp" value={p.name} aria-label="Pension name" onChange={e => setPen(k, { name: e.target.value })} />
        <input className="inp" inputMode="decimal" aria-label="Pension per month" defaultValue={String(p.monthly)} onBlur={e => setPen(k, { monthly: parseNum(e.target.value) ?? p.monthly })} />
        <input className="inp" inputMode="numeric" aria-label="Pension start age" defaultValue={String(p.startAge)} onBlur={e => setPen(k, { startAge: Math.round(parseNum(e.target.value) ?? p.startAge) })} />
        <label className="gm-ign" style={{ fontSize: 12 }} title="cost-of-living adjustment: keeps pace with inflation"><input type="checkbox" checked={p.cola !== false} onChange={e => setPen(k, { cola: e.target.checked })} /> COLA</label>
        <button className="del" aria-label={`Remove ${p.name}`} onClick={() => setI(x => ({ ...x, pensions: (x.pensions || []).filter((_, j) => j !== k) }))}>✕</button>
      </div>)}
      {(i.pensions || []).length > 0 && <div className="pens note" style={{ margin: 0 }}><span>name</span><span>per month</span><span>from age</span><span /><span /></div>}
      <Btn sm onClick={() => setI(x => ({ ...x, pensions: [...(x.pensions || []), { id: 'pen' + Date.now().toString(36), name: 'Pension', monthly: 500, startAge: x.retireAge, cola: true }] }))}>+ Add a pension</Btn>
      <Note>Starting balance: <b>{fmtMoney(balance)}</b> — your retirement + investment accounts. Readiness = projected portfolio ÷ what it must hold: (income wanted − guaranteed income) at a 4% withdrawal rate, plus the bridge years before Social Security starts, which the portfolio funds in full.</Note>
    </Card>
    <Card span={7} title="Projection" hint={`${proj.years} years to retirement · real return ${(proj.realRate * 100).toFixed(1)}%/yr`}>
      <div className="kpis" style={{ marginBottom: 10 }}>
        <KPI l="At retirement (today's $)" v={fmtMoney(proj.real)} cls="info" s={`${fmtMoney(proj.nominal)} nominal`} />
        <KPI l="Needed" v={fmtMoney(proj.needed)} cls={proj.shortfall ? 'warn' : 'good'} s={proj.shortfall ? `shortfall ${fmtMoney(proj.shortfall)}` : 'funded'} />
        <KPI l="Sustainable income" v={fmtMoney(proj.sustainableIncome) + '/yr'} cls={proj.sustainableIncome >= i.desiredIncome ? 'good' : 'warn'} s={`4% rule + ${fmtMoney(proj.guaranteed)} guaranteed · want ${fmtMoney(i.desiredIncome)}`} />
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
        <Note>Each run draws a return every year from a normal distribution (mean {pct('expectedReturn')}%, std dev {pct('returnStdDev')}%), adds contributions until age {i.retireAge}, then withdraws what guaranteed income does not cover — {fmtMoney(Math.max(0, i.desiredIncome - guaranteedIncome(i, i.retireAge)))}/yr at {i.retireAge}, {fmtMoney(Math.max(0, i.desiredIncome - guaranteedIncome(i, Math.max(i.retireAge, ssStart(i)))))}/yr once Social Security starts (inflation-adjusted) — to age {i.lifeExpectancy}.</Note></>}
    </Card>
    <Card span={5} title="Safe withdrawal rate" hint={`starting from ${fmtMoney(proj.real)} at retirement · income includes ${fmtMoney(proj.guaranteed)}/yr guaranteed`}>
      <div className="tblwrap"><table className="tbl"><thead><tr><th>Rate</th><th className="num">Income / yr</th><th>Lasts</th><th className="num">Left at {i.lifeExpectancy}</th></tr></thead><tbody>
        {swr.map(r => <tr key={r.rate}><td><b>{(r.rate * 100).toFixed(1)}%</b></td><td className="num">{fmtMoney(r.annualIncome)}</td><td>{r.yearsLast == null ? <Pill cls="good">indefinitely</Pill> : r.lastsToLifeExpectancy ? <Pill cls="good">past age {i.lifeExpectancy} ({r.yearsLast} yrs)</Pill> : <Pill cls="crit">{r.yearsLast} years → runs out at {i.retireAge + r.yearsLast}</Pill>}</td><td className="num">{fmtMoney(r.endingBalance)}</td></tr>)}
      </tbody></table></div>
      <Field label="Custom rate %"><input className="inp" inputMode="decimal" value={custom} onChange={e => setCustom(e.target.value)} style={{ maxWidth: 120 }} /></Field>
      <Note>Deterministic: withdraws rate × starting balance each year, inflation-adjusted, at the expected real return. The 4% rule is calibrated to ~30 years; longer horizons favour 3–3.5%.</Note>
    </Card>
    <Card span={12} title="Retirement income, year by year" hint={`today's dollars · guaranteed income first, the portfolio covers the rest${dd.bridgeYears ? ` · ${dd.bridgeYears}-year bridge before Social Security at ${ssStart(i)}` : ''}`}>
      <div className="kpis" style={{ marginBottom: 10 }}>
        <KPI l="Guaranteed once started" v={fmtMoney(proj.guaranteed) + '/yr'} cls="good" s={`${Math.round(proj.guaranteed / Math.max(1, i.desiredIncome) * 100)}% of the income you want`} />
        <KPI l="Portfolio money lasts" v={dd.depletionAge ? `to age ${dd.depletionAge}` : `past ${i.lifeExpectancy}`} cls={dd.depletionAge ? 'crit' : 'good'} s={dd.depletionAge ? 'at the expected real return' : `${fmtMoney(dd.endingBalance)} left at ${i.lifeExpectancy}`} />
        {dd.bridgeYears > 0 && <KPI l="Bridge to Social Security" v={fmtMoney(dd.bridgeDraw)} cls="info" s={`${dd.bridgeYears} years drawn from savings first`} />}
        {(i.ssHaircut || 0) > 0 && <KPI l="Benefit-cut scenario" v={i.ssHaircut === 1 ? 'no SS' : `${Math.round((1 - (i.ssHaircut || 0)) * 100)}% of SS`} cls="warn" s="switch to the full benefit to compare" />}
      </div>
      <Chart title="Retirement income, year by year" data={[{ type: 'bar', name: 'Guaranteed income', x: dd.path.map(p => p.age), y: dd.path.map(p => Math.min(p.guaranteed, i.desiredIncome)), marker: { color: c.good }, hovertemplate: 'age %{x}: $%{y:,.0f}<extra>guaranteed</extra>' }, { type: 'bar', name: 'From the portfolio', x: dd.path.map(p => p.age), y: dd.path.map(p => p.draw), marker: { color: c.ink }, hovertemplate: 'age %{x}: $%{y:,.0f}<extra>portfolio</extra>' }, { type: 'scatter', mode: 'lines', name: 'Portfolio balance', x: dd.path.map(p => p.age), y: dd.path.map(p => p.balance), yaxis: 'y2', line: { color: c.blue, width: 2 }, hovertemplate: 'age %{x}: $%{y:,.0f}<extra>balance</extra>' }]} layout={{ barmode: 'stack', showlegend: true, xaxis: { title: { text: 'Age' } }, yaxis: { tickprefix: '$', tickformat: '~s', title: { text: 'income / yr' } }, yaxis2: { overlaying: 'y', side: 'right', tickprefix: '$', tickformat: '~s', tickmode: 'auto', nticks: 5, showgrid: false, rangemode: 'tozero', zeroline: false }, margin: { l: 64, r: 70, t: 30, b: 44 } }} height={280} />
      <Note>A pension marked without COLA is shown losing purchasing power each year. The benefit-cut scenario reflects the Social Security trustees' projection that, without a change in law, the trust fund could pay roughly three quarters of scheduled benefits after it is depleted — plan both ways and see the difference.</Note>
    </Card>
  </>
}
