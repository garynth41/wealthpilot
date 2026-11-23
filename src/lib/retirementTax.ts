// Retirement income after tax (0.39.0). The planner used to treat every dollar saved as a dollar to spend. Money in a pre-tax 401(k) or IRA is
// taxed when it comes out, Roth and HSA money is not, a taxable account pays capital-gains tax on its growth, and from the early or mid seventies
// the IRS requires a minimum withdrawal from pre-tax accounts whether it is needed or not. This module walks retirement year by year in today's
// dollars, draws from the accounts in the usual order (required distributions, then taxable, then pre-tax, then Roth), runs each year through the
// same tax engine as the Tax page (lib/tax.ts) and reports what each year costs in tax — which the planner then adds to the income it must fund.
// Pure functions.
import type { RetirementInputs, Settings } from '../app/data/types'
import { emptyData } from '../app/data/types'
import { estimateTax, tableFor, TAX_DEFAULTS, type TaxEstimate } from './tax'
import { LATEST_TAX_YEAR, SENIOR_DEDUCTION_LAST_YEAR, rmdDivisor, rmdStartAge, type FilingStatus } from './taxTables'
import { guaranteedIncome, projectRetirement, ssAnnual, ssBirthYear, ssClaimShare, ssStart } from './retirement'
import type { Buckets } from './contrib'
import { round2 } from './money'
import { today } from './dates'

/** What the tax on a retirement year depends on, beyond that year's income: filing status and where the household lives (from the Tax page's
 *  profile), and the share of the taxable accounts that is untaxed growth. */
export interface RetTaxCtx { status: FilingStatus; state: string; stateRate?: number; schoolDistrictRate: number; gainShare: number; thisYear: number }
export const retTaxCtx = (s: Pick<Settings, 'tax'>, gainShare: number, asOf = today()): RetTaxCtx => { const p = { ...TAX_DEFAULTS, ...(s.tax || {}) }; return { status: p.filingStatus, state: p.state, stateRate: p.stateRate, schoolDistrictRate: +p.schoolDistrictRate || 0, gainShare: Math.min(1, Math.max(0, gainShare)), thisYear: +asOf.slice(0, 4) } }
const EMPTY = emptyData(), NO_SETTINGS = {} as Settings
/** Income tax on one retirement year — federal, state and school district; a city taxes wages, not retirement income. `ordinary` = pension plus
 *  withdrawals from pre-tax accounts, `ss` = Social Security benefits (the engine works out how much of them is taxable), `gains` = the growth in
 *  what was sold from taxable accounts, taxed as a long-term gain. Uses the latest year's tax tables, in today's dollars: brackets rise with
 *  inflation, so that holds; the Social Security thresholds do not rise, so tax on benefits is somewhat understated far out. A joint return is
 *  assumed to be two people of the planner's age. The 2025–2028 senior deduction is left out of later years. */
export function retirementTax(ctx: RetTaxCtx, x: { ordinary: number; ss: number; gains: number; age: number; calendarYear: number }): { total: number; federal: number; state: number; e: TaxEstimate } {
  const e = estimateTax(EMPTY, NO_SETTINGS, { year: LATEST_TAX_YEAR, filingStatus: ctx.status, age65: x.age >= 65 ? (ctx.status === 'mfj' ? 2 : 1) : 0, dependentsUnder17: 0, otherDependents: 0, state: ctx.state, stateRate: ctx.stateRate, localRate: 0, schoolDistrictRate: ctx.schoolDistrictRate,
    autoAggregate: false, paychecksLeft: 0, extraWithholdingPerCheck: 0, plannedEstimates: 0, priorYearTax: 0, priorYearAgi: 0, seSetAsidePct: 0,
    items: [{ id: 'r', kind: 'retirement_income', label: '', amount: Math.max(0, x.ordinary), source: 'manual' }, { id: 's', kind: 'social_security', label: '', amount: Math.max(0, x.ss), source: 'manual' }, { id: 'g', kind: 'capital_gains', label: '', amount: Math.max(0, x.gains), source: 'manual' }] },
    `${LATEST_TAX_YEAR}-06-30`, { senior: x.calendarYear <= SENIOR_DEDUCTION_LAST_YEAR })
  return { total: e.totalTax, federal: e.federal.total, state: round2(e.state.tax + e.local.total), e }
}

export interface AfterTaxYear { age: number; spend: number; ss: number; pension: number; rmd: number; fromPretax: number; fromRoth: number; fromTaxable: number; tax: number; federal: number; state: number; short: number; balance: Buckets & { total: number } }
export interface AfterTaxPlan {
  atRetirement: Buckets & { total: number }; years: AfterTaxYear[]; taxByAge: Record<number, number>
  depletionAge: number | null; lifetimeTax: number; avgTax: number; firstTax: number; effRate: number | null
  rmdAge: number; firstRmd: { age: number; amount: number } | null
  /** the years after retiring and before Social Security and required distributions: pre-tax money that could come out (or move to Roth) in the
   *  first of them and still be taxed at `rate` or less */
  conversion: { age: number; room: number; rate: number } | null
}
/** Retirement year by year, after tax. `now` = today's money by how it is taxed, `yearly` = what goes in each year by the same split (a typed
 *  contribution with no split known is spread like today's balances). To retirement the three kinds grow together, and their total is the planner's
 *  own projection (projectRetirement), so the two always agree. Then, each year from retirement to the plan age: everything grows at the expected
 *  real return; the required distribution comes out of pre-tax money from `rmdAge`; and the least is withdrawn — taxable first, then pre-tax, then
 *  Roth — that leaves `desiredIncome` to spend after that year's tax. A required distribution that is not needed is put back into the taxable
 *  account. `taxByAge` is what the planner adds to the income it must fund; a year the money runs short is `short`. */
