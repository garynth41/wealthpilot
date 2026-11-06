// 0.22.0 — planning depth: tax lots and loss harvesting, estimated tax in the calendar, insurance gaps, the estate checklist,
// zero-based and envelope budgets, inflation-grown goal targets.
import { describe, it, expect, beforeAll } from 'vitest'
import { setToday, addDays } from './dates'
import { longTermOn, lotView, lotSummary, holdingFromLots, harvestCandidates, isTaxableAccount } from './lots'
import { annualPremium, lifeNeed, coverageGaps, premiumBill, insuranceSummary } from './insurance'
import { templateRows, reviewDue, estateStatus, ESTATE_TEMPLATE } from './estate'
import { periodStat, assignment, moveMoney, coverFrom, envelopeCarry } from './budget'
import { goalTarget, goalProgress } from './goals'
import { estimatedTaxDue, ltcgRate, estimateTax } from './tax'
import { cashCalendar } from './forecast'
import { demoSeed } from '../app/data/demoSeed'
import { SETTINGS_DEFAULTS, type Data, type Goal, type Holding, type HoldingLot, type InsurancePolicy, type Settings, type EstateItem, type BudgetPeriod } from '../app/data/types'

const T0 = '2026-11-04'
beforeAll(() => setToday(T0))
const seed = () => { const s = demoSeed(); return { d: s.data, s: { ...SETTINGS_DEFAULTS, ...s.household.settings } as Settings } }
const lot = (o: Partial<HoldingLot>): HoldingLot => ({ id: 'l' + Math.random().toString(36).slice(2), household_id: 'h', holding_id: 'x', acquired_on: '2025-01-01', quantity: 1, cost: 100, ...o })
const pol = (o: Partial<InsurancePolicy>): InsurancePolicy => ({ id: 'p' + Math.random().toString(36).slice(2), household_id: 'h', kind: 'other', name: 'Policy', premium: 0, premium_frequency: 'monthly', through_employer: false, status: 'Active', sort_order: 1, ...o })

describe('tax lots', () => {
  it('a lot turns long-term the day after its first anniversary (leap day handled)', () => {
    expect(longTermOn('2025-03-10')).toBe('2026-03-11'); expect(longTermOn('2024-02-29')).toBe('2025-03-01')
    const h = { price: 50 } as Holding
    expect(lotView(h, lot({ acquired_on: '2025-11-04', quantity: 10, cost: 400 }), T0).term).toBe('short')   // exactly one year: still short-term
    const v = lotView(h, lot({ acquired_on: '2025-11-03', quantity: 10, cost: 400 }), T0); expect(v.term).toBe('long'); expect(v.gain).toBe(100); expect(v.gainPct).toBe(0.25)
  })
  it('the demo VTI lots split into a long-term gain and a short-term loss, and add up to the holding', () => {
    const { d } = seed(); const vti = d.holdings.find(h => h.symbol === 'VTI')!; const sm = lotSummary(d, vti, T0)
    expect(sm.lots).toHaveLength(2); expect(sm.mismatch).toBeNull(); expect(sm.quantity).toBe(22); expect(sm.cost).toBe(5100)
    expect(sm.longGain).toBeCloseTo(15 * 268.5 - 3000, 2); expect(sm.shortGain).toBeCloseTo(7 * 268.5 - 2100, 2); expect(sm.nextLongTerm?.lot.quantity).toBe(7)
    expect(lotSummary(d, { ...vti, quantity: 25 }, T0).mismatch).toEqual({ quantity: 3, cost: 0 })
    expect(holdingFromLots([{ quantity: 1.25, cost: 10 }, { quantity: 2.5, cost: 20.005 }])).toEqual({ quantity: 3.75, cost_basis: 30.01 })
  })
  it('harvesting: losing lots in taxable accounts, estimated saving at the right rate, retirement accounts skipped', () => {
    const { d } = seed(); const list = harvestCandidates(d, { ordinaryRate: 0.24, ltcgRate: 0.15, asOf: T0 })
    const v = list.find(x => x.holding.symbol === 'VTI')!; expect(v.byLot).toBe(true); expect(v.lots).toHaveLength(1)
    expect(v.loss).toBeCloseTo(2100 - 7 * 268.5, 2); expect(v.shortLoss).toBe(v.loss); expect(v.taxSaved).toBeCloseTo(v.loss * 0.24, 2); expect(v.wash).toBeNull()
    const k401 = d.accounts.find(a => a.name === 'Fidelity 401(k)')!; expect(isTaxableAccount(k401)).toBe(false)
    expect(list.some(x => x.holding.account_id === k401.id)).toBe(false)   // FFFHX is below cost but sits in the 401(k)
    expect(harvestCandidates(d, { minLoss: 1000, asOf: T0 }).some(x => x.holding.symbol === 'VTI')).toBe(false)
  })
  it('flags a wash sale when the same symbol was bought in the last 30 days, in any account', () => {
    const { d } = seed(); const vti = d.holdings.find(h => h.symbol === 'VTI')!; const k401 = d.accounts.find(a => a.name === 'Fidelity 401(k)')!
    const ira: Holding = { ...vti, id: 'ira-vti', account_id: k401.id, quantity: 1, cost_basis: 270 }; d.holdings.push(ira); d.lots.push(lot({ holding_id: 'ira-vti', acquired_on: addDays(T0, -10), quantity: 1, cost: 270 }))
    const v = harvestCandidates(d, { asOf: T0 }).find(x => x.holding.id === vti.id)!; expect(v.wash).toMatch(/wash sale/); expect(v.wash).toMatch(/Fidelity 401\(k\)/)
  })
})

