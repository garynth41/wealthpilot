// Tax tables by year. Keep every figure here (never inline in the engine) so a new year is a data change.
// Sources (checked 2026-11-01): 2026 federal brackets, standard deduction, LTCG thresholds, CTC $2,200, 65+ add-on, SS wage base $184,500, NIIT thresholds — IRS Rev. Proc. 2025-32
//   as reported by CPA Practice Advisor / Accounting Today (Oct 9, 2025) and Everwise 2026 tax tables. Ohio — see the source note above OHIO below (ORC 5747.02 / 5747.025 as amended by HB 96).
// 2025 federal (checked 2026-11-07) — see the source note above the 2025 entry. Senior deduction (2025–2028) — see the note on FederalYear.senior.
export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh'
export const FILING_LABEL: Record<FilingStatus, string> = { single: 'Single', mfj: 'Married filing jointly', mfs: 'Married filing separately', hoh: 'Head of household' }
export interface Bracket { upTo: number | null; rate: number }   // upTo = taxable income ceiling for this rate (null = no ceiling)
export interface FederalYear {
  year: number; brackets: Record<FilingStatus, Bracket[]>; standardDeduction: Record<FilingStatus, number>; additionalDeduction65: Record<FilingStatus, number>
  ltcg: Record<FilingStatus, { zeroUpTo: number; fifteenUpTo: number }>
  /** child tax credit per child under 17 and the credit for each other dependent; the two together shrink by `ctcPhaseoutPer1000` for each $1,000
   *  (or part of $1,000) of AGI above `ctcPhaseoutStart` */
  childTaxCredit: number; otherDependentCredit: number; ctcPhaseoutStart: Record<FilingStatus, number>; ctcPhaseoutPer1000: number
  /** self-employment tax: `seSocialSecurityRate` on `seTaxableShare` of net profit up to `ssWageBase` (less W-2 wages), `medicareRate` on all of it */
  ssWageBase: number; seRate: number; seSocialSecurityRate: number; seTaxableShare: number; medicareRate: number; additionalMedicareRate: number; additionalMedicareThreshold: Record<FilingStatus, number>
  niitRate: number; niitThreshold: Record<FilingStatus, number>
  /** safe harbor: pay 90% of this year's tax, or 100% of last year's (110% when last year's AGI was over `safeHarborHighAgi`, half that married filing
   *  separately); no penalty at all when this year's tax minus withholding is under `penaltyMinimum`. The penalty's rates are UNDERPAYMENT_RATES below. */
  safeHarborPct: number; safeHarborHighPct: number; safeHarborHighAgi: number; penaltyMinimum: number
  /** The 2025–2028 deduction for seniors (P.L. 119-21 §70103; Schedule 1-A Part V): `perPerson` for the filer and, on a joint return, the spouse who is
   *  65 or older by the end of the year, itemizing or not, on top of the 65+ standard-deduction add-on. Each person's amount shrinks by `phaseoutRate`
   *  × modified AGI above `magiOver` (null = not allowed: a married couple must file jointly to claim it). Absent for a year without the deduction.
   *  Sources (checked 2026-11-07): https://www.irs.gov/newsroom/working-families-tax-cuts-individuals-and-workers ($6,000 per eligible individual,
   *  $12,000 for a couple who both qualify, 2025 through 2028, phases out above $75,000 / $150,000 MAGI, itemizers and non-itemizers),
   *  https://www.irs.gov/newsroom/new-and-enhanced-deductions-for-individuals (available whether or not you itemize),
   *  https://www.irs.gov/pub/irs-pdf/f1040s1a.pdf (2025 Schedule 1-A Part V: lines 32–35 = $6,000 − 6% × (MAGI − $75,000 / $150,000), entered once
   *  for each qualifying spouse on lines 36a / 36b; "If married, you must file jointly to claim this deduction"). The same $6,000 / $75,000 / $150,000
   *  apply in 2026: IRS Publication 6142 (Rev. 10-2026), https://www.irs.gov/pub/irs-pdf/p6142.pdf ("Starting in 2025 and through 2028 … $6,000"). */
  senior?: { perPerson: number; magiOver: Record<FilingStatus, number | null>; phaseoutRate: number }
  calendar: Array<{ date: string; label: string; kind: 'estimate' | 'filing' | 'extension' | 'other' }>
}
const B = (s: number[], r = [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37]): Bracket[] => [...s.map((upTo, i) => ({ upTo, rate: r[i] })), { upTo: null, rate: r[6] }]
const SENIOR_2025_2028: FederalYear['senior'] = { perPerson: 6000, magiOver: { single: 75000, mfj: 150000, mfs: null, hoh: 75000 }, phaseoutRate: 0.06 }
export const FEDERAL: Record<number, FederalYear> = {
  // 2025 sources (checked 2026-11-07):
  //   brackets, long-term gains 0% / 15% ceilings, 65+ add-on ($1,600 married, $2,000 unmarried) — Rev. Proc. 2024-40 §§ 2.01, 2.03, 2.15(3), https://www.irs.gov/pub/irs-drop/rp-24-40.pdf
  //   standard deduction $15,750 / $31,500 / $23,625 (raised from Rev. Proc. 2024-40's $15,000 / $30,000 / $22,500 by P.L. 119-21, the One Big Beautiful Bill Act) —
  //     https://www.irs.gov/newsroom/working-families-tax-cuts-individuals-and-workers and https://www.irs.gov/newsroom/new-and-enhanced-deductions-for-individuals
  //   child tax credit $2,200 per child, phase-out above $400,000 joint / $200,000 others — https://www.irs.gov/instructions/i1040s8 (2025 Schedule 8812 instructions),
  //     https://www.irs.gov/credits-deductions/individuals/child-tax-credit
  //   Social Security wage base $176,100 — https://www.ssa.gov/oact/cola/cbb.html
  //   NIIT 3.8% above $200,000 single / HoH, $250,000 joint, $125,000 separate — https://www.irs.gov/individuals/net-investment-income-tax
  //   Additional Medicare 0.9% above the same thresholds — https://www.irs.gov/taxtopics/tc560
  //   underpayment rate 7% in every quarter of 2025 — https://www.irs.gov/payments/quarterly-interest-rates and https://www.irs.gov/pub/irs-pdf/i2210.pdf (2025 Form 2210 instructions)
  //   estimate dates — the 2025 Form 2210 instructions' installments 04/15/25, 06/15/25, 09/15/25, 01/15/26; June 15, 2025 was a Sunday, so that payment was due
  //     Monday June 16 (next business day). W-2s to employees by February 2, 2026 — https://www.irs.gov/instructions/i1040sh. Return due April 15, 2026 (Form 2210 instructions).
  //   extended return due October 15, 2026: the 2025 Form 1040 instructions (https://www.irs.gov/instructions/i1040gi) — "File Form 1040 or 1040-SR by April 15, 2026"
  //     and "an automatic 6-month extension if, no later than the date your return is due, you file Form 4868".
  // Rules re-checked 2026-11-07 (same in both years):
  //   safe harbor 90% / 100% / 110% above $150,000 AGI ($75,000 married filing separately) and the $1,000 minimum — the 2026 Form 1040-ES,
  //     https://www.irs.gov/pub/irs-pdf/f1040es.pdf ("Who Must Pay Estimated Tax", "Higher income taxpayers"), and the 2025 Form 2210 instructions ("The total
  //     tax shown on your 2025 return minus the amount of tax you paid through withholding is less than $1,000" — no penalty).
  //   self-employment tax: 92.35% of net profit, 12.4% Social Security up to the wage base, 2.9% Medicare, half deductible — the 2026 Form 1040-ES
  //     "Self-Employment Tax and Deduction Worksheet" (lines 3, 4, 5 = $184,500, 9 and 11). Not modelled: the $400 floor on net earnings (not confirmed this session).
  //   child tax credit reduced by $50 for each $1,000 or part of $1,000 of modified AGI over $200,000 / $400,000 joint (IRC §24(b)(1); Schedule 8812 rounds the
  //     excess up to the next $1,000 and takes 5%), and the $500 credit for other dependents "begins to decrease in value if your adjusted gross income exceeds
  //     $200,000 ($400,000 for married filing jointly)" — https://www.irs.gov/credits-deductions/individuals/child-tax-credit; the $50 rate itself is from the statute
  //     (no IRS page with the line-by-line wording could be opened this session).
  2025: {
    year: 2025,
    brackets: { single: B([11925, 48475, 103350, 197300, 250525, 626350]), mfj: B([23850, 96950, 206700, 394600, 501050, 751600]), mfs: B([11925, 48475, 103350, 197300, 250525, 375800]), hoh: B([17000, 64850, 103350, 197300, 250500, 626350]) },
    standardDeduction: { single: 15750, mfj: 31500, mfs: 15750, hoh: 23625 }, additionalDeduction65: { single: 2000, mfj: 1600, mfs: 1600, hoh: 2000 },
    ltcg: { single: { zeroUpTo: 48350, fifteenUpTo: 533400 }, mfj: { zeroUpTo: 96700, fifteenUpTo: 600050 }, mfs: { zeroUpTo: 48350, fifteenUpTo: 300000 }, hoh: { zeroUpTo: 64750, fifteenUpTo: 566700 } },
    childTaxCredit: 2200, otherDependentCredit: 500, ctcPhaseoutStart: { single: 200000, mfj: 400000, mfs: 200000, hoh: 200000 }, ctcPhaseoutPer1000: 50,
    ssWageBase: 176100, seRate: 0.124 + 0.029, seSocialSecurityRate: 0.124, seTaxableShare: 0.9235, medicareRate: 0.029, additionalMedicareRate: 0.009, additionalMedicareThreshold: { single: 200000, mfj: 250000, mfs: 125000, hoh: 200000 },
    niitRate: 0.038, niitThreshold: { single: 200000, mfj: 250000, mfs: 125000, hoh: 200000 },
    safeHarborPct: 0.9, safeHarborHighPct: 1.1, safeHarborHighAgi: 150000, penaltyMinimum: 1000,
    senior: SENIOR_2025_2028,
    calendar: [
      { date: '2025-04-15', label: 'Q1 2025 estimated payment (Form 1040-ES) · 2024 return due', kind: 'estimate' }, { date: '2025-06-16', label: 'Q2 2025 estimated payment', kind: 'estimate' }, { date: '2025-09-15', label: 'Q3 2025 estimated payment', kind: 'estimate' },
      { date: '2026-01-15', label: 'Q4 2025 estimated payment', kind: 'estimate' }, { date: '2026-02-02', label: 'W-2s and 1099s due to you', kind: 'other' }, { date: '2026-04-15', label: '2025 federal & Ohio returns due · extension request (Form 4868) · Q1 2026 estimate', kind: 'filing' }, { date: '2026-10-15', label: 'Extended 2025 return due', kind: 'extension' },
    ],
  },
  2026: {
    year: 2026,
    brackets: { single: B([12400, 50400, 105700, 201775, 256225, 640600]), mfj: B([24800, 100800, 211400, 403550, 512450, 768700]), mfs: B([12400, 50400, 105700, 201775, 256225, 384350]), hoh: B([17700, 67450, 105700, 201750, 256200, 640600]) },
    standardDeduction: { single: 16100, mfj: 32200, mfs: 16100, hoh: 24150 }, additionalDeduction65: { single: 2050, mfj: 1650, mfs: 1650, hoh: 2050 },
    ltcg: { single: { zeroUpTo: 49450, fifteenUpTo: 545500 }, mfj: { zeroUpTo: 98900, fifteenUpTo: 613700 }, mfs: { zeroUpTo: 49450, fifteenUpTo: 306850 }, hoh: { zeroUpTo: 66200, fifteenUpTo: 579600 } },
    childTaxCredit: 2200, otherDependentCredit: 500, ctcPhaseoutStart: { single: 200000, mfj: 400000, mfs: 200000, hoh: 200000 }, ctcPhaseoutPer1000: 50,
    ssWageBase: 184500, seRate: 0.124 + 0.029, seSocialSecurityRate: 0.124, seTaxableShare: 0.9235, medicareRate: 0.029, additionalMedicareRate: 0.009, additionalMedicareThreshold: { single: 200000, mfj: 250000, mfs: 125000, hoh: 200000 },
    niitRate: 0.038, niitThreshold: { single: 200000, mfj: 250000, mfs: 125000, hoh: 200000 },
    safeHarborPct: 0.9, safeHarborHighPct: 1.1, safeHarborHighAgi: 150000, penaltyMinimum: 1000,
    senior: SENIOR_2025_2028,
    // 2026 dates (checked 2026-11-07): estimates per the 2026 Form 1040-ES (April 15, June 15, Sept. 15, 2026, Jan. 15, 2027). W-2s and 1099s: January 31, 2027 is a
    //   Sunday, so they are due the next business day, Monday February 1, 2027 (IRC §7503 — as with 2025's forms, due February 2, 2026 when January 31 was a
    //   Saturday, https://www.irs.gov/instructions/i1040sh). Extended return: six months after April 15, 2027 — October 15, 2027, a Friday (inferred; the 2026
    //   Form 4868 is not out yet).
    calendar: [
      { date: '2026-04-15', label: 'Q1 2026 estimated payment (Form 1040-ES) · 2025 return due', kind: 'estimate' }, { date: '2026-06-15', label: 'Q2 2026 estimated payment', kind: 'estimate' }, { date: '2026-09-15', label: 'Q3 2026 estimated payment', kind: 'estimate' },
      { date: '2027-01-15', label: 'Q4 2026 estimated payment', kind: 'estimate' }, { date: '2027-02-01', label: 'W-2s and 1099s due to you', kind: 'other' }, { date: '2027-04-15', label: '2026 federal & Ohio returns due · extension request (Form 4868) · Q1 2027 estimate', kind: 'filing' }, { date: '2027-10-15', label: 'Extended 2026 return due', kind: 'extension' },
    ],
  },
}
/** The IRS underpayment interest rate for individuals in each calendar quarter, from the quarter's first day (IRC §6621(a)(2): the federal short-term rate
 *  plus 3 points). The underpayment penalty (Form 2210) charges each quarter's rate for the days in that quarter. Sources (checked 2026-11-07):
 *  https://www.irs.gov/payments/quarterly-interest-rates (2025: 7% every quarter; 2026: 7%, 6%, 7%, 7%), and for each 2026 quarter —
 *  Jan–Mar 7%: https://www.irs.gov/newsroom/interest-rates-remain-the-same-for-the-first-quarter-of-2026 (Nov. 13, 2025);
 *  Apr–Jun 6%: Rev. Rul. 2026-5, https://www.irs.gov/irb/2026-08_IRB; Jul–Sep 7%: Rev. Rul. 2026-10, https://www.irs.gov/irb/2026-22_IRB;
 *  Oct–Dec 7%: https://www.irs.gov/newsroom/interest-rates-remain-the-same-for-the-fourth-quarter-of-2026 (Aug. 21, 2026).
 *  Quarters not announced yet (2027 on) use the last rate listed here — add each quarter as the IRS publishes it. */
