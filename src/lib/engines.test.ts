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
  it('totals and utilization', () => { const { data } = seed(); const t = debtTotals(data); expect(Math.round(t.balance)).toBe(14035); expect(t.util).toBeCloseTo((1362.55 + 2840.2 + 412.6) / 17000, 3); expect(utilization(data.accounts.find(a => a.name === 'Chase Freedom')!)).toBeCloseTo(0.2725, 3); expect(debtDueState(data.accounts.find(a => a.name === 'Auto loan')!).label).toMatch(/Autopay in 4d/) })
})

describe('debts: payoff simulation conservation', () => {
  it('every dollar paid is principal or interest, and no planned payment is wasted in a final month', () => {
    const { data } = seed(); const debts = data.accounts.filter(x => ['credit_card', 'auto_loan'].includes(x.kind)); const start = debts.reduce((a, x) => a + x.balance, 0)
    for (const st of ['avalanche', 'snowball'] as const) { const r = simulate(debts, 100, st); expect(r.paid).toBeCloseTo(start + r.interest, 2) }
    const a = simulate(debts, 100, 'avalanche'), s = simulate(debts, 100, 'snowball'); expect(a.interest).toBeLessThanOrEqual(s.interest + 0.01)
  })
})
describe('forecast', () => {
  it('cash on hand excludes retirement', () => { const { data, household } = seed(); expect(cashOnHand(data, household.settings)).toBeCloseTo(3184.22 + 8650 + 1240.18 + 86, 2); expect(netWorth(data).net).toBeCloseTo(3184.22 + 8650 + 1240.18 + 86 + 42300 + 11860 + 22800 - 13622.75 - 412.6, 1) })   // incl. Schwab brokerage (0.6.0), Chase checking, cash wallet and Discover (0.8.0), the CR-V (0.24.0)
  it('calendar runs day by day with pay and bills', () => { const { data, household } = seed(); const c = cashCalendar(data, household.settings, 60); expect(c.items.filter(x => x.src === 'pay').length).toBeGreaterThanOrEqual(4); expect(c.items.some(x => x.label.startsWith('Rent'))).toBe(true); expect(c.daily.length).toBe(61); expect(c.low.bal).toBeLessThan(c.start + 1); expect(c.items.every(x => x.bal != null)).toBe(true) })
  it('burn and 24-month runway', () => { const { data, household } = seed(); const b = burn(data, household.settings); expect(b.income).toBeGreaterThan(4000); expect(b.expenses).toBeGreaterThan(3000); const r = runwayProjection(data, household.settings); expect(r.xs.length).toBe(25); expect(r.ys[0]).toBeCloseTo(b.cash, 0); const lean = runwayProjection(data, household.settings, { leanOnly: true }); expect(lean.ys[24]).toBeGreaterThanOrEqual(r.ys[24] - 1) })
  it('net worth series ends today', () => { const { data } = seed(); const s = netWorthSeries(data); expect(s[s.length - 1].date).toBe(T0); expect(s.length).toBe(4) })
})

describe('goals', () => {
  it('progress, need per month and on-track', () => { const { data } = seed(); const g = goalProgress(data, data.goals[0]); expect(g.saved).toBeGreaterThan(7150); expect(g.pct).toBeGreaterThan(0.4); expect(g.needPerMonth).toBeGreaterThan(0); expect(typeof g.onTrack).toBe('boolean'); const d = goalProgress(data, data.goals[1]); expect(d.saved).toBe(0) })
})

// ---------------- spending intelligence (0.3.0) ----------------
import { merchantKey, merchantAnalysis, detectRecurring, subscriptionAnalysis, wasteDetection, healthIndicators } from './intelligence'
import { SETTINGS_DEFAULTS, type Transaction, type Data } from '../app/data/types'
const mkTx = (over: Partial<Transaction>, i: number): Transaction => ({ id: `t${i}`, household_id: 'h', date: '2026-10-01', kind: 'expense', amount: 10, account_id: 'chk', to_account_id: null, category_id: null, payee: 'X', memo: null, tags: [], status: 'cleared', source: 'manual', exclude_from_budget: false, ...over })
const data0 = () => seed().data
const withTx = (txs: Partial<Transaction>[]): Data => { const { data } = seed(); const cat = data.categories.find(c => c.name === 'Groceries')!; return { ...data, transactions: txs.map((t, i) => mkTx({ category_id: cat.id, ...t }, i)) } }