describe('estimated tax in the cash calendar', () => {
  it('planned estimates spread over the deadlines left, on the deadline dates', () => {
    setToday('2026-08-01'); try {
      const { d, s } = seed(); const s2 = { ...s, tax: { ...s.tax, plannedEstimates: 1200 } } as Settings
      const e = estimateTax(d, s2, undefined, '2026-08-01'); const per = Math.round((600 + e.safeHarbor.quarterlyNeeded) * 100) / 100
      const due = estimatedTaxDue(d, s2, '2026-08-01', '2027-02-01', '2026-08-01'); expect(due.map(x => x.date)).toEqual(['2026-09-15', '2027-01-15']); expect(due[0].amount).toBeCloseTo(per, 2); expect(due[0].label).toMatch(/^Estimated tax · Q3 2026/)
      const cal = cashCalendar(d, s2, 60); const it = cal.items.find(x => x.src === 'tax')!; expect(it.date).toBe('2026-09-15'); expect(it.amt).toBeCloseTo(-per, 2)
      expect(estimatedTaxDue(d, { ...s2, taxInCalendar: false }, '2026-08-01', '2027-02-01', '2026-08-01')).toEqual([])
      expect(estimatedTaxDue(d, { ...s2, tax: undefined }, '2026-08-01', '2027-02-01', '2026-08-01')).toEqual([])
    } finally { setToday(T0) }
  })
  it('the long-term gains rate follows taxable income', () => {
    expect(ltcgRate({ year: 2026, status: 'single', taxableIncome: 40000 })).toBe(0); expect(ltcgRate({ year: 2026, status: 'single', taxableIncome: 120000 })).toBe(0.15); expect(ltcgRate({ year: 2026, status: 'mfj', taxableIncome: 900000 })).toBe(0.2)
  })
})

