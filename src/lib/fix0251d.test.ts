// 0.25.1 fixes (batch d), from the calculation audit: a job that starts during the year (3), the 2025–2028 senior deduction (10), a past tax
// year's own tables (14), Monte Carlo balances that went negative and ran a year late against the drawdown (7), and the Social Security claiming age (11).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
// the Investments page draws Plotly charts and watches sizes and media queries; jsdom has none of these, so Plotly is mocked here and
// ResizeObserver / matchMedia are stubbed inside the page test below
vi.mock('plotly.js-basic-dist-min', () => ({ default: { react: () => {}, newPlot: () => {}, purge: () => {} } }))
import { setToday } from './dates'
import { emptyData, SETTINGS_DEFAULTS, type Account, type Data, type PaySchedule, type RetirementInputs, type Settings } from '../app/data/types'
import { autoItems, estimateTax, estimatedTaxDue, paychecksRemaining, tableFor, underpaymentPenalty, type TaxItem, type TaxProfile } from './tax'
import { FEDERAL, TAX_YEARS, underpaymentRateOn } from './taxTables'
import { round2 } from './money'
import { payDates } from './paySchedule'
import { cashCalendar } from './forecast'
import { buildReport } from './reports'
import { monteCarlo, drawdown, projectRetirement, guaranteedIncome, safeWithdrawal, ssClaimFactor, ssClaimShare, ssMonthlyAtClaim, ssStart, ssBirthYear, fullRetirementAge, fullRetirementAgeFor, RETIREMENT_DEFAULTS } from './retirement'
import { MemoryRepo } from '../app/data/memoryRepo'
import { demoSeed } from '../app/data/demoSeed'
import { useStore } from '../app/store'
import { ModalHost } from '../components/ui'
import { InvestmentsPage } from '../pages/Investments'

const TODAY = '2026-11-06'
beforeAll(() => setToday(TODAY))
afterAll(() => setToday(null))

const TI = (kind: TaxItem['kind'], amount: number): TaxItem => ({ id: kind + amount, kind, label: kind, amount, source: 'manual' })
const pay = (o: Partial<PaySchedule>): PaySchedule => ({ id: 'p-' + (o.name || 'job'), household_id: 'h', name: 'New job', kind: 'salary', frequency: 'biweekly', anchor_date: '2026-09-04', net_amount: 2400, status: 'Active', ...o })
const checking: Account = { id: 'a-chk', household_id: 'h', name: 'Checking', kind: 'checking', balance: 4000, apr: 0, minimum_payment: 0, autopay: false, include_in_cash: true, include_in_net_worth: true, status: 'Active', sort_order: 0 } as Account
const withData = (o: Partial<Data>): Data => ({ ...emptyData(), ...o })
const taxSettings = (tax: Partial<TaxProfile>): Settings => ({ ...SETTINGS_DEFAULTS, tax: { year: 2026, filingStatus: 'single', state: 'NONE', autoAggregate: true, items: [], ...tax } })
const manual = (p: Partial<TaxProfile>) => estimateTax(emptyData(), SETTINGS_DEFAULTS, { year: 2026, state: 'NONE', autoAggregate: false, ...p }, TODAY)