describe('intelligence: merchants', () => {
  it('normalises merchant names', () => { expect(merchantKey('KROGER #1234 COLUMBUS OH')).toBe('kroger'); expect(merchantKey('Kroger Fuel 0042')).toBe('kroger fuel'); expect(merchantKey('Netflix.com')).toBe('netflix'); expect(merchantKey('AMZN Mktp US*2K4')).toBe('amzn mktp us'); expect(merchantKey('')).toBe('unknown') })
  it('totals per merchant with change vs the prior window', () => {
    const d = withTx([{ date: '2026-10-05', payee: 'Kroger', amount: 50 }, { date: '2026-10-20', payee: 'KROGER #22', amount: 70 }, { date: '2026-09-10', payee: 'Kroger', amount: 100 }, { date: '2026-10-11', payee: 'Shell', amount: 40 }])
    const m = merchantAnalysis(d, '2026-10-01', '2026-10-31'); expect(m[0].key).toBe('kroger'); expect(m[0].total).toBe(120); expect(m[0].count).toBe(2); expect(m[0].prior).toBe(100); expect(m[0].change).toBe(0.2); expect(m[1].change).toBeNull()
  })
})
describe('intelligence: recurring & subscriptions', () => {
  it('detects a steady monthly charge and flags a price rise', () => {
    const d = withTx(['2026-06-14', '2026-07-14', '2026-08-15', '2026-09-14', '2026-10-14'].map((date, i) => ({ date, payee: 'Hulu', amount: i < 3 ? 14.99 : 15.99 })))
    const r = detectRecurring(d, '2026-11-04'); expect(r).toHaveLength(1); expect(r[0].cadence).toBe('monthly'); expect(r[0].count).toBe(5); expect(r[0].rising).toBe(true); expect(r[0].known).toBe(false); expect(r[0].next).toBe('2026-11-13'); expect(r[0].annual).toBeCloseTo(14.99 * 12, 0)
  })
  it('ignores irregular or wildly varying charges', () => {
    const d = withTx([{ date: '2026-06-01', payee: 'Shell', amount: 40 }, { date: '2026-06-09', payee: 'Shell', amount: 62 }, { date: '2026-07-20', payee: 'Shell', amount: 35 }, { date: '2026-09-02', payee: 'Shell', amount: 48 }])
    expect(detectRecurring(d, '2026-11-04')).toHaveLength(0)
  })
  it('subscription summary combines Recurring rows with detected unknowns', () => {
    const { data } = seed(); const s = subscriptionAnalysis(data, T0); const known = data.recurring.filter(r => r.kind === 'subscription' && r.status === 'Active').length
    expect(s.count).toBeGreaterThanOrEqual(known); expect(s.monthly).toBeGreaterThan(0); expect(s.items.filter(i => i.source === 'recurring')).toHaveLength(known)
  })
})
describe('intelligence: waste detection', () => {
  it('finds duplicates, fees, late fees and outliers', () => {
    const d = withTx([
      { date: '2026-10-03', payee: 'Shell', amount: 45.1 }, { date: '2026-10-04', payee: 'SHELL', amount: 45.1 },   // duplicate
      { date: '2026-10-05', payee: 'Huntington', memo: 'Overdraft fee', amount: 36 },                                   // bank fee
      { date: '2026-10-06', payee: 'Chase', memo: 'Late fee', amount: 29 },                                             // late fee
      ...[1, 2, 3, 4, 5, 6].map(i => ({ date: `2026-10-1${i}`, payee: 'Kroger', amount: 60 + i })), { date: '2026-10-20', payee: 'Kroger', amount: 480 },   // outlier
    ])
    const w = wasteDetection(d, '2026-11-04'); const kinds = w.map(x => x.kind)
    expect(kinds).toContain('duplicate'); expect(kinds).toContain('bank_fee'); expect(kinds).toContain('late_fee'); expect(kinds).toContain('outlier')
    expect(w[0].severity).toBe('crit'); expect(w.find(x => x.kind === 'duplicate')!.txnIds).toEqual(['t0', 't1']); expect(w.find(x => x.kind === 'outlier')!.txnIds).toEqual(['t10'])
  })
  it('flags a week that is a spending spike', () => {
    const d = withTx([...[...Array(8)].map((_, w) => ({ date: addDays('2026-08-10', w * 7), payee: 'Kroger', amount: 100 })), { date: '2026-09-22', payee: 'Best Buy', amount: 900 }])
    const s = wasteDetection(d, '2026-11-04').filter(x => x.kind === 'spike'); expect(s).toHaveLength(1); expect(s[0].date).toBe('2026-09-21'); expect(s[0].amount).toBe(900)
    const rent = data0().categories.find(c => c.name === 'Rent / mortgage')!   // a Fixed cost paid once a month is not a spike
    const f = withTx([...[...Array(8)].map((_, w) => ({ date: addDays('2026-08-10', w * 7), payee: 'Kroger', amount: 100 })), { date: '2026-09-22', payee: 'Landlord', amount: 1850, category_id: rent.id }])
    expect(wasteDetection(f, '2026-11-04').filter(x => x.kind === 'spike')).toHaveLength(0)
  })
  it('flags a listed subscription with no charge in two cycles', () => {
    const { data } = seed(); const sub = data.recurring.find(r => r.kind === 'subscription' && r.status === 'Active')!
    const d: Data = { ...data, transactions: data.transactions.filter(t => merchantKey(t.payee) !== merchantKey(sub.payee || sub.name)), recurring: data.recurring.map(r => r.id === sub.id ? { ...r, last_paid_on: '2026-06-01' } : r) }
    expect(wasteDetection(d, T0).some(x => x.kind === 'unused_subscription' && x.title.startsWith(sub.name))).toBe(true)
  })
})
describe('intelligence: health', () => {
  it('computes burn rate, savings rate, months covered and bounded scores', () => {
    const { data, household } = seed(); const s = { ...SETTINGS_DEFAULTS, ...household.settings }
    const h = healthIndicators(data, s, 3, T0)
    expect(h.burnRate).toBeGreaterThan(0); expect(h.income).toBeGreaterThan(0); expect(h.expenseRatio).toBeCloseTo(h.burnRate / h.income, 2)
    expect(h.cashFlowScore).toBeGreaterThanOrEqual(0); expect(h.cashFlowScore).toBeLessThanOrEqual(100); expect(h.efficiencyScore).toBeGreaterThanOrEqual(0); expect(h.efficiencyScore).toBeLessThanOrEqual(100)
    expect(h.monthsCovered).not.toBeNull(); expect(h.savingsRate).not.toBeNull()
  })
  it('a household with no income gets null ratios and a zero-ish cash-flow score', () => {
    const d = withTx([{ date: '2026-10-05', payee: 'Kroger', amount: 50 }]); const h = healthIndicators({ ...d, accounts: d.accounts.map(a => ({ ...a, balance: 0 })) }, SETTINGS_DEFAULTS, 3, T0)
    expect(h.savingsRate).toBeNull(); expect(h.expenseRatio).toBeNull(); expect(h.cashFlowScore).toBe(0); expect(h.burnRate).toBeCloseTo(50 / 3, 2)
  })
})
describe('intelligence: subscription last-charged', () => {
  it('uses the latest of last_paid_on and the newest matching transaction', () => {
    const { data } = seed(); const s = subscriptionAnalysis(data, T0); const nf = s.items.find(i => i.name === 'Netflix')!
    const newest = data.transactions.filter(t => merchantKey(t.payee) === 'netflix' && t.kind === 'expense').map(t => t.date).sort().pop()
    expect(nf.lastCharged).toBe(newest)
  })
})

