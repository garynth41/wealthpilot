// 0.39.0 — the paycheck breakdown feeding the tax estimate, contributions against the limits, after-tax retirement, tax moves, and the target mix.
import { describe, it, expect, beforeAll } from 'vitest'
import { setToday } from './dates'
import { setPrivacy } from './display'
import { metrics } from './scenarios'
import { plannerRun } from './retirementTax'
import { buildPlan, applyPlanPatches } from './plan'
import { emptyData, SETTINGS_DEFAULTS, type Account, type Data, type Holding, type PaySchedule, type PayStub, type Settings, type Transaction } from '../app/data/types'
import { stubYear, matchOf, takeHome, ficaOf, hasStub } from './paycheck'
import { estimateTax, mergedItems, resolveProfile, tableFor } from './tax'
import { contribLimits, rmdDivisor, rmdStartAge } from './taxTables'
import { inferAcctType, limitsFor, contributions, yearlyContributions, resolveRetirement, bucketsNow, plannerAuto, effectiveInputs } from './contrib'
import { afterTaxPlan, retirementTax, retTaxCtx } from './retirementTax'
import { drawdown, projectRetirement, monteCarlo, wanted, RETIREMENT_DEFAULTS } from './retirement'
import { taxMoves } from './taxMoves'
import { groupOf, mixOf, mixAsTarget, driftOf, contributionPlan, impliedReturn, ruleOfThumb, targetOf, performance } from './allocation'

beforeAll(() => setToday('2026-11-22'))
const PS = (over: Partial<PaySchedule> = {}): PaySchedule => ({ id: 'ps1', household_id: 'h', name: 'Paycheck', kind: 'salary', frequency: 'biweekly', anchor_date: '2026-01-09', gross_amount: 4000, net_amount: 2800, status: 'Active', ...over }) as PaySchedule
const STUB: PayStub = { k401: 400, sec125: 150, fed: 450, state: 110, local: 100 }
const A = (id: string, name: string, kind: Account['kind'], balance: number): Account => ({ id, household_id: 'h', name, kind, balance, apr: 0, minimum_payment: 0, autopay: false, include_in_cash: false, include_in_net_worth: true, status: 'Active', sort_order: 1 }) as Account
const D = (over: Partial<Data> = {}): Data => ({ ...emptyData(), paySchedules: [PS()], ...over })
const S = (over: Partial<Settings> = {}): Settings => ({ ...SETTINGS_DEFAULTS, tax: { year: 2026, filingStatus: 'single', state: 'OH', localRate: 2.5, schoolDistrictRate: 0 }, payStubs: { ps1: STUB }, ...over })

