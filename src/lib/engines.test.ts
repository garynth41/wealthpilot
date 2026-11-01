import { describe, it, expect, beforeAll } from 'vitest'
import { setToday, addDays, monthStart, monthEnd } from './dates'
import { parseNum, fmtMoney, fm2 } from './money'
import { payDates, payPeriodFor, expectedIncome, monthlyIncome } from './paySchedule'
import { spanFor } from './periods'
import { dueDates, upcoming, monthlyCommitments } from './recurring'
import { periodStat, rangeStat, trendSeries, insights } from './budget'
import { payoffProjection, simulate, debtTotals } from './debts'
import { cashCalendar, burn, runwayProjection, netWorthSeries } from './forecast'
import { goalProgress } from './goals'
import { cashOnHand, netWorth, utilization, debtDueState } from './accounts'
import { demoSeed } from '../app/data/demoSeed'
import type { PaySchedule, Recurring } from '../app/data/types'

const T0 = '2026-11-04'
beforeAll(() => setToday(T0))
const seed = () => demoSeed()

describe('money & dates', () => {
  it('parses what people type', () => { expect(parseNum('$5,000.50')).toBe(5000.5); expect(parseNum('(120)')).toBe(-120); expect(parseNum('−45')).toBe(-45); expect(parseNum('abc')).toBeNull(); expect(parseNum('')).toBeNull() })
  it('formats money', () => { expect(fmtMoney(1234.6)).toBe('$1,235'); expect(fmtMoney(-2000)).toBe('−$2,000'); expect(fm2(12.5)).toBe('$12.50') })
  it('month boundaries', () => { expect(monthStart('2026-02')).toBe('2026-02-01'); expect(monthEnd('2026-02')).toBe('2026-02-28'); expect(addDays('2026-01-31', 1)).toBe('2026-02-01') })
})

describe('pay schedules', () => {
  const ps = (p: Partial<PaySchedule>): PaySchedule => ({ id: 'p', household_id: 'h', name: 'x', kind: 'salary', frequency: 'biweekly', anchor_date: '2026-10-30', net_amount: 2305, status: 'Active', ...p })
  it('biweekly from an anchor, both directions', () => { expect(payDates(ps({}), '2026-10-01', '2026-12-31')).toEqual(['2026-10-02', '2026-10-16', '2026-10-30', '2026-11-13', '2026-11-27', '2026-12-11', '2026-12-25']) })
  it('semimonthly 15th and last day', () => { expect(payDates(ps({ frequency: 'semimonthly', semimonthly_days: [15, 31] }), '2026-02-01', '2026-03-31')).toEqual(['2026-02-15', '2026-02-28', '2026-03-15', '2026-03-31']) })
  it('monthly clamps the day', () => { expect(payDates(ps({ frequency: 'monthly', anchor_date: '2026-01-31' }), '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']) })
  it('weekly', () => { expect(payDates(ps({ frequency: 'weekly', anchor_date: '2026-11-06' }), '2026-11-01', '2026-11-30').length).toBe(4) })
  it('pay period around today', () => { expect(payPeriodFor(ps({}), T0)).toEqual({ start: '2026-10-30', end: '2026-11-12' }) })
  it('expected income in a range and monthly equivalent', () => { expect(expectedIncome([ps({})], '2026-11-01', '2026-11-30')).toBe(2305 * 2); expect(Math.round(monthlyIncome([ps({})]))).toBe(Math.round(2305 * 26 / 12)) })
})

describe('budget periods', () => {
  it('month / week / semimonthly / pay spans', () => {
    const { data, household } = seed()
    expect(spanFor(data, { ...household.settings, periodType: 'month' })).toMatchObject({ start: '2026-11-01', end: '2026-11-30' })
    expect(spanFor(data, { ...household.settings, periodType: 'week' })).toMatchObject({ start: '2026-11-02', end: '2026-11-08' })
    expect(spanFor(data, { ...household.settings, periodType: 'semimonthly', semimonthlyDays: [1, 15] })).toMatchObject({ start: '2026-11-01', end: '2026-11-14' })
    const pay = spanFor(data, { ...household.settings, periodType: 'pay' }); expect(pay.type).toBe('pay'); expect(pay.start <= T0 && pay.end >= T0).toBe(true)
    expect(spanFor(data, { ...household.settings, periodType: 'biweekly', periodAnchor: '2026-10-26' })).toMatchObject({ start: '2026-10-26', end: '2026-11-08' })
  })
})