// ---------------- payee rules (0.4.0) ----------------
import { ruleMatches, findRule, suggest, applySuggestion, planAutoCategorise, learnRule, upsertRule, type PayeeRule } from './rules'
const R = (o: Partial<PayeeRule>): PayeeRule => ({ id: o.id || 'r1', pattern: 'kroger', match: 'contains', enabled: true, ...o })
describe('rules: matching', () => {
  it('contains / starts / exact / regex, case-insensitive, kind-scoped, invalid regex never matches', () => {
    expect(ruleMatches(R({}), 'KROGER #123')).toBe(true); expect(ruleMatches(R({ match: 'starts', pattern: 'kro' }), 'Kroger')).toBe(true); expect(ruleMatches(R({ match: 'starts', pattern: 'ger' }), 'Kroger')).toBe(false)
    expect(ruleMatches(R({ match: 'exact', pattern: 'Kroger' }), 'KROGER #123 COLUMBUS')).toBe(true); expect(ruleMatches(R({ match: 'exact', pattern: 'Kroger Fuel' }), 'Kroger')).toBe(false)
    expect(ruleMatches(R({ match: 'regex', pattern: '^(shell|bp)\\b' }), 'BP #44')).toBe(true); expect(ruleMatches(R({ match: 'regex', pattern: '(' }), 'anything')).toBe(false)
    expect(ruleMatches(R({ kind: 'income' }), 'Kroger', 'expense')).toBe(false); expect(ruleMatches(R({ enabled: false }), 'Kroger')).toBe(false)
  })
  it('the most specific (longest) enabled rule wins', () => {
    const rules = [R({ id: 'a', pattern: 'kroger', category_id: 'groc' }), R({ id: 'b', pattern: 'kroger fuel', category_id: 'fuel' })]
    expect(findRule(rules, 'KROGER FUEL #9')!.id).toBe('b'); expect(findRule(rules, 'Kroger')!.id).toBe('a'); expect(findRule(rules, 'Aldi')).toBeNull()
  })
})
describe('rules: suggestions & bulk plan', () => {
  it('rule → remembered email payee → history, in that order', () => {
    const { data, household } = seed(); const groc = data.categories.find(c => c.name === 'Groceries')!, dine = data.categories.find(c => c.name === 'Dining out')!
    const base = { ...SETTINGS_DEFAULTS, ...household.settings }
    expect(suggest(data, { ...base, rules: [R({ pattern: 'kroger', category_id: dine.id })] }, { payee: 'Kroger', kind: 'expense' })).toMatchObject({ category_id: dine.id, how: 'rule' })
    expect(suggest(data, { ...base, finmail: { rules: { kroger: { category: dine.id } } } }, { payee: 'Kroger', kind: 'expense' })).toMatchObject({ category_id: dine.id, how: 'remembered' })
    expect(suggest(data, base, { payee: 'Kroger', kind: 'expense' })).toMatchObject({ category_id: groc.id, how: 'history' })   // demo has 2+ Kroger → Groceries
    expect(suggest(data, base, { payee: 'Never Seen Before LLC', kind: 'expense' }).how).toBeNull()
  })
  it('applySuggestion only fills blanks unless forced; the bulk plan skips transfers, voids and categorised rows', () => {
    expect(applySuggestion({ category_id: 'x' }, { category_id: 'y', how: 'rule' })).toBeNull(); expect(applySuggestion({ category_id: 'x' }, { category_id: 'y', how: 'rule' }, true)).toEqual({ category_id: 'y' })
    expect(applySuggestion({}, { category_id: 'y', payee: 'Kroger', how: 'rule' })).toEqual({ category_id: 'y', payee: 'Kroger' })
    const { data, household } = seed(); const s = { ...SETTINGS_DEFAULTS, ...household.settings, rules: [R({ pattern: 'mystery', category_id: data.categories[5].id })] }
    const d = { ...data, transactions: [...data.transactions, mkTx({ id: 'u1', payee: 'MYSTERY SHOP', category_id: null }, 900), mkTx({ id: 'u2', payee: 'Mystery', category_id: null, status: 'void' }, 901), mkTx({ id: 'u3', payee: 'mystery', kind: 'transfer', category_id: null }, 902)] }
    const plan = planAutoCategorise(d, s); expect(plan.map(p => p.t.id)).toContain('u1'); expect(plan.map(p => p.t.id)).not.toContain('u2'); expect(plan.map(p => p.t.id)).not.toContain('u3'); expect(plan.every(p => !p.t.category_id)).toBe(true)
  })
  it('learns a rule from a correction and upserts by pattern', () => {
    const r = learnRule('KROGER #1234 COLUMBUS OH', { category_id: 'groc' }, 'expense')!; expect(r).toMatchObject({ pattern: 'kroger', match: 'contains', category_id: 'groc', source: 'learned' })
    const once = upsertRule([], r); const twice = upsertRule(once, { ...r, id: 'other', category_id: 'dine' }); expect(twice).toHaveLength(1); expect(twice[0].category_id).toBe('dine'); expect(twice[0].id).toBe(r.id)
    expect(learnRule('', { category_id: 'x' })).toBeNull()
  })
})

// ---------------- planning (0.5.0) ----------------
import { availableBalance, liquidity, goalAllocation, goalMilestones, goalWhatIf } from './planning'
describe('planning: available balance & liquidity', () => {
  it('available = balance for assets, limit − owed for revolving debt, none for instalment loans', () => {
    const { data } = seed(); const chk = data.accounts.find(a => a.name === 'Huntington Checking')!, card = data.accounts.find(a => a.name === 'Chase Freedom')!, loan = data.accounts.find(a => a.kind === 'auto_loan')!
    expect(availableBalance(chk)).toBe(chk.balance); expect(availableBalance(card)).toBeCloseTo(+card.credit_limit! - card.balance, 2); expect(availableBalance(loan)).toBeNull()
  })
  it('months covered use essentials and the full burn rate; tiers scale with the thresholds', () => {
    const { data, household } = seed(); const s = { ...SETTINGS_DEFAULTS, ...household.settings }; const l = liquidity(data, s, T0)
    expect(l.essentialsPerMonth).toBeLessThanOrEqual(l.burnRate); expect(l.monthsEssentials!).toBeGreaterThanOrEqual(l.monthsAll!); expect(l.monthsAll).toBeCloseTo(l.cash / l.burnRate, 2)
    expect(l.tiers[2].amount).toBeCloseTo(l.essentialsPerMonth * s.runwayGreen, 1); expect(['good', 'warn', 'crit']).toContain(l.band)
  })
})
describe('planning: goal allocation', () => {
  it('linked goals share their account by priority; unlinked goals draw on the pool above the reserve floor; debt goals are tracked only', () => {
    const { data, household } = seed(); const s = { ...SETTINGS_DEFAULTS, ...household.settings, reserveFloor: 0 }
    const sav = data.accounts.find(a => a.kind === 'savings')!; const bal = +sav.balance
    const goals: typeof data.goals = [
      { ...data.goals[0], id: 'g1', name: 'A', kind: 'savings', status: 'Active', priority: 1, sort_order: 1, account_id: sav.id, target_amount: bal * 0.6, starting_amount: 0, monthly_contribution: 0, target_date: null },
      { ...data.goals[0], id: 'g2', name: 'B', kind: 'savings', status: 'Active', priority: 2, sort_order: 2, account_id: sav.id, target_amount: bal, starting_amount: 0, monthly_contribution: 0, target_date: null },
      { ...data.goals[0], id: 'g3', name: 'C', kind: 'purchase', status: 'Active', priority: 3, sort_order: 3, account_id: null, target_amount: 100, starting_amount: 0, monthly_contribution: 0, target_date: null },
      { ...data.goals[0], id: 'g4', name: 'D', kind: 'debt_payoff', status: 'Active', priority: 4, sort_order: 4, account_id: data.accounts.find(a => a.kind === 'credit_card')!.id, target_amount: 1000, starting_amount: 0, monthly_contribution: 0, target_date: null },
    ]
    const r = goalAllocation({ ...data, goals, contributions: [] }, s); const by = Object.fromEntries(r.rows.map(x => [x.goal.id, x]))
    expect(by.g1.covered).toBe('full'); expect(by.g1.allocated).toBeCloseTo(bal * 0.6, 2); expect(by.g2.covered).toBe('partial'); expect(by.g2.allocated).toBeCloseTo(bal * 0.4, 2)
    expect(by.g3.covered).toBe('full'); expect(by.g4.covered).toBe('tracked'); expect(r.shortfall).toBeCloseTo(bal * 0.6, 2)
  })
})
describe('planning: milestones & what-if', () => {
  it('milestones mark what is reached and date the rest from the contribution rate', () => {
    const { data } = seed(); const g = { ...data.goals[0], id: 'm', kind: 'savings' as const, account_id: null, target_amount: 1000, starting_amount: 300, monthly_contribution: 100, target_date: null }
    const d = { ...data, contributions: [{ id: 'c1', household_id: 'h', goal_id: 'm', date: '2026-09-01', amount: 250 }] }
    const m = goalMilestones(d, g, T0); expect(m.map(x => x.reached)).toEqual([true, true, false, false]); expect(m[1].reachedOn).toBe('2026-09-01'); expect(m[0].reachedOn).toBeNull()   // 25% was covered by the starting amount — no contribution date
    expect(m[2].date).toBe(addDays(T0, Math.round(2 * 30.44))); expect(m[3].date).toBe(addDays(T0, Math.round(4.5 * 30.44)))
  })
  it('what-if: more per month lands sooner; a lump sum shortens it; needed-for-target is the gap over the months left', () => {
    const { data } = seed(); const g = { ...data.goals[0], id: 'w', kind: 'savings' as const, account_id: null, target_amount: 1200, starting_amount: 0, monthly_contribution: 100, target_date: addDays(T0, 183) }
    const d = { ...data, contributions: [] }; const base = goalWhatIf(d, g, { asOf: T0 }), more = goalWhatIf(d, g, { monthly: 300, asOf: T0 }), lump = goalWhatIf(d, g, { lump: 600, asOf: T0 })
    expect(base.months).toBe(12); expect(base.onTime).toBe(false); expect(more.months).toBe(4); expect(more.onTime).toBe(true); expect(lump.months).toBe(6)
    expect(base.neededForTarget).toBeCloseTo(1200 / (183 / 30.44), 0); expect(base.byTarget).toBeCloseTo(100 * 183 / 30.44, 0)
  })
})

