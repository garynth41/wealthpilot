// Reports (0.8.0): monthly / quarterly / annual reports with spending, cash-flow, net-worth, investment and tax sections.
// Pure: buildReport() returns a Report object; reportRows() flattens it for CSV / Excel. Pages render and export only.
import type { Data, Settings } from '../app/data/types'
import { addDays, monthEnd, monthStart, mAdd, today } from './dates'
import { round2, sum, fmtMoney } from './money'
import { rangeStat } from './budget'
import { merchantAnalysis } from './intelligence'
import { netWorthSeries } from './forecast'
import { netWorth } from './accounts'
import { portfolio } from './portfolio'
import { estimateTax } from './tax'
import { ACCOUNT_KIND_LABEL } from '../app/data/types'

export type ReportKind = 'month' | 'quarter' | 'year'
export type SectionId = 'summary' | 'spending' | 'cashflow' | 'networth' | 'investments' | 'tax'
export interface Kpi { label: string; value: number; fmt: 'money' | 'pct' | 'num'; prev?: number | null }
export interface ReportSection { id: SectionId; title: string; kpis: Kpi[]; table?: { headers: string[]; rows: Array<Array<string | number>> }; notes: string[] }
export interface Report { title: string; kind: ReportKind; from: string; to: string; label: string; prevFrom: string; prevTo: string; generated: string; sections: ReportSection[] }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** The period containing `anchor`, and the period before it. A period that is still running ends today (so "this month" means month-to-date). */
export function periodRange(kind: ReportKind, anchor: string, asOf = today()) {
  const y = +anchor.slice(0, 4), m = +anchor.slice(5, 7)
  let from: string, to: string, label: string, prevFrom: string, prevTo: string
  if (kind === 'month') { const k = anchor.slice(0, 7); from = monthStart(k); to = monthEnd(k); label = `${MONTHS[m - 1]} ${y}`; prevFrom = monthStart(mAdd(k, -1)); prevTo = monthEnd(mAdd(k, -1)) }
  else if (kind === 'quarter') { const q = Math.floor((m - 1) / 3); const k = `${y}-${String(q * 3 + 1).padStart(2, '0')}`; from = monthStart(k); to = monthEnd(mAdd(k, 2)); label = `Q${q + 1} ${y}`; prevFrom = monthStart(mAdd(k, -3)); prevTo = monthEnd(mAdd(k, -1)) }
  else { from = `${y}-01-01`; to = `${y}-12-31`; label = String(y); prevFrom = `${y - 1}-01-01`; prevTo = `${y - 1}-12-31` }
  const partial = to > asOf && from <= asOf
  if (partial) { const len = Math.round((Date.parse(asOf) - Date.parse(from)) / 86400000); to = asOf; prevTo = addDays(prevFrom, len); label += ' (to date)' }
  return { from, to, label, prevFrom, prevTo, partial }
}