export const UNDERPAYMENT_RATES: Array<{ from: string; rate: number }> = [
  { from: '2025-01-01', rate: 0.07 }, { from: '2025-04-01', rate: 0.07 }, { from: '2025-07-01', rate: 0.07 }, { from: '2025-10-01', rate: 0.07 },
  { from: '2026-01-01', rate: 0.07 }, { from: '2026-04-01', rate: 0.06 }, { from: '2026-07-01', rate: 0.07 }, { from: '2026-10-01', rate: 0.07 },
]
/** The underpayment rate in force on a date: the latest quarter on or before it (the earliest listed before the list starts, the last listed after it ends). */
export const underpaymentRateOn = (date: string): number => ([...UNDERPAYMENT_RATES].reverse().find(r => r.from <= date) || UNDERPAYMENT_RATES[0]).rate
export const TAX_YEARS = Object.keys(FEDERAL).map(Number).sort()
export const LATEST_TAX_YEAR = TAX_YEARS[TAX_YEARS.length - 1]

// ---------------- states ----------------
export interface StateRule { code: string; name: string; kind: 'none' | 'flat' | 'ohio'; rate?: number; note: string }
/** One Ohio rate-schedule row: on Ohio taxable (nonbusiness) income above `over`, the tax is `base` + `rate` × (income − over). */
export interface OhioBracket { over: number; base: number; rate: number }
/** An Ohio tax year: no tax at all while Ohio taxable income is at or below `threshold`; above it, the highest bracket whose `over` is passed applies.
 *  The base amount is the tax on the first $26,050 (1.31287% in 2025, 1.27448% in 2026 — ORC 5747.02(A)(2)), so the tax jumps from $0 to the base just above the threshold.
 *  Personal exemption per person by Ohio MAGI: the TY2024 indexed amounts ($2,400 / $2,150 / $1,900), not indexed for 2025–26 under HB 96, and none at or above `exemptionMagiCap`. */