// ---------------- portfolio & retirement (0.6.0) ----------------
import { portfolio, holdingValue, holdingGain, retirementAssets } from './portfolio'
import { sum } from './money'
import { projectRetirement, monteCarlo, safeWithdrawal, rng, RETIREMENT_DEFAULTS } from './retirement'
describe('portfolio', () => {
  it('values, gains and allocation slices sum to the whole; concentration is flagged above 20% in one non-diversified position', () => {
    const { data } = seed(); const p = portfolio(data)
    expect(p.value).toBeCloseTo(sum(data.holdings.map(holdingValue)), 2); expect(p.gain).toBeCloseTo(sum(data.holdings.map(holdingGain)), 2)
    for (const slices of [p.byClass, p.bySector, p.byRisk, p.byAccount]) { expect(sum(slices.map(s => s.value))).toBeCloseTo(p.value, 1); expect(sum(slices.map(s => s.pct))).toBeCloseTo(1, 1) }
    expect(p.byClass[0].key).toBe('mutual_fund'); expect(p.growthShare).toBeGreaterThan(0.5); expect(p.growthShare).toBeLessThan(1); expect(p.concentrationWarning).toBeNull()   // the big position is a diversified fund
    const conc = portfolio({ ...data, holdings: data.holdings.map(h => h.symbol === 'AAPL' ? { ...h, quantity: 200 } : h) }); expect(conc.concentrationWarning).toMatch(/AAPL/)
    const brok = portfolio(data, data.accounts.find(a => a.name === 'Schwab brokerage')!.id); expect(brok.holdings).toHaveLength(5); expect(brok.value).toBeLessThan(p.value)
  })
  it('retirement vs taxable assets use the larger of account balance and itemised holdings', () => { const { data } = seed(); const r = retirementAssets(data); expect(r.retirement).toBeGreaterThanOrEqual(42300); expect(r.taxable).toBeGreaterThanOrEqual(11860); expect(r.total).toBeCloseTo(r.retirement + r.taxable, 2) })
})
describe('retirement: projection', () => {
  it('compounds with growing contributions, converts to today\'s dollars, and scores readiness', () => {
    const i = { ...RETIREMENT_DEFAULTS, currentAge: 40, retireAge: 42, annualContribution: 1000, expectedReturn: 0.1, inflation: 0, desiredIncome: 40000, socialSecurity: 0, currentIncome: 100000 }
    const p = projectRetirement(10000, i); expect(p.years).toBe(2); expect(p.nominal).toBeCloseTo(10000 * 1.21 + 1000 * 1.1 + 1000, 2); expect(p.real).toBe(p.nominal)
    expect(p.needed).toBe(1000000); expect(p.readiness).toBe(Math.round(p.real / 1000000 * 100)); expect(p.sustainableIncome).toBeCloseTo(p.real * 0.04, 2); expect(p.replacementRatio).toBeCloseTo(p.sustainableIncome / 100000, 2)
    expect(p.contributionForTarget).toBeGreaterThan(0); const closed = projectRetirement(10000, { ...i, annualContribution: p.contributionForTarget! }); expect(closed.real).toBeCloseTo(1000000, -2)
  })
  it('inflation shrinks real value; zero years means no growth', () => { const a = projectRetirement(50000, { ...RETIREMENT_DEFAULTS, inflation: 0 }), b = projectRetirement(50000, { ...RETIREMENT_DEFAULTS, inflation: 0.03 }); expect(b.real).toBeLessThan(a.real); expect(b.nominal).toBeGreaterThan(a.nominal); const z = projectRetirement(50000, { ...RETIREMENT_DEFAULTS, currentAge: 65, retireAge: 65 }); expect(z.real).toBe(50000) })
})
describe('retirement: monte carlo & safe withdrawal', () => {
  it('is reproducible for a seed, bands are ordered, and zero volatility matches the deterministic path', () => {
    const i = { ...RETIREMENT_DEFAULTS }; const a = monteCarlo(50000, i, 500, 7), b = monteCarlo(50000, i, 500, 7); expect(a.median).toBe(b.median); expect(a.successRate).toBe(b.successRate)
    for (const band of a.bands) { expect(band.p10).toBeLessThanOrEqual(band.p50); expect(band.p50).toBeLessThanOrEqual(band.p90) }
    const flat = monteCarlo(50000, { ...i, returnStdDev: 0 }, 50, 1); const det = projectRetirement(50000, i); expect(flat.medianAtRetirement).toBeCloseTo(det.real, 0)
    expect(a.successRate).toBeGreaterThanOrEqual(0); expect(a.successRate).toBeLessThanOrEqual(1); expect(a.runs).toBe(500)
    const u = rng(3); const x = u(); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); expect(rng(3)()).toBe(x)
  })
  it('more volatility or a bigger draw lowers the success rate', () => {
    const i = { ...RETIREMENT_DEFAULTS, desiredIncome: 80000 }; const calm = monteCarlo(300000, { ...i, returnStdDev: 0.05 }, 400, 9), wild = monteCarlo(300000, { ...i, returnStdDev: 0.25 }, 400, 9), greedy = monteCarlo(300000, { ...i, returnStdDev: 0.05, desiredIncome: 140000 }, 400, 9)
    expect(wild.successRate).toBeLessThanOrEqual(calm.successRate); expect(greedy.successRate).toBeLessThan(calm.successRate)
  })
  it('safe withdrawal: 3% lasts longer than 5%; income = rate × balance + social security', () => {
    const r = safeWithdrawal(1000000, { ...RETIREMENT_DEFAULTS, expectedReturn: 0.05, inflation: 0.025 }); expect(r.map(x => x.rate)).toEqual([0.03, 0.04, 0.05]); expect(r[0].annualIncome).toBe(30000 + 24000)
    const life = (x: typeof r[number]) => x.yearsLast ?? 999; expect(life(r[0])).toBeGreaterThanOrEqual(life(r[1])); expect(life(r[1])).toBeGreaterThanOrEqual(life(r[2])); expect(r[0].lastsToLifeExpectancy).toBe(true)
    const tight = safeWithdrawal(1000000, { ...RETIREMENT_DEFAULTS, expectedReturn: 0.02, inflation: 0.03 }, [0.08]); expect(tight[0].yearsLast).not.toBeNull(); expect(tight[0].lastsToLifeExpectancy).toBe(false)
  })
})