describe('paycheck breakdown', () => {
  it('counts what has been taken so far and what is still to come from the paydays', () => {
    const y = stubYear(PS(), STUB, 2026, '2026-11-22')
    expect(y.paid).toBe(23); expect(y.left).toBe(3); expect(y.paid + y.left).toBe(26)   // biweekly from Jan 9: 26 paydays in 2026
    expect(y.by.fed).toEqual({ perCheck: 450, ytd: 10350, rest: 1350, total: 11700 }); expect(y.by.k401.total).toBe(10400); expect(y.gross.total).toBe(104000)
  })
  it('uses the year-to-date figures from a pay stub up to its date, then this paycheck\'s amounts', () => {
    const y = stubYear(PS(), { ...STUB, ytd: { asOf: '2026-10-30', fed: 9000, gross: 90000 } }, 2026, '2026-11-22')
    expect(y.fromYtd).toBe(true); expect(y.by.fed.ytd).toBe(9000 + 450 * 1)   // one payday (Nov 13) since the Oct 30 stub
    expect(y.by.k401.ytd).toBe(400 * 23)   // no year-to-date figure given for this line: paychecks so far
    expect(y.gross.ytd).toBe(90000 + 4000)
    expect(stubYear(PS(), { ...STUB, ytd: { asOf: '2025-12-19', fed: 9000 } }, 2026, '2026-11-22').fromYtd).toBe(false)   // last year's stub does not apply
  })
  it('stops 401(k) money at the yearly limit, as payroll does', () => {
    const y = stubYear(PS(), { k401: 1200 }, 2026, '2026-11-22', { limits: { deferral: 24500 } })
    expect(y.by.k401).toMatchObject({ ytd: 24500, rest: 0, total: 24500 }); expect(y.capped.deferral).toBe(true)   // 23 × 1,200 is worked out, so it cannot have passed the limit
    const typed = stubYear(PS(), { k401: 1200, ytd: { asOf: '2026-11-13', k401: 26000 } }, 2026, '2026-11-22', { limits: { deferral: 24500 } }); expect(typed.by.k401).toMatchObject({ ytd: 26000, rest: 0 })   // a figure typed from a pay stub is left as it is
    // the match follows: paychecks that can take no more 401(k) money earn no match
    const m = stubYear(PS(), { k401: 400, matchPct: 100, matchUpToPct: 5, ytd: { asOf: '2026-11-13', k401: 24500 } }, 2026, '2026-11-22', { limits: { deferral: 24500 } }); expect(m.by.k401.rest).toBe(0); expect(m.match.rest).toBe(0); expect(m.match.ytd).toBe(200 * 23)
    expect(stubYear(PS(), { k401: 400, matchPct: 100, matchUpToPct: 5 }, 2026, '2026-11-22', { limits: { deferral: 24500 } }).match).toMatchObject({ ytd: 4600, rest: 600 })
    const z = stubYear(PS(), { k401: 1000 }, 2026, '2026-11-22', { limits: { deferral: 24500 } }); expect(z.by.k401.ytd).toBe(23000); expect(z.by.k401.rest).toBe(1500); expect(z.by.k401.total).toBe(24500)
  })
  it('works out the employer match and what is left uncollected', () => {
    expect(matchOf(PS(), { k401: 100, matchPct: 50, matchUpToPct: 6 })).toEqual({ perCheck: 50, full: 120, missed: 70, neededPct: 6 })
    expect(matchOf(PS(), { k401: 200, roth401k: 100, matchPct: 100, matchUpToPct: 4 })).toEqual({ perCheck: 160, full: 160, missed: 0, neededPct: 4 })
    expect(matchOf(PS(), { k401: 200 }).perCheck).toBe(0)
  })
  it('checks the breakdown against net pay', () => {
    const T = tableFor(2026); expect(ficaOf(PS(), STUB, T).total).toBe(294.52)   // 7.65% of 4,000 − 150
    const t = takeHome(PS(), STUB, T); expect(t.computed).toBe(2495.48); expect(t.unexplained).toBe(-304.52)
    expect(hasStub({})).toBe(false); expect(hasStub(STUB)).toBe(true)
  })
})

