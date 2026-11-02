import { useMemo, useState } from 'react'
import { useData } from '../app/hooks'
import { Card, KPI, Btn, Seg, Note, Field } from '../components/ui'
import { Chart, C, PALETTE } from '../components/Chart'
import { exportTable } from '../components/Table'
import { buildReport, reportRows, changeText, type ReportKind, type SectionId, type Kpi } from '../lib/reports'
import { fmtMoney, fm2, fmtPct } from '../lib/money'
import { today, mAdd, curMonth } from '../lib/dates'

const SECTIONS: Array<[SectionId, string]> = [['summary', 'Summary'], ['spending', 'Spending'], ['cashflow', 'Cash flow'], ['networth', 'Net worth'], ['investments', 'Investments'], ['tax', 'Tax']]
const fmt = (k: Kpi, v: number) => (k.fmt === 'money' ? fmtMoney(v) : k.fmt === 'pct' ? fmtPct(v, 1) : String(v))
const cell = (h: string, v: string | number) => (typeof v === 'number' ? (/%|share/i.test(h) ? fmtPct(v, 1) : /holdings|count/i.test(h) ? String(v) : fm2(v)) : v)

export function ReportsPage() {
  const { data, settings } = useData(); const c = C(); const pal = PALETTE()
  const [kind, setKind] = useState<ReportKind>('month'); const [anchor, setAnchor] = useState(mAdd(curMonth(), -1) + '-01')
  const [on, setOn] = useState<SectionId[]>(SECTIONS.map(s => s[0]))
  const rep = useMemo(() => buildReport(data, settings, kind, anchor, on), [data, settings, kind, anchor, on])
  const y = +today().slice(0, 4); const years = [y - 2, y - 1, y]
  const options = kind === 'month' ? [...Array(24)].map((_, i) => mAdd(curMonth(), -i)).map(k => [k + '-01', new Date(k + '-15T12:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })])
    : kind === 'quarter' ? years.slice().reverse().flatMap(yy => [4, 3, 2, 1].map(q => [`${yy}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`, `Q${q} ${yy}`])).filter(([d]) => d <= today())
    : years.slice().reverse().map(yy => [`${yy}-01-01`, String(yy)])
  const setK = (k: ReportKind) => { setKind(k); setAnchor(k === 'month' ? mAdd(curMonth(), -1) + '-01' : k === 'quarter' ? `${y}-${String(Math.floor((+today().slice(5, 7) - 1) / 3) * 3 + 1).padStart(2, '0')}-01` : `${y}-01-01`) }
  const file = `wealthpilot-${rep.kind}-${rep.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
  const csv = () => exportTable(file, [], reportRows(rep), 'csv')
  const excel = async () => { const XLSX = await import('xlsx'); const wb = XLSX.utils.book_new()
    const sum = XLSX.utils.aoa_to_sheet([[rep.title], [`Period ${rep.from} to ${rep.to}`, `Previous ${rep.prevFrom} to ${rep.prevTo}`], [], ['Section', 'Measure', 'Value', 'Previous', 'Change'], ...rep.sections.flatMap(sec => sec.kpis.map(k => [sec.title, k.label, k.value, k.prev ?? '', k.prev != null ? k.value - k.prev : '']))]); sum['!cols'] = [{ wch: 22 }, { wch: 26 }, { wch: 14 }, { wch: 14 }, { wch: 12 }]; XLSX.utils.book_append_sheet(wb, sum, 'Summary')
    for (const sec of rep.sections) if (sec.table) { const ws = XLSX.utils.aoa_to_sheet([sec.table.headers, ...sec.table.rows, [], ...sec.notes.map(n => [n])]); ws['!cols'] = sec.table.headers.map(h => ({ wch: Math.max(12, h.length + 4) })); XLSX.utils.book_append_sheet(wb, ws, sec.title.slice(0, 31)) }
    XLSX.writeFile(wb, file + '.xlsx') }
  const pdf = () => { const t = document.title; document.title = file; window.print(); setTimeout(() => { document.title = t }, 500) }
  const spend = rep.sections.find(s => s.id === 'spending'); const cf = rep.sections.find(s => s.id === 'cashflow'); const inv = rep.sections.find(s => s.id === 'investments')

  return <>
    <Card span={12} className="noprint" title="Build a report" right={<span className="btnrow"><Btn primary sm onClick={pdf} title="Opens the print dialog — choose “Save as PDF”">PDF</Btn><Btn sm onClick={excel}>Excel</Btn><Btn sm onClick={csv}>CSV</Btn></span>}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Report"><Seg value={kind} options={[['month', 'Monthly'], ['quarter', 'Quarterly'], ['year', 'Annual']]} onChange={setK} /></Field>
        <Field label="Period"><select className="inp" value={anchor} onChange={e => setAnchor(e.target.value)} style={{ minWidth: 180 }}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="Include">{<div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{SECTIONS.map(([id, l]) => <label key={id}><input type="checkbox" checked={on.includes(id)} onChange={e => setOn(x => e.target.checked ? SECTIONS.map(s => s[0]).filter(k => x.includes(k) || k === id) : x.filter(k => k !== id))} /> {l}</label>)}</div>}</Field>
      </div>
    </Card>
    <div className="report" style={{ marginTop: 16 }}>
      <div className="report-head"><h2 style={{ margin: 0 }}>{rep.title}</h2><div className="note" style={{ margin: '4px 0 0' }}>{rep.from} to {rep.to} · compared with {rep.prevFrom} to {rep.prevTo} · generated {rep.generated}</div></div>
      {rep.sections.map(sec => <Card key={sec.id} span={12} title={sec.title} className="report-sec">
        <div className="kpis" style={{ marginBottom: sec.table ? 12 : 0 }}>{sec.kpis.map(k => { const ch = changeText(k); const up = k.prev != null ? k.value - k.prev : 0; const good = /spending|debt|liabilit|tax|due/i.test(k.label) ? up <= 0 : up >= 0
          return <KPI key={k.label} l={k.label} v={fmt(k, k.value)} cls={k.prev == null ? 'info' : good ? 'good' : 'warn'} s={k.prev != null ? `previous ${fmt(k, k.prev)}${ch ? ' · ' + ch : ''}` : ''} /> })}</div>
        {sec.id === 'spending' && spend?.table && spend.table.rows.length > 0 && <Chart title="Spending by category" data={[{ type: 'bar', name: 'This period', x: spend.table.rows.slice(0, 10).map(r => r[1] as string), y: spend.table.rows.slice(0, 10).map(r => +r[2]), marker: { color: c.accent }, hovertemplate: '%{x}: $%{y:,.2f}<extra>this period</extra>' }, { type: 'bar', name: 'Previous', x: spend.table.rows.slice(0, 10).map(r => r[1] as string), y: spend.table.rows.slice(0, 10).map(r => +r[3]), marker: { color: c.idle, opacity: .6 }, hovertemplate: '%{x}: $%{y:,.2f}<extra>previous</extra>' }]} layout={{ barmode: 'group', showlegend: true, yaxis: { tickprefix: '$' }, xaxis: { type: 'category' } }} height={260} />}
        {sec.id === 'cashflow' && cf?.table && cf.table.rows.length > 1 && <Chart title="Cash flow by month" data={[{ type: 'bar', name: 'Income', x: cf.table.rows.map(r => r[0] as string), y: cf.table.rows.map(r => +r[1]), marker: { color: c.good } }, { type: 'bar', name: 'Spending + debt', x: cf.table.rows.map(r => r[0] as string), y: cf.table.rows.map(r => +r[2] + +r[3]), marker: { color: c.warn } }, { type: 'scatter', mode: 'lines+markers', name: 'Net', x: cf.table.rows.map(r => r[0] as string), y: cf.table.rows.map(r => +r[4]), line: { color: c.blue } }]} layout={{ barmode: 'group', showlegend: true, yaxis: { tickprefix: '$' }, xaxis: { type: 'category' } }} height={260} />}
        {sec.id === 'investments' && inv?.table && inv.table.rows.length > 0 && <Chart title="Asset allocation" data={[{ type: 'pie', hole: 0.55, labels: inv.table.rows.map(r => r[0] as string), values: inv.table.rows.map(r => +r[1]), marker: { colors: pal }, textinfo: 'percent', hovertemplate: '%{label}: $%{value:,.0f}<extra></extra>' }]} layout={{ showlegend: true }} height={240} />}
        {sec.table && <div className="tblwrap" style={{ marginTop: 8 }}><table className="tbl"><thead><tr>{sec.table.headers.map(h => <th key={h} className={sec.table!.rows.some(r => typeof r[sec.table!.headers.indexOf(h)] === 'number') ? 'num' : ''}>{h}</th>)}</tr></thead><tbody>
          {sec.table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={typeof v === 'number' ? 'num' : ''} style={sec.table!.headers[j] === 'Change' && typeof v === 'number' ? { color: v > 0 ? 'var(--crit)' : v < 0 ? 'var(--good)' : undefined } : undefined}>{cell(sec.table!.headers[j], v)}</td>)}</tr>)}
        </tbody></table></div>}
        {sec.notes.map((n, i) => <Note key={i}>{n}</Note>)}
      </Card>)}
      {rep.sections.length === 0 && <Note>Pick at least one section.</Note>}
    </div>
  </>
}