// ---------------- tax (0.7.0) ----------------
import { estimateTax, autoItems, withholdingToBreakEven, paychecksRemaining, TAX_DEFAULTS as TAX_D, type TaxItem } from './tax'
import { FEDERAL } from './taxTables'
const TI = (kind: TaxItem['kind'], amount: number, extra: Partial<TaxItem> = {}): TaxItem => ({ id: kind + amount, kind, label: kind, amount, source: 'manual', ...extra })
const blank = () => { const { data } = seed(); return { ...data, paySchedules: [], holdings: [], transactions: [], recurring: [] } }
describe('tax: federal brackets & deduction (2026)', () => {
  it('single, $100k wages, standard deduction: 10/12/22% stacking', () => {
    const e = estimateTax(blank(), SETTINGS_DEFAULTS, { year: 2026, filingStatus: 'single', state: 'NONE', autoAggregate: false, items: [TI('w2', 100000)] })
    expect(e.agi).toBe(100000); expect(e.deduction).toBe(16100); expect(e.taxableIncome).toBe(83900)
    const expected = 12400 * 0.10 + (50400 - 12400) * 0.12 + (83900 - 50400) * 0.22   // 1240 + 4560 + 7370 = 13170
    expect(e.federal.ordinary).toBeCloseTo(expected, 2); expect(e.federal.marginal).toBe(0.22); expect(e.federal.total).toBeCloseTo(expected, 2); expect(e.state.tax).toBe(0)
  })
  it('married filing jointly uses the wider brackets and doubles the standard deduction; itemized wins when larger', () => {
    const e = estimateTax(blank(), SETTINGS_DEFAULTS, { year: 2026, filingStatus: 'mfj', state: 'NONE', autoAggregate: false, items: [TI('w2', 150000), TI('itemized', 40000)] })
    expect(e.deduction).toBe(40000); expect(e.taxableIncome).toBe(110000); expect(e.federal.ordinary).toBeCloseTo(24800 * 0.1 + (100800 - 24800) * 0.12 + (110000 - 100800) * 0.22, 2)
  })
  it('long-term gains stack on ordinary income at 0 / 15 %', () => {
    const e = estimateTax(blank(), SETTINGS_DEFAULTS, { year: 2026, filingStatus: 'single', state: 'NONE', autoAggregate: false, items: [TI('w2', 46100), TI('capital_gains', 30000)] })
    // taxable 60,000: ordinary 30,000; gains 30,000 of which 49,450−30,000 = 19,450 at 0 % and 10,550 at 15 %
    expect(e.taxableIncome).toBe(60000); expect(e.federal.ltcg).toBeCloseTo(10550 * 0.15, 2)
  })
})
describe('tax: self-employment, Ohio, local, credits', () => {
  it('SE tax on 92.35 % of net profit, half deductible; Ohio flat 2.75 % above $26,050 after exemptions; municipal on earned income', () => {
    const e = estimateTax(blank(), SETTINGS_DEFAULTS, { year: 2026, filingStatus: 'single', state: 'OH', localRate: 2.5, schoolDistrictRate: 0, autoAggregate: false, items: [TI('business', 80000)] })
    const seTax = 80000 * 0.9235 * 0.153; expect(e.federal.se).toBeCloseTo(seTax, 2); expect(e.seDeduction).toBeCloseTo(seTax / 2, 2); expect(e.agi).toBeCloseTo(80000 - seTax / 2, 2)
    const oagi = e.agi; const exempt = 2150   // Ohio MAGI ≈ $74k → $40,001–$80,000 tier
    expect(e.state.taxable).toBeCloseTo(oagi - exempt, 2); expect(e.state.tax).toBeCloseTo((oagi - exempt - 26050) * 0.0275, 2)
    expect(e.local.municipal).toBeCloseTo(80000 * 0.025, 2); expect(e.seSetAside).toBe(80000 * 0.25)
  })
  it('child tax credit reduces federal tax; SS wage base caps the 12.4 % part', () => {
    const e = estimateTax(blank(), SETTINGS_DEFAULTS, { year: 2026, filingStatus: 'mfj', state: 'NONE', dependentsUnder17: 2, autoAggregate: false, items: [TI('w2', 120000)] })
    const noKids = estimateTax(blank(), SETTINGS_DEFAULTS, { year: 2026, filingStatus: 'mfj', state: 'NONE', autoAggregate: false, items: [TI('w2', 120000)] })
    expect(noKids.federal.total - e.federal.total).toBeCloseTo(4400, 2)
    const hi = estimateTax(blank(), SETTINGS_DEFAULTS, { year: 2026, filingStatus: 'single', state: 'NONE', autoAggregate: false, items: [TI('business', 300000)] })
    expect(hi.federal.se).toBeCloseTo(FEDERAL[2026].ssWageBase * 0.124 + 300000 * 0.9235 * 0.029, 0)
  })
  it('head of household brackets (24 % tops out at $201,750) and the Ohio exemption cap above $500k', () => {
    const h = FEDERAL[2026].brackets.hoh; expect(h.map(b => b.upTo)).toEqual([17700, 67450, 105700, 201750, 256200, 640600, null])
    const rich = estimateTax(blank(), SETTINGS_DEFAULTS, { year: 2026, filingStatus: 'single', state: 'OH', autoAggregate: false, items: [TI('w2', 600000)] })
    expect(rich.state.taxable).toBe(600000); expect(rich.state.tax).toBeCloseTo((600000 - 26050) * 0.0275, 2)
  })
})
describe('tax: payments, safe harbor, provisioning', () => {
  it('refund / due, safe-harbor basis and the per-paycheck change that breaks even', () => {
    const base = { year: 2026, filingStatus: 'single' as const, state: 'NONE', autoAggregate: false, paychecksLeft: 10, priorYearTax: 9000, priorYearAgi: 90000 }
    const e = estimateTax(blank(), SETTINGS_DEFAULTS, { ...base, items: [TI('w2', 100000), TI('withholding', 8000)] })
    expect(e.federal.total).toBeCloseTo(13170, 0); expect(e.paid.withheld).toBe(8000); expect(e.due).toBeCloseTo(13170 - 8000, 0)
    expect(e.safeHarbor.basis).toBe('100% of last year'); expect(e.safeHarbor.required).toBe(9000); expect(e.safeHarbor.met).toBe(false); expect(e.safeHarbor.shortfall).toBe(1000)
    const w = withholdingToBreakEven(blank(), SETTINGS_DEFAULTS, { ...TAX_D, ...base, items: [TI('w2', 100000), TI('withholding', 8000)] }); expect(w).toBeCloseTo((13170 - 8000) / 10, 0)
    const ok = estimateTax(blank(), SETTINGS_DEFAULTS, { ...base, items: [TI('w2', 100000), TI('withholding', 8000)], extraWithholdingPerCheck: 100 }); expect(ok.safeHarbor.met).toBe(true); expect(ok.paid.extraWithholding).toBe(1000)
  })
  it('auto-aggregation turns pay schedules into W-2 / 1099 items and holdings yields into dividends', () => {
    const { data } = seed(); const items = autoItems(data, 2026); const w2 = items.filter(i => i.kind === 'w2'); expect(w2.length).toBeGreaterThanOrEqual(1)
    const ps = data.paySchedules.find(p => p.kind === 'salary')!; const per = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 } as Record<string, number>
    expect(w2[0].amount).toBeCloseTo((ps.gross_amount || ps.net_amount) * per[ps.frequency], 2)
  })
})
describe('tax: remaining deadlines and paydays', () => {
  it('quarterly amount divides the shortfall over the estimate deadlines still ahead; paychecks left come from the pay schedule', () => {
    const items = [TI('business', 60000)]; const p = { year: 2026, filingStatus: 'single' as const, state: 'NONE', autoAggregate: false, items }
    const nov = estimateTax(blank(), SETTINGS_DEFAULTS, p, '2026-11-01'), may = estimateTax(blank(), SETTINGS_DEFAULTS, p, '2026-05-01')
    expect(nov.safeHarbor.estimatesLeft).toBe(1); expect(nov.safeHarbor.quarterlyNeeded).toBeCloseTo(nov.safeHarbor.shortfall, 2)
    expect(may.safeHarbor.estimatesLeft).toBe(3); expect(may.safeHarbor.quarterlyNeeded).toBeCloseTo(may.safeHarbor.shortfall / 3, 2)
    const { data } = seed(); const ps = data.paySchedules.find(x => x.kind === 'salary')!; const left = paychecksRemaining(data, 2026, '2026-11-01')
    expect(left).toBe(payDates(ps, '2026-11-02', '2026-12-31').length); expect(left).toBeGreaterThan(0); expect(paychecksRemaining(data, 2026, '2027-01-02')).toBe(0)
  })
})

