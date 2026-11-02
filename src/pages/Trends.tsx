import { useMemo, useState } from 'react'
import { useData } from '../app/hooks'
import { Card, KPI, Note, Seg, AList } from '../components/ui'
import { Chart, C, PALETTE } from '../components/Chart'
import { trendSeries, rangeStat } from '../lib/budget'
import { netWorthSeries } from '../lib/forecast'
import { treemap, spendingHeatmap } from '../lib/visuals'
import { fmtMoney, sum } from '../lib/money'
import { addDays, curMonth, mAdd, mShort, monthEnd, monthStart, today } from '../lib/dates'

export function TrendsPage() {
  const { data, settings } = useData(); const [gran, setGran] = useState<'week' | 'month' | 'year'>('month'); const [look, setLook] = useState<3 | 6 | 12>(6)
  const ser = useMemo(() => trendSeries(data, gran), [data, gran]); const c = C(); const pal = PALETTE()
  const months = [...Array(look)].map((_, i) => mAdd(curMonth(), i - look + 1)); const stats = months.map(m => rangeStat(data, monthStart(m), monthEnd(m)))
  const tot: Record<string, number> = {}; stats.forEach(s => Object.entries(s.byCat).forEach(([k, v]) => { tot[k] = (tot[k] || 0) + v }))
  const top = Object.keys(tot).sort((a, b) => tot[b] - tot[a]).filter(k => tot[k] > 0).slice(0, 8)
  const grp: Record<string, number> = {}; stats.forEach(s => Object.entries(s.byGroup).forEach(([k, v]) => { grp[k] = (grp[k] || 0) + v }))
  const avgSpend = stats.length ? sum(stats.map(s => s.spend + s.debt)) / stats.length : 0, avgInc = stats.length ? sum(stats.map(s => s.income)) / stats.length : 0
  const closed = stats.slice(0, -1); const cur = stats[stats.length - 1]
  const ins: Array<{ c: string; t: string; m: string }> = []
  if (closed.length && cur) { const a = sum(closed.map(s => s.spend)) / closed.length; ins.push({ c: cur.spend > a * 1.05 ? 'warn' : 'good', t: `This month's spending is ${cur.spend > a ? 'above' : 'at or below'} your ${closed.length}-month average`, m: `${fmtMoney(cur.spend)} so far vs ${fmtMoney(a)} average` }) }
  if (stats.length) { const i = sum(stats.map(s => s.income)), o = sum(stats.map(s => s.spend + s.debt)); ins.push({ c: i - o >= 0 ? 'good' : 'crit', t: `Last ${look} months: ${i - o >= 0 ? 'kept' : 'overspent by'} ${fmtMoney(Math.abs(i - o))}`, m: `income ${fmtMoney(i)} · spending + debt payments ${fmtMoney(o)}` }) }
  const topCat = top[0]; if (topCat) ins.push({ c: 'info', t: `${topCat} is your biggest category`, m: `${fmtMoney(tot[topCat])} over ${look} months · ${fmtMoney(tot[topCat] / look)}/mo` })
  const disc = sum(stats.map(s => s.disc)); if (disc) ins.push({ c: disc / Math.max(1, sum(stats.map(s => s.spend))) > 0.3 ? 'warn' : 'good', t: `Discretionary is ${Math.round(disc / Math.max(1, sum(stats.map(s => s.spend))) * 100)}% of spending`, m: `${fmtMoney(disc / look)}/mo — the easiest lever if money gets tight` })
  const nws = netWorthSeries(data); const dow = useMemo(() => { const m = [0, 0, 0, 0, 0, 0, 0]; data.transactions.filter(t => t.kind === 'expense' && t.status !== 'void' && t.date >= addDays(today(), -90)).forEach(t => { m[new Date(t.date + 'T12:00').getDay()] += t.amount }); return m }, [data])
  return <>
    <div className="kpis" style={{ marginBottom: 16 }}><KPI l="Avg monthly income" v={fmtMoney(avgInc)} cls="good" s={`last ${look} months`} /><KPI l="Avg monthly spend" v={fmtMoney(avgSpend)} cls="warn" s="incl. debt payments" /><KPI l="Avg savings rate" v={avgInc ? Math.round((avgInc - avgSpend) / avgInc * 100) + '%' : '—'} cls={avgInc && (avgInc - avgSpend) / avgInc >= settings.savingsTargetPct / 100 ? 'good' : 'warn'} s={`target ${settings.savingsTargetPct}%`} /><KPI l="Net worth" v={fmtMoney(nws[nws.length - 1].net)} cls={nws[nws.length - 1].net >= 0 ? 'good' : 'crit'} s={nws.length > 1 ? `${nws[nws.length - 1].net - nws[0].net >= 0 ? '+' : ''}${fmtMoney(nws[nws.length - 1].net - nws[0].net)} since ${nws[0].date}` : 'record snapshots on Accounts'} /></div>
    <div className="grid g12">
      <Card span={12} title="Income, spending and net" hint={gran === 'week' ? 'week by week (Mon–Sun)' : gran === 'month' ? 'month by month · grey = planned spending' : 'year by year'} right={<Seg value={gran} options={[['week', 'Week'], ['month', 'Month'], ['year', 'Year']]} onChange={setGran} />}>
        <Chart title="Income, spending and net" data={[{ type: 'bar', name: 'Income', x: ser.map(r => r.label), y: ser.map(r => r.income), marker: { color: c.good }, hovertemplate: '%{x}: income $%{y:,.0f}<extra></extra>' }, ...(gran === 'month' ? [{ type: 'bar' as const, name: 'Planned spending', x: ser.map(r => r.label), y: ser.map(r => r.planned ?? 0), marker: { color: c.idle, opacity: .55 }, hovertemplate: '%{x}: planned $%{y:,.0f}<extra></extra>' }] : []), { type: 'bar', name: 'Spending', x: ser.map(r => r.label), y: ser.map(r => r.spend), marker: { color: ser.map(r => r.planned != null && r.spend > r.planned ? c.crit : c.soon) }, hovertemplate: '%{x}: spending $%{y:,.0f}<extra></extra>' }, { type: 'bar', name: 'Debt payments', x: ser.map(r => r.label), y: ser.map(r => r.debt), marker: { color: c.wait }, hovertemplate: '%{x}: debt $%{y:,.0f}<extra></extra>' }, { type: 'scatter', mode: 'lines+markers', name: 'Net', x: ser.map(r => r.label), y: ser.map(r => r.net), line: { color: c.blue, width: 2 }, marker: { size: 7 }, hovertemplate: '%{x}: net $%{y:,.0f}<extra></extra>' }, ...(gran === 'week' && ser.length >= 2 ? [{ type: 'scatter' as const, mode: 'lines' as const, name: '4-week avg spending', x: ser.map(r => r.label), y: ser.map((_, i) => { const w = ser.slice(Math.max(0, i - 3), i + 1); return sum(w.map(z => z.spend)) / w.length }), line: { color: c.warn, width: 2, dash: 'dot' as const }, hovertemplate: '%{x}: 4-wk avg $%{y:,.0f}<extra></extra>' }] : [])]} layout={{ barmode: 'group', showlegend: true, yaxis: { tickformat: '$,.0f', zeroline: true, zerolinecolor: c.line }, xaxis: { type: 'category' } }} height={320} />
        <div className="tblwrap" style={{ marginTop: 8 }}><table className="tbl"><thead><tr><th>{gran === 'week' ? 'Week' : gran === 'month' ? 'Month' : 'Year'}</th><th className="num">Income</th>{gran === 'month' && <th className="num">Planned</th>}<th className="num">Spending</th><th className="num">Debt payments</th><th className="num">Net</th><th className="num">Savings rate</th></tr></thead><tbody>{ser.slice().reverse().map(r => <tr key={r.key}><td>{r.label}</td><td className="num">{fmtMoney(r.income)}</td>{gran === 'month' && <td className="num">{r.planned != null ? fmtMoney(r.planned) : '—'}</td>}<td className="num">{fmtMoney(r.spend)}</td><td className="num">{fmtMoney(r.debt)}</td><td className="num" style={{ color: `var(--${r.net < 0 ? 'crit' : 'good'})` }}>{r.net >= 0 ? '+' : ''}{fmtMoney(r.net)}</td><td className="num">{r.income > 0 ? Math.round(r.net / r.income * 100) + '%' : '—'}</td></tr>)}</tbody></table></div></Card>
      <Card span={7} title="Spending by category" hint="largest categories per month" right={<Seg value={String(look) as '3' | '6' | '12'} options={[['3', '3 mo'], ['6', '6 mo'], ['12', '12 mo']]} onChange={v => setLook(+v as 3 | 6 | 12)} />}>
        <Chart title="Spending by category" data={[...top.map((k, i) => ({ type: 'bar' as const, name: k, x: months.map(mShort), y: stats.map(s => s.byCat[k] || 0), marker: { color: pal[i % pal.length] }, hovertemplate: `${k} · %{x}: $%{y:,.0f}<extra></extra>` })), { type: 'bar', name: 'Other + debt payments', x: months.map(mShort), y: stats.map(s => Object.entries(s.byCat).filter(([k]) => !top.includes(k)).reduce((a, [, v]) => a + v, 0) + s.debt), marker: { color: c.line }, hovertemplate: 'Other · %{x}: $%{y:,.0f}<extra></extra>' }]} layout={{ barmode: 'stack', showlegend: true, yaxis: { tickformat: '$,.0f' }, xaxis: { type: 'category' } }} height={320} /></Card>
      <Card span={5} title="Insights"><AList items={ins} />
        <h3 style={{ marginTop: 14 }}>By group · last {look} months</h3><div className="tblwrap"><table className="tbl"><tbody>{Object.entries(grp).sort((a, b) => b[1] - a[1]).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{fmtMoney(v)}</td><td className="num" style={{ color: 'var(--ink-3)' }}>{fmtMoney(v / look)}/mo</td></tr>)}</tbody></table></div></Card>
      <Card span={7} title="Where the money went" hint={`treemap · spending by category, last ${look} months · size = dollars`}><Treemap items={top.concat(Object.keys(tot).filter(k => !top.includes(k) && tot[k] > 0)).map(k => ({ key: k, label: k, value: Math.round(tot[k]) }))} colors={pal} /></Card>
      <Card span={5} title="Spending heat map" hint="daily spending, last 26 weeks · darker = more"><Heatmap /></Card>
      <Card span={6} title="Spending by day of week" hint="last 90 days"><Chart title="Spending by day of week" data={[{ type: 'bar', x: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], y: dow, marker: { color: c.blue }, hovertemplate: '%{x}: $%{y:,.0f}<extra></extra>' }]} layout={{ showlegend: false, yaxis: { tickprefix: '$' }, xaxis: { type: 'category' } }} height={220} /><Note>Weekend-heavy spending usually means dining and shopping; weekday peaks are bills and fuel.</Note></Card>
      <Card span={6} title="Net worth" hint="recorded snapshots plus today"><Chart title="Net worth" data={[{ type: 'scatter', mode: 'lines+markers', name: 'Net', x: nws.map(x => x.date), y: nws.map(x => x.net), line: { color: c.accent, width: 2 }, fill: 'tozeroy', fillcolor: c.accentSoft, hovertemplate: '%{x|%b %d, %Y}: $%{y:,.0f}<extra></extra>' }]} layout={{ showlegend: false, yaxis: { tickprefix: '$' }, xaxis: { type: 'date', tickformat: '%b %d', hoverformat: '%b %d, %Y', nticks: 6 } }} height={220} /></Card>
    </div>
  </>
}