describe('the tax estimate follows the paycheck', () => {
  it('takes pre-tax deductions off income and counts tax withheld, so far and to come', () => {
    const e = estimateTax(D(), S(), undefined, '2026-11-22'), bare = estimateTax(D(), S({ payStubs: {} }), undefined, '2026-11-22')
    expect(bare.pretax).toBe(0); expect(bare.paid.total).toBe(0); expect(bare.due).toBe(bare.federal.total)
    expect(e.pretax).toBe((400 + 150) * 26); expect(e.agi).toBe(104000 - 14300)
    expect(e.paid.withheld).toBe(450 * 23); expect(e.paid.projectedWithholding).toBe(450 * 3); expect(e.paid.total).toBe(11700)
    expect(e.federal.total).toBeLessThan(bare.federal.total); expect(e.due).toBeLessThan(bare.due)
  })
  it('compares state and city tax with what was withheld, and leaves cafeteria benefits out of city wages', () => {
    const e = estimateTax(D(), S(), undefined, '2026-11-22')
    expect(e.state.paid).toBe(110 * 26); expect(e.state.due > 0 || e.state.refund > 0).toBe(true); expect(round(e.state.refund - e.state.due)).toBe(round(e.state.paid - e.state.tax))
    expect(e.local.municipal).toBe(round((104000 - 150 * 26) * 0.025)); expect(e.local.paid).toBe(2600); expect(e.local.refund).toBe(round(2600 - e.local.total))
    expect(e.allDue).toBe(round(e.due + e.state.due + e.local.due)); expect(e.allRefund).toBe(round(e.refund + e.state.refund + e.local.refund))
  })
  it('the "paychecks left" what-if moves what is still to come', () => {
    const e = estimateTax(D(), S(), { paychecksLeft: 1 }, '2026-11-22'); expect(e.paid.projectedWithholding).toBe(450); expect(e.pretax).toBe(550 * 24)
  })
  it('a typed withholding row is still projected for a job with no breakdown, and never for one that has it', () => {
    const typed = { tax: { year: 2026, filingStatus: 'single' as const, state: 'OH', items: [{ id: 'm1', kind: 'withholding' as const, label: 'W-2 box 2 so far', amount: 2300, source: 'manual' as const }] } }
    expect(estimateTax(D(), S({ ...typed, payStubs: {} }), undefined, '2026-11-22').paid.projectedWithholding).toBe(300)   // 2,300 ÷ 23 × 3
    const both = estimateTax(D(), S(typed), undefined, '2026-11-22'); expect(both.paid.withheld).toBe(2300 + 10350); expect(both.paid.projectedWithholding).toBe(1350)
  })
  it('lists the rows with what is so far and what is to come', () => {
    const s = S(); const rows = mergedItems(D(), resolveProfile(D(), s, undefined, '2026-11-22'), s, '2026-11-22')
    expect(rows.map(r => r.id)).toEqual(['auto-pay-ps1', 'auto-k401-ps1', 'auto-sec125-ps1', 'auto-fed-ps1', 'auto-state-ps1', 'auto-local-ps1'])
    expect(rows.find(r => r.id === 'auto-fed-ps1')).toMatchObject({ kind: 'withholding', amount: 10350, rest: 1350, note: '$10,350 so far · $1,350 still to come over 3 paychecks' })
  })
  it('Ohio does not tax Social Security benefits', () => {
    const items = [{ id: 'a', kind: 'retirement_income' as const, label: '', amount: 60000, source: 'manual' as const }, { id: 'b', kind: 'social_security' as const, label: '', amount: 30000, source: 'manual' as const }]
    const e = estimateTax(emptyData(), { ...SETTINGS_DEFAULTS, tax: { year: 2026, filingStatus: 'single', state: 'OH', items, autoAggregate: false } }, undefined, '2026-11-22')
    expect(e.income.taxableSS).toBeGreaterThan(0); expect(e.state.taxable).toBe(round(e.agi - e.income.taxableSS - 2150))   // Ohio income of 60,000: the $2,150 exemption
  })
})
const round = (n: number) => Math.round(n * 100) / 100