// ---------------- reports (0.8.0) ----------------
import { periodRange, buildReport, reportRows, changeText, ALL_SECTIONS, plannedInRange, accountFlows } from './reports'
describe('reports', () => {
  it('period ranges: month / quarter / year, previous period, month-to-date when the period is still running', () => {
    expect(periodRange('month', '2026-10-15', '2026-11-04')).toMatchObject({ from: '2026-10-01', to: '2026-10-31', prevFrom: '2026-09-01', prevTo: '2026-09-30', partial: false, label: 'October 2026' })
    expect(periodRange('quarter', '2026-08-02', '2026-11-04')).toMatchObject({ from: '2026-07-01', to: '2026-09-30', prevFrom: '2026-04-01', prevTo: '2026-06-30', label: 'Q3 2026' })
    const ytd = periodRange('year', '2026-03-01', '2026-11-04'); expect(ytd).toMatchObject({ from: '2026-01-01', to: '2026-11-04', prevFrom: '2025-01-01', prevTo: '2025-11-04', partial: true }); expect(ytd.label).toBe('2026 (to date)')
  })
  it('spending and cash-flow sections reconcile to the ledger; CSV rows carry every section', () => {
    const { data, household } = seed(); const s = { ...SETTINGS_DEFAULTS, ...household.settings }; const rep = buildReport(data, s, 'month', '2026-10-01', undefined, T0)
    const spend = data.transactions.filter(t => t.kind === 'expense' && t.status !== 'void' && !t.exclude_from_budget && t.date >= '2026-10-01' && t.date <= '2026-10-31').reduce((a, t) => a + t.amount, 0)
    const sp = rep.sections.find(x => x.id === 'spending')!; expect(sp.kpis[0].value).toBeCloseTo(spend, 2); expect(sp.table!.rows.reduce((a, r) => a + +r[2], 0)).toBeCloseTo(spend, 1)
    const cf = rep.sections.find(x => x.id === 'cashflow')!; expect(cf.table!.rows).toHaveLength(1); expect(+cf.table!.rows[0][2]).toBeCloseTo(spend, 2)
    expect(rep.sections.map(x => x.id)).toEqual(['summary', 'spending', 'cashflow', 'networth', 'investments', 'tax'])
    const rows = reportRows(rep); expect(rows[0][0]).toContain('October 2026'); for (const sec of rep.sections) expect(rows.some(r => r[0] === sec.title.toUpperCase())).toBe(true)
    const q = buildReport(data, s, 'quarter', '2026-10-01', ['cashflow'], T0); expect(q.sections[0].table!.rows.map(r => r[0])).toEqual(['2026-10', '2026-11'])   // Q4 to date
  })
})
describe('reports (0.18.0): custom ranges, statement, income, budget, bills, trend, accounts, debts, goals, transactions', () => {
  it('a custom range compares with the same-length span just before it', () => {
    expect(periodRange('custom', '', '2026-11-04', { from: '2026-10-10', to: '2026-10-19' })).toMatchObject({ from: '2026-10-10', to: '2026-10-19', prevFrom: '2026-09-30', prevTo: '2026-10-09', label: '2026-10-10 to 2026-10-19' })
    expect(periodRange('custom', '', '2026-11-04', { from: '2026-10-19', to: '2026-10-10' }).from).toBe('2026-10-10')   // swapped dates are tolerated
  })
  it('every section builds from the demo data, in catalogue order, with a table that reconciles to the ledger', () => {
    const { data, household } = seed(); const s = { ...SETTINGS_DEFAULTS, ...household.settings }; const all = ALL_SECTIONS.map(x => x[0])
    const rep = buildReport(data, s, 'custom', '', all.slice().reverse(), T0, { from: '2026-10-01', to: '2026-10-31' })
    expect(rep.sections.map(x => x.id)).toEqual(all)
    const live = data.transactions.filter(t => t.status !== 'void' && !t.duplicate_of && t.date >= '2026-10-01' && t.date <= '2026-10-31')
    const tx = rep.sections.find(x => x.id === 'transactions')!; expect(tx.table!.rows).toHaveLength(live.length); expect(tx.kpis[0].value).toBe(live.length)
    const inc = rep.sections.find(x => x.id === 'income')!; const income = live.filter(t => t.kind === 'income' && !t.exclude_from_budget).reduce((a, t) => a + t.amount, 0)
    expect(inc.kpis[0].value).toBeCloseTo(income, 2); expect(inc.table!.rows.reduce((a, r) => a + +r[2], 0)).toBeCloseTo(income, 1)
    const st = rep.sections.find(x => x.id === 'statement')!; const [begin, change, end] = [st.kpis[0].value, st.kpis[1].value, st.kpis[2].value]; expect(begin + change).toBeCloseTo(end, 1)
    const bud = rep.sections.find(x => x.id === 'budget')!; expect(bud.kpis[0].value).toBeGreaterThan(0); expect(bud.table!.rows.every(r => Math.abs(+r[2] - +r[3] - +r[4]) < 0.01)).toBe(true)   // variance = planned − actual
    const bills = rep.sections.find(x => x.id === 'bills')!; expect(bills.table!.rows.length).toBeGreaterThan(0); expect(bills.kpis[0].value).toBeCloseTo(monthlyCommitments(data).total, 1)
    const tr = rep.sections.find(x => x.id === 'trend')!; expect(tr.table!.rows).toHaveLength(12); expect(tr.table!.rows[11][0]).toBe('2026-10')
    const acc = rep.sections.find(x => x.id === 'accounts')!; expect(acc.table!.rows.every(r => Math.abs(+r[2] - +r[3] - +r[4]) < 0.01)).toBe(true)   // net = in − out
    const debts = rep.sections.find(x => x.id === 'debts')!; expect(debts.kpis[0].value).toBeCloseTo(debtTotals(data).balance, 1)
    const goals = rep.sections.find(x => x.id === 'goals')!; expect(goals.table!.rows.length).toBe(data.goals.filter(g => g.status === 'Active' || g.status === 'Reached').length)
    const rows = reportRows(rep); for (const sec of rep.sections) expect(rows.some(r => r[0] === sec.title.toUpperCase())).toBe(true)
  })
  it('planned-in-range pro-rates a budget line by the share of the period inside the range, and falls back to the default budget without periods', () => {
    const { data } = seed(); const p = data.periods.find(x => x.period_type === 'month' && x.start_date === '2026-10-01'); const line = p && data.lines.find(l => l.period_id === p.id && +l.planned > 0)
    if (p && line) { const full = plannedInRange(data, line.category_id, '2026-10-01', '2026-10-31'); expect(full).toBeCloseTo(+line.planned + +line.rollover_in, 1); expect(plannedInRange(data, line.category_id, '2026-10-01', '2026-10-15')).toBeCloseTo(full * 15 / 31, 1) }
    const c = data.categories.find(c => c.kind === 'expense' && c.default_budget > 0)!; expect(plannedInRange({ ...data, periods: [], lines: [] }, c.id, '2026-10-01', '2026-10-31')).toBeGreaterThan(0)
  })
  it('account flows: income and transfers in count as inflow, expenses and transfers out as outflow', () => {
    const { data } = seed(); const a = data.accounts.find(x => x.kind === 'checking')!; const f = accountFlows(data, a, '2026-10-01', '2026-10-31')
    const inflow = data.transactions.filter(t => t.status !== 'void' && !t.duplicate_of && t.date >= '2026-10-01' && t.date <= '2026-10-31' && ((t.kind === 'income' && t.account_id === a.id) || (t.kind === 'transfer' && t.to_account_id === a.id))).reduce((n, t) => n + t.amount, 0)
    expect(f.inflow).toBeCloseTo(inflow, 2); expect(f.net).toBeCloseTo(f.inflow - f.outflow, 2)
  })
})
describe('reports: change labels and net worth', () => {
  it('rates change in points; small or sign-flipping bases show dollars, not percent', () => {
    expect(changeText({ label: 'Savings rate', value: 0.264, fmt: 'pct', prev: 0.01 })).toBe('+25.4 pts')
    expect(changeText({ label: 'Net', value: 1929, fmt: 'money', prev: 56 })).toBe('+$1,873')
    expect(changeText({ label: 'Net', value: -200, fmt: 'money', prev: 300 })).toBe('−$500')
    expect(changeText({ label: 'Income', value: 7315, fmt: 'money', prev: 5010 })).toBe('+46%')
    expect(changeText({ label: 'Income', value: 10, fmt: 'money', prev: 10 })).toBe('no change')
  })
  it('net worth section: change = end − start, both from the same series', () => {
    const { data, household } = seed(); const rep = buildReport(data, { ...SETTINGS_DEFAULTS, ...household.settings }, 'month', '2026-10-01', ['networth'], T0)
    const [end, change] = rep.sections[0].kpis; expect(change.value).toBeCloseTo(end.value - end.prev!, 2)
  })
})

