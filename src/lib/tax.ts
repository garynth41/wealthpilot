// Tax engine (0.7.0): income aggregation, federal / state / local / self-employment estimate, underpayment monitor, provisioning and filing projection.
// Pure functions; every rate and threshold comes from taxTables.ts. This is a planning estimate, not a return.
import type { Data, Settings } from '../app/data/types'
import { FEDERAL, STATES, LATEST_TAX_YEAR, ohioYear, type FilingStatus, type FederalYear } from './taxTables'
import { round2, sum } from './money'
import { REC_PER_YEAR } from './recurring'
import { holdingValue } from './portfolio'
import { payDates } from './paySchedule'
import { today, addDays } from './dates'

export type TaxItemKind = 'w2' | '1099' | 'dividends' | 'interest' | 'capital_gains' | 'business' | 'rental' | 'retirement_income' | 'social_security' | 'other' | 'pretax_deduction' | 'itemized' | 'adjustment' | 'withholding' | 'estimated_payment' | 'credit'
export const TAX_ITEM_LABEL: Record<TaxItemKind, string> = { w2: 'W-2 wages', '1099': '1099-NEC / contract income', dividends: 'Dividends', interest: 'Interest', capital_gains: 'Capital gains (long-term)', business: 'Business income (Schedule C)', rental: 'Rental income (net)', retirement_income: 'Retirement withdrawals / pension', social_security: 'Social Security benefits', other: 'Other income', pretax_deduction: 'Pre-tax deductions (401k, HSA, health premiums)', itemized: 'Itemized deductions', adjustment: 'Adjustments (IRA, student loan interest)', withholding: 'Tax withheld (federal)', estimated_payment: 'Estimated payment made (federal)', credit: 'Tax credit (federal)' }
export interface TaxItem { id: string; kind: TaxItemKind; label: string; amount: number; source: 'manual' | 'auto'; stateWithheld?: number; localWithheld?: number; note?: string }
export interface TaxProfile {
  year: number; filingStatus: FilingStatus; age65: number; dependentsUnder17: number; otherDependents: number
  state: string; stateRate?: number; localRate: number; schoolDistrictRate: number
  items: TaxItem[]; extraWithholdingPerCheck: number; paychecksLeft: number | null;   // null = count the remaining paydays from the W-2 pay schedule
  seSetAsidePct: number; plannedEstimates: number; priorYearTax: number; priorYearAgi: number; autoAggregate: boolean
}
export const TAX_DEFAULTS: TaxProfile = { year: LATEST_TAX_YEAR, filingStatus: 'single', age65: 0, dependentsUnder17: 0, otherDependents: 0, state: 'OH', localRate: 0, schoolDistrictRate: 0, items: [], extraWithholdingPerCheck: 0, paychecksLeft: null, seSetAsidePct: 25, plannedEstimates: 0, priorYearTax: 0, priorYearAgi: 0, autoAggregate: true }
export const tableFor = (year: number): FederalYear => FEDERAL[year] || FEDERAL[LATEST_TAX_YEAR]

