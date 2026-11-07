// Cash-flow forecasting: a day-by-day calendar for the next N days, and a month-by-month runway projection.
import type { Account, Data, Recurring, Settings } from '../app/data/types'
import { addDays, addMonthsClamp, diffDays, parse, today, monthStart, monthEnd, curMonth, mAdd } from './dates'
import { sum } from './money'
import { cashOnHand, liabilities, debtPlanned, debtBal, debtDueState, acctLabel, netWorth, countsAsCash } from './accounts'
import { payDates, monthlyIncome, paycheckOnFile, oneOffPay } from './paySchedule'
import { upcoming, recMonthly, recActive, isOutflow } from './recurring'
import { rangeStat, monthlyDebt, monthlyCardPayments } from './budget'
import { payoffProjection, assumedPay, aprAt } from './debts'
import { estimatedTaxDue } from './tax'

export interface CalItem { date: string; label: string; amt: number; kind: 'in' | 'out'; src: 'pay' | 'bill' | 'sub' | 'debt' | 'planned' | 'goal' | 'flex' | 'relief' | 'tax'; bal?: number; id?: string }
/** What a recurring item does to cash on hand (0.25.1): a bill, subscription or card or loan payment takes money out and recurring income
 *  brings it in; a savings or other transfer takes money out only when it goes from cash to an account that does not count as cash (an
 *  investment, retirement account or debt), brings it in when it comes the other way, and moves nothing between two cash accounts — the
 *  money is still on hand. With no account set, a transfer is taken to come out of cash and go somewhere that is not. */
export function cashEffect(d: Data, s: Settings, r: Recurring): -1 | 0 | 1 {
  if (r.kind === 'income') return 1
  if (r.kind !== 'savings' && r.kind !== 'transfer') return -1
  const cash = (id?: string | null) => { const a = id ? d.accounts.find(x => x.id === id) : undefined; return a ? countsAsCash(a, s) : null }
  const fromCash = cash(r.account_id) ?? true, toCash = cash(r.liability_account_id) ?? false
  return fromCash === toCash ? 0 : fromCash ? -1 : 1
}
/** Card and loan payments due on accounts that have no recurring payment item (0.25.1): the planned (or minimum) payment on each due date in
 *  [from, to], monthly from the account's due date — overdue when the current due date has passed unpaid. The cash calendar and the Bills
 *  page both use these, so "due" agrees everywhere with the Debts page. */
