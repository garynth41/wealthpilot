// Tax tables by year. Keep every figure here (never inline in the engine) so a new year is a data change.
// Sources (checked 2026-11-01): 2026 federal brackets, standard deduction, LTCG thresholds, CTC $2,200, 65+ add-on, SS wage base $184,500, NIIT thresholds — IRS Rev. Proc. 2025-32
//   as reported by CPA Practice Advisor / Accounting Today (Oct 9, 2025) and Everwise 2026 tax tables. Ohio — HB 96 (2025): flat 2.75% above $26,050 from TY2026 (EY Tax News, Aug 25, 2025);
//   personal exemptions per ORC 5747.025 (not indexed for 2025–26 under HB 96; no exemption above $500,000 MAGI from 2026).
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
/** Ohio TY2026 (HB 96): no tax on the first $26,050 of Ohio taxable income, 2.75% above (no base amount); personal exemption per person by Ohio MAGI — the TY2024 indexed amounts, frozen for 2025–26 —
 *  and none above $500,000. The joint-filing credit, senior / retirement-income credits and the $20 exemption credit are not modelled. */
export const OHIO_2026 = { exemptionThreshold: 26050, rate: 0.0275, exemptionCap: 500000, exemption: (oagi: number) => (oagi > 500000 ? 0 : oagi <= 40000 ? 2400 : oagi <= 80000 ? 2150 : 1900) }
export const STATES: StateRule[] = [
  { code: 'OH', name: 'Ohio', kind: 'ohio', note: 'flat 2.75% above $26,050 of Ohio taxable income (2026); personal exemptions by income' },
  { code: 'NONE', name: 'No state income tax (AK, FL, NV, NH, SD, TN, TX, WA, WY)', kind: 'none', note: '' },
  { code: 'FLAT', name: 'Other state — flat rate (enter %)', kind: 'flat', note: 'approximation: one rate on federal taxable income' },
]