describe('insurance register', () => {
  it('annual premium by frequency, and the Bills row it becomes', () => {
    expect(annualPremium({ premium: 612, premium_frequency: 'semiannual' })).toBe(1224); expect(annualPremium({ premium: 28.5, premium_frequency: 'monthly' })).toBe(342)
    const b = premiumBill(pol({ name: 'Auto', carrier: 'Progressive', premium: 612, premium_frequency: 'semiannual', renews_on: '2027-01-18' }), 'chk', 'cat')
    expect(b).toMatchObject({ name: 'Auto premium', payee: 'Progressive', amount: 612, frequency: 'every_6_months', day_of_month: 18, next_due: '2027-01-18', account_id: 'chk', category_id: 'cat' })
  })
  it('life need = debts + 10 years of income − liquid savings, against coverage on file', () => {
    const { d } = seed(); const n = lifeNeed(d); expect(n.have).toBe(250000); expect(n.need).toBeCloseTo(Math.max(0, n.debts + n.income * 10 - n.liquid), 2); expect(n.gap).toBe(Math.max(0, Math.round((n.need - n.have) * 100) / 100))
  })
  it('gaps: renters and disability are missing in the demo, health and auto are covered, the life policy has a beneficiary', () => {
    const { d, s } = seed(); const keys = coverageGaps(d, s, T0).map(g => g.key)
    expect(keys).toEqual(expect.arrayContaining(['renters', 'disability'])); expect(keys).not.toContain('health'); expect(keys).not.toContain('auto'); expect(keys.some(k => k.startsWith('benef-'))).toBe(false)
    expect(keys.some(k => k.startsWith('renew-'))).toBe(true)   // the term policy renews in 40 days
    const noHealth = { ...d, insurance: d.insurance.filter(p => p.kind !== 'health') } as Data; expect(coverageGaps(noHealth, s, T0)[0]).toMatchObject({ key: 'health', severity: 'crit' })
    const noLife = { ...d, insurance: d.insurance.filter(p => p.kind !== 'term_life') } as Data
    expect(coverageGaps(noLife, { ...s, tax: { ...s.tax, dependentsUnder17: 2 } } as Settings, T0).find(g => g.key === 'life')?.severity).toBe('crit')
    const noBenef = { ...d, insurance: d.insurance.map(p => p.kind === 'term_life' ? { ...p, beneficiary: null } : p) } as Data; expect(coverageGaps(noBenef, s, T0).some(g => g.key.startsWith('benef-'))).toBe(true)
  })
  it('summary totals only active policies', () => {
    const { d, s } = seed(); d.insurance.push(pol({ status: 'Cancelled', premium: 999 })); const sm = insuranceSummary(d, s, T0)
    expect(sm.annual).toBe(186 * 12 + 342 + 1224); expect(sm.active).toHaveLength(3); expect(sm.renewals.map(p => p.name)).toEqual(['20-year term life'])
  })
})

describe('estate checklist', () => {
  it('the template adds a guardian line only with dependents, and never duplicates', () => {
    const { d } = seed(); expect(templateRows(d, 0).some(r => r.key === 'guardian')).toBe(false); expect(templateRows(d, 2).length).toBe(ESTATE_TEMPLATE.length)
    d.estate = templateRows(d, 0).map((r, i) => ({ id: 'e' + i, household_id: 'h', ...r } as EstateItem)); expect(templateRows(d, 0)).toEqual([]); expect(templateRows(d, 1).map(r => r.key)).toEqual(['guardian'])
  })
  it('a finished item is due for review three years after it was done, or on its own date', () => {
    expect(reviewDue({ status: 'done', done_on: '2023-01-10' } as EstateItem)).toBe(addDays('2023-01-10', 1096)); expect(reviewDue({ status: 'done', done_on: '2023-01-10', review_on: '2026-06-01' } as EstateItem)).toBe('2026-06-01'); expect(reviewDue({ status: 'todo' } as EstateItem)).toBeNull()
  })
  it('progress skips "not needed", lists overdue reviews and missing beneficiaries', () => {
    const { d } = seed(); d.estate = [{ id: 'a', household_id: 'h', label: 'Will', area: 'documents', status: 'done', done_on: '2022-05-01', sort_order: 1 }, { id: 'b', household_id: 'h', label: 'Trust', area: 'documents', status: 'na', sort_order: 2 }, { id: 'c', household_id: 'h', label: 'POA', area: 'documents', status: 'todo', sort_order: 3 }]
    const st = estateStatus(d, T0); expect(st.total).toBe(2); expect(st.done).toBe(1); expect(st.pct).toBe(0.5); expect(st.overdue.map(e => e.id)).toEqual(['a'])
    expect(st.accountGaps.map(a => a.name)).toEqual(['Schwab brokerage']); expect(st.staleBeneficiaries.map(a => a.name)).toEqual(['Fidelity 401(k)'])
  })
})