export function accountPaymentsDue(d: Data, from: string, to: string): Array<{ a: Account; date: string; amount: number; overdue: boolean }> {
  const t = today(), rec = recActive(d), out: Array<{ a: Account; date: string; amount: number; overdue: boolean }> = []
  for (const a of liabilities(d)) {
    if (rec.some(r => r.liability_account_id === a.id)) continue
    const pay = debtPlanned(a); if (!(pay > 0) || !a.due_date) continue
    const due = a.due_date.slice(0, 10), day = parse(due).getDate(), settled = debtDueState(a).cls === 'good'   // paid, or nothing due
    for (let k = 0; k < 120; k++) {
      const dd = addMonthsClamp(due, k, day); if (dd > to) break
      if (k === 0 && settled) continue
      const overdue = k === 0 && dd < t; if (dd < from || (dd < t && !overdue)) continue
      out.push({ a, date: dd, amount: pay, overdue })
    }
  }
  return out.sort((x, y) => x.date.localeCompare(y.date))
}
/** Money in and out, day by day, starting from cash on hand. Uses pay schedules, recurring items (unpaid), planned one-offs and the variable-spend run-rate. */
export function cashCalendar(d: Data, s: Settings, days = 60) {
  const t = today(), to = addDays(t, days), items: CalItem[] = []
  const add = (x: CalItem) => { if (x.date >= t && x.date <= to && Math.abs(x.amt) >= 0.005) items.push(x) }
  // a payday whose deposit is already on file (0.25.1: logged, from the bank feed or a day early) is in cash on hand — not added again
  d.paySchedules.filter(p => p.status === 'Active').forEach(p => payDates(p, t, to).forEach(dd => { if (!paycheckOnFile(d, p, dd)) add({ date: dd, label: p.name, amt: +p.net_amount || 0, kind: 'in', src: 'pay', id: p.id }) }))
  const up = upcoming(d, t, to); up.forEach(u => { if (u.status === 'paid' || u.status === 'skipped') return; const eff = cashEffect(d, s, u.r); if (!eff) return; add({ date: u.date, label: u.r.name + (u.r.autopay ? ' (autopay)' : ''), amt: eff * u.amount, kind: eff < 0 ? 'out' : 'in', src: u.r.kind === 'subscription' ? 'sub' : u.r.kind === 'debt_payment' ? 'debt' : u.r.kind === 'income' ? 'pay' : 'bill', id: u.r.id }) })
  // liabilities without a recurring payment item still get paid on their due date
  accountPaymentsDue(d, t, to).forEach(x => add({ date: x.date, label: `${acctLabel(x.a, d.accounts)} payment`, amt: -x.amount, kind: 'out', src: 'debt', id: x.a.id }))
  d.planned.filter(p => p.status === 'Planned').forEach(p => add({ date: p.date.slice(0, 10), label: p.label, amt: +p.amount || 0, kind: (+p.amount || 0) >= 0 ? 'in' : 'out', src: 'planned', id: p.id }))
  // federal estimated-tax deadlines (0.22.0): planned estimates and any safe-harbor shortfall, from the tax planner
  estimatedTaxDue(d, s, t, to).forEach(x => add({ date: x.date, label: x.label, amt: -x.amount, kind: 'out', src: 'tax' }))
  // everyday spending: variable categories at the recent run-rate, spread over the weeks ahead (less what has already been spent this period of the month)
  const varCats = d.categories.filter(c => c.kind === 'expense' && c.cost_type !== 'Fixed' && !c.archived && !recActive(d).some(r => r.category_id === c.id))
  const last90 = rangeStat(d, addDays(t, -90), addDays(t, -1)); const perWeek = sum(varCats.map(c => last90.byCat[c.name] || 0)) / (90 / 7)
  if (perWeek > 0) { let w = addDays(t, (8 - parse(t).getDay()) % 7 || 7); while (w <= to) { add({ date: w, label: 'Everyday spending (recent average per week)', amt: -perWeek, kind: 'out', src: 'flex' }); w = addDays(w, 7) } }
  items.sort((a, b) => a.date.localeCompare(b.date) || b.amt - a.amt)
  const start = cashOnHand(d, s); let bal = start; const daily: Array<{ d: string; bal: number }> = []; let low = { bal: start, date: t }, firstFloor: string | null = null, firstZero: string | null = null; const floor = +s.reserveFloor || 0
  for (let dd = t; dd <= to; dd = addDays(dd, 1)) { items.filter(x => x.date === dd).forEach(x => { bal += x.amt; x.bal = bal }); daily.push({ d: dd, bal }); if (bal < low.bal) low = { bal, date: dd }; if (floor && bal < floor && !firstFloor) firstFloor = dd; if (bal < 0 && !firstZero) firstZero = dd }
  return { start, items, daily, low, firstFloor, firstZero, floor, inTot: sum(items.filter(x => x.amt > 0).map(x => x.amt)), outTot: -sum(items.filter(x => x.amt < 0).map(x => x.amt)), end: bal }
}
/** Bills and payments already past their due date and still unpaid (0.25.1) — the same ones the Dashboard lists as overdue: every bill,
 *  subscription, debt payment or savings transfer from the last 30 days with no payment matched or recorded and not skipped (autopay
 *  included: an autopay that never went through is still owed), plus any card or loan without a recurring payment whose due date has
 *  passed unpaid. The money is still owed, so Safe to spend takes it off. Dated on the day each one was due (before today). */
