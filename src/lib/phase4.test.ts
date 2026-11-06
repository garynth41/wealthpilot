// Phase 4 (0.20.0): promotional APRs, guaranteed retirement income, the unified plan, saved scenarios, market prices.
import { describe, it, expect, beforeAll } from 'vitest'
import { setToday } from './dates'
import { aprAt, hasPromo, promoMonthsLeft, payoffProjection, simulate, promoAlerts } from './debts'
import { guaranteedIncome, ssAnnual, ssStart, steadyGuaranteed, drawdown, projectRetirement, monteCarlo, RETIREMENT_DEFAULTS } from './retirement'
import { buildPlan, normalizePlan, applyPlanPatches, affordableExtra, PLAN_DEFAULTS } from './plan'
import { normalize, metrics, compare, scenariosOf, sameAssumptions } from './scenarios'
import { normSymbol, quoteSymbol, isAutoPriced, parseYahooChart, planPriceUpdates, symbolsToFetch, priceFreshness, nyDate, yahooUrl } from './prices'
import { demoSeed } from '../app/data/demoSeed'
import type { Account, RetirementInputs, Scenario } from '../app/data/types'
import pricesSource from './prices.ts?raw'
import pricesCopy from '../../supabase/functions/price-feed/prices.ts?raw'

const T0 = '2026-11-04'
beforeAll(() => setToday(T0))
const card = (o: Partial<Account>): Account => ({ id: 'c' + Math.random(), household_id: 'h', name: 'Card', kind: 'credit_card', balance: 3000, apr: 24, minimum_payment: 60, planned_payment: 200, autopay: false, include_in_cash: false, include_in_net_worth: true, status: 'Active', sort_order: 1, ...o })

describe('promotional APRs', () => {
  const promo = card({ apr: 24.99, promo_apr: 0, promo_until: '2027-02-28' })
  it('applies the promo rate through its end month, then the standard rate', () => {
    expect(aprAt(promo, 0)).toBe(0); expect(aprAt(promo, 3)).toBe(0)   // Nov, Dec, Jan, Feb
    expect(aprAt(promo, 4)).toBe(24.99)                                  // March
    expect(aprAt(card({ apr: 19 }), 5)).toBe(19)
  })
  it('counts the months left and knows when a promo is over', () => {
    expect(promoMonthsLeft(promo)).toBe(4); expect(hasPromo(promo)).toBe(true)
    expect(hasPromo(card({ promo_apr: 0, promo_until: '2026-10-31' }))).toBe(false); expect(promoMonthsLeft(card({}))).toBe(0)
  })
  it('the payoff projection charges no interest while the promo runs', () => {
    const p = payoffProjection(1000, m => aprAt(promo, m), 250); expect(p.months).toBe(4); expect(p.interest).toBe(0)
    const q = payoffProjection(3000, m => aprAt(promo, m), 250); expect(q.interest).toBeGreaterThan(0)
  })
  it('the portfolio simulation re-ranks avalanche when a promo ends', () => {
    const a = card({ id: 'promo', balance: 3000, apr: 29.99, promo_apr: 0, promo_until: '2027-01-31', planned_payment: 100 })
    const b = card({ id: 'std', balance: 3000, apr: 18, planned_payment: 100 })
    const withPromo = simulate([a, b], 200, 'avalanche'); const noPromo = simulate([{ ...a, promo_apr: null, promo_until: null }, b], 200, 'avalanche')
    expect(withPromo.interest).toBeLessThan(noPromo.interest)
  })
  it('warns with the balance left when the rate steps up and the payment that would clear it', () => {
    const al = promoAlerts([card({ balance: 2400, apr: 24.99, promo_apr: 0, promo_until: '2027-02-28', planned_payment: 200 })])
    expect(al).toHaveLength(1); expect(al[0].monthsLeft).toBe(4); expect(al[0].balanceAtEnd).toBe(1600); expect(al[0].payToClear).toBe(600); expect(al[0].clearsInTime).toBe(false)
    expect(al[0].interestAfterPerMonth).toBeCloseTo(1600 * 24.99 / 1200, 1)
    expect(promoAlerts([card({ balance: 400, promo_apr: 0, promo_until: '2027-02-28', planned_payment: 200 })])[0].clearsInTime).toBe(true)
  })
})