export interface OhioYear { year: number; threshold: number; brackets: OhioBracket[]; exemptionMagiCap: number; exemption: (magi: number) => number }
const ohioExemption = (cap: number) => (magi: number) => (magi >= cap ? 0 : magi <= 40000 ? 2400 : magi <= 80000 ? 2150 : 1900)
// Source (checked 2026-11-06): Ohio Revised Code 5747.02(A)(3) as amended by HB 96 (136th GA), effective 2025-09-30 —
//   https://codes.ohio.gov/assets/laws/revised-code/authenticated/57/5747/5747.02/9-30-2025/5747.02-9-30-2025.pdf
//   TY2025: ≤ $26,050 no tax; $26,050–$100,000 $342.00 + 2.75% of the excess over $26,050; > $100,000 $2,394.32 + 3.125% of the excess over $100,000
//   (the same figures as the Ohio Department of Taxation's "Annual Tax Rates" page, https://tax.ohio.gov/individual/file-now/annual-tax-rates).
//   TY2026 and after: ≤ $26,050 no tax; above, $332.00 + 2.75% of the excess over $26,050.
//   Exemption MAGI limits: ORC 5747.025(A) — under $750,000 for 2025, under $500,000 from 2026.
// Not modelled: the joint-filing credit, senior / retirement-income credits, the $20 exemption credit and the 3% rate on taxable business income.
export const OHIO: Record<number, OhioYear> = {
  2025: { year: 2025, threshold: 26050, brackets: [{ over: 26050, base: 342, rate: 0.0275 }, { over: 100000, base: 2394.32, rate: 0.03125 }], exemptionMagiCap: 750000, exemption: ohioExemption(750000) },
  2026: { year: 2026, threshold: 26050, brackets: [{ over: 26050, base: 332, rate: 0.0275 }], exemptionMagiCap: 500000, exemption: ohioExemption(500000) },
}
/** The Ohio table for a tax year: that year, else the latest earlier one ("2026 and thereafter"), else the earliest. */
export const ohioYear = (year: number): OhioYear => { const ys = Object.keys(OHIO).map(Number).sort((a, b) => a - b); const y = [...ys].reverse().find(x => x <= year) ?? ys[0]; return OHIO[y] }
export const STATES: StateRule[] = [
  { code: 'OH', name: 'Ohio', kind: 'ohio', note: 'no tax up to $26,050 of Ohio taxable income; above that, $332 plus 2.75% of the amount over $26,050 (2026); personal exemptions by income' },
  { code: 'NONE', name: 'No state income tax (AK, FL, NV, NH, SD, TN, TX, WA, WY)', kind: 'none', note: '' },
  { code: 'FLAT', name: 'Other state — flat rate (enter %)', kind: 'flat', note: 'approximation: one rate on federal taxable income' },
]
