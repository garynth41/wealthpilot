// Reports (0.8.0): monthly / quarterly / annual reports with spending, cash-flow, net-worth, investment and tax sections.
// Pure: buildReport() returns a Report object; reportRows() flattens it for CSV / Excel. Pages render and export only.
import type { Data, Settings, Account, Transaction } from '../app/data/types'
import { addDays, monthEnd, monthStart, mAdd, today, diffDays } from './dates'
import { round2, sum, fmtMoney } from './money'
import { rangeStat, inRange, spentIn } from './budget'
import { merchantAnalysis, merchantKey } from './intelligence'
import { netWorthSeries } from './forecast'
import { netWorth, liabilities, debtBal, debtPlanned, debtPaidInRange, utilization, balanceOf, assets, cashOnHand } from './accounts'
import { portfolio } from './portfolio'
import { estimateTax } from './tax'
import { expectedIncome } from './paySchedule'
import { recActive, isOutflow, recMonthly, nextDue, upcoming, REC_PER_YEAR } from './recurring'
import { payoffProjection, simulate } from './debts'
import { goalProgress } from './goals'
import { plannedForPeriod } from './sinking'
import { ACCOUNT_KIND_LABEL } from '../app/data/types'

export type ReportKind = 'month' | 'quarter' | 'year' | 'custom'
export type SectionId = 'summary' | 'statement' | 'income' | 'spending' | 'merchants' | 'budget' | 'bills' | 'cashflow' | 'trend' | 'accounts' | 'debts' | 'goals' | 'networth' | 'investments' | 'tax' | 'transactions'
export const ALL_SECTIONS: Array<[SectionId, string, string]> = [
  ['summary', 'Summary', 'income, spending, net, savings rate'], ['statement', 'Cash flow statement', 'operating · debt · savings · change in cash'], ['income', 'Income', 'by source, vs previous'],
  ['spending', 'Spending by category', 'this period vs previous'], ['merchants', 'Top payees', 'where the money went'], ['budget', 'Budget vs actual', 'planned, spent, variance'],
  ['bills', 'Bills & subscriptions', 'commitments and what was paid'], ['cashflow', 'Cash flow by month', 'in, out, net per month'], ['trend', '12-month trend', 'income, spending, net, savings rate'],
  ['accounts', 'Account activity', 'in, out, net per account'], ['debts', 'Debt', 'balances, APR, payments, payoff'], ['goals', 'Savings goals', 'progress and contributions'],
  ['networth', 'Net worth', 'assets and liabilities'], ['investments', 'Investments', 'portfolio and allocation'], ['tax', 'Tax estimate', 'this year'], ['transactions', 'Transaction detail', 'every transaction in the period']]
export const PRESETS: Array<{ id: string; label: string; sections: SectionId[] }> = [
  { id: 'full', label: 'Everything', sections: ALL_SECTIONS.map(s => s[0]) },
  { id: 'monthly', label: 'Monthly review', sections: ['summary', 'statement', 'spending', 'budget', 'bills', 'merchants', 'networth'] },
  { id: 'spend', label: 'Spending deep-dive', sections: ['spending', 'merchants', 'budget', 'trend', 'transactions'] },
  { id: 'debt', label: 'Debt & goals', sections: ['summary', 'debts', 'goals', 'networth'] },
  { id: 'tax', label: 'Tax pack', sections: ['summary', 'income', 'tax', 'accounts', 'investments'] },
  { id: 'statement', label: 'Statement', sections: ['statement', 'accounts', 'transactions'] }]