describe('guaranteed retirement income', () => {
  const base: RetirementInputs = { ...RETIREMENT_DEFAULTS, currentAge: 45, retireAge: 62, lifeExpectancy: 92, desiredIncome: 70000, socialSecurity: 0, ssMonthly: 2500, ssStartAge: 67, ssHaircut: 0, pensions: [{ id: 'p', name: 'State pension', monthly: 1000, startAge: 62, cola: true }] }
  it('Social Security from the SSA monthly figure at its claiming age', () => {
    expect(ssAnnual(base)).toBe(30000); expect(ssStart(base)).toBe(67)
    expect(guaranteedIncome(base, 62)).toBe(12000); expect(guaranteedIncome(base, 67)).toBe(42000)
  })
  it('the haircut scenario pays 75% of the benefit', () => { expect(guaranteedIncome(base, 70, 0.25)).toBe(22500 + 12000) })
  it('a pension without COLA loses purchasing power', () => { const i = { ...base, ssMonthly: 0, pensions: [{ id: 'p', name: 'x', monthly: 1000, startAge: 62, cola: false }] }; expect(guaranteedIncome(i, 72)).toBeLessThan(guaranteedIncome(i, 62)); expect(guaranteedIncome(i, 72)).toBeCloseTo(12000 / Math.pow(1.025, 10), 0) })
  it('legacy annual field still works', () => { const i = { ...RETIREMENT_DEFAULTS, socialSecurity: 24000 }; expect(ssAnnual(i)).toBe(24000) })
  it('bridge years before Social Security raise what the portfolio must hold', () => {
    const early = projectRetirement(500000, base); const late = projectRetirement(500000, { ...base, ssStartAge: 62 })
    expect(early.needed).toBeGreaterThan(late.needed); expect(early.bridgeYears).toBe(5); expect(early.guaranteed).toBe(42000)
  })
  it('the haircut changes readiness materially', () => {
    const rich = { ...base, desiredIncome: 110000, annualContribution: 6000 }; const full = projectRetirement(100000, rich), cut = projectRetirement(100000, { ...rich, ssHaircut: 0.25 }); expect(cut.readiness).toBeLessThan(full.readiness)
    expect(steadyGuaranteed(base, 0.25)).toBe(34500)
  })
  it('drawdown: the portfolio funds the gap year by year and reports when it runs out', () => {
    const dd = drawdown(300000, base); expect(dd.path[0].draw).toBe(58000); expect(dd.path[5].draw).toBe(28000); expect(dd.bridgeYears).toBe(5)
    const tiny = drawdown(50000, base); expect(tiny.depletionAge).not.toBeNull()
  })
  it('Monte Carlo withdraws less once guaranteed income starts', () => {
    const a = monteCarlo(400000, base, 300, 7), b = monteCarlo(400000, { ...base, ssMonthly: 0, pensions: [] }, 300, 7); expect(a.successRate).toBeGreaterThanOrEqual(b.successRate)
  })
})