describe('recurring', () => {
  const r = (p: Partial<Recurring>): Recurring => ({ id: 'r', household_id: 'h', name: 'x', kind: 'bill', amount: 100, amount_varies: false, frequency: 'monthly', autopay: false, reminder_days: 3, status: 'Active', sort_order: 1, ...p })
  it('monthly on a day', () => { expect(dueDates(r({ day_of_month: 15, next_due: '2026-11-15' }), '2026-11-01', '2027-01-31')).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']) })
  it('quarterly and yearly', () => { expect(dueDates(r({ frequency: 'quarterly', next_due: '2026-12-01' }), '2026-11-01', '2027-06-30')).toEqual(['2026-12-01', '2027-03-01', '2027-06-01']); expect(dueDates(r({ frequency: 'yearly', next_due: '2027-03-10' }), '2026-11-01', '2028-12-31')).toEqual(['2027-03-10', '2028-03-10']) })
  it('every 2 weeks walks back to the window', () => { expect(dueDates(r({ frequency: 'biweekly', next_due: '2026-11-20' }), '2026-10-01', '2026-11-30')).toEqual(['2026-10-09', '2026-10-23', '2026-11-06', '2026-11-20']) })
  it('upcoming marks paid items from matching transactions', () => {
    const { data } = seed(); const up = upcoming(data, '2026-11-01', '2026-11-30')
    const rent = up.find(u => u.r.name === 'Rent'); expect(rent?.status).toBe('paid')
    const geico = up.find(u => u.r.name === 'GEICO auto'); expect(['autopay', 'due', 'due_soon']).toContain(geico?.status)
    expect(up.filter(u => u.status === 'overdue').length).toBe(0)
  })
  it('monthly commitments add up', () => { const { data } = seed(); const c = monthlyCommitments(data); expect(c.total).toBeGreaterThan(2500); expect(c.debt).toBe(862) })
})

describe('budget stats', () => {
  it('actuals come from transactions, not the plan', () => {
    const { data, household } = seed(); const p = data.periods.find(x => x.start_date === '2026-11-01')!
    const ps = periodStat(data, household.settings, p)
    const rent = ps.lines.find(l => l.cat.name === 'Rent / mortgage')!; expect(rent.actual).toBe(1850); expect(rent.state).toBe('good')
    expect(ps.incA).toBe(0); expect(ps.expectedPay).toBe(2305 * 2 + 400); expect(ps.spA).toBeGreaterThan(2000); expect(ps.elapsed).toBeCloseTo(4 / 30, 2)
    expect(ps.rate).toBeNull()
    const ins = insights(household.settings, ps); expect(ins.length).toBeGreaterThan(0)
  })
  it('range stats and trends', () => { const { data } = seed(); const r = rangeStat(data, '2026-10-01', '2026-10-31'); expect(r.income).toBe(2305 * 3 + 400); expect(r.byCat['Groceries']).toBeGreaterThan(300); const ms = trendSeries(data, 'month'); expect(ms.length).toBe(3); expect(ms[1].planned).toBeGreaterThan(0); expect(trendSeries(data, 'week').length).toBeGreaterThan(8) })
})

describe('debts', () => {
  it('payoff projection', () => { const p = payoffProjection(1000, 24, 100); expect(p.months).toBe(12); expect(p.interest).toBeGreaterThan(100); expect(payoffProjection(1000, 24, 10).months).toBe(Infinity) })
  it('avalanche beats snowball on interest', () => { const { data } = seed(); const a = simulate(data.accounts.filter(x => x.kind === 'credit_card' || x.kind === 'auto_loan'), 100, 'avalanche'); const s = simulate(data.accounts.filter(x => x.kind === 'credit_card' || x.kind === 'auto_loan'), 100, 'snowball'); expect(a.interest).toBeLessThanOrEqual(s.interest + 1); expect(isFinite(a.months)).toBe(true) })
  it('totals and utilization', () => { const { data } = seed(); const t = debtTotals(data); expect(Math.round(t.balance)).toBe(13623); expect(t.util).toBeCloseTo((1362.55 + 2840.2) / 13000, 3); expect(utilization(data.accounts.find(a => a.name === 'Chase Freedom')!)).toBeCloseTo(0.2725, 3); expect(debtDueState(data.accounts.find(a => a.name === 'Auto loan')!).label).toMatch(/Autopay in 4d/) })
})

describe('forecast', () => {
  it('cash on hand excludes retirement', () => { const { data, household } = seed(); expect(cashOnHand(data, household.settings)).toBeCloseTo(3184.22 + 8650, 2); expect(netWorth(data).net).toBeCloseTo(3184.22 + 8650 + 42300 - 13622.75, 1) })
  it('calendar runs day by day with pay and bills', () => { const { data, household } = seed(); const c = cashCalendar(data, household.settings, 60); expect(c.items.filter(x => x.src === 'pay').length).toBeGreaterThanOrEqual(4); expect(c.items.some(x => x.label.startsWith('Rent'))).toBe(true); expect(c.daily.length).toBe(61); expect(c.low.bal).toBeLessThan(c.start + 1); expect(c.items.every(x => x.bal != null)).toBe(true) })
  it('burn and 24-month runway', () => { const { data, household } = seed(); const b = burn(data, household.settings); expect(b.income).toBeGreaterThan(4000); expect(b.expenses).toBeGreaterThan(3000); const r = runwayProjection(data, household.settings); expect(r.xs.length).toBe(25); expect(r.ys[0]).toBeCloseTo(b.cash, 0); const lean = runwayProjection(data, household.settings, { leanOnly: true }); expect(lean.ys[24]).toBeGreaterThanOrEqual(r.ys[24] - 1) })
  it('net worth series ends today', () => { const { data } = seed(); const s = netWorthSeries(data); expect(s[s.length - 1].date).toBe(T0); expect(s.length).toBe(4) })
})

describe('goals', () => {
  it('progress, need per month and on-track', () => { const { data } = seed(); const g = goalProgress(data, data.goals[0]); expect(g.saved).toBeGreaterThan(7150); expect(g.pct).toBeGreaterThan(0.4); expect(g.needPerMonth).toBeGreaterThan(0); expect(typeof g.onTrack).toBe('boolean'); const d = goalProgress(data, data.goals[1]); expect(d.saved).toBe(0) })
})
