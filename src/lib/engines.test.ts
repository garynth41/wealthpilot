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