describe('the unified plan', () => {
  const { data, household } = demoSeed(); const s = household.settings
  it('normalises bad input', () => { const a = normalizePlan({ extra: -5, months: 999, mode: 'nope' as never, cutPct: 500 }); expect(a.extra).toBe(0); expect(a.months).toBe(120); expect(a.mode).toBe('debt_first'); expect(a.cutPct).toBe(90) })
  it('with no extra and nothing rolled on, nothing is allocated', () => { const r = buildPlan(data, s, { rollFreed: false }); expect(r.totals.debtExtra + r.totals.goalExtra + r.totals.retireExtra).toBe(0); expect(r.months).toHaveLength(PLAN_DEFAULTS.months) })
  it('extra to debt first: debt-free sooner, less interest, nothing to goals while debt remains', () => {
    const base = buildPlan(data, s), more = buildPlan(data, s, { extra: 400, mode: 'debt_first' })
    expect(more.debtFreeMonth!).toBeLessThan(base.debtFreeMonth ?? 999); expect(more.interest).toBeLessThan(base.interest)
    expect(more.now.debt).toBe(400); expect(Object.keys(more.now.goals)).toHaveLength(0); expect(more.now.focus).not.toBeNull()
  })
  it('the extra is allocated once: every dollar lands in exactly one bucket', () => {
    const r = buildPlan(data, s, { extra: 300, mode: 'split', split: { debt: 50, goals: 25, retirement: 25 } })
    for (const m of r.months) expect(m.debtExtra + m.goalExtra + m.retireExtra + m.toCash).toBeGreaterThanOrEqual(300 - 0.02)
    expect(r.now.debt + Object.values(r.now.goals).reduce((a, b) => a + b, 0) + r.now.retirement + r.now.cash).toBeCloseTo(300, 1)
  })
  it('goals first reaches goals sooner than debt first', () => {
    const g = buildPlan(data, s, { extra: 300, mode: 'goals_first' }), dfst = buildPlan(data, s, { extra: 300, mode: 'debt_first' })
    const firstReached = (r: typeof g) => r.goals.map(x => x.reachedOn || '9999').sort()[0]
    expect(firstReached(g) <= firstReached(dfst)).toBe(true)
  })
  it('freed payments roll on after the last debt when asked to', () => {
    const roll = buildPlan(data, s, { extra: 600, months: 60, rollFreed: true, mode: 'debt_first' }), keep = buildPlan(data, s, { extra: 600, months: 60, rollFreed: false, mode: 'debt_first' })
    expect(roll.totals.goalExtra + roll.totals.retireExtra).toBeGreaterThan(keep.totals.goalExtra + keep.totals.retireExtra)
  })
  it('affordable extra: the largest amount that keeps cash above the floor, and no more', () => {
    const rich = { ...s, reserveFloor: 0 }; const d2 = { ...data, paySchedules: data.paySchedules.map(p => ({ ...p, net_amount: p.net_amount * 1.6 })) }
    const af = affordableExtra(d2, rich, { mode: 'debt_first' }); expect(af.baselineBreaches).toBe(false); expect(af.max).toBeGreaterThan(0); expect(af.max % 25).toBe(0)
    expect(buildPlan(d2, rich, { extra: af.max }).low.cash).toBeGreaterThanOrEqual(-0.5); expect(buildPlan(d2, rich, { extra: af.max + 50 }).low.cash).toBeLessThan(0)
    const tight = affordableExtra(data, { ...s, reserveFloor: 1e7 }); expect(tight.baselineBreaches).toBe(true); expect(tight.max).toBe(0)
  })
  it('apply replaces, it does not add', () => {
    const r = buildPlan(data, s, { extra: 300, mode: 'goals_first' }); const p1 = applyPlanPatches(data, s, r)
    expect(p1.goals.length).toBeGreaterThan(0)
    // pretend the patches were written, then apply the same plan again: no further change
    const d2 = { ...data, goals: data.goals.map(g => { const x = p1.goals.find(y => y.id === g.id); return x ? { ...g, monthly_contribution: x.to } : g }) }
    const s2 = { ...s, plan: p1.plan, retirement: { ...RETIREMENT_DEFAULTS, ...(s.retirement || {}), annualContribution: p1.retirement.to } }
    const p2 = applyPlanPatches(d2, s2, buildPlan(data, s, { extra: 300, mode: 'goals_first' })); expect(p2.goals).toHaveLength(0); expect(p2.retirement.to).toBe(p1.retirement.to)
  })
})

describe('saved scenarios', () => {
  const { data, household } = demoSeed(); const s = household.settings
  it('normalises each kind', () => {
    expect(normalize('forecast', { cutPct: 200, incomeEndsOn: 'x' })).toEqual({ cutPct: 90, leanOnly: false, extraIncome: 0, incomeEndsOn: null })
    expect(normalize('debt', { strategy: 'snowball', extra: '150' })).toEqual({ extra: 150, strategy: 'snowball' })
    expect(normalize('retirement', { retireAge: 300 }).retireAge).toBe(100)
  })
  it('metrics move the right way and compare marks the winner', () => {
    const a = metrics('debt', data, s, { extra: 0, strategy: 'avalanche' }), b = metrics('debt', data, s, { extra: 500, strategy: 'avalanche' })
    const rows = compare([a, b]); const interest = rows.find(r => r.k === 'interest')!; expect(interest.cells[1].best).toBe(true); expect(interest.cells[0].best).toBe(false)
    expect(rows.find(r => r.k === 'date')!.cells.every(c => !c.best)).toBe(true)   // no direction → never marked
  })
  it('forecast, retirement and plan metrics compute', () => {
    expect(metrics('forecast', data, s, { cutPct: 20 }).length).toBe(4)
    expect(metrics('retirement', data, s, {}).find(m => m.k === 'ready')!.v).toBeGreaterThanOrEqual(0)
    expect(metrics('plan', data, s, { extra: 200 }).find(m => m.k === 'goals')).toBeTruthy()
  })
  it('lists pinned first and recognises unchanged sliders', () => {
    const sc = (o: Partial<Scenario>): Scenario => ({ id: 'x' + Math.random(), household_id: 'h', name: 'A', kind: 'debt', assumptions: {}, pinned: false, sort_order: 0, ...o })
    const d2 = { ...data, scenarios: [sc({ name: 'Zed', pinned: true }), sc({ name: 'Alpha' }), sc({ name: 'Other', kind: 'forecast' })] }
    expect(scenariosOf(d2, 'debt').map(x => x.name)).toEqual(['Zed', 'Alpha'])
    expect(sameAssumptions('debt', { extra: 100 }, { extra: '100', strategy: 'avalanche' })).toBe(true); expect(sameAssumptions('debt', { extra: 100 }, { extra: 50 })).toBe(false)
  })
})