describe('contributions and limits', () => {
  it('reads an account\'s tax type from its name and kind', () => {
    const t = (name: string, kind: Account['kind'] = 'retirement') => inferAcctType({ name, kind, institution: null })
    expect([t('Fidelity 401(k)'), t('Roth 401k'), t('Roth IRA'), t('Rollover IRA'), t('HSA Bank', 'investment'), t('Schwab brokerage', 'investment'), t('Pension plan'), t('TSP'), t('College 529', 'investment')]).toEqual(['k401', 'roth401k', 'rothIra', 'ira', 'hsa', 'taxable', 'k401', 'k401', 'other'])
  })
  it('adds the catch-up a person\'s age allows', () => {
    expect(contribLimits(2026)).toMatchObject({ deferral: 24500, catchUp50: 8000, catchUp60to63: 11250, ira: 7500, iraCatchUp50: 1100, hsaSelf: 4400, hsaFamily: 8750 }); expect(contribLimits(2030).year).toBe(2027); expect(contribLimits(2020).year).toBe(2025)
    const at = (age: number, cov?: 'family') => limitsFor({ retirement: { ...RETIREMENT_DEFAULTS, currentAge: age }, invest: cov ? { hsaCoverage: cov } : undefined }, 2026, '2026-11-22')
    expect([at(40).deferral, at(52).deferral, at(61).deferral, at(64).deferral]).toEqual([24500, 32500, 35750, 32500]); expect([at(40).ira, at(50).ira]).toEqual([7500, 8600]); expect([at(40).hsa, at(56).hsa, at(56, 'family').hsa]).toEqual([4400, 5400, 9750])
    expect(limitsFor({}, 2026, '2026-11-22')).toMatchObject({ age: null, deferral: 24500 })   // no planner saved: no age, no catch-up
  })
  it('tracks this year against each limit and the match', () => {
    const d = D({ accounts: [A('k', 'Fidelity 401(k)', 'retirement', 50000), A('r', 'Roth IRA', 'retirement', 10000), A('c', 'Checking', 'checking', 5000)], transactions: [{ id: 't1', household_id: 'h', date: '2026-03-02', kind: 'transfer', amount: 3000, account_id: 'c', to_account_id: 'r', status: 'cleared', source: 'manual' } as Transaction] })
    const c = contributions(d, S({ payStubs: { ps1: { ...STUB, matchPct: 50, matchUpToPct: 12 } } }), 2026, '2026-11-22')
    const dl = c.lines.find(l => l.key === 'deferral')!; expect(dl).toMatchObject({ ytd: 9200, rest: 1200, total: 10400, limit: 24500, room: 14100, over: 0 })
    expect(c.lines.find(l => l.key === 'ira')).toMatchObject({ ytd: 3000, limit: 7500, room: 4500 })
    expect(c.match).toMatchObject({ ytd: 4600, total: 5200, missedPerCheck: 40, missedRest: 120, neededPct: 12, hasFormula: true })
    expect(c.byAccount).toEqual({ k: { own: 9200, employer: 4600 }, r: { own: 3000, employer: 0 } })
  })
  it('each person has their own workplace-plan limit', () => {
    const two = D({ paySchedules: [PS(), PS({ id: 'ps2', name: 'Partner pay' })] }), mk = (partner: boolean) => S({ payStubs: { ps1: { k401: 900 }, ps2: { k401: 900, ...(partner ? { partner: true } : {}) } } })
    const one = contributions(two, mk(false), 2026, '2026-11-22'); expect(one.lines.find(l => l.key === 'deferral')).toMatchObject({ ytd: 41400, rest: 2700, room: 0, over: 19600 }); expect(one.lines.find(l => l.key === 'deferral2')!.show).toBe(false)   // one person, two jobs: one limit — each payroll kept going, so the year is over it, and the second job gets no more room
    const both = contributions(two, mk(true), 2026, '2026-11-22'); expect(both.lines.find(l => l.key === 'deferral')).toMatchObject({ ytd: 20700, rest: 2700, limit: 24500, room: 1100 }); expect(both.lines.find(l => l.key === 'deferral2')).toMatchObject({ show: true, ytd: 20700, rest: 2700, limit: 24500 })
    expect(yearlyContributions(two, mk(true), '2026-11-22').pretax).toBe(46800); expect(yearlyContributions(two, mk(false), '2026-11-22').pretax).toBe(24500)
  })
  it('a rollover is not a contribution, and payroll money sent to a left-out account is not the planner\'s', () => {
    const T = (id: string, from: string, to: string, amount: number) => ({ id, household_id: 'h', date: '2026-03-02', kind: 'transfer', amount, account_id: from, to_account_id: to, status: 'cleared', source: 'manual' }) as Transaction
    const accounts = [A('k', 'Old 401(k)', 'retirement', 0), A('r', 'Rollover IRA', 'retirement', 50000), A('b', 'Schwab brokerage', 'investment', 1000), A('c', 'Checking', 'checking', 5000)]
    const d = D({ accounts, transactions: [T('t1', 'k', 'r', 50000), T('t2', 'c', 'r', 2000), T('t3', 'b', 'r', 500)] })
    const c = contributions(d, S(), 2026, '2026-11-22'); expect(c.lines.find(l => l.key === 'ira')).toMatchObject({ ytd: 2500, room: 5000, over: 0 }); expect(c.byAccount.r).toEqual({ own: 2500, employer: 0 })   // from checking and the brokerage; the 50,000 rolled over is neither
    const out = D({ accounts: [{ ...A('k', 'Fidelity 401(k)', 'retirement', 50000), excluded: true }, A('b', 'Schwab brokerage', 'investment', 1000)] })
    expect(yearlyContributions(out, S({ payStubs: { ps1: { ...STUB, k401Account: 'k' } } }), '2026-11-22').total).toBe(0); expect(yearlyContributions(out, S(), '2026-11-22').total).toBe(10400)   // not mapped anywhere: still counted
  })
  it('the planner follows the paychecks and transfers, and a typed number comes back when that is switched off', () => {
    const d = D({ accounts: [A('k', 'Fidelity 401(k)', 'retirement', 50000)] }), s = S({ payStubs: { ps1: { ...STUB, matchPct: 100, matchUpToPct: 5 } }, retirement: { ...RETIREMENT_DEFAULTS, annualContribution: 1234 } })
    expect(yearlyContributions(d, s, '2026-11-22')).toMatchObject({ pretax: (400 + 200) * 26, roth: 0, total: 15600, match: 5200 })
    const r = resolveRetirement(d, s, '2026-11-22'); expect(r.annualContribution).toBe(15600); expect(r.currentIncome).toBe(104000)
    expect(resolveRetirement(d, { ...s, plan: { assumptions: {}, appliedAt: '', debtExtra: 0, goalExtra: {}, retireExtra: 100 } }, '2026-11-22').annualContribution).toBe(16800)
    const off = resolveRetirement(d, { ...s, retirement: { ...s.retirement!, autoContribution: false, autoIncome: false } }, '2026-11-22'); expect(off.annualContribution).toBe(1234); expect(off.currentIncome).toBe(RETIREMENT_DEFAULTS.currentIncome)
    expect(resolveRetirement(D({ paySchedules: [] }), S({ payStubs: {}, retirement: { ...RETIREMENT_DEFAULTS, annualContribution: 1234 } })).annualContribution).toBe(1234)   // nothing found: the typed number stands
  })
})