// ---------------- sinking funds (0.9.0) ----------------
import { plannedForPeriod, cadencePlan, sinkingFunds } from './sinking'
describe('sinking funds', () => {
  it('spreads monthly and yearly amounts over any period length', () => {
    const y = { default_budget: 1200, budget_cadence: 'yearly' as const }, m = { default_budget: 300, budget_cadence: 'monthly' as const }, p = { default_budget: 75, budget_cadence: 'period' as const }
    expect(plannedForPeriod(y, '2026-02-01', '2026-02-28')).toBe(100); expect(plannedForPeriod(m, '2026-02-01', '2026-02-28')).toBe(300)   // whole months: exactly 1/12 and the monthly amount
    expect(plannedForPeriod(y, '2026-10-02', '2026-10-15')).toBeCloseTo(1200 * 14 / 365, 2); expect(plannedForPeriod(m, '2026-10-02', '2026-10-15')).toBeCloseTo(300 * 14 / (365 / 12), 2)
    expect(plannedForPeriod(p, '2026-10-02', '2026-10-15')).toBe(75)
  })
  it('cadencePlan fixes stale lines and adds missing ones; per-period categories are left alone', () => {
    const { data } = seed(); const gifts = data.categories.find(c => c.name === 'Gifts & giving')!; const per = data.lines.filter(l => l.category_id === gifts.id)[0]; const period = data.periods.find(p => p.id === per.period_id)!
    expect(cadencePlan(data, period).updates).toHaveLength(0)
    const d2 = { ...data, categories: data.categories.map(c => c.id === gifts.id ? { ...c, default_budget: 2400 } : c) }; const plan = cadencePlan(d2, period)
    expect(plan.updates).toEqual([{ id: per.id, planned: 200 }]); expect(plan.updates.every(u => data.lines.find(l => l.id === u.id)!.category_id === gifts.id)).toBe(true)
  })
  it('year-to-date fund: accrued = yearly × share of year elapsed; balance = accrued − spent', () => {
    const { data, household } = seed(); const f = sinkingFunds(data, { ...SETTINGS_DEFAULTS, ...household.settings }, T0); const hm = f.find(x => x.cat.name === 'Home maintenance')!
    const share = (Date.parse(T0) - Date.parse('2026-01-01')) / 86400000 + 1; expect(hm.accrued).toBeCloseTo(1800 * share / 365, 1)
    expect(hm.balance).toBeCloseTo(hm.accrued - hm.spent, 2); expect(hm.spent).toBeCloseTo(136.42 + 189.39, 2)
  })
})