export interface Kpi { label: string; value: number; fmt: 'money' | 'pct' | 'num'; prev?: number | null }
export interface ReportSection { id: SectionId; title: string; kpis: Kpi[]; table?: { headers: string[]; rows: Array<Array<string | number>> }; notes: string[] }
export interface Report { title: string; kind: ReportKind; from: string; to: string; label: string; prevFrom: string; prevTo: string; generated: string; sections: ReportSection[] }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** The period containing `anchor`, and the period before it. A period that is still running ends today (so "this month" means month-to-date). */
export function periodRange(kind: ReportKind, anchor: string, asOf = today(), custom?: { from: string; to: string }) {
  const y = +anchor.slice(0, 4), m = +anchor.slice(5, 7)
  let from: string, to: string, label: string, prevFrom: string, prevTo: string
  if (kind === 'custom') { from = custom?.from || monthStart(asOf.slice(0, 7)); to = custom?.to || asOf; if (to < from) [from, to] = [to, from]; const len = diffDays(to, from) + 1; prevTo = addDays(from, -1); prevFrom = addDays(prevTo, -(len - 1)); label = `${from} to ${to}`; const partial = to > asOf && from <= asOf; return { from, to, label, prevFrom, prevTo, partial } }
  if (kind === 'month') { const k = anchor.slice(0, 7); from = monthStart(k); to = monthEnd(k); label = `${MONTHS[m - 1]} ${y}`; prevFrom = monthStart(mAdd(k, -1)); prevTo = monthEnd(mAdd(k, -1)) }
  else if (kind === 'quarter') { const q = Math.floor((m - 1) / 3); const k = `${y}-${String(q * 3 + 1).padStart(2, '0')}`; from = monthStart(k); to = monthEnd(mAdd(k, 2)); label = `Q${q + 1} ${y}`; prevFrom = monthStart(mAdd(k, -3)); prevTo = monthEnd(mAdd(k, -1)) }
  else { from = `${y}-01-01`; to = `${y}-12-31`; label = String(y); prevFrom = `${y - 1}-01-01`; prevTo = `${y - 1}-12-31` }
  const partial = to > asOf && from <= asOf
  if (partial) { const len = Math.round((Date.parse(asOf) - Date.parse(from)) / 86400000); to = asOf; prevTo = addDays(prevFrom, len); label += ' (to date)' }
  return { from, to, label, prevFrom, prevTo, partial }
}