describe('retirement income after tax', () => {
  const i = { ...RETIREMENT_DEFAULTS, currentAge: 40, retireAge: 65, lifeExpectancy: 92, desiredIncome: 60000, ssMonthly: 2000, ssStartAge: 67, annualContribution: 12000 }
  const ctx = retTaxCtx({ tax: { filingStatus: 'single', state: 'OH' } }, 0.5, '2026-11-22')
  it('pre-tax money is taxed on the way out and Roth money is not', () => {
    expect(retirementTax(ctx, { ordinary: 80000, ss: 0, gains: 0, age: 66, calendarYear: 2052 }).total).toBeGreaterThan(8000)
    expect(retirementTax(ctx, { ordinary: 0, ss: 24000, gains: 0, age: 70, calendarYear: 2056 }).total).toBe(0)
    const pre = afterTaxPlan(i, { pretax: 300000, roth: 0, taxable: 0 }, { pretax: 12000, roth: 0, taxable: 0 }, ctx), roth = afterTaxPlan(i, { pretax: 0, roth: 300000, taxable: 0 }, { pretax: 0, roth: 12000, taxable: 0 }, ctx)
    expect(pre.atRetirement.total).toBe(roth.atRetirement.total); expect(pre.atRetirement.total).toBe(projectRetirement(300000, i).real)
    expect(pre.lifetimeTax).toBeGreaterThan(100000); expect(roth.lifetimeTax).toBe(0); expect(roth.years.every(y => y.fromPretax === 0 && y.tax === 0)).toBe(true)
    expect(Object.values(pre.taxByAge).reduce((a, b) => a + b, 0)).toBeCloseTo(pre.lifetimeTax, 0)
  })
  it('every year leaves the income wanted after tax, until the money runs out', () => {
    const p = afterTaxPlan(i, { pretax: 200000, roth: 50000, taxable: 50000 }, { pretax: 9000, roth: 3000, taxable: 0 }, ctx)
    for (const y of p.years.filter(y => y.short === 0)) expect(y.ss + y.pension + y.fromPretax + y.fromRoth + y.fromTaxable - y.tax).toBeGreaterThanOrEqual(i.desiredIncome - 2)
    const first = p.years[0]; expect(first.fromTaxable).toBeGreaterThan(0)   // taxable first
    if (p.depletionAge != null) expect(p.years.find(y => y.age === p.depletionAge)!.short).toBeGreaterThan(0)
  })
  it('the planner\'s pooled balance follows the same path once it carries the tax', () => {
    const p = afterTaxPlan(i, { pretax: 400000, roth: 100000, taxable: 0 }, { pretax: 12000, roth: 0, taxable: 0 }, ctx), dd = drawdown(p.atRetirement.total, { ...i, taxByAge: p.taxByAge })
    for (const y of p.years.filter(y => y.short === 0)) expect(Math.abs(dd.path.find(x => x.age === y.age)!.balance - y.balance.total)).toBeLessThan(60)
    expect(dd.depletionAge).toBe(p.depletionAge)
    expect(wanted({ ...i, taxByAge: p.taxByAge }, 65)).toBe(60000 + p.taxByAge[65]); expect(wanted(i, 65)).toBe(60000); expect(wanted({ ...i, taxByAge: p.taxByAge }, 120)).toBe(60000 + p.taxByAge[91])
    expect(projectRetirement(500000, { ...i, taxByAge: p.taxByAge }).needed).toBeGreaterThan(projectRetirement(500000, i).needed)
    expect(monteCarlo(500000, { ...i, taxByAge: p.taxByAge }, 200, 7).successRate).toBeLessThanOrEqual(monteCarlo(500000, i, 200, 7).successRate)
  })
  it('required distributions start at 75 for someone born in 1960 or later, 73 before', () => {
    expect([rmdStartAge(1986), rmdStartAge(1960), rmdStartAge(1959), rmdStartAge(1951), rmdStartAge(1950)]).toEqual([75, 75, 73, 73, 72]); expect([rmdDivisor(73), rmdDivisor(75), rmdDivisor(90), rmdDivisor(106), rmdDivisor(110), rmdDivisor(119), rmdDivisor(125)]).toEqual([26.5, 24.6, 12.2, 4.3, 3.5, 2.3, 2.0])
    const rich = afterTaxPlan({ ...i, desiredIncome: 40000 }, { pretax: 1500000, roth: 0, taxable: 0 }, { pretax: 12000, roth: 0, taxable: 0 }, ctx)
    expect(rich.rmdAge).toBe(75); expect(rich.firstRmd!.age).toBe(75); const y75 = rich.years.find(y => y.age === 75)!; expect(y75.rmd).toBeGreaterThan(100000); expect(y75.balance.taxable).toBeGreaterThan(0)   // the part not needed is reinvested
    expect(rich.conversion).toMatchObject({ age: 65 }); expect(rich.conversion!.room).toBeGreaterThan(1000)
    expect(afterTaxPlan({ ...i, currentAge: 70, retireAge: 71, lifeExpectancy: 90 }, { pretax: 500000, roth: 0, taxable: 0 }, { pretax: 0, roth: 0, taxable: 0 }, ctx).rmdAge).toBe(73)
  })
  it('the planner, saved scenarios and the Plan run on the same inputs', () => {
    const d = D({ accounts: [A('k', 'Fidelity 401(k)', 'retirement', 300000)] }), s = S({ payStubs: { ps1: { ...STUB, matchPct: 100, matchUpToPct: 5 } }, retirement: { ...i, desiredIncome: 150000, annualContribution: 1234 } })
    const run = plannerRun(s.retirement!, d, s, 300000, '2026-11-22'); expect(run.inputs.annualContribution).toBe(15600); expect(run.plan).not.toBeNull(); expect(Object.keys(run.inputs.taxByAge!).length).toBe(27)
    expect(plannerRun(s.retirement!, d, s, 300000, '2026-11-22')).toBe(run)   // kept: the Plan asks many times
    const ready = metrics('retirement', d, s, s.retirement).find(m => m.k === 'ready')!.v; expect(ready).toBe(projectRetirement(300000, run.inputs).readiness); expect(ready).toBeLessThan(projectRetirement(300000, { ...run.inputs, taxByAge: undefined }).readiness)
    expect(plannerRun({ ...s.retirement!, countTaxes: false }, d, s, 300000, '2026-11-22')).toMatchObject({ plan: null }); expect(plannerRun({ ...s.retirement!, countTaxes: false }, d, s, 300000, '2026-11-22').inputs.taxByAge).toBeUndefined()
    const r = buildPlan(d, s), p = applyPlanPatches(d, s, r); expect(p.retirement.from).toBe(15600)   // the Apply dialog starts from the contribution the plan simulated, not the typed 1,234
  })
  it('today\'s money is sorted by how it will be taxed', () => {
    const d = D({ accounts: [A('k', 'Fidelity 401(k)', 'retirement', 50000), A('r', 'Roth IRA', 'retirement', 10000), A('b', 'Schwab brokerage', 'investment', 20000), A('h', 'HSA', 'investment', 5000)],
      holdings: [{ id: 'h1', household_id: 'h', account_id: 'b', name: 'VTI', asset_class: 'etf', risk: 'medium', quantity: 100, price: 200, cost_basis: 12000, sort_order: 1 } as Holding] })
    expect(bucketsNow(d, S())).toEqual({ pretax: 50000, roth: 15000, taxable: 20000, total: 85000, gainShare: 0.4 })
    expect(bucketsNow(d, S({ invest: { acctType: { k: 'roth401k' } } })).roth).toBe(65000)
  })
})