// ---------------- visuals (0.9.0) ----------------
import { treemap, spendingHeatmap } from './visuals'
describe('visuals', () => {
  it('treemap: areas proportional to values, tiles inside the box and non-overlapping', () => {
    const items = [{ key: 'a', label: 'A', value: 6 }, { key: 'b', label: 'B', value: 6 }, { key: 'c', label: 'C', value: 4 }, { key: 'd', label: 'D', value: 3 }, { key: 'e', label: 'E', value: 2 }, { key: 'f', label: 'F', value: 2 }, { key: 'g', label: 'G', value: 1 }, { key: 'z', label: 'Z', value: 0 }]
    const r = treemap(items, 600, 400); expect(r).toHaveLength(7)
    for (const x of r) { expect(x.w * x.h).toBeCloseTo(x.value / 24 * 600 * 400, -1); expect(x.x).toBeGreaterThanOrEqual(-0.01); expect(x.y).toBeGreaterThanOrEqual(-0.01); expect(x.x + x.w).toBeLessThanOrEqual(600.01); expect(x.y + x.h).toBeLessThanOrEqual(400.01) }
    for (const a of r) for (const b of r) if (a !== b) { const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); expect(ox <= 0.02 || oy <= 0.02).toBe(true) }
    expect(treemap([], 100, 100)).toEqual([])
  })
  it('heat map: Monday-start weeks, totals match the ledger, quartile levels', () => {
    const { data } = seed(); const h = spendingHeatmap(data, 8, T0); expect(h.cells[0].dow).toBe(0); expect(h.cells[h.cells.length - 1].date).toBe(T0)
    const start = h.cells[0].date; const total = data.transactions.filter(t => t.kind === 'expense' && t.status !== 'void' && t.date >= start && t.date <= T0).reduce((a, t) => a + t.amount, 0)
    expect(h.total).toBeCloseTo(total, 2); expect(h.cells.reduce((a, c) => a + c.amount, 0)).toBeCloseTo(total, 1); expect(h.cells.filter(c => c.amount === 0).every(c => c.level === 0)).toBe(true)
    expect(h.cells.filter(c => c.amount > 0 && c.amount === h.max).every(c => c.level === 4 || h.thresholds[2] === h.max)).toBe(true)
  })
})

// ---------------- split transactions (0.19.0) ----------------
import { categoryLines, validateSplits, splitRemaining, isSplit } from './splits'
import { round2 } from './money'
import { spentIn, uncategorized } from './budget'
describe('split transactions', () => {
  it('a split transaction counts each slice against its own category; an unsplit one counts whole', () => {
    const { data } = seed(); const t = data.transactions.find(x => x.kind === 'expense' && x.category_id && x.amount >= 20)!; const other = data.categories.find(c => c.kind === 'expense' && c.id !== t.category_id)!
    const before = spentIn(data, t.category_id!, t.date, t.date), beforeOther = spentIn(data, other.id, t.date, t.date)
    const d2 = { ...data, splits: [{ id: 's1', household_id: t.household_id, transaction_id: t.id, category_id: t.category_id, amount: round2(t.amount - 5), sort_order: 0 }, { id: 's2', household_id: t.household_id, transaction_id: t.id, category_id: other.id, amount: 5, sort_order: 1 }] } as typeof data
    expect(spentIn(d2, t.category_id!, t.date, t.date)).toBeCloseTo(before - 5, 2); expect(spentIn(d2, other.id, t.date, t.date)).toBeCloseTo(beforeOther + 5, 2)
    expect(isSplit(d2, t)).toBe(true); expect(categoryLines(d2, [t])).toHaveLength(2); expect(categoryLines(data, [t])).toHaveLength(1)
    const st = rangeStat(d2, t.date, t.date); expect(st.byCat[other.name]).toBeGreaterThanOrEqual(5)
  })
  it('a split with an uncategorized slice is not itself "uncategorized"; the slices must sum to the parent', () => {
    const { data } = seed(); const t = data.transactions.find(x => x.kind === 'expense' && x.amount >= 20)!
    const d2 = { ...data, splits: [{ id: 's1', household_id: t.household_id, transaction_id: t.id, category_id: null, amount: 1, sort_order: 0 }, { id: 's2', household_id: t.household_id, transaction_id: t.id, category_id: t.category_id, amount: round2(t.amount - 1), sort_order: 1 }] } as typeof data
    expect(uncategorized(d2, t.date, t.date).some(x => x.id === t.id)).toBe(false)
    expect(validateSplits(50, [{ amount: 20 }, { amount: 30 }])).toBeNull()
    expect(validateSplits(50, [{ amount: 20 }, { amount: 29.99 }])).toMatch(/add up to \$49\.99/)
    expect(validateSplits(50, [{ amount: 50 }])).toMatch(/at least two/)
    expect(validateSplits(50, [{ amount: 0 }, { amount: 50 }])).toMatch(/above zero/)
    expect(splitRemaining(50, [{ amount: 20 }])).toBe(30)
  })
})

// ---------------- safe to spend (0.19.0) ----------------
import { safeToSpend } from './forecast'
describe('safe to spend', () => {
  it('is cash minus commitments before the next paycheck minus the floor, never negative, with a per-day figure', () => {
    const { data, household } = seed(); const s = { ...SETTINGS_DEFAULTS, ...household.settings }
    const r = safeToSpend(data, s); expect(r.cash).toBeCloseTo(cashOnHand(data, s), 2); expect(r.committed).toBeGreaterThan(0)
    expect(r.safe).toBeCloseTo(Math.max(0, r.cash - r.committed - (+s.reserveFloor || 0)), 2); expect(r.perDay).toBeCloseTo(r.safe / r.days, 6); expect(r.days).toBeGreaterThan(0)
    expect(r.items.every(i => i.amt < 0 && i.src !== 'flex')).toBe(true)
    const broke = safeToSpend({ ...data, accounts: data.accounts.map(a => ({ ...a, balance: 0, bank_balance: null })) }, s); expect(broke.safe).toBe(0); expect(broke.short).toBeGreaterThan(0)
  })
})
