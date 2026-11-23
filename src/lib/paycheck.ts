// The paycheck breakdown (0.39.0): what comes out of each paycheck — pre-tax savings and benefits, tax withheld, after-tax savings — and what the
// employer adds. Entered once per pay schedule (Settings.payStubs); the tax estimate, the contribution limits and the retirement planner all read it,
// and every figure moves on its own as paydays pass. Pure functions.
import type { PaySchedule, PayStub, Settings } from '../app/data/types'
import { payDates } from './paySchedule'
import { round2 } from './money'
import { addDays, today } from './dates'

/** The amounts a paycheck is split into, in the order a pay stub lists them. */
export const STUB_FIELDS = ['k401', 'roth401k', 'hsa', 'sec125', 'fed', 'state', 'local', 'afterTax'] as const
export type StubField = typeof STUB_FIELDS[number]
export const STUB_LABEL: Record<StubField, string> = { k401: '401(k) / 403(b), pre-tax', roth401k: 'Roth 401(k)', hsa: 'HSA through payroll', sec125: 'Health, dental, FSA and other pre-tax benefits', fed: 'Federal income tax withheld', state: 'State income tax withheld', local: 'City and school-district tax withheld', afterTax: 'Other after-tax deductions' }
/** Jobs that pay through a payroll, so have a pay stub: salary, hourly and severance. */
export const hasPayroll = (p: Pick<PaySchedule, 'kind'>) => p.kind === 'salary' || p.kind === 'hourly' || p.kind === 'severance'
export const stubOf = (s: Pick<Settings, 'payStubs'>, id: string): PayStub => (s.payStubs || {})[id] || {}
const n = (v: unknown) => { const x = +(v as number); return Number.isFinite(x) && x > 0 ? x : 0 }
/** True once anything has been entered for the paycheck. */
export const hasStub = (st: PayStub | undefined | null) => !!st && (STUB_FIELDS.some(f => n(st[f]) > 0) || n(st.matchPct) > 0 || n(st.hsaEmployer) > 0 || !!st.ytd)
/** Gross pay per paycheck: the schedule's gross when set, else its net (the tax page flags that). */
export const grossOf = (p: Pick<PaySchedule, 'gross_amount' | 'net_amount'>) => (p.gross_amount != null && +p.gross_amount > 0 ? +p.gross_amount : +p.net_amount || 0)

/** What the employer's match formula pays on this paycheck: `matchPct`% of the employee's own 401(k) money (pre-tax and Roth), counted only up to
 *  `matchUpToPct`% of gross pay. `full` is the most the formula can pay, `missed` what is left uncollected, and `neededPct` the share of pay the
 *  employee has to put in to collect all of it. */
export function matchOf(p: Pick<PaySchedule, 'gross_amount' | 'net_amount'>, st: PayStub) {
  const gross = grossOf(p), rate = n(st.matchPct) / 100, upTo = n(st.matchUpToPct) / 100
  if (!(rate > 0) || !(upTo > 0) || !(gross > 0)) return { perCheck: 0, full: 0, missed: 0, neededPct: 0 }
  const own = n(st.k401) + n(st.roth401k), cap = gross * upTo
  const perCheck = round2(Math.min(own, cap) * rate), full = round2(cap * rate)
  return { perCheck, full, missed: round2(Math.max(0, full - perCheck)), neededPct: round2(upTo * 100) }
}
/** Social Security and Medicare on one paycheck (employee share): half the self-employment rates on gross pay less the cafeteria-plan benefits
 *  (health premiums, FSA, payroll HSA) — 401(k) money is still taxed for these. The Social Security wage base and the Additional Medicare tax are
 *  not applied per paycheck, so a very high earner's later paychecks are overstated. */
export function ficaOf(p: Pick<PaySchedule, 'gross_amount' | 'net_amount'>, st: PayStub, rates: { seSocialSecurityRate: number; medicareRate: number }) {
  const base = Math.max(0, grossOf(p) - n(st.sec125) - n(st.hsa))
  return { socialSecurity: round2(base * rates.seSocialSecurityRate / 2), medicare: round2(base * rates.medicareRate / 2), total: round2(base * (rates.seSocialSecurityRate + rates.medicareRate) / 2) }
}
/** Does the breakdown add up? Gross less everything entered and the Social Security and Medicare estimate, against the schedule's net pay.
 *  `unexplained` = worked-out take-home − net pay: positive means something that comes out of the paycheck has not been entered. */
export function takeHome(p: Pick<PaySchedule, 'gross_amount' | 'net_amount'>, st: PayStub, rates: { seSocialSecurityRate: number; medicareRate: number }) {
  const gross = grossOf(p), fica = ficaOf(p, st, rates).total
  const out = STUB_FIELDS.reduce((a, f) => a + n(st[f]), 0)
  const computed = round2(gross - out - fica), net = +p.net_amount || 0
  return { gross, deductions: round2(out), fica, computed, net, unexplained: round2(computed - net) }
}