// ---------------- 3: a job that starts (or ends) during the year ----------------
describe('a job that starts during the year counts only its own paychecks (3)', () => {
  // $3,000 gross every two weeks from Sept 1 2026 (first payday Fri Sept 4), single, $1,250 federal tax withheld on the five paychecks so far
  const job = pay({ starts_on: '2026-09-01', gross_amount: 3000 })
  const d = withData({ accounts: [checking], paySchedules: [job] })
  const s = taxSettings({ items: [TI('withholding', 1250)] })

  it('W-2 wages are gross × the pay dates inside the tax year — the same dates Income & Pay Periods shows', () => {
    const dates = payDates(job, '2026-01-01', '2026-12-31')
    expect(dates).toEqual(['2026-09-04', '2026-09-18', '2026-10-02', '2026-10-16', '2026-10-30', '2026-11-13', '2026-11-27', '2026-12-11', '2026-12-25'])
    const w2 = autoItems(d, 2026).filter(i => i.kind === 'w2')
    expect(w2).toHaveLength(1); expect(w2[0].amount).toBe(27000); expect(w2[0].label).toMatch(/gross × 9 paychecks in 2026/)
    expect(autoItems(d, 2025).filter(i => i.kind === 'w2')).toEqual([])   // the job did not exist in 2025
  })
  it('tax, withholding and the refund come from those nine paychecks', () => {
    const e = estimateTax(d, s, undefined, TODAY)
    expect(e.income.w2).toBe(27000); expect(e.taxableIncome).toBe(27000 - 16100)
    expect(e.federal.total).toBeCloseTo(1090, 2)                          // 10% of $10,900
    expect(e.paychecksLeft).toBe(4)                                        // Nov 13, Nov 27, Dec 11, Dec 25
    expect(e.paid.projectedWithholding).toBeCloseTo(1000, 2)              // $1,250 over 5 paychecks = $250 each, for the 4 still to come
    expect(e.paid.withheld + e.paid.projectedWithholding).toBeCloseTo(2250, 2)
    expect(e.refund).toBeCloseTo(1160, 2); expect(e.due).toBe(0); expect(e.safeHarbor.met).toBe(true)
  })
  it('no phantom estimated payment lands in the cash calendar', () => {
    expect(estimatedTaxDue(d, s, TODAY, '2027-02-28', TODAY)).toEqual([])
    expect(cashCalendar(d, s, 90).items.filter(x => x.src === 'tax')).toEqual([])
  })
  it('a job change: the old job counts up to its last payday, the new one from its start, and withholding is paced over both', () => {
    // old job listed first, still Active but with its last payday in Ends; a second old job set to Ended with a last payday; one Ended with no Ends (unknown: not counted)
    const old = pay({ id: 'p-old', name: 'Old job', anchor_date: '2026-01-09', ends_on: '2026-08-28', gross_amount: 2500 })
    const ended = pay({ id: 'p-ended', name: 'Weekend job', kind: 'hourly', frequency: 'monthly', anchor_date: '2026-01-31', ends_on: '2026-04-30', gross_amount: 500, status: 'Ended' })
    const unknown = pay({ id: 'p-unknown', name: 'Gone', gross_amount: 9999, status: 'Ended' })
    const dd = withData({ paySchedules: [old, ended, unknown, job] })
    const rows = Object.fromEntries(autoItems(dd, 2026).filter(i => i.kind === 'w2').map(i => [i.id, i.amount]))
    expect(rows).toEqual({ 'auto-pay-p-old': 17 * 2500, 'auto-pay-p-ended': 4 * 500, 'auto-pay-p-job': 27000 })   // Jan 9 … Aug 21 = 17 paydays; Jan–Apr = 4
    expect(paychecksRemaining(dd, 2026, TODAY)).toBe(4)                   // the job still paying, not the first one listed
    const e = estimateTax(dd, taxSettings({ items: [TI('withholding', 6500)] }), undefined, TODAY)
    expect(e.paychecksLeft).toBe(4); expect(e.income.w2).toBe(42500 + 2000 + 27000)
    expect(e.paid.projectedWithholding).toBeCloseTo(6500 / (17 + 4 + 5) * 4, 2)   // per paycheck paid so far this year, for the 4 left
  })
})