describe('tax moves', () => {
  const d = D({ accounts: [A('k', 'Fidelity 401(k)', 'retirement', 50000)] }), s = S({ payStubs: { ps1: { ...STUB, matchPct: 50, matchUpToPct: 12 } }, retirement: { ...RETIREMENT_DEFAULTS, currentAge: 40 } })
  it('prices each move by running the estimate with and without it', () => {
    const m = taxMoves(d, s, undefined, '2026-11-22'), e = estimateTax(d, s, undefined, '2026-11-22')
    const k = m.moves.find(x => x.id === 'k401')!; expect(k.kind).toBe('save'); expect(k.title).toContain('$10,800')   // the 3 paychecks left carry 12,000 gross, less the 1,200 already going in
    const w = estimateTax(d, s, { items: [{ id: 'x', kind: 'pretax_deduction', label: '', amount: 10800, source: 'manual' }] }, '2026-11-22'); expect(k.amount).toBe(round(e.totalTax - w.totalTax)); expect(k.amount).toBeGreaterThan(2000)
    expect(m.moves.find(x => x.id === 'match')).toMatchObject({ kind: 'free', amount: 120 }); expect(m.moves[0].id).toBe('match')   // free money first
    expect(m.moves.find(x => x.id === 'ira')!.amount).toBeGreaterThan(1000); expect(m.together).toBeGreaterThanOrEqual(k.amount)
  })
  it('the amounts in a move follow privacy mode', () => {
    setPrivacy(true); try { const m = taxMoves(d, s, undefined, '2026-11-22').moves.find(x => x.id === 'k401')!; expect(m.title).not.toMatch(/\d{2},\d{3}/); expect(mergedItems(d, resolveProfile(d, s, undefined, '2026-11-22'), s, '2026-11-22').find(r => r.id === 'auto-fed-ps1')!.note).not.toMatch(/10,350/) } finally { setPrivacy(false) }
  })
  it('asks for the paycheck breakdown when there is none, and offers nothing for a year that is over', () => {
    expect(taxMoves(D(), S({ payStubs: {} }), undefined, '2026-11-22').moves.map(x => x.id)).toContain('breakdown')
    expect(taxMoves(d, s, { year: 2025 }, '2026-11-22').moves).toEqual([])
  })
})

