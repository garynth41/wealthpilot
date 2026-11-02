import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../app/hooks'
import { Card, KPI, Note, Seg, AList, Pill, Empty, Btn } from '../components/ui'
import { Chart, C, PALETTE, Gauge, cssVar } from '../components/Chart'
import { merchantAnalysis, subscriptionAnalysis, wasteDetection, healthIndicators, type WasteKind } from '../lib/intelligence'
import { fmtMoney, fm2, fmtPct } from '../lib/money'
import { addDays, fmtD, monthEnd, monthStart, curMonth, mAdd, today } from '../lib/dates'

const WASTE_LABEL: Record<WasteKind, string> = { duplicate: 'Duplicate charge', rising_subscription: 'Subscription went up', bank_fee: 'Bank / card fee', late_fee: 'Late fee', unused_subscription: 'Dormant subscription', spike: 'Spending spike', outlier: 'Unusually large' }

export function InsightsPage() {
  const { data, settings } = useData(); const c = C(); const pal = PALETTE()
  const [win, setWin] = useState<'30' | 'month' | '90'>('30'); const [look, setLook] = useState<3 | 6>(3)
  const [from, to] = useMemo(() => (win === 'month' ? [monthStart(curMonth()), monthEnd(curMonth())] : [addDays(today(), -(+win) + 1), today()]), [win])
  const merchants = useMemo(() => merchantAnalysis(data, from, to), [data, from, to])
  const subs = useMemo(() => subscriptionAnalysis(data), [data])
  const waste = useMemo(() => wasteDetection(data, today(), 90), [data])
  const health = useMemo(() => healthIndicators(data, settings, look), [data, settings, look])
  const wasteTotal = waste.filter(w => w.kind !== 'unused_subscription' && w.kind !== 'rising_subscription').reduce((a, w) => a + w.amount, 0)
  const top = merchants.slice(0, 12)
  const prevMonths = [...Array(look)].map((_, i) => mAdd(curMonth(), -(look - i)))
  const gcol = (n: number) => (n >= 70 ? c.good : n >= 40 ? c.warn : c.crit)
  const steps = [{ range: [0, 40] as [number, number], color: c.critSoft }, { range: [40, 70] as [number, number], color: cssVar('--warn-soft') }, { range: [70, 100] as [number, number], color: cssVar('--good-soft') }]
  return <>
    <div className="kpis" style={{ marginBottom: 16 }}>
      <KPI l="Monthly burn rate" v={fmtMoney(health.burnRate)} cls="warn" s={`spending + debt payments · avg of ${prevMonths.length} closed months`} />
      <KPI l="Savings rate" v={fmtPct(health.savingsRate)} cls={health.savingsRate == null ? 'idle' : health.savingsRate >= settings.savingsTargetPct / 100 ? 'good' : 'warn'} s={`target ${settings.savingsTargetPct}% · income ${fmtMoney(health.income)}/mo`} />
      <KPI l="Expense ratio" v={fmtPct(health.expenseRatio)} cls={health.expenseRatio == null ? 'idle' : health.expenseRatio <= 0.8 ? 'good' : health.expenseRatio <= 1 ? 'warn' : 'crit'} s="spending ÷ income" />
      <KPI l="Months covered" v={health.monthsCovered == null ? '—' : health.monthsCovered.toFixed(1)} cls={health.monthsCovered == null ? 'idle' : health.monthsCovered >= settings.runwayGreen ? 'good' : health.monthsCovered >= settings.runwayYellow ? 'warn' : 'crit'} s="cash on hand ÷ burn rate, if income stopped" />
      <KPI l="Subscriptions" v={fmtMoney(subs.monthly) + '/mo'} cls={subs.detectedUnknown.length ? 'warn' : 'info'} s={`${subs.count} items · ${fmtMoney(subs.annual)}/yr${subs.detectedUnknown.length ? ` · ${subs.detectedUnknown.length} not in Bills` : ''}`} />
      <KPI l="Waste found" v={fmtMoney(wasteTotal)} cls={wasteTotal > 0 ? 'crit' : 'good'} s={`${waste.length} findings · last 90 days`} />
    </div>
    <div className="grid g12">
      <Card span={4} title="Cash-flow score" hint="savings rate vs target + months of cover" right={<Seg value={String(look) as '3' | '6'} options={[['3', '3 mo'], ['6', '6 mo']]} onChange={v => setLook(+v as 3 | 6)} />}>
        <Gauge value={health.cashFlowScore} max={100} label={`${health.cashFlowScore} / 100`} color={gcol(health.cashFlowScore)} steps={steps} />
        <Note>60% how close your savings rate is to the {settings.savingsTargetPct}% target, 40% how many months of spending your cash covers (green at {settings.runwayGreen}).</Note>
      </Card>
      <Card span={4} title="Spending-efficiency score" hint="discretionary share, essentials vs income, fees">
        <Gauge value={health.efficiencyScore} max={100} label={`${health.efficiencyScore} / 100`} color={gcol(health.efficiencyScore)} steps={steps} />
        <Note>Essentials {fmtPct(health.essentialShare)} · discretionary {fmtPct(health.discretionaryShare)} of spending. Fees and interest pull this down fast.</Note>
      </Card>
      <Card span={4} title="What to look at">{health.notes.length ? <AList items={health.notes.map(n => ({ c: 'warn', t: n }))} /> : <AList items={[{ c: 'good', t: 'Nothing stands out', m: 'savings rate, cover and discretionary share are all inside your targets' }]} />}</Card>

      <Card span={12} title="Waste detection" hint="duplicates, fees, late fees, rising or dormant subscriptions, spikes and outliers · last 90 days">
        {waste.length === 0 ? <Empty>Nothing looks wasteful in the last 90 days.</Empty> : <div className="tblwrap"><table className="tbl"><thead><tr><th>Finding</th><th>Detail</th><th>Date</th><th className="num">Amount</th><th></th></tr></thead><tbody>
          {waste.map((w, i) => <tr key={i}><td><Pill cls={w.severity}>{WASTE_LABEL[w.kind]}</Pill> <b>{w.title}</b></td><td style={{ color: 'var(--ink-2)' }}>{w.detail}</td><td>{fmtD(w.date)}</td><td className="num">{fm2(w.amount)}</td><td>{w.txnIds.length > 0 && <Link to={`/transactions?ids=${w.txnIds.join(',')}`} className="btn sm">Open</Link>}{(w.kind === 'unused_subscription' || w.kind === 'rising_subscription') && <Link to="/bills" className="btn sm">Bills</Link>}</td></tr>)}
        </tbody></table></div>}
      </Card>

      <Card span={7} title="Merchants" hint="where the money goes" right={<Seg value={win} options={[['30', '30 days'], ['month', 'This month'], ['90', '90 days']]} onChange={setWin} />}>
        {top.length === 0 ? <Empty>No spending in this window.</Empty> : <>
          <Chart title="Spending by merchant" data={[{ type: 'bar', orientation: 'h', x: top.map(m => m.total).reverse(), y: top.map(m => m.name).reverse(), marker: { color: top.map((_, i) => pal[i % pal.length]).reverse() }, hovertemplate: '%{y}: $%{x:,.2f}<extra></extra>' }]} layout={{ showlegend: false, xaxis: { tickprefix: '$' }, yaxis: { automargin: true }, margin: { l: 10 } }} height={Math.max(220, 26 * top.length + 60)} />
          <div className="tblwrap" style={{ marginTop: 8 }}><table className="tbl"><thead><tr><th>Merchant</th><th className="num">Visits</th><th className="num">Total</th><th className="num">Avg</th><th className="num">vs prior</th><th>Categories</th></tr></thead><tbody>
            {merchants.slice(0, 25).map(m => <tr key={m.key}><td><b>{m.name}</b></td><td className="num">{m.count}</td><td className="num">{fm2(m.total)}</td><td className="num">{fm2(m.avg)}</td><td className="num" style={{ color: m.change == null ? 'var(--ink-3)' : m.change > 0.1 ? 'var(--crit)' : m.change < -0.1 ? 'var(--good)' : undefined }}>{m.change == null ? 'new' : (m.change > 0 ? '+' : '') + Math.round(m.change * 100) + '%'}</td><td style={{ color: 'var(--ink-2)' }}>{m.categories.join(', ')}</td></tr>)}
          </tbody></table></div></>}
      </Card>

      <Card span={5} title="Subscriptions & recurring charges" hint="from Bills plus charges detected in the ledger">
        <div className="tblwrap"><table className="tbl"><thead><tr><th>Service</th><th className="num">/mo</th><th className="num">/yr</th><th>Last</th><th></th></tr></thead><tbody>
          {subs.items.map((s, i) => <tr key={i}><td><b>{s.name}</b>{s.rising && <> <Pill cls="warn">↑ price</Pill></>}</td><td className="num">{fm2(s.monthly)}</td><td className="num">{fm2(s.annual)}</td><td>{s.lastCharged ? fmtD(s.lastCharged) : '—'}</td><td>{s.source === 'detected' ? <Pill cls="info">detected</Pill> : null}</td></tr>)}
          <tr><td><b>Total</b></td><td className="num"><b>{fm2(subs.monthly)}</b></td><td className="num"><b>{fm2(subs.annual)}</b></td><td colSpan={2}></td></tr>
        </tbody></table></div>
        {subs.detectedUnknown.length > 0 && <Note>{subs.detectedUnknown.length} recurring charge{subs.detectedUnknown.length === 1 ? '' : 's'} found in your transactions that are not in Bills &amp; Subscriptions — add them there so the forecast and reminders include them. <Link to="/bills"><Btn sm>Open Bills</Btn></Link></Note>}
        <Chart title="Subscription cost by service" data={[{ type: 'bar', x: subs.items.slice(0, 10).map(s => s.name), y: subs.items.slice(0, 10).map(s => s.monthly), marker: { color: c.blue }, hovertemplate: '%{x}: $%{y:,.2f}/mo<extra></extra>' }]} layout={{ showlegend: false, yaxis: { tickprefix: '$' }, xaxis: { type: 'category' } }} height={200} />
      </Card>
    </div>
  </>
}
