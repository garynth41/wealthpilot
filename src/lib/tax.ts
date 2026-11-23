// Tax engine (0.7.0): income aggregation, federal / state / local / self-employment estimate, underpayment monitor, provisioning and filing projection.
// Pure functions; every rate and threshold comes from taxTables.ts. This is a planning estimate, not a return.
import type { Data, PaySchedule, Settings } from '../app/data/types'
import { FEDERAL, STATES, LATEST_TAX_YEAR, TAX_YEARS, ohioYear, underpaymentRateOn, type FilingStatus, type FederalYear } from './taxTables'
import { round2, sum } from './money'
import { REC_PER_YEAR } from './recurring'
import { holdingValue } from './portfolio'
import { payDates } from './paySchedule'
import { today, addDays, diffDays } from './dates'
import { payrollYear, type PayrollRow } from './contrib'
import { stubOf } from './paycheck'

export type TaxItemKind = 'w2' | '1099' | 'dividends' | 'interest' | 'capital_gains' | 'business' | 'rental' | 'retirement_income' | 'social_security' | 'other' | 'pretax_deduction' | 'itemized' | 'adjustment' | 'withholding' | 'estimated_payment' | 'credit' | 'state_withholding' | 'local_withholding'
export const TAX_ITEM_LABEL: Record<TaxItemKind, string> = { w2: 'W-2 wages', '1099': '1099-NEC / contract income', dividends: 'Dividends', interest: 'Interest', capital_gains: 'Capital gains (long-term)', business: 'Business income (Schedule C)', rental: 'Rental income (net)', retirement_income: 'Retirement withdrawals / pension', social_security: 'Social Security benefits', other: 'Other income', pretax_deduction: 'Pre-tax deductions (401k, HSA, health premiums)', itemized: 'Itemized deductions', adjustment: 'Adjustments (IRA, student loan interest)', withholding: 'Tax withheld (federal)', estimated_payment: 'Estimated payment made (federal)', credit: 'Tax credit (federal)', state_withholding: 'State tax withheld or paid', local_withholding: 'City / school-district tax withheld or paid' }
/** `rest` and `sub` are set on the rows the paycheck breakdown writes (0.39.0). For tax withheld, `amount` is what has been withheld so far and
 *  `rest` what the paychecks still to come will add; for a pre-tax deduction, `amount` is the year's total, `rest` the part still to come, and `sub`
 *  which paycheck line it is (cafeteria-plan lines — `sec125`, `hsa` — also come off the wages a city taxes; 401(k) money does not). */
export interface TaxItem { id: string; kind: TaxItemKind; label: string; amount: number; source: 'manual' | 'auto'; stateWithheld?: number; localWithheld?: number; note?: string; rest?: number; sub?: 'k401' | 'hsa' | 'sec125' }
export interface TaxProfile {
  year: number; filingStatus: FilingStatus; age65: number; dependentsUnder17: number; otherDependents: number
  state: string; stateRate?: number; localRate: number; schoolDistrictRate: number
  items: TaxItem[]; extraWithholdingPerCheck: number; paychecksLeft: number | null;   // null = count the remaining paydays from the W-2 pay schedule
  seSetAsidePct: number; plannedEstimates: number; priorYearTax: number; priorYearAgi: number; autoAggregate: boolean
}
export const TAX_DEFAULTS: TaxProfile = { year: LATEST_TAX_YEAR, filingStatus: 'single', age65: 0, dependentsUnder17: 0, otherDependents: 0, state: 'OH', localRate: 0, schoolDistrictRate: 0, items: [], extraWithholdingPerCheck: 0, paychecksLeft: null, seSetAsidePct: 25, plannedEstimates: 0, priorYearTax: 0, priorYearAgi: 0, autoAggregate: true }
/** The federal table for a tax year: that year's, else the nearest year that has one (the later on a tie). TaxEstimate.tableYear says which was used. */
export const tableFor = (year: number): FederalYear => FEDERAL[year] || (Number.isFinite(year) ? FEDERAL[TAX_YEARS.reduce((best, y) => { const a = Math.abs(y - year), b = Math.abs(best - year); return a < b || (a === b && y > best) ? y : best })] : FEDERAL[LATEST_TAX_YEAR])