export function afterTaxPlan(i: RetirementInputs, now: Buckets, yearly: Buckets, ctx: RetTaxCtx): AfterTaxPlan {
  const realRate = (1 + i.expectedReturn) / (1 + i.inflation) - 1, years = Math.max(0, i.retireAge - i.currentAge)
  const nowTotal = now.pretax + now.roth + now.taxable, yTotal = yearly.pretax + yearly.roth + yearly.taxable
  const share = (b: Buckets, t: number): Buckets => (t > 0 ? { pretax: b.pretax / t, roth: b.roth / t, taxable: b.taxable / t } : { pretax: 1, roth: 0, taxable: 0 })
  const cs = yTotal > 0 ? share(yearly, yTotal) : share(now, nowTotal); const c = +i.annualContribution || 0
  let P = now.pretax, R = now.roth, T = now.taxable
  for (let y = 0; y < years; y++) { P = P * (1 + realRate) + c * cs.pretax; R = R * (1 + realRate) + c * cs.roth; T = T * (1 + realRate) + c * cs.taxable }
  // the planner's own projection is the total; the split comes from the walk above
  const proj = projectRetirement(nowTotal, { ...i, taxByAge: undefined }), grown = P + R + T, k = grown > 0 ? proj.real / grown : 0; P *= k; R *= k; T *= k
  const atRetirement = { pretax: round2(P), roth: round2(R), taxable: round2(T), total: round2(P + R + T) }
  const start = Math.max(i.currentAge, i.retireAge), end = Math.max(start + 1, i.lifeExpectancy), rmdAge = rmdStartAge(ssBirthYear(i, `${ctx.thisYear}-06-30`)), haircut = Math.max(0, Math.min(1, i.ssHaircut || 0))
  const out: AfterTaxYear[] = [], taxByAge: Record<number, number> = {}; let depletionAge: number | null = null, lifetimeTax = 0, lifetimeIncome = 0, firstRmd: AfterTaxPlan['firstRmd'] = null, conversion: AfterTaxPlan['conversion'] = null
  for (let age = start; age < end; age++) {
    P *= 1 + realRate; R *= 1 + realRate; T *= 1 + realRate
    const ss = age >= ssStart(i) ? ssAnnual(i) * ssClaimShare(i) * (1 - haircut) : 0, pension = Math.max(0, guaranteedIncome(i, age) - ss), spend = i.desiredIncome, calendarYear = ctx.thisYear + (age - i.currentAge)
    const rmd = age >= rmdAge && P > 0 ? Math.min(P, P / rmdDivisor(age)) : 0; if (rmd > 0 && !firstRmd) firstRmd = { age, amount: round2(rmd) }
    const split = (W: number) => { const wT = Math.min(W, T), wP = Math.min(W - wT, P - rmd), wR = Math.min(W - wT - wP, R); return { wT, wP, wR } }
    const run = (W: number) => { const { wT, wP, wR } = split(W); const tx = retirementTax(ctx, { ordinary: pension + rmd + wP, ss, gains: wT * ctx.gainShare, age, calendarYear }); return { wT, wP, wR, tx, cash: ss + pension + rmd + wT + wP + wR - tx.total } }
    const base = run(0); let r = base, short = 0
    if (base.cash < spend) {
      const maxW = T + (P - rmd) + R; const top = run(maxW)
      if (top.cash < spend) { r = top; short = spend - top.cash }
      else { let lo = 0, hi = maxW; for (let n = 0; n < 40 && hi - lo > 1; n++) { const mid = (lo + hi) / 2; if (run(mid).cash >= spend) hi = mid; else lo = mid } r = run(hi) }
    }
    // the first retirement year with no required distribution yet: how much more pre-tax money fits under the top of the 12% bracket (or the bracket it is in)
    if (!conversion && age < rmdAge && P - rmd - r.wP > 1) { const e = r.tx.e, brs = tableFor(LATEST_TAX_YEAR).brackets[ctx.status]; const b = brs.find((x, n) => n >= 1 && x.upTo != null && e.ordinaryTaxable < x.upTo)
      if (b && b.upTo != null) { const room = b.upTo - e.ordinaryTaxable + Math.max(0, e.deduction + e.seniorDeduction - e.agi); if (room > 500) conversion = { age, room: round2(Math.min(room, P - rmd - r.wP)), rate: b.rate } } }
    const surplus = Math.max(0, Math.min(r.cash - spend, rmd))   // a required distribution nobody needed goes back into the taxable account
    T += surplus - r.wT; P -= rmd + r.wP; R -= r.wR; P = Math.max(0, P); R = Math.max(0, R); T = Math.max(0, T)
    if (short > 0.5 && depletionAge == null) depletionAge = age
    lifetimeTax += r.tx.total; lifetimeIncome += ss + pension + rmd + r.wT + r.wP + r.wR - surplus; taxByAge[age] = round2(r.tx.total)
    out.push({ age, spend, ss: round2(ss), pension: round2(pension), rmd: round2(rmd), fromPretax: round2(rmd + r.wP - surplus), fromRoth: round2(r.wR), fromTaxable: round2(r.wT), tax: round2(r.tx.total), federal: round2(r.tx.federal), state: round2(r.tx.state), short: round2(short), balance: { pretax: round2(P), roth: round2(R), taxable: round2(T), total: round2(P + R + T) } })
  }
  return { atRetirement, years: out, taxByAge, depletionAge, lifetimeTax: round2(lifetimeTax), avgTax: out.length ? round2(lifetimeTax / out.length) : 0, firstTax: out[0]?.tax ?? 0, effRate: lifetimeIncome > 0 ? lifetimeTax / lifetimeIncome : null, rmdAge, firstRmd, conversion }
}