export function overdueOwed(d: Data, s?: Settings): CalItem[] {
  const t = today(), out: CalItem[] = []
  for (const u of upcoming(d, addDays(t, -30), addDays(t, -1))) {
    // a late transfer between two cash accounts is not money owed: it would only move cash from one account to another (0.25.1)
    if (u.status === 'paid' || u.status === 'skipped' || !isOutflow(u.r) || !(u.amount > 0) || (s && cashEffect(d, s, u.r) === 0)) continue
    out.push({ date: u.date, label: `${u.r.name} (overdue)`, amt: -u.amount, kind: 'out', src: u.r.kind === 'subscription' ? 'sub' : u.r.kind === 'debt_payment' ? 'debt' : 'bill', id: u.r.id })
  }
  liabilities(d).forEach(a => { if (recActive(d).some(r => r.liability_account_id === a.id)) return; const pay = debtPlanned(a); if (!(pay > 0) || !a.due_date || debtDueState(a).cls !== 'crit') return
    out.push({ date: a.due_date.slice(0, 10), label: `${acctLabel(a, d.accounts)} payment (overdue)`, amt: -pay, kind: 'out', src: 'debt', id: a.id }) })
  return out.sort((a, b) => a.date.localeCompare(b.date))
}
/** Safe to spend (0.19.0): cash on hand minus everything committed before the next paycheck (bills, debt and planned items — not everyday
 *  spending, which is what this number is for) minus anything already overdue (0.25.1) minus the reserve floor; also per day until payday.
 *  No paycheck ahead → the next 30 days. */
export function safeToSpend(d: Data, s: Settings) {
  const cal = cashCalendar(d, s, 45); const t = today()
  const nextPay = cal.items.find(x => x.src === 'pay' && x.amt > 0 && x.date > t)?.date || null
  const until = nextPay || addDays(t, 30); const days = Math.max(1, diffDays(until, t))
  const late = overdueOwed(d, s); const overdue = -sum(late.map(x => x.amt))
  const committedItems = [...late, ...cal.items.filter(x => x.amt < 0 && x.src !== 'flex' && x.date <= until && (x.date > t || x.date === t))]
  const committed = -sum(committedItems.map(x => x.amt)); const floor = +s.reserveFloor || 0
  const safe = Math.max(0, cal.start - committed - floor)
  return { safe, perDay: safe / days, days, until, payday: nextPay, committed, overdue, cash: cal.start, floor, items: committedItems, short: cal.start - committed - floor < 0 ? -(cal.start - committed - floor) : 0 }
}
/** Monthly burn = committed bills + recent variable spend + loan payments − income. Card payments are not added (0.25.1): what is bought on
 *  the cards is already in the bills and the recent spending, so adding the payment too would count it twice — `cards` is the planned
 *  card payments, for information. Income is the schedules that repeat; a one-off (Irregular) pay is not monthly income. */