const pctChange = (cur: number, prev: number | null | undefined) => (prev != null && prev !== 0 ? round2((cur - prev) / Math.abs(prev)) : null)
/** Build the whole report. Spending and cash flow come from transactions; net worth from snapshots + today; investments and tax are point-in-time (today / the report's tax year). */
/** Warn when the period starts before the first transaction on file — a YTD total built on 3 months of data is not a YTD total. */
export function coverageNotes(d: Data, from: string, to: string, prevFrom: string): string[] {
  const dates = d.transactions.filter(t => t.status !== 'void' && !t.duplicate_of).map(t => t.date).sort(); const first = dates[0]
  const out: string[] = []
  if (!first) return ['No transactions on file for this period yet.']
  if (first > addDays(from, 3) && first <= to) out.push(`Incomplete: transactions on file start ${first}, so ${from} to ${addDays(first, -1)} is missing from these totals. Import bank statements for those dates (Bank Connections → Year-to-date coverage shows which accounts).`)
  if (first > addDays(prevFrom, 3)) out.push(`The comparison period (${prevFrom} onward) has little or no data on file, so the change figures are not meaningful yet.`)
  return out
}
const live = (t: Transaction) => t.status !== 'void' && !t.duplicate_of
const LIAB = ['credit_card', 'store_card', 'loan', 'auto_loan', 'student_loan', 'mortgage', 'bnpl', 'line_of_credit', 'medical', 'collection', 'other_liability']
/** Money into and out of one account over a range: income and transfers in count as inflow; expenses and transfers out as outflow. */
export function accountFlows(d: Data, a: Account, from: string, to: string) {
  const tx = d.transactions.filter(t => live(t) && inRange(t, from, to)); let inflow = 0, outflow = 0, n = 0
  for (const t of tx) { if (t.kind === 'income' && t.account_id === a.id) { inflow += t.amount; n++ } else if (t.kind === 'expense' && t.account_id === a.id) { outflow += t.amount; n++ } else if (t.kind === 'transfer') { if (t.to_account_id === a.id) { inflow += t.amount; n++ } if (t.account_id === a.id) { outflow += t.amount; n++ } } }
  return { inflow: round2(inflow), outflow: round2(outflow), net: round2(inflow - outflow), count: n }
}
/** Planned amount for a category over a range: the budget lines of the periods that overlap it (pro-rated by overlap), else the category's default budget for that span. */
export function plannedInRange(d: Data, catId: string, from: string, to: string): number {
  const ps = d.periods.filter(p => p.start_date <= to && p.end_date >= from); if (!ps.length) { const c = d.categories.find(c => c.id === catId); return c ? round2(plannedForPeriod(c, from, to)) : 0 }
  let planned = 0
  for (const p of ps) { const l = d.lines.find(l => l.period_id === p.id && l.category_id === catId); if (!l) continue; const a = p.start_date < from ? from : p.start_date, b = p.end_date > to ? to : p.end_date; const share = (diffDays(b, a) + 1) / (diffDays(p.end_date, p.start_date) + 1); planned += (+l.planned + +l.rollover_in) * Math.min(1, Math.max(0, share)) }
  return round2(planned)
}
export function buildReport(d: Data, s: Settings, kind: ReportKind, anchor: string, sections: SectionId[] = ['summary', 'spending', 'cashflow', 'networth', 'investments', 'tax'], asOf = today(), custom?: { from: string; to: string }): Report {
  const r = periodRange(kind, anchor, asOf, custom); const cur = rangeStat(d, r.from, r.to), prev = rangeStat(d, r.prevFrom, r.prevTo)
  const out: ReportSection[] = []
  const period = (id: SectionId) => sections.includes(id)
  const net = round2(cur.income - cur.spend - cur.debt), prevNet = round2(prev.income - prev.spend - prev.debt)
  const rate = cur.income > 0 ? round2((cur.income - cur.spend - cur.debt) / cur.income) : null, prevRate = prev.income > 0 ? round2((prev.income - prev.spend - prev.debt) / prev.income) : null
  if (sections.includes('summary')) out.push({ id: 'summary', title: 'Summary', kpis: [
    { label: 'Income', value: round2(cur.income), fmt: 'money', prev: round2(prev.income) }, { label: 'Spending', value: round2(cur.spend), fmt: 'money', prev: round2(prev.spend) },
    { label: 'Debt payments', value: round2(cur.debt), fmt: 'money', prev: round2(prev.debt) }, { label: 'Net (kept)', value: net, fmt: 'money', prev: prevNet },
    ...(rate != null ? [{ label: 'Savings rate', value: rate, fmt: 'pct' as const, prev: prevRate }] : []), { label: 'Net worth today', value: round2(netWorth(d).net), fmt: 'money' as const } ],
    notes: [`${r.label}: ${r.from} to ${r.to}; compared with ${r.prevFrom} to ${r.prevTo}.`, ...coverageNotes(d, r.from, r.to, r.prevFrom), ...(cur.income > 0 && net < 0 ? [`Spending and debt payments exceeded income by ${Math.abs(net).toFixed(2)}.`] : [])] })

  if (period('statement')) {
    // classic cash-flow statement: where cash came from and went, with beginning and ending cash reconstructed from today's verified balances
    const cashAccts = assets(d).filter(a => a.include_in_cash || (s.includeRetirementInCash && a.kind === 'retirement'))
    const flows = cashAccts.map(a => accountFlows(d, a, r.from, r.to)); const after = cashAccts.map(a => accountFlows(d, a, addDays(r.to, 1), '9999-12-31'))
    const endCash = round2(cashOnHand(d, s) - sum(after.map(f => f.net))), change = round2(sum(flows.map(f => f.net))), beginCash = round2(endCash - change)
    const toSav = cur.saved, debt = cur.debt, other = round2(change - (cur.income - cur.spend - debt - toSav))
    out.push({ id: 'statement', title: 'Cash flow statement', kpis: [{ label: 'Beginning cash', value: beginCash, fmt: 'money' }, { label: 'Net change in cash', value: change, fmt: 'money', prev: round2(prev.income - prev.spend - prev.debt - prev.saved) }, { label: 'Ending cash', value: endCash, fmt: 'money' }, { label: 'Operating cash flow', value: round2(cur.income - cur.spend), fmt: 'money', prev: round2(prev.income - prev.spend) }],
      table: { headers: ['Line', 'This period', 'Previous'], rows: [['Income received', round2(cur.income), round2(prev.income)], ['Spending', round2(-cur.spend), round2(-prev.spend)], ['= Operating cash flow', round2(cur.income - cur.spend), round2(prev.income - prev.spend)], ['Debt payments', round2(-debt), round2(-prev.debt)], ['Moved to savings & investments', round2(-toSav), round2(-prev.saved)], ['Other transfers & adjustments', other, ''], ['= Net change in cash', change, ''], ['Beginning cash', beginCash, ''], ['Ending cash', endCash, '']] },
      notes: [`Cash = the ${cashAccts.length} account${cashAccts.length === 1 ? '' : 's'} counted as cash on hand. Ending cash is today's verified balance less any activity after ${r.to}; "other" covers transfers between cash accounts, refunds and balance adjustments.`] })
  }
  if (period('income')) {
    const inc = (from: string, to: string) => d.transactions.filter(t => live(t) && t.kind === 'income' && inRange(t, from, to))
    const curI = inc(r.from, r.to), prevI = inc(r.prevFrom, r.prevTo); const key = (t: Transaction) => { const ps = t.pay_schedule_id && d.paySchedules.find(p => p.id === t.pay_schedule_id); return ps ? ps.name : (t.payee || '').trim() ? merchantKey(t.payee) : 'Other income' }
    const name = new Map<string, string>(); curI.concat(prevI).forEach(t => { const k = key(t); if (!name.has(k)) { const ps = t.pay_schedule_id && d.paySchedules.find(p => p.id === t.pay_schedule_id); name.set(k, ps ? ps.name : (t.payee || '').trim() || 'Other income') } })
    const tot = (xs: Transaction[]) => { const m: Record<string, { n: number; v: number }> = {}; xs.forEach(t => { const k = key(t); m[k] = { n: (m[k]?.n || 0) + 1, v: round2((m[k]?.v || 0) + t.amount) } }); return m }
    const a = tot(curI), b = tot(prevI)
    const rows = [...new Set([...Object.keys(a), ...Object.keys(b)])].map(k => [name.get(k) || k, a[k]?.n || 0, a[k]?.v || 0, b[k]?.v || 0, round2((a[k]?.v || 0) - (b[k]?.v || 0)), pctChange(a[k]?.v || 0, b[k]?.v || 0) ?? ''] as Array<string | number>).sort((x, y) => +y[2] - +x[2])
    const expected = round2(expectedIncome(d.paySchedules, r.from, r.to))
    out.push({ id: 'income', title: 'Income', kpis: [{ label: 'Income received', value: round2(cur.income), fmt: 'money', prev: round2(prev.income) }, { label: 'Deposits', value: curI.length, fmt: 'num', prev: prevI.length }, { label: 'Average deposit', value: curI.length ? round2(cur.income / curI.length) : 0, fmt: 'money' }, ...(expected > 0 ? [{ label: 'Expected from pay schedules', value: expected, fmt: 'money' as const }] : [])],
      table: { headers: ['Source', 'Deposits', 'This period', 'Previous', 'Change', 'Change %'], rows }, notes: expected > 0 && Math.abs(expected - cur.income) > Math.max(50, expected * 0.05) ? [`Received ${fmtMoney(cur.income)} against ${fmtMoney(expected)} expected from pay schedules — ${cur.income < expected ? 'a paycheck may not be recorded yet' : 'extra income arrived this period'}.`] : [] })
  }
  if (sections.includes('spending')) {
    const cats = Object.keys({ ...cur.byCat, ...prev.byCat }).map(name => { const c = d.categories.find(x => x.name === name); const a = round2(cur.byCat[name] || 0), b = round2(prev.byCat[name] || 0); return [c?.group || '', name, a, b, round2(a - b), pctChange(a, b) ?? ''] as Array<string | number> })
      .filter(row => +row[2] > 0 || +row[3] > 0).sort((x, y) => +y[2] - +x[2])
    const merch = merchantAnalysis(d, r.from, r.to).slice(0, 10)
    out.push({ id: 'spending', title: 'Spending by category', kpis: [{ label: 'Total spending', value: round2(cur.spend), fmt: 'money', prev: round2(prev.spend) }, { label: 'Essential', value: round2(cur.ess), fmt: 'money', prev: round2(prev.ess) }, { label: 'Discretionary', value: round2(cur.disc), fmt: 'money', prev: round2(prev.disc) }, { label: 'Categories', value: cats.length, fmt: 'num' }],
      table: { headers: ['Group', 'Category', 'This period', 'Previous', 'Change', 'Change %'], rows: cats },
      notes: merch.length ? [`Top merchants: ${merch.slice(0, 5).map(m => `${m.name} ${m.total.toFixed(2)}`).join(' · ')}`] : [] })
  }
  if (period('merchants')) {
    const ms = merchantAnalysis(d, r.from, r.to); const top = ms.slice(0, 15); const share = cur.spend > 0 && ms[0] ? round2(ms[0].total / cur.spend) : null
    out.push({ id: 'merchants', title: 'Top payees', kpis: [{ label: 'Payees paid', value: ms.length, fmt: 'num' }, { label: 'Top payee share', value: share ?? 0, fmt: 'pct' }, { label: 'Average per visit', value: ms.length ? round2(sum(ms.map(m => m.total)) / Math.max(1, sum(ms.map(m => m.count)))) : 0, fmt: 'money' }, { label: 'Top 15 total', value: round2(sum(top.map(m => m.total))), fmt: 'money' }],
      table: { headers: ['Payee', 'Visits', 'This period', 'Previous', 'Change %', 'Average', 'Categories'], rows: top.map(m => [m.name, m.count, m.total, m.prior, m.change ?? '', m.avg, m.categories.join(', ')]) },
      notes: ms.length > 15 ? [`${ms.length - 15} more payees share the remaining ${fmtMoney(cur.spend - sum(top.map(m => m.total)))}.`] : [] })
  }
  if (period('budget')) {
    const cats = d.categories.filter(c => c.kind === 'expense' && !c.archived)
    const rows = cats.map(c => { const planned = plannedInRange(d, c.id, r.from, r.to), actual = round2(spentIn(d, c.id, r.from, r.to)); const v = round2(planned - actual); return { c, planned, actual, v, used: planned > 0 ? round2(actual / planned) : null, state: planned === 0 && actual === 0 ? 'idle' : actual > planned * (1 + s.budgetCritPct / 100) ? 'over' : actual > planned ? 'near' : 'under' } }).filter(x => x.planned > 0 || x.actual > 0).sort((a, b) => a.v - b.v)
    const pl = round2(sum(rows.map(x => x.planned))), ac = round2(sum(rows.map(x => x.actual)))
    out.push({ id: 'budget', title: 'Budget vs actual', kpis: [{ label: 'Planned', value: pl, fmt: 'money' }, { label: 'Spent', value: ac, fmt: 'money' }, { label: 'Variance', value: round2(pl - ac), fmt: 'money' }, { label: 'Categories over', value: rows.filter(x => x.state === 'over' || x.state === 'near').length, fmt: 'num' }, ...(pl > 0 ? [{ label: 'Used', value: round2(ac / pl), fmt: 'pct' as const }] : [])],
      table: { headers: ['Group', 'Category', 'Planned', 'Actual', 'Variance', 'Used %', 'Status'], rows: rows.map(x => [x.c.group || '', x.c.name, x.planned, x.actual, x.v, x.used ?? '', x.state === 'over' ? 'Over' : x.state === 'near' ? 'Slightly over' : x.state === 'under' ? 'Within plan' : 'No budget']) },
      notes: d.periods.some(p => p.start_date <= r.to && p.end_date >= r.from) ? ['Planned = the budget lines of the periods overlapping this range, pro-rated where a period is only partly inside it.'] : ['No budget periods cover this range; planned amounts are each category\'s default budget scaled to the range.'] })
  }
  if (period('bills')) {
    const act = recActive(d).filter(isOutflow); const ups = upcoming(d, r.from, r.to)
    const paidFor = (id: string) => round2(sum(ups.filter(u => u.r.id === id && u.status === 'paid').map(u => u.amount)))
    const rows = act.map(x => [x.name, x.kind === 'subscription' ? 'Subscription' : x.kind === 'debt_payment' ? 'Debt payment' : x.kind === 'savings' ? 'Savings' : x.kind === 'transfer' ? 'Transfer' : 'Bill', x.frequency.replace(/_/g, ' '), +x.amount || 0, round2(recMonthly(x)), round2((+x.amount || 0) * REC_PER_YEAR[x.frequency]), paidFor(x.id), nextDue(x, addDays(asOf, 1)) || '', x.autopay ? 'autopay' : ''] as Array<string | number>).sort((a, b) => +b[4] - +a[4])
    const subs = act.filter(x => x.kind === 'subscription')
    out.push({ id: 'bills', title: 'Bills & subscriptions', kpis: [{ label: 'Monthly commitments', value: round2(sum(act.map(recMonthly))), fmt: 'money' }, { label: 'Subscriptions / month', value: round2(sum(subs.map(recMonthly))), fmt: 'money' }, { label: 'Subscriptions / year', value: round2(sum(subs.map(recMonthly)) * 12), fmt: 'money' }, { label: 'Paid this period', value: round2(sum(rows.map(x => +x[6]))), fmt: 'money' }, { label: 'Active items', value: act.length, fmt: 'num' }],
      table: { headers: ['Item', 'Kind', 'Frequency', 'Amount', 'Per month', 'Per year', 'Paid this period', 'Next due', 'Autopay'], rows }, notes: ups.filter(u => u.status === 'overdue').length ? [`${ups.filter(u => u.status === 'overdue').length} item(s) in this range are overdue.`] : [] })
  }
  if (sections.includes('cashflow')) {
    const months: string[] = []; for (let k = r.from.slice(0, 7); k <= r.to.slice(0, 7); k = mAdd(k, 1)) months.push(k)
    const rows = months.map(k => { const a = monthStart(k) < r.from ? r.from : monthStart(k), b = monthEnd(k) > r.to ? r.to : monthEnd(k); const st = rangeStat(d, a, b); return [k, round2(st.income), round2(st.spend), round2(st.debt), round2(st.income - st.spend - st.debt)] as Array<string | number> })
    out.push({ id: 'cashflow', title: 'Cash flow by month', kpis: [{ label: 'Money in', value: round2(cur.income), fmt: 'money' }, { label: 'Money out', value: round2(cur.spend + cur.debt), fmt: 'money' }, { label: 'Net', value: net, fmt: 'money', prev: prevNet }],
      table: { headers: ['Month', 'Income', 'Spending', 'Debt payments', 'Net'], rows }, notes: [] })
  }
  if (period('trend')) {
    const months: string[] = []; for (let k = mAdd(r.to.slice(0, 7), -11); k <= r.to.slice(0, 7); k = mAdd(k, 1)) months.push(k)
    const rows = months.map(k => { const st = rangeStat(d, monthStart(k), monthEnd(k) > asOf ? asOf : monthEnd(k)); const net = round2(st.income - st.spend - st.debt); return [k, round2(st.income), round2(st.spend), round2(st.debt), round2(st.saved), net, st.income > 0 ? round2(net / st.income) : ''] as Array<string | number> })
    const withData = rows.filter(x => +x[1] > 0 || +x[2] > 0); const avg = (i: number) => withData.length ? round2(sum(withData.map(x => +x[i])) / withData.length) : 0
    const best = withData.slice().sort((a, b) => +b[5] - +a[5])[0]
    out.push({ id: 'trend', title: '12-month trend', kpis: [{ label: 'Average monthly income', value: avg(1), fmt: 'money' }, { label: 'Average monthly spending', value: avg(2), fmt: 'money' }, { label: 'Average kept per month', value: avg(5), fmt: 'money' }, ...(best ? [{ label: `Best month (${best[0]})`, value: +best[5], fmt: 'money' as const }] : []), { label: 'Months with data', value: withData.length, fmt: 'num' }],
      table: { headers: ['Month', 'Income', 'Spending', 'Debt payments', 'Saved', 'Net', 'Savings rate'], rows }, notes: withData.length < 12 ? [`Only ${withData.length} of the last 12 months have transactions on file — import older statements for a full-year view.`] : [] })
  }
  if (period('accounts')) {
    const accts = d.accounts.filter(a => a.status === 'Active').sort((a, b) => a.sort_order - b.sort_order)
    const rows = accts.map(a => { const f = accountFlows(d, a, r.from, r.to); const bal = balanceOf(a, d); return [a.name, ACCOUNT_KIND_LABEL[a.kind], f.inflow, f.outflow, f.net, f.count, LIAB.includes(a.kind) ? -Math.abs(bal) : bal, a.balance_as_of || ''] as Array<string | number> }).filter(x => +x[5] > 0 || Math.abs(+x[6]) > 0)
    const busiest = rows.slice().sort((a, b) => +b[5] - +a[5])[0]
    out.push({ id: 'accounts', title: 'Account activity', kpis: [{ label: 'Cash on hand today', value: round2(cashOnHand(d, s)), fmt: 'money' }, { label: 'Money in', value: round2(sum(rows.map(x => +x[2]))), fmt: 'money' }, { label: 'Money out', value: round2(sum(rows.map(x => +x[3]))), fmt: 'money' }, { label: 'Transactions', value: sum(rows.map(x => +x[5])), fmt: 'num' }, ...(busiest ? [{ label: `Busiest: ${busiest[0]}`, value: +busiest[5], fmt: 'num' as const }] : [])],
      table: { headers: ['Account', 'Type', 'In', 'Out', 'Net', 'Transactions', 'Balance now', 'As of'], rows }, notes: ['Transfers between your own accounts appear as out of one and into the other.'] })
  }
  if (period('debts')) {
    const ls = liabilities(d).filter(a => debtBal(a, d) >= 1 || debtPaidInRange(d, a, r.from, r.to) > 0)
    const rows = ls.map(a => { const bal = debtBal(a, d), pay = debtPlanned(a), paid = round2(debtPaidInRange(d, a, r.from, r.to)), pr = payoffProjection(bal, +a.apr || 0, Math.max(pay, 1)), u = utilization(a); return [a.name, ACCOUNT_KIND_LABEL[a.kind], bal, +a.apr || 0, +a.minimum_payment || 0, pay, paid, round2(bal * (+a.apr || 0) / 100 / 12), isFinite(pr.months) ? pr.months : '', u != null ? round2(u) : ''] as Array<string | number> }).sort((a, b) => +b[2] - +a[2])
    const sim = simulate(liabilities(d), 0, 'avalanche'); const total = round2(sum(rows.map(x => +x[2])))
    out.push({ id: 'debts', title: 'Debt', kpis: [{ label: 'Total owed', value: total, fmt: 'money' }, { label: 'Paid this period', value: round2(sum(rows.map(x => +x[6]))), fmt: 'money' }, { label: 'Interest per month (est.)', value: round2(sum(rows.map(x => +x[7]))), fmt: 'money' }, { label: 'Planned per month', value: round2(sum(rows.map(x => +x[5]))), fmt: 'money' }, ...(total > 0 && isFinite(sim.months) ? [{ label: 'Debt-free in (months)', value: sim.months, fmt: 'num' as const }] : [])],
      table: { headers: ['Account', 'Type', 'Balance', 'APR %', 'Minimum', 'Planned', 'Paid this period', 'Interest / mo', 'Months to payoff', 'Utilization'], rows }, notes: total > 0 ? [`At the planned payments (avalanche order) the last balance clears in about ${isFinite(sim.months) ? sim.months + ' months' : 'more than 30 years'}, paying roughly ${fmtMoney(sim.interest)} in interest.`] : ['No debt balances.'] })
  }
  if (period('goals')) {
    const gs = d.goals.filter(g => g.status === 'Active' || g.status === 'Reached').sort((a, b) => a.priority - b.priority)
    const contribIn = (id: string) => round2(sum(d.contributions.filter(c => c.goal_id === id && c.date >= r.from && c.date <= r.to).map(c => c.amount)))
    const rows = gs.map(g => { const p = goalProgress(d, g); return [g.name, g.kind.replace(/_/g, ' '), p.target, round2(p.saved), round2(p.pct), round2(p.left), g.target_date || '', +g.monthly_contribution || 0, p.needPerMonth != null ? round2(p.needPerMonth) : '', contribIn(g.id), p.reached ? 'Reached' : p.onTrack == null ? '—' : p.onTrack ? 'On track' : 'Behind'] as Array<string | number> })
    out.push({ id: 'goals', title: 'Savings goals', kpis: [{ label: 'Active goals', value: gs.filter(g => g.status === 'Active').length, fmt: 'num' }, { label: 'Saved toward goals', value: round2(sum(rows.map(x => +x[3]))), fmt: 'money' }, { label: 'Still to save', value: round2(sum(rows.map(x => +x[5]))), fmt: 'money' }, { label: 'Contributed this period', value: round2(sum(rows.map(x => +x[9]))), fmt: 'money' }, { label: 'Behind schedule', value: rows.filter(x => x[10] === 'Behind').length, fmt: 'num' }],
      table: { headers: ['Goal', 'Kind', 'Target', 'Saved', 'Progress %', 'Left', 'Target date', 'Monthly plan', 'Monthly needed', 'Contributed this period', 'Status'], rows }, notes: [] })
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
  if (period('transactions')) {
    const tx = d.transactions.filter(t => live(t) && inRange(t, r.from, r.to)).sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount)
    const cat = (id?: string | null) => d.categories.find(c => c.id === id)?.name || '', acc = (id?: string | null) => d.accounts.find(a => a.id === id)?.name || ''
    const rows = tx.map(t => [t.date, t.payee || '', t.kind === 'transfer' ? 'Transfer' : t.kind === 'income' ? 'Income' : 'Expense', cat(t.category_id), acc(t.account_id) + (t.to_account_id ? ' → ' + acc(t.to_account_id) : ''), t.kind === 'income' ? t.amount : -t.amount, t.status || '', t.check_number || '', t.memo || ''] as Array<string | number>)
    out.push({ id: 'transactions', title: 'Transaction detail', kpis: [{ label: 'Transactions', value: tx.length, fmt: 'num' }, { label: 'Money in', value: round2(sum(tx.filter(t => t.kind === 'income').map(t => t.amount))), fmt: 'money' }, { label: 'Money out', value: round2(sum(tx.filter(t => t.kind === 'expense').map(t => t.amount))), fmt: 'money' }, { label: 'Transfers', value: round2(sum(tx.filter(t => t.kind === 'transfer').map(t => t.amount))), fmt: 'money' }, { label: 'Uncategorized', value: tx.filter(t => !t.category_id && t.kind !== 'transfer').length, fmt: 'num' }],
      table: { headers: ['Date', 'Payee', 'Type', 'Category', 'Account', 'Amount', 'Status', 'Check #', 'Memo'], rows }, notes: ['Merged duplicates and voided rows are left out. Amounts: income positive, spending negative, transfers shown as positive movements.'] })
  }
  // keep the catalogue order whatever order the sections were requested in
  const order = ALL_SECTIONS.map(x => x[0]); out.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  return { title: `WealthPilot ${kind === 'month' ? 'monthly' : kind === 'quarter' ? 'quarterly' : kind === 'year' ? 'annual' : 'custom-range'} report — ${r.label}`, kind, from: r.from, to: r.to, label: r.label, prevFrom: r.prevFrom, prevTo: r.prevTo, generated: new Date(Date.parse(asOf + 'T12:00:00')).toISOString().slice(0, 10), sections: out }
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
