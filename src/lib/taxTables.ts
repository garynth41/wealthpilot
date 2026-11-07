// Tax tables by year. Keep every figure here (never inline in the engine) so a new year is a data change.
// Sources (checked 2026-11-01): 2026 federal brackets, standard deduction, LTCG thresholds, CTC $2,200, 65+ add-on, SS wage base $184,500, NIIT thresholds — IRS Rev. Proc. 2025-32
//   as reported by CPA Practice Advisor / Accounting Today (Oct 9, 2025) and Everwise 2026 tax tables. Ohio — see the source note above OHIO below (ORC 5747.02 / 5747.025 as amended by HB 96).
export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh'
export const FILING_LABEL: Record<FilingStatus, string> = { single: 'Single', mfj: 'Married filing jointly', mfs: 'Married filing separately', hoh: 'Head of household' }
export interface Bracket { upTo: number | null; rate: number }   // upTo = taxable income ceiling for this rate (null = no ceiling)
export interface FederalYear {
  year: number; brackets: Record<FilingStatus, Bracket[]>; standardDeduction: Record<FilingStatus, number>; additionalDeduction65: Record<FilingStatus, number>
  ltcg: Record<FilingStatus, { zeroUpTo: number; fifteenUpTo: number }>
  childTaxCredit: number; ctcPhaseoutStart: Record<FilingStatus, number>
  ssWageBase: number; seRate: number; seTaxableShare: number; medicareRate: number; additionalMedicareRate: number; additionalMedicareThreshold: Record<FilingStatus, number>
  niitRate: number; niitThreshold: Record<FilingStatus, number>
  safeHarborPct: number; safeHarborHighPct: number; safeHarborHighAgi: number; underpaymentRate: number
  calendar: Array<{ date: string; label: string; kind: 'estimate' | 'filing' | 'extension' | 'other' }>
}
const B = (s: number[], r = [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37]): Bracket[] => [...s.map((upTo, i) => ({ upTo, rate: r[i] })), { upTo: null, rate: r[6] }]
export const FEDERAL: Record<number, FederalYear> = {
  2026: {
    year: 2026,
    brackets: { single: B([12400, 50400, 105700, 201775, 256225, 640600]), mfj: B([24800, 100800, 211400, 403550, 512450, 768700]), mfs: B([12400, 50400, 105700, 201775, 256225, 384350]), hoh: B([17700, 67450, 105700, 201750, 256200, 640600]) },
    standardDeduction: { single: 16100, mfj: 32200, mfs: 16100, hoh: 24150 }, additionalDeduction65: { single: 2050, mfj: 1650, mfs: 1650, hoh: 2050 },
    ltcg: { single: { zeroUpTo: 49450, fifteenUpTo: 545500 }, mfj: { zeroUpTo: 98900, fifteenUpTo: 613700 }, mfs: { zeroUpTo: 49450, fifteenUpTo: 306850 }, hoh: { zeroUpTo: 66200, fifteenUpTo: 579600 } },
    childTaxCredit: 2200, ctcPhaseoutStart: { single: 200000, mfj: 400000, mfs: 200000, hoh: 200000 },
    ssWageBase: 184500, seRate: 0.124 + 0.029, seTaxableShare: 0.9235, medicareRate: 0.029, additionalMedicareRate: 0.009, additionalMedicareThreshold: { single: 200000, mfj: 250000, mfs: 125000, hoh: 200000 },
    niitRate: 0.038, niitThreshold: { single: 200000, mfj: 250000, mfs: 125000, hoh: 200000 },
    safeHarborPct: 0.9, safeHarborHighPct: 1.1, safeHarborHighAgi: 150000, underpaymentRate: 0.07,
    calendar: [
      { date: '2026-04-15', label: 'Q1 2026 estimated payment (Form 1040-ES) · 2025 return due', kind: 'estimate' }, { date: '2026-06-15', label: 'Q2 2026 estimated payment', kind: 'estimate' }, { date: '2026-09-15', label: 'Q3 2026 estimated payment', kind: 'estimate' },
      { date: '2027-01-15', label: 'Q4 2026 estimated payment', kind: 'estimate' }, { date: '2027-01-31', label: 'W-2s and 1099s due to you', kind: 'other' }, { date: '2027-04-15', label: '2026 federal & Ohio returns due · extension request (Form 4868) · Q1 2027 estimate', kind: 'filing' }, { date: '2027-10-15', label: 'Extended 2026 return due', kind: 'extension' },
    ],
  },
}
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