const pctChange = (cur: number, prev: number | null | undefined) => (prev != null && prev !== 0 ? round2((cur - prev) / Math.abs(prev)) : null)
/** Build the whole report. Spending and cash flow come from transactions; net worth from snapshots + today; investments and tax are point-in-time (today / the report's tax year). */
export function buildReport(d: Data, s: Settings, kind: ReportKind, anchor: string, sections: SectionId[] = ['summary', 'spending', 'cashflow', 'networth', 'investments', 'tax'], asOf = today()): Report {
  const r = periodRange(kind, anchor, asOf); const cur = rangeStat(d, r.from, r.to), prev = rangeStat(d, r.prevFrom, r.prevTo)
  const out: ReportSection[] = []
  const net = round2(cur.income - cur.spend - cur.debt), prevNet = round2(prev.income - prev.spend - prev.debt)
  const rate = cur.income > 0 ? round2((cur.income - cur.spend - cur.debt) / cur.income) : null, prevRate = prev.income > 0 ? round2((prev.income - prev.spend - prev.debt) / prev.income) : null
  if (sections.includes('summary')) out.push({ id: 'summary', title: 'Summary', kpis: [
    { label: 'Income', value: round2(cur.income), fmt: 'money', prev: round2(prev.income) }, { label: 'Spending', value: round2(cur.spend), fmt: 'money', prev: round2(prev.spend) },
    { label: 'Debt payments', value: round2(cur.debt), fmt: 'money', prev: round2(prev.debt) }, { label: 'Net (kept)', value: net, fmt: 'money', prev: prevNet },
    ...(rate != null ? [{ label: 'Savings rate', value: rate, fmt: 'pct' as const, prev: prevRate }] : []), { label: 'Net worth today', value: round2(netWorth(d).net), fmt: 'money' as const } ],
    notes: [`${r.label}: ${r.from} to ${r.to}; compared with ${r.prevFrom} to ${r.prevTo}.`, ...(cur.income > 0 && net < 0 ? [`Spending and debt payments exceeded income by ${Math.abs(net).toFixed(2)}.`] : [])] })

  if (sections.includes('spending')) {
    const cats = Object.keys({ ...cur.byCat, ...prev.byCat }).map(name => { const c = d.categories.find(x => x.name === name); const a = round2(cur.byCat[name] || 0), b = round2(prev.byCat[name] || 0); return [c?.group || '', name, a, b, round2(a - b), pctChange(a, b) ?? ''] as Array<string | number> })
      .filter(row => +row[2] > 0 || +row[3] > 0).sort((x, y) => +y[2] - +x[2])
    const merch = merchantAnalysis(d, r.from, r.to).slice(0, 10)
    out.push({ id: 'spending', title: 'Spending by category', kpis: [{ label: 'Total spending', value: round2(cur.spend), fmt: 'money', prev: round2(prev.spend) }, { label: 'Essential', value: round2(cur.ess), fmt: 'money', prev: round2(prev.ess) }, { label: 'Discretionary', value: round2(cur.disc), fmt: 'money', prev: round2(prev.disc) }, { label: 'Categories', value: cats.length, fmt: 'num' }],
      table: { headers: ['Group', 'Category', 'This period', 'Previous', 'Change', 'Change %'], rows: cats },
      notes: merch.length ? [`Top merchants: ${merch.slice(0, 5).map(m => `${m.name} ${m.total.toFixed(2)}`).join(' · ')}`] : [] })
  }
  if (sections.includes('cashflow')) {
    const months: string[] = []; for (let k = r.from.slice(0, 7); k <= r.to.slice(0, 7); k = mAdd(k, 1)) months.push(k)
    const rows = months.map(k => { const a = monthStart(k) < r.from ? r.from : monthStart(k), b = monthEnd(k) > r.to ? r.to : monthEnd(k); const st = rangeStat(d, a, b); return [k, round2(st.income), round2(st.spend), round2(st.debt), round2(st.income - st.spend - st.debt)] as Array<string | number> })
    out.push({ id: 'cashflow', title: 'Cash flow by month', kpis: [{ label: 'Money in', value: round2(cur.income), fmt: 'money' }, { label: 'Money out', value: round2(cur.spend + cur.debt), fmt: 'money' }, { label: 'Net', value: net, fmt: 'money', prev: prevNet }],
      table: { headers: ['Month', 'Income', 'Spending', 'Debt payments', 'Net'], rows }, notes: [] })
  }
  if (sections.includes('networth')) {
    // net worth at the start and end of the period from recorded snapshots (the series always ends with today's live balances)
    const series = netWorthSeries(d); const at = (date: string) => [...series].reverse().find(x => x.date <= date) || null
    const startPt = at(r.from) || series[0], endPt = at(r.to) || series[series.length - 1]; const nw = netWorth(d); const accts = d.accounts.filter(a => a.status === 'Active' && a.include_in_net_worth).sort((a, b) => a.sort_order - b.sort_order)
    const exactStart = !!at(r.from)
    out.push({ id: 'networth', title: 'Net worth', kpis: [{ label: `Net worth ${endPt.date === today() ? 'today' : 'on ' + endPt.date}`, value: round2(endPt.net), fmt: 'money', prev: round2(startPt.net) }, { label: `Change since ${startPt.date}`, value: round2(endPt.net - startPt.net), fmt: 'money' }, { label: 'Assets today', value: round2(nw.assets), fmt: 'money' }, { label: 'Liabilities today', value: round2(nw.liabilities), fmt: 'money' }],
      table: { headers: ['Account', 'Type', 'Institution', 'Balance', 'As of'], rows: accts.map(a => [a.name, ACCOUNT_KIND_LABEL[a.kind], a.institution || '', round2(['credit_card', 'store_card', 'loan', 'auto_loan', 'student_loan', 'mortgage', 'bnpl', 'line_of_credit', 'medical', 'collection', 'other_liability'].includes(a.kind) ? -Math.abs(+a.balance || 0) : +a.balance || 0), a.balance_as_of || '']) },
      notes: [exactStart ? `Start of period uses the snapshot of ${startPt.date}; end uses ${endPt.date === today() ? "today's balances" : 'the snapshot of ' + endPt.date}.` : `No snapshot on or before ${r.from}; the earliest one (${startPt.date}) is used as the starting point.`, 'Account balances are as last updated. Record a snapshot monthly on Account Balances to keep the trend accurate.'] })
  }
  if (sections.includes('investments')) {
    const pf = portfolio(d)
    out.push({ id: 'investments', title: 'Investments', kpis: [{ label: 'Portfolio value', value: pf.value, fmt: 'money' }, { label: 'Gain / loss', value: pf.gain, fmt: 'money' }, ...(pf.gainPct != null ? [{ label: 'Return on cost', value: pf.gainPct, fmt: 'pct' as const }] : []), ...(pf.growthShare != null ? [{ label: 'Growth share', value: pf.growthShare, fmt: 'pct' as const }] : [])],
      table: { headers: ['Asset class', 'Value', 'Share', 'Holdings'], rows: pf.byClass.map(c => [c.label, c.value, c.pct, c.count]) }, notes: pf.concentrationWarning ? [pf.concentrationWarning] : [] })
  }
  if (sections.includes('tax')) {
    const yr = +r.to.slice(0, 4); const e = estimateTax(d, s, { year: yr }, asOf)
    out.push({ id: 'tax', title: `Tax estimate ${e.year}`, kpis: [{ label: 'Total tax', value: e.totalTax, fmt: 'money' }, { label: e.refund > 0 ? 'Projected refund' : 'Projected due', value: e.refund > 0 ? e.refund : e.due, fmt: 'money' }, ...(e.federal.effective != null ? [{ label: 'Federal effective rate', value: e.federal.effective, fmt: 'pct' as const }] : []), { label: 'Marginal rate', value: e.federal.marginal, fmt: 'pct' }],
      table: { headers: ['Line', 'Amount'], rows: [['Total income', e.income.total], ['AGI', e.agi], ['Taxable income', e.taxableIncome], ['Federal tax', e.federal.total], [e.state.name.split(' (')[0], e.state.tax], ['Local', e.local.total], ['Paid / planned (federal)', e.paid.total]] },
      notes: [e.safeHarbor.met ? 'Safe harbor met.' : `Short of the safe harbor by ${e.safeHarbor.shortfall.toFixed(2)} (${e.safeHarbor.basis}).`, 'Planning estimate, not a return.'] })
  }
  return { title: `WealthPilot ${kind === 'month' ? 'monthly' : kind === 'quarter' ? 'quarterly' : 'annual'} report — ${r.label}`, kind, from: r.from, to: r.to, label: r.label, prevFrom: r.prevFrom, prevTo: r.prevTo, generated: new Date(Date.parse(asOf + 'T12:00:00')).toISOString().slice(0, 10), sections: out }
}
/** Flatten for CSV: section header, KPI rows (label, value, previous), the table, a blank line. */
export function reportRows(rep: Report): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [[rep.title], [`Period ${rep.from} to ${rep.to}`, `Generated ${rep.generated}`], []]
  for (const sec of rep.sections) { rows.push([sec.title.toUpperCase()]); rows.push(['Measure', 'Value', 'Previous']); for (const k of sec.kpis) rows.push([k.label, k.value, k.prev ?? '']); if (sec.table) { rows.push([]); rows.push(sec.table.headers); rows.push(...sec.table.rows) } for (const n of sec.notes) rows.push([n]); rows.push([]) }
  return rows
}
export const totalOf = (rows: Array<Array<string | number>>, col: number) => round2(sum(rows.map(r => +r[col] || 0)))

/** Change vs previous: percentage points for rates; % for money only when the base is meaningful (≥ $100 and same sign), otherwise the dollar difference. */
export const changeText = (k: Kpi): string => { if (k.prev == null) return ''; const diff = k.value - k.prev; if (Math.abs(diff) < 0.005) return 'no change'
  if (k.fmt === 'pct') return `${diff >= 0 ? '+' : '−'}${Math.abs(diff * 100).toFixed(1)} pts`
  if (k.fmt === 'money' && Math.abs(k.prev) >= 100 && Math.sign(k.prev) === Math.sign(k.value)) return `${diff >= 0 ? '+' : '−'}${Math.round(Math.abs(diff / k.prev) * 100)}%`
  return `${diff >= 0 ? '+' : '−'}${k.fmt === 'money' ? fmtMoney(Math.abs(diff)) : Math.abs(diff)}` }