// ---------------- 10: the 2025–2028 senior deduction ----------------
describe('the 2025–2028 senior deduction (10)', () => {
  it('married filing jointly, both 65+, $40k Social Security and $70k IRA withdrawals: taxable $56,500, tax $6,284', () => {
    const e = manual({ filingStatus: 'mfj', age65: 2, items: [TI('social_security', 40000), TI('retirement_income', 70000)] })
    expect(e.agi).toBe(104000); expect(e.deduction).toBe(32200 + 2 * 1650)
    expect(e.seniorDeduction).toBe(12000); expect(e.taxableIncome).toBe(56500)
    expect(e.federal.total).toBeCloseTo(24800 * 0.10 + (56500 - 24800) * 0.12, 2)   // 6,284
    expect(e.federal.total).toBeCloseTo(6284, 2)
  })
  it('each $6,000 shrinks by 6% of income over $75,000 ($150,000 joint) and is gone at $175,000 ($250,000 joint)', () => {
    expect(manual({ filingStatus: 'single', age65: 1, items: [TI('w2', 100000)] }).seniorDeduction).toBe(6000 - 0.06 * 25000)   // 4,500
    expect(manual({ filingStatus: 'single', age65: 1, items: [TI('w2', 75000)] }).seniorDeduction).toBe(6000)
    expect(manual({ filingStatus: 'single', age65: 1, items: [TI('w2', 175000)] }).seniorDeduction).toBe(0)
    expect(manual({ filingStatus: 'mfj', age65: 2, items: [TI('w2', 200000)] }).seniorDeduction).toBe(2 * (6000 - 0.06 * 50000))   // 6,000
    expect(manual({ filingStatus: 'mfj', age65: 1, items: [TI('w2', 200000)] }).seniorDeduction).toBe(3000)
    expect(manual({ filingStatus: 'mfj', age65: 2, items: [TI('w2', 250000)] }).seniorDeduction).toBe(0)
    const single = manual({ filingStatus: 'single', age65: 1, items: [TI('w2', 100000)] }); expect(single.taxableIncome).toBe(100000 - (16100 + 2050) - 4500)
  })
  it('itemizers get it too; married filing separately does not; only the filer and spouse count; 2025 has it as well', () => {
    const item = manual({ filingStatus: 'single', age65: 1, items: [TI('w2', 60000), TI('itemized', 30000)] })
    expect(item.deduction).toBe(30000); expect(item.seniorDeduction).toBe(6000); expect(item.taxableIncome).toBe(24000)
    expect(manual({ filingStatus: 'mfs', age65: 1, items: [TI('w2', 60000)] }).seniorDeduction).toBe(0)
    expect(manual({ filingStatus: 'single', age65: 0, items: [TI('w2', 60000)] }).seniorDeduction).toBe(0)
    expect(manual({ filingStatus: 'mfj', age65: 3, items: [TI('w2', 60000)] }).seniorDeduction).toBe(12000)   // dependents never count
    expect(manual({ filingStatus: 'hoh', age65: 2, items: [TI('w2', 60000)] }).seniorDeduction).toBe(6000)
    const y25 = manual({ year: 2025, filingStatus: 'single', age65: 1, items: [TI('w2', 50000)] })
    expect(y25.seniorDeduction).toBe(6000); expect(y25.taxableIncome).toBe(50000 - (15750 + 2000) - 6000)
  })
})