/** SVG treemap: one tile per category, labelled when there is room. */
function Treemap({ items, colors }: { items: Array<{ key: string; label: string; value: number }>; colors: string[] }) {
  const W = 640, H = 300; const rects = treemap(items, W, H); const total = items.reduce((a, i) => a + i.value, 0)
  if (!rects.length) return <Note>No spending in this window.</Note>
  return <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Treemap of spending by category">
    {rects.map((r, i) => <g key={r.key}><title>{`${r.label}: ${fmtMoney(r.value)} (${Math.round(r.value / total * 100)}%)`}</title>
      <rect x={r.x + 1} y={r.y + 1} width={Math.max(0, r.w - 2)} height={Math.max(0, r.h - 2)} rx={6} fill={colors[i % colors.length]} opacity={0.9} />
      {r.w > 70 && r.h > 34 && <text x={r.x + 8} y={r.y + 20} fontSize={r.w > 140 ? 14 : 12} fontWeight={600} fill="#fff">{r.label.length * 7 > r.w - 12 ? r.label.slice(0, Math.max(3, Math.floor((r.w - 12) / 7) - 1)) + '…' : r.label}</text>}
      {r.w > 70 && r.h > 52 && <text x={r.x + 8} y={r.y + 38} fontSize={12} fill="#fff" opacity={0.9}>{fmtMoney(r.value)} · {Math.round(r.value / total * 100)}%</text>}</g>)}
  </svg>
}
/** Calendar heat map of daily spending (Mon–Sun rows, one column per week). */
function Heatmap() {
  const { data } = useData(); const h = useMemo(() => spendingHeatmap(data, 26), [data]); const cs = 14, gap = 3, left = 28, top = 18
  const weeks = Math.max(1, ...h.cells.map(c => c.week + 1)); const W = left + weeks * (cs + gap), H = top + 7 * (cs + gap) + 22
  const fill = ['var(--line-2)', 'color-mix(in srgb, var(--accent) 25%, transparent)', 'color-mix(in srgb, var(--accent) 50%, transparent)', 'color-mix(in srgb, var(--accent) 75%, transparent)', 'var(--accent)']
  const months = h.cells.filter(c => c.dow === 0 && +c.date.slice(8) <= 7)
  return <><svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Heat map of daily spending">
    {['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map((d, i) => d && <text key={i} x={0} y={top + i * (cs + gap) + cs - 3} fontSize={10} fill="var(--ink-3)">{d}</text>)}
    {months.map(m => <text key={m.date} x={left + m.week * (cs + gap)} y={11} fontSize={10} fill="var(--ink-3)">{new Date(m.date + 'T12:00').toLocaleDateString('en-US', { month: 'short' })}</text>)}
    {h.cells.map(c => <rect key={c.date} x={left + c.week * (cs + gap)} y={top + c.dow * (cs + gap)} width={cs} height={cs} rx={3} fill={fill[c.level]}><title>{`${c.date}: ${c.amount ? fmtMoney(c.amount) : 'no spending'}`}</title></rect>)}
    <text x={left} y={H - 4} fontSize={10} fill="var(--ink-3)">less</text>{fill.map((f, i) => <rect key={i} x={left + 28 + i * (cs + gap)} y={H - 15} width={cs - 2} height={cs - 2} rx={3} fill={f} />)}<text x={left + 32 + 5 * (cs + gap)} y={H - 4} fontSize={10} fill="var(--ink-3)">more</text>
  </svg><Note>{fmtMoney(h.total)} over 26 weeks · busiest day {fmtMoney(h.max)} · levels split at {h.thresholds.map(t => fmtMoney(t)).join(' / ')}.</Note></>
}