export function burn(d: Data, s: Settings) {
  const t = today(); const last90 = rangeStat(d, addDays(t, -90), addDays(t, -1)); const monthsSeen = Math.max(1, Math.min(3, d.transactions.length ? (diffDays(t, d.transactions.map(x => x.date).sort()[0]) + 1) / 30.44 : 1))
  const income = monthlyIncome(d.paySchedules) || last90.income / monthsSeen
  const fixed = sum(recActive(d).filter(r => isOutflow(r) && r.kind !== 'debt_payment' && r.kind !== 'savings' && r.kind !== 'transfer').map(recMonthly))
  const fixedCats = new Set(recActive(d).map(r => r.category_id).filter(Boolean))
  const variable = sum(d.categories.filter(c => c.kind === 'expense' && !fixedCats.has(c.id)).map(c => last90.byCat[c.name] || 0)) / monthsSeen
  const debt = monthlyDebt(d, curMonth()), cards = monthlyCardPayments(d, curMonth())
  const relief = sum(d.hardship.filter(h => h.status === 'Enrolled' && (+(h.relief_monthly || 0) > 0) && (!h.relief_start || h.relief_start <= t) && (!h.relief_end || h.relief_end >= t)).map(h => +h.relief_monthly!))
  const expenses = Math.max(0, fixed + variable + debt - relief)
  const cash = cashOnHand(d, s); const net = expenses - income; const months = net > 0 ? cash / net : Infinity
  const floor = +s.reserveFloor || 0; const monthsFloor = net > 0 ? Math.max(0, cash - floor) / net : Infinity
  return { cash, income, fixed, variable, debt, cards, relief, expenses, net, months, monthsFloor, exhaust: net > 0 ? addDays(t, Math.round(months * 30.44)) : null, cls: months >= s.runwayGreen ? 'good' : months >= s.runwayYellow ? 'warn' : 'crit' }
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
  // each month at the rate in force that month: a promotional rate until it ends, then the regular APR (0.25.1); from the verified balance
  const debts = liabilities(d).map(a => ({ a, p: payoffProjection(debtBal(a, d), m => aprAt(a, m), assumedPay(a, debtPlanned(a), d), o.months + 1), pay: assumedPay(a, debtPlanned(a), d) }))
  const horizon = addDays(t, (o.months + 1) * 31)
  // one-off (Irregular) pay once, in its own month, as the cash calendar has it — and not after the income stops (0.25.1)
  const oneOffs = oneOffPay(d, t, horizon).filter(x => !o.incomeEndsOn || x.date < o.incomeEndsOn).map(x => ({ date: x.date, amount: x.amount }))
  const events = [...d.planned.filter(p => p.status === 'Planned').map(p => ({ date: p.date.slice(0, 10), amount: +p.amount || 0 })), ...estimatedTaxDue(d, s, t, horizon).map(x => ({ date: x.date, amount: -x.amount })), ...oneOffs, ...o.extraEvents]
  const xs: string[] = [], ys: number[] = [], inc: number[] = [], out: number[] = []; let cash = b.cash
  for (let m = 0; m <= o.months; m++) {
    // month steps keep the day of the month, clamped to shorter months (Jan 31 → Feb 28 → Mar 31), so no month is skipped (0.25.1)
    const from = addMonthsClamp(t, m), to = addMonthsClamp(t, m + 1)
    xs.push(from); ys.push(Math.max(0, cash)); if (m === o.months) break
    let income = b.income + o.extraIncome; if (o.incomeEndsOn && o.incomeEndsOn < to) income = o.incomeEndsOn <= from ? o.extraIncome : (b.income * Math.max(0, diffDays(o.incomeEndsOn, from) / diffDays(to, from))) + o.extraIncome
    let spend = baseSpend - b.relief; debts.forEach(({ p, pay }) => { if (p.series[m] > 0.005) spend += pay })
    const ev = sum(events.filter(e => e.date >= from && e.date < to).map(e => e.amount))
    inc.push(income + Math.max(0, ev)); out.push(Math.max(0, spend) + Math.max(0, -ev)); cash = cash + income - Math.max(0, spend) + ev
  }
  const floor = +s.reserveFloor || 0
  // starting at zero only counts as running out when money is actually going out faster than it comes in (an empty household has no runway to speak of)
  const zeroAt = (ys[0] <= 0.5 && !(out[0] > inc[0] + 0.5) ? xs.find((_, i) => i > 1 && ys[i] <= 0.5 && ys[i - 1] > 0.5) : xs.find((_, i) => ys[i] <= 0.5 && i > 0)) || null, floorAt = floor ? xs.find((_, i) => ys[i] <= floor && i > 0) || null : null
  return { xs, ys, inc, out, zeroAt, floorAt, floor, minCash: Math.min(...ys), essentials, spend: b.fixed + b.variable, burn: b }
}
/** Net-worth series from snapshots plus today's live figure — today's point is netWorth() itself (0.25.1): verified balances, and only the
 *  accounts counted in net worth, like the snapshots. */
export function netWorthSeries(d: Data) { const nw = netWorth(d); const live = { date: today(), assets: nw.assets, liabilities: nw.liabilities }; const rows = [...d.snapshots.map(s => ({ date: s.date.slice(0, 10), assets: +s.assets, liabilities: +s.liabilities })), live].sort((a, b) => a.date.localeCompare(b.date)); return rows.map(r => ({ ...r, net: r.assets - r.liabilities })) }
export const monthsAhead = (n: number) => { const out: string[] = []; for (let i = 0; i < n; i++) out.push(mAdd(curMonth(), i)); return out }
export const monthRange = (m: string) => ({ from: monthStart(m), to: monthEnd(m) })