// ---------------- aggregation ----------------
/** Build income items from what the app already knows: pay schedules (gross × per year, or net when gross is blank), side-income schedules → 1099, holdings' yields → dividends/interest, income transactions in investment-like categories. Manual items are kept; auto items are regenerated. */
export function autoItems(d: Data, year: number): TaxItem[] {
  const out: TaxItem[] = []; const per = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, quarterly: 4, yearly: 1, irregular: 0 } as Record<string, number>
  for (const p of d.paySchedules.filter(p => p.status === 'Active')) {
    const n = per[p.frequency] || 0; if (!n) continue
    const gross = p.gross_amount != null && +p.gross_amount > 0 ? +p.gross_amount : +p.net_amount
    const kind: TaxItemKind = p.kind === 'salary' || p.kind === 'hourly' || p.kind === 'severance' ? 'w2' : p.kind === 'side' ? '1099' : p.kind === 'rental' ? 'rental' : p.kind === 'investment' ? 'dividends' : p.kind === 'benefit' || p.kind === 'support' ? 'other' : 'other'
    out.push({ id: 'auto-pay-' + p.id, kind, label: `${p.name}${p.payer ? ' · ' + p.payer : ''} (${p.gross_amount ? 'gross' : 'net'} × ${n}/yr)`, amount: round2(gross * n), source: 'auto', note: p.gross_amount ? undefined : 'gross pay not set — using net' })
  }
  const divs = round2(sum(d.holdings.filter(h => h.yield_pct != null && h.asset_class !== 'bond' && h.asset_class !== 'cash').map(h => holdingValue(h) * (+h.yield_pct! || 0) / 100)))
  const ints = round2(sum(d.holdings.filter(h => h.yield_pct != null && (h.asset_class === 'bond' || h.asset_class === 'cash')).map(h => holdingValue(h) * (+h.yield_pct! || 0) / 100)))
  if (divs) out.push({ id: 'auto-div', kind: 'dividends', label: 'Dividends (estimated from holdings yields)', amount: divs, source: 'auto' })
  if (ints) out.push({ id: 'auto-int', kind: 'interest', label: 'Interest (estimated from bond / cash yields)', amount: ints, source: 'auto' })
  const inc = d.transactions.filter(t => t.kind === 'income' && t.status !== 'void' && t.date.startsWith(String(year)) && !t.pay_schedule_id)
  const other = round2(sum(inc.filter(t => { const c = d.categories.find(c => c.id === t.category_id); return c && /other income|side/i.test(c.name) }).map(t => t.amount)))
  if (other && !out.some(i => i.kind === '1099')) out.push({ id: 'auto-other', kind: 'other', label: `Other income logged in ${year}`, amount: other, source: 'auto' })
  const rec = d.recurring.filter(r => r.status === 'Active' && r.kind === 'income' && /rent/i.test(r.name + ' ' + (r.payee || '')))
  for (const r of rec) out.push({ id: 'auto-rec-' + r.id, kind: 'rental', label: `${r.name} (${REC_PER_YEAR[r.frequency]}/yr)`, amount: round2((+r.amount || 0) * REC_PER_YEAR[r.frequency]), source: 'auto' })
  return out
}
export const mergedItems = (d: Data, p: TaxProfile) => [...(p.autoAggregate ? autoItems(d, p.year) : []), ...p.items]

// ---------------- Ohio ----------------
/** Ohio income tax on Ohio taxable (nonbusiness) income for a tax year: nothing at or below the threshold; above it, the base amount of the
 *  highest bracket passed plus its rate on the excess (ORC 5747.02(A)(3)). */
export function ohioTax(taxable: number, year: number): number {
  const O = ohioYear(year); if (!(taxable > O.threshold)) return 0
  const b = [...O.brackets].reverse().find(x => taxable > x.over) || O.brackets[0]
  return round2(b.base + (taxable - b.over) * b.rate)
}
/** The Ohio rate on the next dollar: 0 at or below the threshold, else the bracket's rate. */
export function ohioMarginal(taxable: number, year: number): number { const O = ohioYear(year); if (!(taxable > O.threshold)) return 0; return ([...O.brackets].reverse().find(x => taxable > x.over) || O.brackets[0]).rate }

