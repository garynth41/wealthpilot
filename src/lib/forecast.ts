// Cash-flow forecasting: a day-by-day calendar for the next N days, and a month-by-month runway projection.
import type { Data, Settings } from '../app/data/types'
import { addDays, addMonthsClamp, diffDays, iso, parse, today, monthStart, monthEnd, curMonth, mAdd } from './dates'
import { sum } from './money'
import { cashOnHand, liabilities, debtPlanned, debtBal, debtDueState, acctLabel, assets } from './accounts'
import { payDates, monthlyIncome } from './paySchedule'
import { upcoming, recMonthly, recActive, isOutflow } from './recurring'
import { rangeStat, monthlyDebt } from './budget'
import { payoffProjection, assumedPay } from './debts'

export interface CalItem { date: string; label: string; amt: number; kind: 'in' | 'out'; src: 'pay' | 'bill' | 'sub' | 'debt' | 'planned' | 'goal' | 'flex' | 'relief'; bal?: number; id?: string }
/** Money in and out, day by day, starting from cash on hand. Uses pay schedules, recurring items (unpaid), planned one-offs and the variable-spend run-rate. */
export function cashCalendar(d: Data, s: Settings, days = 60) {
  const t = today(), to = addDays(t, days), items: CalItem[] = []
  const add = (x: CalItem) => { if (x.date >= t && x.date <= to && Math.abs(x.amt) >= 0.005) items.push(x) }
  d.paySchedules.filter(p => p.status === 'Active').forEach(p => payDates(p, t, to).forEach(dd => add({ date: dd, label: p.name, amt: +p.net_amount || 0, kind: 'in', src: 'pay', id: p.id })))
  const up = upcoming(d, t, to); up.forEach(u => { if (u.status === 'paid' || u.status === 'skipped') return; const out = isOutflow(u.r); add({ date: u.date, label: u.r.name + (u.r.autopay ? ' (autopay)' : ''), amt: out ? -u.amount : u.amount, kind: out ? 'out' : 'in', src: u.r.kind === 'subscription' ? 'sub' : u.r.kind === 'debt_payment' ? 'debt' : u.r.kind === 'income' ? 'pay' : 'bill', id: u.r.id }) })
  // liabilities without a recurring payment item still get paid on their due date
  liabilities(d).forEach(a => { if (recActive(d).some(r => r.liability_account_id === a.id)) return; const pay = debtPlanned(a); if (!(pay > 0) || !a.due_date) return; const dday = parse(a.due_date).getDate(); const paid = debtDueState(a).label === 'Paid'
    for (let k = 0; k < 5; k++) { const dd = addMonthsClamp(a.due_date.slice(0, 10), k, dday); if (k === 0 && (paid || dd < t)) continue; if (dd < t) continue; add({ date: dd, label: `${acctLabel(a, d.accounts)} payment`, amt: -pay, kind: 'out', src: 'debt', id: a.id }) } })
  d.planned.filter(p => p.status === 'Planned').forEach(p => add({ date: p.date.slice(0, 10), label: p.label, amt: +p.amount || 0, kind: (+p.amount || 0) >= 0 ? 'in' : 'out', src: 'planned', id: p.id }))
  // everyday spending: variable categories at the recent run-rate, spread over the weeks ahead (less what has already been spent this period of the month)
  const varCats = d.categories.filter(c => c.kind === 'expense' && c.cost_type !== 'Fixed' && !c.archived && !recActive(d).some(r => r.category_id === c.id))
  const last90 = rangeStat(d, addDays(t, -90), addDays(t, -1)); const perWeek = sum(varCats.map(c => last90.byCat[c.name] || 0)) / (90 / 7)
  if (perWeek > 0) { let w = addDays(t, (8 - parse(t).getDay()) % 7 || 7); while (w <= to) { add({ date: w, label: 'Everyday spending (recent average per week)', amt: -perWeek, kind: 'out', src: 'flex' }); w = addDays(w, 7) } }
  items.sort((a, b) => a.date.localeCompare(b.date) || b.amt - a.amt)
  const start = cashOnHand(d, s); let bal = start; const daily: Array<{ d: string; bal: number }> = []; let low = { bal: start, date: t }, firstFloor: string | null = null, firstZero: string | null = null; const floor = +s.reserveFloor || 0
  for (let dd = t; dd <= to; dd = addDays(dd, 1)) { items.filter(x => x.date === dd).forEach(x => { bal += x.amt; x.bal = bal }); daily.push({ d: dd, bal }); if (bal < low.bal) low = { bal, date: dd }; if (floor && bal < floor && !firstFloor) firstFloor = dd; if (bal < 0 && !firstZero) firstZero = dd }
  return { start, items, daily, low, firstFloor, firstZero, floor, inTot: sum(items.filter(x => x.amt > 0).map(x => x.amt)), outTot: -sum(items.filter(x => x.amt < 0).map(x => x.amt)), end: bal }
}
/** Monthly burn = committed bills + recent variable spend + debt payments − income. */
export function burn(d: Data, s: Settings) {
  const t = today(); const last90 = rangeStat(d, addDays(t, -90), addDays(t, -1)); const monthsSeen = Math.max(1, Math.min(3, d.transactions.length ? (diffDays(t, d.transactions.map(x => x.date).sort()[0]) + 1) / 30.44 : 1))
  const income = monthlyIncome(d.paySchedules) || last90.income / monthsSeen
  const fixed = sum(recActive(d).filter(r => isOutflow(r) && r.kind !== 'debt_payment' && r.kind !== 'savings' && r.kind !== 'transfer').map(recMonthly))
  const fixedCats = new Set(recActive(d).map(r => r.category_id).filter(Boolean))
  const variable = sum(d.categories.filter(c => c.kind === 'expense' && !fixedCats.has(c.id)).map(c => last90.byCat[c.name] || 0)) / monthsSeen
  const debt = monthlyDebt(d, curMonth())
  const relief = sum(d.hardship.filter(h => h.status === 'Enrolled' && (+(h.relief_monthly || 0) > 0) && (!h.relief_start || h.relief_start <= t) && (!h.relief_end || h.relief_end >= t)).map(h => +h.relief_monthly!))
  const expenses = Math.max(0, fixed + variable + debt - relief)
  const cash = cashOnHand(d, s); const net = expenses - income; const months = net > 0 ? cash / net : Infinity
  const floor = +s.reserveFloor || 0; const monthsFloor = net > 0 ? Math.max(0, cash - floor) / net : Infinity
  return { cash, income, fixed, variable, debt, relief, expenses, net, months, monthsFloor, exhaust: net > 0 ? addDays(t, Math.round(months * 30.44)) : null, cls: months >= s.runwayGreen ? 'good' : months >= s.runwayYellow ? 'warn' : 'crit' }
}
/** 24-month cash projection: income, bills, variable spend, debt payments that stop when paid off, planned one-offs, optional what-ifs. */
export function runwayProjection(d: Data, s: Settings, opts?: { months?: number; cutPct?: number; leanOnly?: boolean; extraIncome?: number; incomeEndsOn?: string | null; extraEvents?: Array<{ date: string; amount: number }> }) {
  const o = { months: 24, cutPct: 0, leanOnly: false, extraIncome: 0, incomeEndsOn: null as string | null, extraEvents: [] as Array<{ date: string; amount: number }>, ...(opts || {}) }
  const t = today(), b = burn(d, s)
  const last90 = rangeStat(d, addDays(t, -90), addDays(t, -1)); const monthsSeen = Math.max(1, Math.min(3, d.transactions.length ? (diffDays(t, d.transactions.map(x => x.date).sort()[0]) + 1) / 30.44 : 1))
  const fixedCats = new Set(recActive(d).map(r => r.category_id).filter(Boolean))
  const essVar = sum(d.categories.filter(c => c.kind === 'expense' && c.priority === 'Essential' && !fixedCats.has(c.id)).map(c => last90.byCat[c.name] || 0)) / monthsSeen
  const essFixed = sum(recActive(d).filter(r => isOutflow(r) && r.kind !== 'debt_payment' && r.kind !== 'savings' && r.kind !== 'transfer' && d.categories.find(c => c.id === r.category_id)?.priority !== 'Discretionary').map(recMonthly))
  const essentials = essFixed + essVar
  const baseSpend = (o.leanOnly ? essentials : b.fixed + b.variable) * (1 - o.cutPct / 100)
  const debts = liabilities(d).map(a => ({ a, p: payoffProjection(debtBal(a), a.apr, assumedPay(a, debtPlanned(a)), o.months + 1), pay: assumedPay(a, debtPlanned(a)) }))
  const events = [...d.planned.filter(p => p.status === 'Planned').map(p => ({ date: p.date.slice(0, 10), amount: +p.amount || 0 })), ...o.extraEvents]
  const xs: string[] = [], ys: number[] = [], inc: number[] = [], out: number[] = []; let cash = b.cash
  for (let m = 0; m <= o.months; m++) {
    const d0 = parse(t); d0.setMonth(d0.getMonth() + m); const from = iso(d0); const d1 = parse(t); d1.setMonth(d1.getMonth() + m + 1); const to = iso(d1)
    xs.push(from); ys.push(Math.max(0, cash)); if (m === o.months) break
    let income = b.income + o.extraIncome; if (o.incomeEndsOn && o.incomeEndsOn < to) income = o.incomeEndsOn <= from ? o.extraIncome : (b.income * Math.max(0, diffDays(o.incomeEndsOn, from) / diffDays(to, from))) + o.extraIncome
    let spend = baseSpend - b.relief; debts.forEach(({ p, pay }) => { if (p.series[m] > 0.005) spend += pay })
    const ev = sum(events.filter(e => e.date >= from && e.date < to).map(e => e.amount))
    inc.push(income + Math.max(0, ev)); out.push(Math.max(0, spend) + Math.max(0, -ev)); cash = cash + income - Math.max(0, spend) + ev
  }
  const floor = +s.reserveFloor || 0
  const zeroAt = xs.find((_, i) => ys[i] <= 0.5 && i > 0) || null, floorAt = floor ? xs.find((_, i) => ys[i] <= floor && i > 0) || null : null
  return { xs, ys, inc, out, zeroAt, floorAt, floor, minCash: Math.min(...ys), essentials, spend: b.fixed + b.variable, burn: b }
}
/** Net-worth series from snapshots plus today's live figure. */
export function netWorthSeries(d: Data) { const live = { date: today(), assets: sum(assets(d).map(a => +a.balance || 0)), liabilities: sum(liabilities(d).map(debtBal)) }; const rows = [...d.snapshots.map(s => ({ date: s.date.slice(0, 10), assets: +s.assets, liabilities: +s.liabilities })), live].sort((a, b) => a.date.localeCompare(b.date)); return rows.map(r => ({ ...r, net: r.assets - r.liabilities })) }
export const monthsAhead = (n: number) => { const out: string[] = []; for (let i = 0; i < n; i++) out.push(mAdd(curMonth(), i)); return out }
export const monthRange = (m: string) => ({ from: monthStart(m), to: monthEnd(m) })