// ---------------- 14: a past year's own tables ----------------
describe('a past tax year uses its own tables, and a year without one says so (14)', () => {
  it('2025 federal figures (Rev. Proc. 2024-40 as amended by the One Big Beautiful Bill Act)', () => {
    expect(TAX_YEARS).toEqual([2025, 2026]); const T = FEDERAL[2025]
    expect(T.standardDeduction).toEqual({ single: 15750, mfj: 31500, mfs: 15750, hoh: 23625 })
    expect(T.additionalDeduction65).toEqual({ single: 2000, mfj: 1600, mfs: 1600, hoh: 2000 })
    expect(T.brackets.single.map(b => b.upTo)).toEqual([11925, 48475, 103350, 197300, 250525, 626350, null])
    expect(T.brackets.mfj.map(b => b.upTo)).toEqual([23850, 96950, 206700, 394600, 501050, 751600, null])
    expect(T.brackets.mfs.map(b => b.upTo)).toEqual([11925, 48475, 103350, 197300, 250525, 375800, null])
    expect(T.brackets.hoh.map(b => b.upTo)).toEqual([17000, 64850, 103350, 197300, 250500, 626350, null])
    expect(T.brackets.single.map(b => b.rate)).toEqual([0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37])
    expect(T.ltcg).toEqual({ single: { zeroUpTo: 48350, fifteenUpTo: 533400 }, mfj: { zeroUpTo: 96700, fifteenUpTo: 600050 }, mfs: { zeroUpTo: 48350, fifteenUpTo: 300000 }, hoh: { zeroUpTo: 64750, fifteenUpTo: 566700 } })
    expect(T.childTaxCredit).toBe(2200); expect(T.ctcPhaseoutStart).toEqual({ single: 200000, mfj: 400000, mfs: 200000, hoh: 200000 }); expect(T.ssWageBase).toBe(176100)
    expect(T.niitThreshold).toEqual({ single: 200000, mfj: 250000, mfs: 125000, hoh: 200000 }); expect(T.additionalMedicareThreshold).toEqual(T.niitThreshold)
    expect(T.calendar.filter(c => c.kind === 'estimate').map(c => c.date)).toEqual(['2025-04-15', '2025-06-16', '2025-09-15', '2026-01-15'])
  })
  it('a 2025 estimate uses the 2025 standard deduction, brackets and wage base', () => {
    const e = manual({ year: 2025, filingStatus: 'single', items: [TI('w2', 60000)] })
    expect(e.tableYear).toBe(2025); expect(e.standard).toBe(15750); expect(e.taxableIncome).toBe(44250)
    expect(e.federal.total).toBeCloseTo(11925 * 0.10 + (44250 - 11925) * 0.12, 2)   // 5,071.50
    const se = manual({ year: 2025, filingStatus: 'single', items: [TI('business', 300000)] }); expect(se.federal.se).toBeCloseTo(176100 * 0.124 + 300000 * 0.9235 * 0.029, 0)
  })
  it('a year with no table uses the nearest one, and the report says so in plain words', () => {
    expect(tableFor(2024).year).toBe(2025); expect(tableFor(2031).year).toBe(2026); expect(tableFor(2025).year).toBe(2025)
    const s = taxSettings({ autoAggregate: false, items: [TI('w2', 60000)] })
    const r25 = buildReport(emptyData(), s, 'year', '2025-06-01', ['tax'], TODAY).sections[0]
    expect(r25.title).toBe('Tax estimate 2025'); expect(r25.table!.rows).toContainEqual(['Taxable income', 44250]); expect(r25.notes.join(' ')).not.toMatch(/tax tables/)
    const r24 = buildReport(emptyData(), s, 'year', '2024-06-01', ['tax'], TODAY).sections[0]
    expect(r24.title).toBe('Tax estimate 2024 (with 2025 tax rules)')
    expect(r24.notes[0]).toBe('No 2024 tax tables are built in, so this uses the 2025 tax brackets, standard deduction, credits and limits. Treat it as a rough guide for 2024.')
    const e24 = estimateTax(emptyData(), s, { year: 2024 }, TODAY); expect(e24.year).toBe(2024); expect(e24.tableYear).toBe(2025)
  })
})