describe('zero-based and envelope budgets', () => {
  const setup = () => { const { d, s } = seed(); const p = d.periods.slice().sort((a, b) => b.start_date.localeCompare(a.start_date))[0]; return { d, s, p, ps: periodStat(d, s, p) } }
  it('to assign = expected income − planned spending', () => {
    const { ps } = setup(); const a = assignment(ps); expect(a.income).toBe(Math.round(Math.max(ps.incB, ps.expectedPay) * 100) / 100); expect(a.toAssign).toBeCloseTo(a.income - ps.lines.reduce((n, l) => n + l.planned, 0), 2)
    expect(assignment({ ...ps, incB: a.assigned, expectedPay: 0 }).state).toBe('good')
  })
  it('moving money never takes more than the source envelope has left', () => {
    const { ps } = setup(); const from = ps.lines.filter(l => l.left > 20).sort((a, b) => b.left - a.left)[0]; const to = ps.lines.find(l => l.cat.id !== from.cat.id)!
    const m = moveMoney(ps, from.cat.id, to.cat.id, 10); expect(m.moved).toBe(10); expect(m.patches).toEqual([{ lineId: from.lineId, category_id: from.cat.id, planned: Math.round((from.planned - 10) * 100) / 100 }, { lineId: to.lineId, category_id: to.cat.id, planned: Math.round((to.planned + 10) * 100) / 100 }])
    expect(moveMoney(ps, from.cat.id, to.cat.id, from.left + 500).moved).toBeCloseTo(from.left, 2); expect(moveMoney(ps, from.cat.id, from.cat.id, 5).moved).toBe(0)
  })
  it('an overspent envelope is covered from discretionary lines first', () => {
    const { ps } = setup(); const over = { ...ps.lines[0], left: -40 }; const lines = [over, ...ps.lines.slice(1)]; const c = coverFrom({ ...ps, lines }, over.cat.id)
    expect(c.short).toBe(40); expect(c.from).not.toBeNull(); expect(c.amount).toBe(Math.min(40, Math.round(c.from!.left * 100) / 100))
    const firstRank = lines.filter(l => l.cat.id !== over.cat.id && l.left > 0.005).some(l => l.cat.priority === 'Discretionary'); if (firstRank) expect(c.from!.cat.priority).toBe('Discretionary')
  })
  it('envelopes carry the whole balance — leftover and overspending — into the next period', () => {
    const { d, s, p } = setup(); const next: BudgetPeriod = { ...p, id: 'next', start_date: addDays(p.end_date, 1), end_date: addDays(p.end_date, 31), ref: null }
    d.periods.push(next); const prev = periodStat(d, s, p); const first = prev.lines[0]; d.lines.push({ id: 'nl', household_id: 'h', period_id: 'next', category_id: first.cat.id, planned: first.planned, rollover_in: 0 })
    const ch = envelopeCarry(d, s, p, next); const a = ch.find(c => c.category_id === first.cat.id)
    if (Math.abs(first.left) > 0.005) { expect(a).toEqual({ lineId: 'nl', category_id: first.cat.id, rollover_in: Math.round(first.left * 100) / 100 }) } else expect(a).toBeUndefined()
    const created = ch.filter(c => !c.lineId); for (const c of created) { expect(c.planned).toBe(0); expect(prev.lines.find(l => l.cat.id === c.category_id)!.left).toBeCloseTo(c.rollover_in, 2) }
  })
})

describe('inflation-grown goal targets', () => {
  const g = (o: Partial<Goal>): Goal => ({ id: 'g', household_id: 'h', name: 'College', kind: 'savings', target_amount: 10000, starting_amount: 0, monthly_contribution: 100, priority: 1, status: 'Active', sort_order: 1, ...o })
  it('grows from the base date to the target date; nothing without a rate; debt payoffs never grow', () => {
    expect(goalTarget(g({}), T0)).toBe(10000)
    expect(goalTarget(g({ inflation_pct: 3, target_base_date: '2026-01-01', target_date: '2036-01-01' }), T0)).toBeCloseTo(10000 * Math.pow(1.03, 3652 / 365.25), 0)
    expect(goalTarget(g({ inflation_pct: 3, target_base_date: '2025-11-04' }), T0)).toBeCloseTo(10300, -1)   // no date: grown to today
    expect(goalTarget(g({ kind: 'debt_payoff', inflation_pct: 5, target_date: '2030-01-01' }), T0)).toBe(10000)
  })
  it('progress and the demo trip use the grown target', () => {
    const { d } = seed(); const trip = d.goals.find(x => x.name === 'Spring break trip')!; const p = goalProgress(d, trip)
    expect(p.inflated).toBe(true); expect(p.target).toBeGreaterThan(2400); expect(p.target).toBeLessThan(2450); expect(p.left).toBeCloseTo(p.target - p.saved, 2)
  })
})