// ---------------- pay dates in a tax year ----------------
const yStart = (y: number) => `${y}-01-01`, yEnd = (y: number) => `${y}-12-31`
/** Pay dates a schedule has inside a tax year (optionally only from / to a date), from the same generator as Income & Pay Periods — so a job that starts
 *  or ends during the year counts only its own paychecks (its Starts / Ends dates bound them). */
export const payDatesInYear = (ps: PaySchedule, year: number, from = yStart(year), to = yEnd(year)) => payDates(ps, from > yStart(year) ? from : yStart(year), to < yEnd(year) ? to : yEnd(year))
/** Schedules whose paychecks count toward a tax year: the active ones, plus ended ones with a last payday (Ends) — what they paid before then is
 *  still that year's income. An ended schedule without an Ends date is left out: when it stopped is unknown. */
const taxYearSchedules = (d: Data): PaySchedule[] => d.paySchedules.filter(p => p.status === 'Active' || (p.status === 'Ended' && !!p.ends_on)).map(p => p.status === 'Active' ? p : { ...p, status: 'Active' as const })
const isW2 = (p: PaySchedule) => p.kind === 'salary' || p.kind === 'hourly'
/** Paydays in the tax year up to and including asOf, and after asOf. */
const paidBy = (ps: PaySchedule, year: number, asOf: string) => asOf < yStart(year) ? 0 : payDatesInYear(ps, year, yStart(year), asOf).length
const leftAfter = (ps: PaySchedule, year: number, asOf: string) => asOf >= yEnd(year) ? 0 : payDatesInYear(ps, year, addDays(asOf, 1)).length