// ---------------- 7: Monte Carlo ----------------
describe('the Monte Carlo floors balances at $0 and, with no volatility, matches the year-by-year drawdown (7)', () => {
  // 62 and retired, Social Security $2,500 a month at 67 claimed at 70, 5% return, 2.5% inflation, $600,000
  const retired: RetirementInputs = { ...RETIREMENT_DEFAULTS, currentAge: 62, retireAge: 62, lifeExpectancy: 92, annualContribution: 0, expectedReturn: 0.05, inflation: 0.025, returnStdDev: 0, desiredIncome: 60000, socialSecurity: 0, ssMonthly: 2500, ssStartAge: 70, ssHaircut: 0, pensions: [] }
  /** With zero volatility every run is the same path: the band at age a + 1 is the balance after the year of age a (what drawdown reports at a). */
  const sameAsDrawdown = (balance: number, i: RetirementInputs, atRet: number) => {
    const dd = drawdown(atRet, i); const mc = monteCarlo(balance, i, 5, 1); const off = mc.bands.findIndex(b => b.age === dd.path[0].age) + 1
    expect(off).toBeGreaterThan(0); expect(mc.bands).toHaveLength(off + dd.path.length)
    dd.path.forEach((p, k) => { expect(mc.bands[off + k].age).toBe(p.age + 1); expect(Math.abs(mc.bands[off + k].p50 - p.balance)).toBeLessThan(0.05) })
    expect(mc.depletionAges[0] ?? null).toBe(dd.depletionAge); expect(mc.successRate).toBe(dd.depletionAge == null ? 1 : 0)
    expect(Math.abs(mc.median - dd.endingBalance)).toBeLessThan(0.05)
    return { dd, mc }
  }
  it('already retired at 62: the first withdrawal is at 62 and the money runs out at the same age as the drawdown', () => {
    const { dd, mc } = sameAsDrawdown(600000, retired, 600000)
    expect(dd.depletionAge).not.toBeNull(); expect(mc.depletionAges).toEqual([dd.depletionAge, dd.depletionAge, dd.depletionAge, dd.depletionAge, dd.depletionAge])
    expect(mc.bands[1].p50).toBeCloseTo(600000 * (1.05 / 1.025) - 60000, 0)   // a full year's draw in the year of age 62
    expect(mc.median).toBe(0); expect(mc.worst).toBe(0); expect(mc.bands.every(b => b.p10 >= 0)).toBe(true)
  })
  it('also while still saving, and when the retirement age is already past', () => {
    const saver = { ...retired, currentAge: 45, annualContribution: 20000 }; sameAsDrawdown(300000, saver, projectRetirement(300000, saver).real)
    const late = { ...retired, currentAge: 66 }; const { dd } = sameAsDrawdown(600000, late, projectRetirement(600000, late).real)
    expect(dd.path[0].age).toBe(66); expect(dd.bridgeYears).toBe(4)        // 66–69: the years before 62 are not drawn again
    expect(projectRetirement(600000, late).bridgeYears).toBe(4)
  })
  it('with volatility a run that runs out stays at $0: no negative median, 10th percentile or worst case', () => {
    const mc = monteCarlo(700000, { ...retired, expectedReturn: 0.06, returnStdDev: 0.12 }, 1000, 42)
    expect(mc.median).toBeGreaterThanOrEqual(0); expect(mc.p10).toBeGreaterThanOrEqual(0); expect(mc.worst).toBeGreaterThanOrEqual(0)
    expect(mc.bands.every(b => b.p10 >= 0 && b.p50 >= 0 && b.p90 >= 0)).toBe(true)
    if (mc.successRate < 0.5) expect(mc.median).toBe(0)
  })
  it('the web worker runs this same simulation', () => {
    const src = Object.values(import.meta.glob<string>('./mc.worker.ts', { query: '?raw', import: 'default', eager: true }))[0]
    expect(src).toMatch(/import \{ monteCarlo \} from '\.\/retirement'/); expect(src).toMatch(/monteCarlo\(balance, inputs, runs, seed\)/)
  })
})