// ---------------- federal ----------------
const bracketTax = (taxable: number, brs: { upTo: number | null; rate: number }[]) => { let tax = 0, lo = 0; for (const b of brs) { const hi = b.upTo ?? Infinity; if (taxable > lo) tax += (Math.min(taxable, hi) - lo) * b.rate; lo = hi; if (taxable <= hi) break } return tax }
export const marginalRate = (taxable: number, brs: { upTo: number | null; rate: number }[]) => { let lo = 0; for (const b of brs) { const hi = b.upTo ?? Infinity; if (taxable <= hi) return b.rate; lo = hi } return brs[brs.length - 1].rate + 0 * lo }
export interface TaxEstimate {
  year: number; status: FilingStatus
  income: { w2: number; se: number; dividends: number; interest: number; ltcg: number; rental: number; retirement: number; socialSecurity: number; taxableSS: number; other: number; total: number }
  pretax: number; adjustments: number; seDeduction: number; agi: number; deduction: number; itemized: number; standard: number; taxableIncome: number; ordinaryTaxable: number
  federal: { ordinary: number; ltcg: number; se: number; additionalMedicare: number; niit: number; credits: number; total: number; marginal: number; effective: number | null }
  state: { name: string; taxable: number; tax: number; rate: number }; local: { municipal: number; schoolDistrict: number; total: number }
  totalTax: number; effectiveAll: number | null
  paid: { withheld: number; estimates: number; projectedWithholding: number; extraWithholding: number; plannedEstimates: number; total: number }
  balance: number; refund: number; due: number
  safeHarbor: { required: number; basis: '90% of this year' | '100% of last year' | '110% of last year'; met: boolean; shortfall: number; penaltyEstimate: number; quarterlyNeeded: number; estimatesLeft: number }
  paychecksLeft: number
  seSetAside: number
}
/** Paydays left in the tax year on the main W-2 schedule (after asOf). */
export function paychecksRemaining(d: Data, year: number, asOf = today()): number { const ps = d.paySchedules.find(x => x.status === 'Active' && (x.kind === 'salary' || x.kind === 'hourly')); if (!ps) return 0; const end = `${year}-12-31`; return asOf > end ? 0 : payDates(ps, addDays(asOf, 1), end).length }
export const resolveProfile = (d: Data, s: Settings, p0?: Partial<TaxProfile>, asOf = today()): TaxProfile => { const p: TaxProfile = { ...TAX_DEFAULTS, ...(s.tax || {}), ...(p0 || {}) }; return { ...p, paychecksLeft: p.paychecksLeft == null ? paychecksRemaining(d, p.year, asOf) : p.paychecksLeft } }
/** The whole estimate. Taxable Social Security uses the simplified 85% rule above the thresholds; QBI, AMT, EITC and most credits are out of scope. */
export function estimateTax(d: Data, s: Settings, p0?: Partial<TaxProfile>, asOf = today()): TaxEstimate {
  const p = resolveProfile(d, s, p0, asOf) as TaxProfile & { paychecksLeft: number }; const T = tableFor(p.year); const st = p.filingStatus; const items = mergedItems(d, p)
  const by = (k: TaxItemKind) => round2(sum(items.filter(i => i.kind === k).map(i => i.amount)))
  const w2 = by('w2'), se = round2(by('1099') + by('business')), dividends = by('dividends'), interest = by('interest'), ltcg = by('capital_gains'), rental = by('rental'), retirement = by('retirement_income'), socialSecurity = by('social_security'), other = by('other')
  const pretax = by('pretax_deduction'), adjustments = by('adjustment'), itemized = by('itemized'), credits = by('credit')
  // self-employment tax (Schedule SE): 92.35% of net SE income; 12.4% SS up to the wage base (less W-2 wages already taxed), 2.9% Medicare on all
  const seBase = Math.max(0, se) * T.seTaxableShare; const ssRoom = Math.max(0, T.ssWageBase - w2); const seTax = round2(Math.min(seBase, ssRoom) * 0.124 + seBase * T.medicareRate); const seDeduction = round2(seTax / 2)
  // provisional income for Social Security taxability (simplified: 85% taxable above the upper threshold, 50% between, none below)
  const provisional = w2 + se + dividends + interest + ltcg + rental + retirement + other + 0.5 * socialSecurity; const ssLo = st === 'mfj' ? 32000 : 25000, ssHi = st === 'mfj' ? 44000 : 34000
  const taxableSS = round2(socialSecurity <= 0 ? 0 : provisional <= ssLo ? 0 : provisional <= ssHi ? Math.min(0.5 * socialSecurity, 0.5 * (provisional - ssLo)) : Math.min(0.85 * socialSecurity, 0.85 * (provisional - ssHi) + Math.min(0.5 * socialSecurity, 0.5 * (ssHi - ssLo))))
  const totalIncome = round2(w2 + se + dividends + interest + ltcg + rental + retirement + taxableSS + other)
  const agi = round2(Math.max(0, totalIncome - pretax - adjustments - seDeduction))
  const standard = T.standardDeduction[st] + p.age65 * T.additionalDeduction65[st]; const deduction = Math.max(standard, itemized)
  const taxableIncome = Math.max(0, round2(agi - deduction)); const ltcgTaxable = Math.min(ltcg + dividends * 0.0, taxableIncome)   // dividends treated as ordinary unless entered as capital gains
  const ordinaryTaxable = Math.max(0, taxableIncome - ltcgTaxable)
  const ordinary = round2(bracketTax(ordinaryTaxable, T.brackets[st]))
  // long-term gains stack on top of ordinary income: 0% up to zeroUpTo, 15% to fifteenUpTo, 20% above
  const L = T.ltcg[st]; const g0 = Math.max(0, Math.min(ltcgTaxable, L.zeroUpTo - ordinaryTaxable)), g15 = Math.max(0, Math.min(ltcgTaxable - g0, L.fifteenUpTo - Math.max(ordinaryTaxable, L.zeroUpTo))), g20 = Math.max(0, ltcgTaxable - g0 - g15)
  const ltcgTax = round2(g15 * 0.15 + g20 * 0.20)
  const earned = w2 + Math.max(0, se) * T.seTaxableShare; const addMed = round2(Math.max(0, earned - T.additionalMedicareThreshold[st]) * T.additionalMedicareRate)
  const nii = dividends + interest + ltcg + rental; const niit = round2(Math.max(0, Math.min(nii, agi - T.niitThreshold[st])) * T.niitRate)
  const ctc = Math.max(0, p.dependentsUnder17 * T.childTaxCredit - Math.max(0, Math.ceil(Math.max(0, agi - T.ctcPhaseoutStart[st]) / 1000)) * 50) + p.otherDependents * 500
  const fedCredits = round2(ctc + credits)
  const fedTotal = round2(Math.max(0, ordinary + ltcgTax - fedCredits) + seTax + addMed + niit)
  const marginal = marginalRate(ordinaryTaxable, T.brackets[st])
  // state
  const rule = STATES.find(x => x.code === p.state) || STATES[0]; let stTaxable = 0, stTax = 0, stRate = 0
  if (rule.kind === 'ohio') { const O = ohioYear(p.year); const oagi = agi; const exemptions = (1 + (st === 'mfj' ? 1 : 0) + p.dependentsUnder17 + p.otherDependents) * O.exemption(oagi); stTaxable = Math.max(0, round2(oagi - exemptions)); stTax = ohioTax(stTaxable, p.year); stRate = ohioMarginal(stTaxable, p.year) }
  else if (rule.kind === 'flat') { stTaxable = taxableIncome; stRate = (p.stateRate || 0) / 100; stTax = round2(stTaxable * stRate) }
  // local: Ohio municipal tax is on earned income (wages + SE); school-district income tax (traditional base) on Ohio taxable income
  const municipal = round2(Math.max(0, w2 + se) * (p.localRate || 0) / 100), schoolDistrict = round2(Math.max(0, rule.kind === 'ohio' ? stTaxable : taxableIncome) * (p.schoolDistrictRate || 0) / 100)
  const totalTax = round2(fedTotal + stTax + municipal + schoolDistrict)
  // payments
  const withheld = by('withholding'), estimates = by('estimated_payment'), extra = round2(p.extraWithholdingPerCheck * p.paychecksLeft)
  // projected remaining withholding: assume withholding so far continues at the same rate for the paychecks left (only if a W-2 schedule exists)
  const paySched = d.paySchedules.find(x => x.status === 'Active' && (x.kind === 'salary' || x.kind === 'hourly')); const perYear = paySched ? ({ weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 } as Record<string, number>)[paySched.frequency] || 0 : 0
  const projectedWithholding = perYear && p.paychecksLeft > 0 && withheld > 0 ? round2(withheld / Math.max(1, perYear - p.paychecksLeft) * p.paychecksLeft) : 0
  const paidTotal = round2(withheld + estimates + projectedWithholding + extra + p.plannedEstimates)
  const balance = round2(paidTotal - fedTotal)
  // safe harbor (federal): 90% of this year's tax, or 100% (110% if prior AGI > 150k) of last year's tax, whichever is smaller
  // 110% of last year's tax once last year's AGI was over $150,000 — $75,000 when married filing separately (IRS rule)
  const highAgi = st === 'mfs' ? T.safeHarborHighAgi / 2 : T.safeHarborHighAgi
  const prior = p.priorYearTax > 0 ? p.priorYearTax * (p.priorYearAgi > highAgi ? T.safeHarborHighPct : 1) : Infinity
  const required = round2(Math.min(fedTotal * T.safeHarborPct, prior)); const basis: TaxEstimate['safeHarbor']['basis'] = prior < fedTotal * T.safeHarborPct ? (p.priorYearAgi > highAgi ? '110% of last year' : '100% of last year') : '90% of this year'
  const shortfall = round2(Math.max(0, required - paidTotal)); const penaltyEstimate = round2(shortfall * T.underpaymentRate * 0.5)   // roughly half a year outstanding on average
  const estimatesLeft = T.calendar.filter(c => c.kind === 'estimate' && c.date >= asOf).length; const quarterlyNeeded = round2(shortfall > 0 ? shortfall / Math.max(1, estimatesLeft) : 0)   // only deadlines still ahead
  const seSetAside = round2(Math.max(0, se) * (p.seSetAsidePct || 0) / 100)
  return {
    year: p.year, status: st,
    income: { w2, se, dividends, interest, ltcg, rental, retirement, socialSecurity, taxableSS, other, total: totalIncome },
    pretax, adjustments, seDeduction, agi, deduction, itemized, standard, taxableIncome, ordinaryTaxable,
    federal: { ordinary, ltcg: ltcgTax, se: seTax, additionalMedicare: addMed, niit, credits: fedCredits, total: fedTotal, marginal, effective: agi > 0 ? round2(fedTotal / agi) : null },
    state: { name: rule.name, taxable: stTaxable, tax: stTax, rate: stRate }, local: { municipal, schoolDistrict, total: round2(municipal + schoolDistrict) },
    totalTax, effectiveAll: totalIncome > 0 ? round2(totalTax / totalIncome) : null,
    paid: { withheld, estimates, projectedWithholding, extraWithholding: extra, plannedEstimates: p.plannedEstimates, total: paidTotal },
    balance, refund: Math.max(0, balance), due: Math.max(0, -balance),
    safeHarbor: { required, basis, met: shortfall <= 0, shortfall, penaltyEstimate, quarterlyNeeded, estimatesLeft }, seSetAside, paychecksLeft: p.paychecksLeft,
  }
}
/** Which withholding change (per paycheck) would land the federal balance at zero. */
export function withholdingToBreakEven(d: Data, s: Settings, p: Partial<TaxProfile>, asOf = today()): number | null { const e = estimateTax(d, s, { ...p, extraWithholdingPerCheck: 0 }, asOf); if (!e.paychecksLeft) return null; return round2(-e.balance / e.paychecksLeft) }
/** The federal long-term capital-gains rate at this estimate's taxable income (0 / 15 / 20%). */
export function ltcgRate(e: Pick<TaxEstimate, 'year' | 'status' | 'taxableIncome'>): number { const L = tableFor(e.year).ltcg[e.status]; return e.taxableIncome <= L.zeroUpTo ? 0 : e.taxableIncome <= L.fifteenUpTo ? 0.15 : 0.2 }
/** Estimated-tax payments still due this tax year (0.22.0), for the cash calendar: the planned estimates spread over the deadlines left,
 *  plus the safe-harbor shortfall's share per deadline. Nothing when the household has no tax profile. */
export function estimatedTaxDue(d: Data, s: Settings, from: string, to: string, asOf = today()): Array<{ date: string; label: string; amount: number }> {
  if (!s.tax || s.taxInCalendar === false) return []
  const T = tableFor((s.tax.year as number) || LATEST_TAX_YEAR); const dates = T.calendar.filter(c => c.kind === 'estimate' && c.date >= asOf); if (!dates.length || !dates.some(c => c.date >= from && c.date <= to)) return []
  const e = estimateTax(d, s, undefined, asOf); const p = resolveProfile(d, s, undefined, asOf)
  const per = round2((p.plannedEstimates || 0) / dates.length + e.safeHarbor.quarterlyNeeded)
  if (per < 1) return []
  return dates.filter(c => c.date >= from && c.date <= to).map(c => ({ date: c.date, label: 'Estimated tax · ' + c.label.split(' · ')[0].replace(/ \(Form 1040-ES\)/, ''), amount: per }))
}