describe('market prices', () => {
  it('symbols', () => {
    expect(normSymbol(' vti ')).toBe('VTI'); expect(normSymbol('')).toBeNull(); expect(normSymbol('no way!')).toBeNull()
    expect(quoteSymbol('btc', 'crypto')).toBe('BTC-USD'); expect(quoteSymbol('BRK.B', 'stock')).toBe('BRK-B'); expect(quoteSymbol('ETH-USD', 'crypto')).toBe('ETH-USD')
    expect(isAutoPriced({ id: 'a', symbol: 'VTI', price: 1 })).toBe(true); expect(isAutoPriced({ id: 'a', symbol: 'VTI', price: 1, price_source: 'manual' })).toBe(false); expect(isAutoPriced({ id: 'a', symbol: null, price: 1 })).toBe(false)
  })
  it('parses a Yahoo chart payload; two hosts', () => {
    const y = parseYahooChart('VTI', { chart: { result: [{ meta: { regularMarketPrice: 301.234567, regularMarketTime: 1793912400, currency: 'USD' } }] } })
    expect(y).toMatchObject({ price: 301.2346, source: 'yahoo' }); expect(y!.date).toBe(nyDate(1793912400))
    expect(parseYahooChart('X', { chart: { result: null, error: { code: 'Not Found' } } })).toBeNull()
    expect(parseYahooChart('Y', { chart: { result: [{ meta: {}, timestamp: [1793826000, 1793912400], indicators: { quote: [{ close: [100, null] }] } }] } })).toMatchObject({ price: 100 })
    expect(yahooUrl('BRK-B')).toMatch(/^https:\/\/query1\.finance\.yahoo\.com\/v8\/finance\/chart\/BRK-B\?/); expect(yahooUrl('VTI', 2)).toMatch(/^https:\/\/query2\./)
  })
  it('plans updates forward in time only, and only for auto-priced holdings', () => {
    const hs = [{ id: '1', symbol: 'VTI', price: 290, price_as_of: '2026-11-01' }, { id: '2', symbol: 'VTI', price: 300, price_as_of: '2026-11-06' }, { id: '3', symbol: 'AAPL', price: 200, price_source: 'manual' as const }, { id: '4', symbol: 'btc', asset_class: 'crypto', price: 60000, price_as_of: '2026-11-04' }]
    const q = { VTI: { symbol: 'VTI', price: 301.2, date: '2026-11-04', source: 'yahoo' as const }, 'BTC-USD': { symbol: 'BTC-USD', price: 60000, date: '2026-11-04', source: 'yahoo' as const } }
    const p = planPriceUpdates(hs, q); expect(p.map(x => x.id)).toEqual(['1']); expect(p[0]).toMatchObject({ price: 301.2, price_as_of: '2026-11-04', from: 290 })
    expect(symbolsToFetch(hs)).toEqual(['BTC-USD', 'VTI'])
  })
  it('freshness bands', () => { expect(priceFreshness({ price_as_of: '2026-11-02' }, T0)).toBe('fresh'); expect(priceFreshness({ price_as_of: '2026-10-20' }, T0)).toBe('stale'); expect(priceFreshness({ price_as_of: null }, T0)).toBe('old') })
  it('the price-feed function carries an identical copy of the rules', () => {
    expect(pricesCopy).toBe(pricesSource)
  })
})

import { describeDevice } from './devices'
describe('device labels', () => {
  it('names common browsers and systems', () => {
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')).toMatchObject({ label: 'Safari on iPhone', icon: '📱' })
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0').label).toBe('Edge on Windows')
    expect(describeDevice('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36')).toMatchObject({ label: 'Chrome on Android', icon: '📱' })
    expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7; rv:132.0) Gecko/20100101 Firefox/132.0').label).toBe('Firefox on Mac')
    expect(describeDevice(null).label).toBe('Unknown device')
  })
})