// ---------------- 11: Social Security claiming age ----------------
describe('the Social Security claiming age changes the benefit (11)', () => {
  const base: RetirementInputs = { ...RETIREMENT_DEFAULTS, currentAge: 55, retireAge: 62, lifeExpectancy: 92, desiredIncome: 60000, socialSecurity: 0, ssMonthly: 2500, ssStartAge: 67, ssHaircut: 0, pensions: [] }
  it('SSA factors for a full retirement age of 67: 70% at 62 up to 124% at 70', () => {
    const f = [62, 63, 64, 65, 66, 67, 68, 69, 70].map(a => ssClaimFactor(a))
    expect(f.map(x => Math.round(x * 10000) / 10000)).toEqual([0.7, 0.75, 0.8, 0.8667, 0.9333, 1, 1.08, 1.16, 1.24])
    expect(ssClaimFactor(62)).toBe(0.7); expect(ssClaimFactor(70)).toBe(1.24); expect(ssClaimFactor(60)).toBe(0.7); expect(ssClaimFactor(72)).toBe(1.24)
  })
  it('claiming at 62 pays $1,750 of a $2,500 age-67 benefit, for life, and readiness falls', () => {
    const at62 = { ...base, ssStartAge: 62 }
    expect(ssMonthlyAtClaim(at62)).toBe(1750); expect(ssMonthlyAtClaim(base)).toBe(2500); expect(ssMonthlyAtClaim({ ...base, ssStartAge: 70 })).toBe(3100)
    expect(guaranteedIncome(at62, 62)).toBe(21000); expect(guaranteedIncome(at62, 80)).toBe(21000); expect(guaranteedIncome(base, 67)).toBe(30000)
    const r67 = projectRetirement(400000, base), r62 = projectRetirement(400000, at62)
    expect(r62.readiness).toBeLessThan(r67.readiness); expect(r62.guaranteed).toBe(21000)
    // (income wanted − $21,000) ÷ 4%, no bridge years: the same as typing the $1,750 SSA shows at 62 under the old meaning
    expect(r62.needed).toBe(975000); expect(r62.readiness).toBe(65)
  })
  it('waiting to 70 adds delayed retirement credits; the benefit-cut scenario applies on top; it never starts before 62', () => {
    expect(guaranteedIncome({ ...base, ssStartAge: 70 }, 70)).toBe(37200); expect(guaranteedIncome({ ...base, ssStartAge: 70 }, 69)).toBe(0)
    expect(guaranteedIncome({ ...base, ssStartAge: 70 }, 70, 0.25)).toBe(27900)
    expect(ssStart({ ...base, ssStartAge: 60 })).toBe(62)
  })
  it('the Investments page asks for the full-retirement-age amount and shows what the claiming age pays next to it', async () => {
    const RO = globalThis.ResizeObserver; globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
    const MM = window.matchMedia; window.matchMedia = ((media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
    try {
      const repo = new MemoryRepo(demoSeed()); useStore.setState({ mode: 'demo', repo, role: 'owner', readOnly: false, offlineAt: null }); await useStore.getState().refresh()
      render(createElement(MemoryRouter, null, createElement(ModalHost, null, createElement(InvestmentsPage))))
      const ss = screen.getByLabelText(/^Social Security at full retirement age \/ month/); expect(ss).toHaveValue('2000')   // the demo's $24,000 a year
      expect(ss.closest('.field')).toHaveTextContent('yours is 67')   // the demo planner's age 40 in 2026 → born 1986
      const claim = screen.getByLabelText(/^Claim at age/); expect(claim.closest('.field')).toHaveTextContent('pays $2,000/mo (100%)')
      fireEvent.blur(claim, { target: { value: '62' } })
      await waitFor(() => expect(screen.getByLabelText(/^Claim at age/).closest('.field')).toHaveTextContent('pays $1,400/mo (70%)'))
      fireEvent.blur(screen.getByLabelText(/^Claim at age/), { target: { value: '70' } })
      await waitFor(() => expect(screen.getByLabelText(/^Claim at age/).closest('.field')).toHaveTextContent('pays $2,480/mo (124%)'))
    } finally { cleanup(); globalThis.ResizeObserver = RO; window.matchMedia = MM }
  })
})

// ======================================================================================================
// Follow-ups (coordinator, round 2): what the first round found but left
// ======================================================================================================
describe('follow-up 1: every tax deadline falls on a business day', () => {
  it('2026 W-2s and 1099s are due Monday February 1, 2027 (January 31 is a Sunday); no date in either year is a weekend', () => {
    expect(FEDERAL[2026].calendar.find(c => c.label.startsWith('W-2s'))!.date).toBe('2027-02-01')
    for (const y of TAX_YEARS) for (const c of FEDERAL[y].calendar) { const wd = new Date(c.date + 'T12:00:00').getDay(); expect(wd >= 1 && wd <= 5, `${y}: ${c.label} on ${c.date}`).toBe(true) }
    expect(FEDERAL[2025].calendar.find(c => c.kind === 'extension')!.date).toBe('2026-10-15')
  })
})
describe('follow-up 2: the underpayment penalty charges each quarter its own IRS rate', () => {
  it('2026: 7% January–March, 6% April–June, 7% July–September and October–December; quarters not announced yet use the latest rate', () => {
    expect(['2026-02-15', '2026-05-15', '2026-08-15', '2026-11-15'].map(underpaymentRateOn)).toEqual([0.07, 0.06, 0.07, 0.07])
    expect(['2025-02-15', '2025-05-15', '2025-08-15', '2025-11-15'].map(underpaymentRateOn)).toEqual([0.07, 0.07, 0.07, 0.07])
    expect(underpaymentRateOn('2027-03-01')).toBe(0.07)
  })
  it('a $1,000 shortfall for 2026: a quarter of it from each due date to April 15, 2027, each Form 2210 period at its own rate', () => {
    // days in each period (Apr 16–Jun 30 at 6%; Jul–Sep, Oct–Dec and Jan 1–Apr 15, 2027 at 7%): due Apr 15 → 76, 92, 92, 105; Jun 15 → 15, 92, 92, 105;
    // Sep 15 → 15, 92, 105 (all 7%); Jan 15 → 90. A flat 7% for half a year (the old estimate) would have said $35.
    const expected = 250 / 365 * ((76 * 0.06 + (92 + 92 + 105) * 0.07) + (15 * 0.06 + (92 + 92 + 105) * 0.07) + (15 + 92 + 105) * 0.07 + 90 * 0.07)
    const p = underpaymentPenalty(1000, 2026); expect(p.amount).toBeCloseTo(expected, 2); expect(p.amount).toBe(45.93); expect(p.rates).toEqual([0.06, 0.07])
    expect(underpaymentPenalty(1000, 2025).amount).toBe(round2(250 / 365 * 0.07 * (365 + 304 + 212 + 90)))   // every 2025 period, and Jan 1–Apr 15, 2026, at 7%
    expect(underpaymentPenalty(0, 2026)).toEqual({ amount: 0, rates: [] })
  })
  it('the estimate carries that penalty — and none when this year\'s tax minus withholding is under $1,000 (estimated payments do not count for that)', () => {
    const short = manual({ filingStatus: 'single', paychecksLeft: 0, items: [TI('w2', 100000), TI('withholding', 8000)] })   // tax $13,170
    expect(short.safeHarbor.metBy).toBeNull(); expect(short.safeHarbor.shortfall).toBeCloseTo(11853 - 8000, 2)   // 90% of $13,170 − $8,000
    expect(short.safeHarbor.penaltyEstimate).toBe(underpaymentPenalty(short.safeHarbor.shortfall, 2026).amount); expect(short.safeHarbor.penaltyRates).toEqual([0.06, 0.07])
    const small = manual({ filingStatus: 'single', paychecksLeft: 0, items: [TI('w2', 50000), TI('withholding', 3000)] })   // tax $3,820: $820 left after withholding
    expect(small.federal.total).toBeCloseTo(3820, 2); expect(small.safeHarbor.owedAfterWithholding).toBeCloseTo(820, 2); expect(small.paid.total).toBeLessThan(small.safeHarbor.required)
    expect(small.safeHarbor.metBy).toBe('under $1,000'); expect(small.safeHarbor.met).toBe(true)
    expect(small.safeHarbor.shortfall).toBe(0); expect(small.safeHarbor.penaltyEstimate).toBe(0); expect(small.safeHarbor.quarterlyNeeded).toBe(0)
    const est = manual({ filingStatus: 'single', paychecksLeft: 0, items: [TI('w2', 50000), TI('withholding', 2700), TI('estimated_payment', 500)] })   // $1,120 after withholding
    expect(est.safeHarbor.metBy).toBeNull(); expect(est.safeHarbor.shortfall).toBeCloseTo(3820 * 0.9 - 3200, 2)
  })
})
describe('follow-up 3: the safe-withdrawal table starts from the current age once the retirement age is past', () => {
  it('66, retired at 62, plan to 92: 26 years, not 30, and the run-out age counts from 66', () => {
    const late: RetirementInputs = { ...RETIREMENT_DEFAULTS, currentAge: 66, retireAge: 62, lifeExpectancy: 92, expectedReturn: 0.025, inflation: 0.025, socialSecurity: 0, ssMonthly: 0, pensions: [] }   // real return 0
    const [r38, r50] = safeWithdrawal(1000000, late, [0.038, 0.05])
    expect(r38.yearsLast).toBe(27); expect(r38.lastsToLifeExpectancy).toBe(true); expect(r38.endingBalance).toBe(1000000 - 26 * 38000)   // measured from 62 it would fall short of 92
    expect(r50.yearsLast).toBe(20); expect(r50.runsOutAge).toBe(66 + 20); expect(r50.lastsToLifeExpectancy).toBe(false)
    expect(safeWithdrawal(1000000, { ...late, currentAge: 50 }, [0.05])[0].runsOutAge).toBe(62 + 20)   // not retired yet: from the retirement age
  })
})
describe('follow-up 4: the 65+ add-on counts at most the filers', () => {
  it('one per filer: up to 2 on a joint return, 1 on any other', () => {
    const std = (filingStatus: TaxProfile['filingStatus'], age65: number) => manual({ filingStatus, age65, items: [TI('w2', 300000)] }).standard
    expect([std('mfj', 1), std('mfj', 2), std('mfj', 3), std('mfj', 5)]).toEqual([32200 + 1650, 32200 + 3300, 32200 + 3300, 32200 + 3300])
    expect([std('single', 0), std('single', 2), std('hoh', 3), std('mfs', 2)]).toEqual([16100, 16100 + 2050, 24150 + 2050, 16100 + 1650])
    expect(manual({ year: 2025, filingStatus: 'mfj', age65: 4, items: [TI('w2', 300000)] }).standard).toBe(31500 + 2 * 1600)
  })
})
describe('follow-up 5: full retirement age by year of birth', () => {
  it('SSA\'s table: 66 for 1943–1954, two months more a year to 66 and 10 months for 1959, 67 from 1960 — and the reduction at 62 for each', () => {
    expect([1943, 1954, 1955, 1956, 1957, 1958, 1959, 1960, 1990].map(fullRetirementAge)).toEqual([{ years: 66, months: 0 }, { years: 66, months: 0 }, { years: 66, months: 2 }, { years: 66, months: 4 }, { years: 66, months: 6 }, { years: 66, months: 8 }, { years: 66, months: 10 }, { years: 67, months: 0 }, { years: 67, months: 0 }])
    const at62 = [1954, 1955, 1956, 1957, 1958, 1959, 1960].map(y => { const f = fullRetirementAge(y); return Math.round((1 - ssClaimFactor(62, f.years + f.months / 12)) * 10000) / 100 })
    expect(at62).toEqual([25, 25.83, 26.67, 27.5, 28.33, 29.17, 30])   // SSA's "Reduction at 62" column
  })
  it('the birth year comes from the current age and today, and the benefit is scaled at that full retirement age', () => {
    const at70: RetirementInputs = { ...RETIREMENT_DEFAULTS, currentAge: 70, retireAge: 70, lifeExpectancy: 92, socialSecurity: 0, ssMonthly: 2000, ssStartAge: 70, pensions: [] }
    expect(ssBirthYear(at70)).toBe(1956); expect(fullRetirementAgeFor(at70)).toEqual({ years: 66, months: 4 })   // today is 2026-11-06
    expect(ssClaimShare(at70)).toBeCloseTo(1 + 44 * (2 / 3) / 100, 10); expect(ssMonthlyAtClaim(at70)).toBe(2586.67)   // 44 months of delayed credits
    expect(ssMonthlyAtClaim({ ...at70, ssStartAge: 62 })).toBe(1466.67)   // 52 months early: 26.67% less
    expect(fullRetirementAgeFor({ ...at70, currentAge: 66 })).toEqual({ years: 67, months: 0 }); expect(ssBirthYear({ ...at70, currentAge: 66 }, '2027-03-01')).toBe(1961)
    expect(guaranteedIncome({ ...at70, currentAge: 55, ssStartAge: 62 }, 62)).toBe(16800)   // born 1971: full retirement age 67, so 70% of $24,000 at 62
  })
})
describe('follow-up 6: the child credits phase out together; the re-checked constants', () => {
  it('$50 for each $1,000 or part of $1,000 over the threshold comes off the child and other-dependent credits together', () => {
    expect(manual({ filingStatus: 'single', otherDependents: 2, items: [TI('w2', 210000)] }).federal.credits).toBe(1000 - 10 * 50)
    expect(manual({ filingStatus: 'single', dependentsUnder17: 1, otherDependents: 1, items: [TI('w2', 250000)] }).federal.credits).toBe(2700 - 50 * 50)
    expect(manual({ filingStatus: 'mfj', dependentsUnder17: 2, items: [TI('w2', 400001)] }).federal.credits).toBe(4400 - 50)   // $1 over takes a whole $50
  })
  it('self-employment 92.35% / 12.4% / 2.9%, safe harbor 90% / 110% above $150,000, the $1,000 minimum and the credit amounts are as the IRS states them', () => {
    for (const y of TAX_YEARS) { const T = FEDERAL[y]; expect([T.seTaxableShare, T.seSocialSecurityRate, T.medicareRate, T.safeHarborPct, T.safeHarborHighPct, T.safeHarborHighAgi, T.penaltyMinimum, T.ctcPhaseoutPer1000, T.otherDependentCredit], String(y)).toEqual([0.9235, 0.124, 0.029, 0.9, 1.1, 150000, 1000, 50, 500]) }
  })
})