describe('target mix, drift and performance', () => {
  const H = (id: string, asset_class: Holding['asset_class'], value: number, sector?: string): Holding => ({ id, household_id: 'h', name: id, asset_class, sector, risk: 'medium', quantity: 1, price: value, cost_basis: value, sort_order: 1 }) as Holding
  const hs = [H('a', 'etf', 70000), H('b', 'bond', 20000), H('c', 'cash', 5000), H('d', 'mutual_fund', 5000, 'Fixed income')]
  it('sorts holdings into groups and measures drift from the target', () => {
    expect(hs.map(groupOf)).toEqual(['stocks', 'bonds', 'cash', 'bonds']); const m = mixOf(hs); expect(m.total).toBe(100000); expect(m.pct.stocks).toBe(0.7)
    expect(mixAsTarget(m.pct)).toEqual({ stocks: 70, bonds: 25, cash: 5, real_estate: 0, other: 0 }); expect(ruleOfThumb(40)).toEqual({ stocks: 70, bonds: 25, cash: 5, real_estate: 0, other: 0 }); expect(ruleOfThumb(95).stocks).toBe(20)
    const dr = driftOf(hs, { stocks: 60, bonds: 35, cash: 5, real_estate: 0, other: 0 }); expect(dr.drifted).toBe(true); expect(dr.maxDiff).toBe(10); expect(dr.sell.map(r => [r.group, r.amount])).toEqual([['stocks', 10000]]); expect(dr.buy.map(r => [r.group, r.amount])).toEqual([['bonds', -10000]])
    expect(contributionPlan(dr, 12000)).toEqual({ split: [{ group: 'bonds', share: 1, perMonth: 1000 }], months: 16 });   // 10,000 short, but the new money grows the total: 10,000 ÷ (1 − 35%) = 15,385
    expect(contributionPlan(driftOf([H('x', 'etf', 6000), H('y', 'bond', 4000)], { stocks: 50, bonds: 50, cash: 0, real_estate: 0, other: 0 }), 12000).months).toBe(2); expect(driftOf(hs, mixAsTarget(m.pct)).drifted).toBe(false)
    expect(targetOf({ targets: { stocks: 60, bonds: 30 } })).toBeNull(); expect(targetOf({ targets: { stocks: 60, bonds: 40 } })).toMatchObject({ stocks: 60, bonds: 40, cash: 0 })
  })
  it('works out the return and swing a mix implies', () => {
    const r = impliedReturn(mixOf(hs).pct)!; expect(r.ret).toBeCloseTo(0.7 * 0.07 + 0.25 * 0.04 + 0.05 * 0.03, 4); expect(r.vol).toBeGreaterThan(0.11); expect(r.vol).toBeLessThan(0.13)
    expect(impliedReturn(mixOf([]).pct)).toBeNull(); expect(impliedReturn({ stocks: 1, bonds: 0, cash: 0, real_estate: 0, other: 0 })).toEqual({ ret: 0.07, vol: 0.16 })
    const d = D({ holdings: hs }), s = S({ retirement: { ...RETIREMENT_DEFAULTS, followMix: true } }); const a = plannerAuto(s.retirement!, d, s, '2026-11-22'); expect(a.mix).toBe(true); expect(effectiveInputs(s.retirement!, a).expectedReturn).toBe(r.ret)
    expect(plannerAuto({ ...RETIREMENT_DEFAULTS }, d, s, '2026-11-22').mix).toBe(false)   // only when asked
  })
  it('separates what was put in from what the investments earned', () => {
    const bal = (as_of: string, balance: number) => ({ id: as_of, household_id: 'h', account_id: 'k', as_of, balance, bank_balance: null, source: 'value' as const })
    const d = D({ paySchedules: [], accounts: [A('k', 'Fidelity 401(k)', 'retirement', 11300), A('c', 'Checking', 'checking', 0)], balances: [bal('2026-08-31', 10000), bal('2026-09-30', 10700), bal('2026-10-31', 11000), bal('2026-11-20', 11300)],
      transactions: [{ id: 't', household_id: 'h', date: '2026-09-15', kind: 'transfer', amount: 500, account_id: 'c', to_account_id: 'k', status: 'cleared', source: 'manual' } as Transaction] })
    const p = performance(d, {}, '2026-11-22'); expect(p.points.map(x => [x.month, x.value, x.flow, x.growth])).toEqual([['2026-09', 10700, 500, 200], ['2026-10', 11000, 0, 300], ['2026-11', 11300, 0, 300]])
    expect(p.contributed).toBe(500); expect(p.earned).toBe(800); expect(p.points[0].ret).toBeCloseTo(200 / 10250, 6); expect(p.sinceStart).toBeCloseTo((1 + 200 / 10250) * (1 + 300 / 10700) * (1 + 300 / 11000) - 1, 6); expect(p.annualized).toBeNull()
    expect(performance(D(), {}, '2026-11-22').points).toEqual([])
    // payroll money into an account that is not followed (no balance history) is not taken off the followed accounts' growth
    const b2 = (as_of: string, balance: number) => ({ id: 'b' + as_of, household_id: 'h', account_id: 'b', as_of, balance, bank_balance: null, source: 'value' as const })
    const pay = D({ accounts: [A('k', 'Fidelity 401(k)', 'retirement', 0), A('b', 'Schwab brokerage', 'investment', 5000)], balances: [b2('2026-08-31', 5000), b2('2026-11-20', 5000)] })
    const flat = performance(pay, { payStubs: { ps1: { k401: 400 } } }, '2026-11-22', a => (a.id === 'k' ? 'k401' : 'taxable')); expect(flat.contributed).toBe(0); expect(flat.earned).toBe(0)
  })
})