export interface StubAmount { perCheck: number; ytd: number; rest: number; total: number }
export interface StubYear { paid: number; left: number; gross: StubAmount; match: StubAmount; hsaEmployer: StubAmount; by: Record<StubField, StubAmount>; fromYtd: boolean; capped: { deferral: boolean; hsa: boolean } }
const inYear = (ps: PaySchedule, year: number, from: string, to: string) => { const lo = `${year}-01-01`, hi = `${year}-12-31`; const a = from > lo ? from : lo, b = to < hi ? to : hi; return a > b ? [] : payDates(ps, a, b) }
/** One schedule's paycheck amounts over a tax year: what has been taken so far (`ytd`), what is still to come (`rest`) and the year's `total`.
 *  So far = this paycheck's amounts × the paydays up to `asOf` — or, when the stub carries year-to-date figures from a pay stub, those figures plus
 *  this paycheck's amounts × the paydays since that pay stub. To come = this paycheck's amounts × the paydays left (`leftOverride` replaces the
 *  count — the Tax page's "paychecks left" slider). `limits` stops the 401(k) money at the yearly limit and the HSA money (employee + employer) at
 *  the HSA limit, as payroll does: once the limit is reached the paychecks left contribute nothing more.
 *  An ended schedule with a last payday is counted up to it; pass it as it is — payDates() stops at `ends_on`. */
export function stubYear(ps: PaySchedule, st: PayStub, year: number, asOf = today(), opts: { leftOverride?: number | null; limits?: { deferral?: number; hsa?: number } } = {}): StubYear {
  const live: PaySchedule = ps.status === 'Ended' && ps.ends_on ? { ...ps, status: 'Active' } : ps
  const paidDates = asOf < `${year}-01-01` ? [] : inYear(live, year, `${year}-01-01`, asOf), leftDates = asOf >= `${year}-12-31` ? [] : inYear(live, year, addDays(asOf, 1), `${year}-12-31`)
  const paid = paidDates.length, left = opts.leftOverride != null ? Math.max(0, Math.round(opts.leftOverride)) : leftDates.length
  const y = st.ytd && st.ytd.asOf && st.ytd.asOf.slice(0, 4) === String(year) && st.ytd.asOf <= asOf ? st.ytd : null
  const since = y ? paidDates.filter(d => d > y.asOf).length : 0, upTo = y ? paid - since : 0
  const amt = (perCheck: number, ytdGiven?: number | null): StubAmount => {
    const ytd = round2(y ? (ytdGiven != null && +ytdGiven >= 0 ? +ytdGiven : perCheck * upTo) + perCheck * since : perCheck * paid), rest = round2(perCheck * left)
    return { perCheck: round2(perCheck), ytd, rest, total: round2(ytd + rest) }
  }
  const by = Object.fromEntries(STUB_FIELDS.map(f => [f, amt(n(st[f]), y ? (y as unknown as Record<string, number | null | undefined>)[f] : null)])) as Record<StubField, StubAmount>
  const m = matchOf(ps, st); const match = amt(m.perCheck), hsaEmployer = amt(n(st.hsaEmployer)), gross = amt(grossOf(ps), y?.gross)
  const capped = { deferral: false, hsa: false }
  // payroll stops the 401(k) money at the yearly limit: scale what is still to come down to the room left
  const cap = (limit: number | undefined, parts: StubAmount[], key: 'deferral' | 'hsa') => { if (!(limit != null && limit > 0)) return; const ytd = parts.reduce((a, x) => a + x.ytd, 0), rest = parts.reduce((a, x) => a + x.rest, 0); const room = Math.max(0, limit - ytd)
    if (rest > room + 0.005) { const k = rest > 0 ? room / rest : 0; for (const x of parts) { x.rest = round2(x.rest * k); x.total = round2(x.ytd + x.rest) } capped[key] = true } }
  cap(opts.limits?.deferral, [by.k401, by.roth401k], 'deferral'); cap(opts.limits?.hsa, [by.hsa, hsaEmployer], 'hsa')
  return { paid, left, gross, match, hsaEmployer, by, fromYtd: !!y, capped }
}
/** Paychecks a schedule pays in the twelve months after `asOf` — the yearly rate going forward (a job that ends sooner counts only what is left). */
export const paychecksAYear = (ps: PaySchedule, asOf = today()) => (ps.status !== 'Active' ? 0 : payDates(ps, addDays(asOf, 1), addDays(asOf, 365)).length)