// ---------------- aggregation ----------------
/** Build income items from what the app already knows: pay schedules (gross × the paychecks each pays in the tax year, or net when gross is blank), side-income schedules → 1099, holdings' yields → dividends/interest, income transactions in investment-like categories. Manual items are kept; auto items are regenerated. */
export function autoItems(d: Data, year: number, s?: Settings | null, asOf = today(), leftOverride?: { id: string; left: number } | null): TaxItem[] {
  const out: TaxItem[] = []
  // 0.39.0: the paycheck breakdowns (lib/paycheck.ts) — pre-tax deductions and tax withheld, so far and still to come, for every payroll job
  const rows = new Map<string, PayrollRow>(s ? payrollYear(d, s, year, asOf, leftOverride).map(r => [r.ps.id, r]) : [])
  const sofar = (r: PayrollRow, x: { ytd: number; rest: number }) => `${money0(x.ytd)} so far${r.y.fromYtd ? ' (from your pay stub)' : ''}${x.rest > 0 ? ` · ${money0(x.rest)} still to come over ${r.y.left} paycheck${r.y.left === 1 ? '' : 's'}` : ''}`
  for (const p of taxYearSchedules(d)) {
    const n = payDatesInYear(p, year).length; if (!n) continue
    const gross = p.gross_amount != null && +p.gross_amount > 0 ? +p.gross_amount : +p.net_amount
    const kind: TaxItemKind = p.kind === 'salary' || p.kind === 'hourly' || p.kind === 'severance' ? 'w2' : p.kind === 'side' ? '1099' : p.kind === 'rental' ? 'rental' : p.kind === 'investment' ? 'dividends' : p.kind === 'benefit' || p.kind === 'support' ? 'other' : 'other'
    const r = rows.get(p.id); const who = `${p.name}${p.payer ? ' · ' + p.payer : ''}`
    // year-to-date gross from a pay stub (a raise, a bonus, a mid-year start) replaces "gross × paychecks so far"; the paychecks to come stay at today's gross
    const ytdGross = r && r.y.fromYtd && r.st.ytd?.gross != null && asOf >= yStart(year) ? r.y.gross.ytd + gross * leftAfter(p, year, asOf) : null
    out.push(ytdGross != null ? { id: 'auto-pay-' + p.id, kind, label: `${who} (${money0(r!.y.gross.ytd)} so far, from your pay stub + gross × ${leftAfter(p, year, asOf)} to come)`, amount: round2(ytdGross), source: 'auto' }
      : { id: 'auto-pay-' + p.id, kind, label: `${who} (${p.gross_amount ? 'gross' : 'net'} × ${n} paycheck${n === 1 ? '' : 's'} in ${year})`, amount: round2(gross * n), source: 'auto', note: p.gross_amount ? undefined : 'gross pay not set — using net' })
    if (!r) continue
    const pre = (sub: 'k401' | 'hsa' | 'sec125', what: string) => { const x = r.y.by[sub]; if (x.total > 0) out.push({ id: `auto-${sub}-${p.id}`, kind: 'pretax_deduction', label: `${what} · ${p.name}`, amount: x.total, rest: x.rest, sub, source: 'auto', note: sofar(r, x) + (sub === 'k401' && r.y.capped.deferral ? ' · stops at the yearly limit' : '') }) }
    pre('k401', '401(k), pre-tax'); pre('hsa', 'HSA through payroll'); pre('sec125', 'Health and other pre-tax benefits')
    const wh = (f: 'fed' | 'state' | 'local', k: TaxItemKind, what: string) => { const x = r.y.by[f]; if (x.ytd > 0 || x.rest > 0) out.push({ id: `auto-${f}-${p.id}`, kind: k, label: `${what} · ${p.name}`, amount: x.ytd, rest: x.rest, source: 'auto', note: sofar(r, x) }) }
    wh('fed', 'withholding', 'Federal tax withheld'); wh('state', 'state_withholding', 'State tax withheld'); wh('local', 'local_withholding', 'City / school-district tax withheld')
  }
  const divs = round2(sum(d.holdings.filter(h => h.yield_pct != null && h.asset_class !== 'bond' && h.asset_class !== 'cash').map(h => holdingValue(h) * (+h.yield_pct! || 0) / 100)))
  const ints = round2(sum(d.holdings.filter(h => h.yield_pct != null && (h.asset_class === 'bond' || h.asset_class === 'cash')).map(h => holdingValue(h) * (+h.yield_pct! || 0) / 100)))
  if (divs) out.push({ id: 'auto-div', kind: 'dividends', label: 'Dividends (estimated from holdings yields)', amount: divs, source: 'auto' })
  if (ints) out.push({ id: 'auto-int', kind: 'interest', label: 'Interest (estimated from bond / cash yields)', amount: ints, source: 'auto' })
  const inc = d.transactions.filter(t => t.kind === 'income' && t.status !== 'void' && !t.exclude_from_budget && t.date.startsWith(String(year)) && !t.pay_schedule_id)
  const other = round2(sum(inc.filter(t => { const c = d.categories.find(c => c.id === t.category_id); return c && /other income|side/i.test(c.name) }).map(t => t.amount)))
  if (other && !out.some(i => i.kind === '1099')) out.push({ id: 'auto-other', kind: 'other', label: `Other income logged in ${year}`, amount: other, source: 'auto' })
  const rec = d.recurring.filter(r => r.status === 'Active' && r.kind === 'income' && /rent/i.test(r.name + ' ' + (r.payee || '')))
  for (const r of rec) out.push({ id: 'auto-rec-' + r.id, kind: 'rental', label: `${r.name} (${REC_PER_YEAR[r.frequency]}/yr)`, amount: round2((+r.amount || 0) * REC_PER_YEAR[r.frequency]), source: 'auto' })
  return out
}
const money0 = (v: number) => '$' + Math.round(v).toLocaleString('en-US')
/** Every row the estimate adds up: the rows the app works out (pay schedules, paycheck breakdowns, holdings, rent) and the ones typed by hand.
 *  `s` supplies the paycheck breakdowns; the "paychecks left" what-if (a number on the profile) applies to the main W-2 job's paychecks to come. */
export const mergedItems = (d: Data, p: TaxProfile, s?: Settings | null, asOf = today()): TaxItem[] => { if (!p.autoAggregate) return [...p.items]; const main = s && p.paychecksLeft != null ? mainW2Schedule(d, p.year, asOf) : null
  return [...autoItems(d, p.year, s, asOf, main ? { id: main.id, left: p.paychecksLeft as number } : null), ...p.items] }

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
  /** the tax year asked for, and the year whose federal table was used (the nearest one when that year has no table) */
  year: number; tableYear: number; status: FilingStatus
  income: { w2: number; se: number; dividends: number; interest: number; ltcg: number; rental: number; retirement: number; socialSecurity: number; taxableSS: number; other: number; total: number }
  /** `deduction` = the larger of standard and itemized; `seniorDeduction` (2025–2028, filers 65+) comes off as well, itemizing or not */
  pretax: number; adjustments: number; seDeduction: number; agi: number; deduction: number; itemized: number; standard: number; seniorDeduction: number; taxableIncome: number; ordinaryTaxable: number
  federal: { ordinary: number; ltcg: number; se: number; additionalMedicare: number; niit: number; credits: number; total: number; marginal: number; effective: number | null }
  /** 0.39.0: `paid` = state (or city and school-district) tax withheld so far, still to be withheld on the paychecks to come, and typed by hand;
   *  `refund` / `due` = that against the tax. `allDue` / `allRefund` below add the three governments together. */
  state: { name: string; taxable: number; tax: number; rate: number; paid: number; refund: number; due: number }; local: { municipal: number; schoolDistrict: number; total: number; paid: number; refund: number; due: number }
  allDue: number; allRefund: number
  totalTax: number; effectiveAll: number | null
  paid: { withheld: number; estimates: number; projectedWithholding: number; extraWithholding: number; plannedEstimates: number; total: number }
  balance: number; refund: number; due: number
  /** `met` = no underpayment penalty expected, and `metBy` why: the safe harbor is reached, or this year's tax minus withholding (`owedAfterWithholding`)
   *  is under $1,000. `penaltyEstimate` is underpaymentPenalty() on the shortfall; `penaltyRates` the quarterly rates it used. */
  safeHarbor: { required: number; basis: '90% of this year' | '100% of last year' | '110% of last year'; met: boolean; metBy: 'safe harbor' | 'under $1,000' | null; owedAfterWithholding: number; shortfall: number; penaltyEstimate: number; penaltyRates: number[]; quarterlyNeeded: number; estimatesLeft: number }
  paychecksLeft: number
  seSetAside: number
}
/** The main W-2 pay schedule for a tax year: the first active salary or hourly schedule that still pays after asOf that year, else the first one. */
export function mainW2Schedule(d: Data, year: number, asOf = today()): PaySchedule | null { const w = d.paySchedules.filter(x => x.status === 'Active' && isW2(x)); return w.find(x => leftAfter(x, year, asOf) > 0) || w[0] || null }
/** Paydays left in the tax year on the main W-2 schedule (after asOf). */
export function paychecksRemaining(d: Data, year: number, asOf = today()): number { const ps = mainW2Schedule(d, year, asOf); return ps ? leftAfter(ps, year, asOf) : 0 }
export const resolveProfile = (d: Data, s: Settings, p0?: Partial<TaxProfile>, asOf = today()): TaxProfile => { const p: TaxProfile = { ...TAX_DEFAULTS, ...(s.tax || {}), ...(p0 || {}) }; return { ...p, paychecksLeft: p.paychecksLeft == null ? paychecksRemaining(d, p.year, asOf) : p.paychecksLeft } }
/** The whole estimate. Taxable Social Security uses the simplified 85% rule above the thresholds; QBI, AMT, EITC and most credits are out of scope. */
export function estimateTax(d: Data, s: Settings, p0?: Partial<TaxProfile>, asOf = today(), opts: { /** false = a year after the 2025–2028 senior deduction has ended (the retirement planner's later years) */ senior?: boolean } = {}): TaxEstimate {
  const p = resolveProfile(d, s, p0, asOf) as TaxProfile & { paychecksLeft: number }; const T = tableFor(p.year); const st = p.filingStatus; const items = mergedItems(d, p, s, asOf)
  const by = (k: TaxItemKind) => round2(sum(items.filter(i => i.kind === k).map(i => i.amount)))
  const w2 = by('w2'), se = round2(by('1099') + by('business')), dividends = by('dividends'), interest = by('interest'), ltcg = by('capital_gains'), rental = by('rental'), retirement = by('retirement_income'), socialSecurity = by('social_security'), other = by('other')
  const pretax = by('pretax_deduction'), adjustments = by('adjustment'), itemized = by('itemized'), credits = by('credit')
  // self-employment tax (Schedule SE): 92.35% of net SE income; 12.4% SS up to the wage base (less W-2 wages already taxed), 2.9% Medicare on all
  const seBase = Math.max(0, se) * T.seTaxableShare; const ssRoom = Math.max(0, T.ssWageBase - w2); const seTax = round2(Math.min(seBase, ssRoom) * T.seSocialSecurityRate + seBase * T.medicareRate); const seDeduction = round2(seTax / 2)
  // provisional income for Social Security taxability (simplified: 85% taxable above the upper threshold, 50% between, none below)
  const provisional = w2 + se + dividends + interest + ltcg + rental + retirement + other + 0.5 * socialSecurity; const ssLo = st === 'mfj' ? 32000 : 25000, ssHi = st === 'mfj' ? 44000 : 34000
  const taxableSS = round2(socialSecurity <= 0 ? 0 : provisional <= ssLo ? 0 : provisional <= ssHi ? Math.min(0.5 * socialSecurity, 0.5 * (provisional - ssLo)) : Math.min(0.85 * socialSecurity, 0.85 * (provisional - ssHi) + Math.min(0.5 * socialSecurity, 0.5 * (ssHi - ssLo))))
  const totalIncome = round2(w2 + se + dividends + interest + ltcg + rental + retirement + taxableSS + other)
  const agi = round2(Math.max(0, totalIncome - pretax - adjustments - seDeduction))
  // the 65+ add-on: one for the filer and, on a joint return, one for the spouse (IRC §63(f)) — dependents never add one, so "People 65+ on return"
  // counts at most 2 on a joint return and 1 on any other. Not asked, so not modelled: blindness (the same amount again per person), and the narrow
  // married-filing-separately case where a spouse with no income who files no return also counts.
  const over65 = Math.min(Math.max(0, Math.floor(+p.age65 || 0)), st === 'mfj' ? 2 : 1)
  const standard = T.standardDeduction[st] + over65 * T.additionalDeduction65[st]; const deduction = Math.max(standard, itemized)
  // 2025–2028 senior deduction (Schedule 1-A Part V; sources on FederalYear.senior): for the filer and, on a joint return, the spouse who is 65+, each
  // $6,000 less 6% of MAGI above $75,000 ($150,000 joint), whether or not they itemize; none married filing separately. MAGI = AGI here (the foreign
  // income exclusions that would be added back are not modelled). The same people as the 65+ add-on.
  const S = opts.senior === false ? undefined : T.senior, seniorOver = S ? S.magiOver[st] : null
  const seniors = S && seniorOver != null ? over65 : 0
  const seniorDeduction = S && seniorOver != null && seniors ? round2(seniors * Math.max(0, S.perPerson - S.phaseoutRate * Math.max(0, agi - seniorOver))) : 0
  const taxableIncome = Math.max(0, round2(agi - deduction - seniorDeduction)); const ltcgTaxable = Math.min(ltcg + dividends * 0.0, taxableIncome)   // dividends treated as ordinary unless entered as capital gains
  const ordinaryTaxable = Math.max(0, taxableIncome - ltcgTaxable)
  const ordinary = round2(bracketTax(ordinaryTaxable, T.brackets[st]))
  // long-term gains stack on top of ordinary income: 0% up to zeroUpTo, 15% to fifteenUpTo, 20% above
  const L = T.ltcg[st]; const g0 = Math.max(0, Math.min(ltcgTaxable, L.zeroUpTo - ordinaryTaxable)), g15 = Math.max(0, Math.min(ltcgTaxable - g0, L.fifteenUpTo - Math.max(ordinaryTaxable, L.zeroUpTo))), g20 = Math.max(0, ltcgTaxable - g0 - g15)
  const ltcgTax = round2(g15 * 0.15 + g20 * 0.20)
  const earned = w2 + Math.max(0, se) * T.seTaxableShare; const addMed = round2(Math.max(0, earned - T.additionalMedicareThreshold[st]) * T.additionalMedicareRate)
  const nii = dividends + interest + ltcg + rental; const niit = round2(Math.max(0, Math.min(nii, agi - T.niitThreshold[st])) * T.niitRate)
  // child tax credit plus the credit for other dependents, the two together reduced by $50 for each $1,000 (or part of $1,000) of AGI over the threshold
  // (sources in taxTables.ts) — the other-dependent credit shrinks too once the reduction is larger than the child credit
  const ctc = Math.max(0, p.dependentsUnder17 * T.childTaxCredit + p.otherDependents * T.otherDependentCredit - Math.ceil(Math.max(0, agi - T.ctcPhaseoutStart[st]) / 1000) * T.ctcPhaseoutPer1000)
  const fedCredits = round2(ctc + credits)
  const fedTotal = round2(Math.max(0, ordinary + ltcgTax - fedCredits) + seTax + addMed + niit)
  const marginal = marginalRate(ordinaryTaxable, T.brackets[st])
  // state
  const rule = STATES.find(x => x.code === p.state) || STATES[0]; let stTaxable = 0, stTax = 0, stRate = 0
  if (rule.kind === 'ohio') { const O = ohioYear(p.year); const oagi = Math.max(0, round2(agi - taxableSS));   // Ohio deducts Social Security benefits that are in federal AGI (ORC 5747.01(A)(5))
    const exemptions = (1 + (st === 'mfj' ? 1 : 0) + p.dependentsUnder17 + p.otherDependents) * O.exemption(oagi); stTaxable = Math.max(0, round2(oagi - exemptions)); stTax = ohioTax(stTaxable, p.year); stRate = ohioMarginal(stTaxable, p.year) }
  else if (rule.kind === 'flat') { stTaxable = taxableIncome; stRate = (p.stateRate || 0) / 100; stTax = round2(stTaxable * stRate) }
  // local: Ohio municipal tax is on earned income (wages + SE); school-district income tax (traditional base) on Ohio taxable income
  // a city taxes "qualifying wages" — Medicare wages, so 401(k) money is taxed but cafeteria-plan benefits (health premiums, FSA, payroll HSA) are not
  const cafeteria = round2(sum(items.filter(i => i.kind === 'pretax_deduction' && (i.sub === 'sec125' || i.sub === 'hsa')).map(i => i.amount)))
  const municipal = round2(Math.max(0, w2 - cafeteria + se) * (p.localRate || 0) / 100), schoolDistrict = round2(Math.max(0, rule.kind === 'ohio' ? stTaxable : taxableIncome) * (p.schoolDistrictRate || 0) / 100)
  const totalTax = round2(fedTotal + stTax + municipal + schoolDistrict)
  // payments
  const withheld = by('withholding'), estimates = by('estimated_payment'), extra = round2(p.extraWithholdingPerCheck * p.paychecksLeft)
  // projected remaining withholding: the tax withheld so far ÷ the W-2 paychecks actually paid this tax year (from the pay schedules' dates — a job that
  // started in September has not paid since January), continued for the W-2 paychecks still to come. The main schedule's count is the Paychecks left
  // slider's, so a what-if there moves it; any other W-2 schedule keeps its own dates. Nothing is projected before a W-2 paycheck has been paid.
  // 0.39.0: a job with a paycheck breakdown is not guessed at — its row carries what is still to come (`rest`). The rule above applies only to tax
  // typed by hand, over the W-2 jobs that have no federal amount on a breakdown.
  const stubFed = (x: PaySchedule) => p.autoAggregate && +(stubOf(s, x.id).fed || 0) > 0
  const w2Sched = taxYearSchedules(d).filter(isW2).filter(x => !stubFed(x)); const main = mainW2Schedule(d, p.year, asOf); const mainTyped = !!main && !stubFed(main)
  const typedWithheld = round2(sum(items.filter(i => i.kind === 'withholding' && i.rest == null).map(i => i.amount))), stubRest = round2(sum(items.filter(i => i.kind === 'withholding').map(i => i.rest || 0)))
  const paidSoFar = sum(w2Sched.map(x => paidBy(x, p.year, asOf))), othersLeft = sum(w2Sched.filter(x => x.id !== main?.id).map(x => leftAfter(x, p.year, asOf)))
  const projectedWithholding = round2(stubRest + (typedWithheld > 0 && paidSoFar > 0 ? typedWithheld / paidSoFar * Math.max(0, (mainTyped ? p.paychecksLeft : 0) + othersLeft) : 0))
  // state, and city with school district: withheld so far + still to come + typed, against the tax
  const paidTo = (k: TaxItemKind) => round2(sum(items.filter(i => i.kind === k).map(i => i.amount + (i.rest || 0))))
  const statePaid = paidTo('state_withholding'), localPaid = paidTo('local_withholding'), localTax = round2(municipal + schoolDistrict)
  const paidTotal = round2(withheld + estimates + projectedWithholding + extra + p.plannedEstimates)
  const balance = round2(paidTotal - fedTotal)
  // safe harbor (federal): 90% of this year's tax, or 100% (110% if prior AGI > 150k) of last year's tax, whichever is smaller
  // 110% of last year's tax once last year's AGI was over $150,000 — $75,000 when married filing separately (IRS rule)
  const highAgi = st === 'mfs' ? T.safeHarborHighAgi / 2 : T.safeHarborHighAgi
  const prior = p.priorYearTax > 0 ? p.priorYearTax * (p.priorYearAgi > highAgi ? T.safeHarborHighPct : 1) : Infinity
  const required = round2(Math.min(fedTotal * T.safeHarborPct, prior)); const basis: TaxEstimate['safeHarbor']['basis'] = prior < fedTotal * T.safeHarborPct ? (p.priorYearAgi > highAgi ? '110% of last year' : '100% of last year') : '90% of this year'
  // no penalty at all when this year's tax minus withholding (so far, still to come and extra) is under $1,000 — estimated payments do not count toward
  // that test (Form 2210, "Exceptions to the Penalty"; source in taxTables.ts). Otherwise the penalty on the shortfall, quarter by quarter.
  const owedAfterWithholding = round2(fedTotal - (withheld + projectedWithholding + extra)); const short = round2(Math.max(0, required - paidTotal))
  const metBy: TaxEstimate['safeHarbor']['metBy'] = short <= 0 ? 'safe harbor' : owedAfterWithholding < T.penaltyMinimum ? 'under $1,000' : null
  const shortfall = metBy ? 0 : short; const penalty = underpaymentPenalty(shortfall, p.year)
  const estimatesLeft = T.calendar.filter(c => c.kind === 'estimate' && c.date >= asOf).length; const quarterlyNeeded = round2(shortfall > 0 ? shortfall / Math.max(1, estimatesLeft) : 0)   // only deadlines still ahead
  const seSetAside = round2(Math.max(0, se) * (p.seSetAsidePct || 0) / 100)
  return {
    year: p.year, tableYear: T.year, status: st,
    income: { w2, se, dividends, interest, ltcg, rental, retirement, socialSecurity, taxableSS, other, total: totalIncome },
    pretax, adjustments, seDeduction, agi, deduction, itemized, standard, seniorDeduction, taxableIncome, ordinaryTaxable,
    federal: { ordinary, ltcg: ltcgTax, se: seTax, additionalMedicare: addMed, niit, credits: fedCredits, total: fedTotal, marginal, effective: agi > 0 ? round2(fedTotal / agi) : null },
    state: { name: rule.name, taxable: stTaxable, tax: stTax, rate: stRate, paid: statePaid, refund: round2(Math.max(0, statePaid - stTax)), due: round2(Math.max(0, stTax - statePaid)) },
    local: { municipal, schoolDistrict, total: localTax, paid: localPaid, refund: round2(Math.max(0, localPaid - localTax)), due: round2(Math.max(0, localTax - localPaid)) },
    allDue: round2(Math.max(0, -balance) + Math.max(0, stTax - statePaid) + Math.max(0, localTax - localPaid)), allRefund: round2(Math.max(0, balance) + Math.max(0, statePaid - stTax) + Math.max(0, localPaid - localTax)),
    totalTax, effectiveAll: totalIncome > 0 ? round2(totalTax / totalIncome) : null,
    paid: { withheld, estimates, projectedWithholding, extraWithholding: extra, plannedEstimates: p.plannedEstimates, total: paidTotal },
    balance, refund: Math.max(0, balance), due: Math.max(0, -balance),
    safeHarbor: { required, basis, met: metBy != null, metBy, owedAfterWithholding, shortfall, penaltyEstimate: penalty.amount, penaltyRates: penalty.rates, quarterlyNeeded, estimatesLeft }, seSetAside, paychecksLeft: p.paychecksLeft,
  }
}
/** The underpayment penalty (IRC §6654, the way Form 2210's penalty worksheet figures it) on a safe-harbor shortfall for a tax year. The shortfall is spread
 *  evenly over the four required installments — Form 2210 counts withholding as paid a quarter on each due date — and each part is charged from the day
 *  after its due date (April 15, June 15, September 15, January 15) to April 15 of the next year, for the days in each of Form 2210's periods (April 16 –
 *  June 30, July – September, October – December, January 1 – April 15) at that quarter's IRS rate ÷ the days in that calendar year. The January – March
 *  rate also covers April 1–15, as on Form 2210 (IRC §6621(b)(2)(B)). Rates: UNDERPAYMENT_RATES in taxTables.ts; quarters not announced yet use the
 *  latest published rate. Returns the amount and the rates used. */
export function underpaymentPenalty(shortfall: number, year: number): { amount: number; rates: number[] } {
  if (!(shortfall > 0)) return { amount: 0, rates: [] }
  const next = year + 1, dues = [`${year}-04-15`, `${year}-06-15`, `${year}-09-15`, `${next}-01-15`], part = shortfall / dues.length
  const periods = [[`${year}-04-16`, `${year}-06-30`], [`${year}-07-01`, `${year}-09-30`], [`${year}-10-01`, `${year}-12-31`], [`${next}-01-01`, `${next}-04-15`]].map(([from, to]) => ({ from, to, rate: underpaymentRateOn(from) }))
  const daysInYear = (d: string) => { const y = +d.slice(0, 4); return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365 }
  let amount = 0; const used = new Set<number>()
  for (const due of dues) for (const per of periods) {
    const from = addDays(due, 1) > per.from ? addDays(due, 1) : per.from; if (from > per.to) continue
    amount += part * per.rate * (diffDays(per.to, from) + 1) / daysInYear(per.from); used.add(per.rate)
  }
  return { amount: round2(amount), rates: [...used].sort((a, b) => a - b) }
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
