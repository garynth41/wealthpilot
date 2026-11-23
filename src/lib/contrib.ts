// Account tax types, contributions against the yearly limits, employer match, and the retirement planner's own-accord inputs (0.39.0).
// Everything here is worked out from what the app already holds — the paycheck breakdown, transfers into the accounts, the accounts themselves —
// so the figures move as paydays pass and money is moved, with nothing to re-type. Pure functions.
import type { Account, AcctTaxType, Data, PaySchedule, PayStub, RetirementInputs, Settings } from '../app/data/types'
import { contribLimits, type ContribLimits } from './taxTables'
import { RETIREMENT_DEFAULTS } from './retirement'
import { hasPayroll, hasStub, matchOf, paychecksAYear, stubOf, stubYear, grossOf, type StubYear } from './paycheck'
import { investAccounts, accountValue, impliedReturn, mixOf } from './allocation'
import { round2, sum } from './money'
import { addDays, today } from './dates'

// ---------------- how each account is taxed ----------------
/** The tax type an account's name and kind point to: an HSA, a Roth or pre-tax workplace plan (401(k), 403(b), 457, TSP), a Roth or traditional IRA
 *  (rollover, SEP and SIMPLE IRAs count as traditional); otherwise a retirement account is a pre-tax workplace plan and an investment account taxable. */
export function inferAcctType(a: Pick<Account, 'name' | 'kind' | 'institution'>): AcctTaxType {
  const t = `${a.name || ''}`.toLowerCase(); const plan = /\b(401|403|457)\b|401\(?k|403\(?b|\btsp\b|thrift savings/.test(t)
  if (/\bhsa\b|health savings/.test(t)) return 'hsa'
  if (/\broth\b/.test(t)) return plan ? 'roth401k' : 'rothIra'
  if (plan) return 'k401'
  if (/\bira\b|rollover|\bsep\b|\bsimple\b/.test(t)) return 'ira'
  if (/\b529\b|annuity/.test(t)) return 'other'
  return a.kind === 'retirement' ? 'k401' : 'taxable'
}
/** An account's tax type: the one the household chose, else the one its name and kind point to. */
export const acctTypeOf = (s: Pick<Settings, 'invest'>, a: Account): AcctTaxType => s.invest?.acctType?.[a.id] || inferAcctType(a)
/** How money in each type is taxed when it is taken out in retirement: pre-tax money is taxed as income, Roth and HSA money is not (HSA money spent
 *  on medical costs), and a taxable account pays capital-gains tax on its growth only. */
export const TAX_BUCKET: Record<AcctTaxType, 'pretax' | 'roth' | 'taxable'> = { k401: 'pretax', ira: 'pretax', roth401k: 'roth', rothIra: 'roth', hsa: 'roth', taxable: 'taxable', other: 'taxable' }
export interface Buckets { pretax: number; roth: number; taxable: number }
/** Today's investment and retirement money by how it will be taxed, and the share of the taxable accounts that is untaxed growth (from the cost
 *  basis of the holdings there; half is assumed when no holding in a taxable account has a cost basis). */
export function bucketsNow(d: Data, s: Pick<Settings, 'invest'>): Buckets & { total: number; gainShare: number } {
  const b: Buckets = { pretax: 0, roth: 0, taxable: 0 }; const accts = investAccounts(d)
  for (const a of accts) b[TAX_BUCKET[acctTypeOf(s, a)]] += accountValue(d, a)
  const tx = new Set(accts.filter(a => TAX_BUCKET[acctTypeOf(s, a)] === 'taxable').map(a => a.id)); const hs = d.holdings.filter(h => h.account_id && tx.has(h.account_id) && +h.cost_basis > 0)
  const val = sum(hs.map(h => (+h.quantity || 0) * (+h.price || 0))), cost = sum(hs.map(h => +h.cost_basis || 0))
  return { pretax: round2(b.pretax), roth: round2(b.roth), taxable: round2(b.taxable), total: round2(b.pretax + b.roth + b.taxable), gainShare: val > 0 ? Math.min(1, Math.max(0, (val - cost) / val)) : 0.5 }
}

// ---------------- limits ----------------
/** The age the planner holds, moved to the end of `year` — null until a planner has been saved (no age, no catch-up amounts). */
export const ageIn = (s: Pick<Settings, 'retirement'>, year: number, asOf = today()): number | null => (s.retirement && +s.retirement.currentAge > 0 ? Math.round(+s.retirement.currentAge) + (year - +asOf.slice(0, 4)) : null)
/** This person's limits for a year: the base amounts plus the catch-up their age allows (50+, or 60 to 63, for workplace plans; 50+ for IRAs; 55+
 *  for an HSA). `L.year` is the year whose figures were used — an earlier one when that year's are not published yet. */
export function limitsFor(s: Pick<Settings, 'retirement' | 'invest'>, year: number, asOf = today()): { L: ContribLimits; age: number | null; deferral: number; deferralCatchUp: number; /** a spouse's or partner's own workplace-plan limit: the base amount — their age is not on file, so no catch-up */ partnerDeferral: number; ira: number; iraCatchUp: number; hsa: number; hsaCatchUp: number; coverage: 'self' | 'family' } {
  const L = contribLimits(year), age = ageIn(s, year, asOf), coverage = s.invest?.hsaCoverage === 'family' ? 'family' : 'self'
  const dc = age == null ? 0 : age >= 60 && age <= 63 ? L.catchUp60to63 : age >= 50 ? L.catchUp50 : 0, ic = age != null && age >= 50 ? L.iraCatchUp50 : 0, hc = age != null && age >= 55 ? L.hsaCatchUp55 : 0
  return { L, age, deferral: L.deferral + dc, deferralCatchUp: dc, partnerDeferral: L.deferral, ira: L.ira + ic, iraCatchUp: ic, hsa: (coverage === 'family' ? L.hsaFamily : L.hsaSelf) + hc, hsaCatchUp: hc, coverage }
}

// ---------------- payroll over a tax year ----------------
export interface PayrollRow { ps: PaySchedule; st: PayStub; y: StubYear }
/** Payroll jobs that count toward a tax year: active ones, and ended ones with a last payday (what they paid before it is still that year's). */
export const payrollSchedules = (d: Pick<Data, 'paySchedules'>) => d.paySchedules.filter(p => hasPayroll(p) && (p.status === 'Active' || (p.status === 'Ended' && !!p.ends_on)))
/** Every payroll job's paycheck amounts over a tax year (stubYear). The 401(k) limit is per person: a person's jobs share it in the order they are
 *  listed (a second job only gets the room the first left), and a breakdown marked as the spouse's or partner's is counted against their own
 *  limit. The HSA limit is shared. `leftOverride` replaces one schedule's count of paychecks still to come. */
export function payrollYear(d: Pick<Data, 'paySchedules'>, s: Pick<Settings, 'payStubs' | 'retirement' | 'invest'>, year: number, asOf = today(), leftOverride?: { id: string; left: number } | null): PayrollRow[] {
  const lim = limitsFor(s, year, asOf), plan = { me: lim.deferral, partner: lim.partnerDeferral }
  // first what every job has already taken this year, then the room that leaves for the paychecks to come — so the answer does not depend on
  // which job is listed first, and a job that has used the whole limit leaves none for another
  const jobs = payrollSchedules(d).map(ps => { const st = stubOf(s, ps.id), who: 'me' | 'partner' = st.partner ? 'partner' : 'me', left = leftOverride && leftOverride.id === ps.id ? leftOverride.left : null
    const y0 = stubYear(ps, st, year, asOf, { leftOverride: left, limits: { deferralPlan: plan[who] } })
    return { ps, st, who, left, dY: y0.by.k401.ytd + y0.by.roth401k.ytd, hY: y0.by.hsa.ytd + y0.hsaEmployer.ytd } })
  const taken = (who: 'me' | 'partner') => sum(jobs.filter(j => j.who === who).map(j => j.dY))
  const room = { me: Math.max(0, plan.me - taken('me')), partner: Math.max(0, plan.partner - taken('partner')) }; let hsaRoom = Math.max(0, lim.hsa - sum(jobs.map(j => j.hY)))
  return jobs.map(j => {
    const y = stubYear(j.ps, j.st, year, asOf, { leftOverride: j.left, limits: { deferral: Math.max(0.01, j.dY + room[j.who]), deferralPlan: plan[j.who], hsa: Math.max(0.01, j.hY + hsaRoom) } })
    room[j.who] = Math.max(0, room[j.who] - (y.by.k401.rest + y.by.roth401k.rest)); hsaRoom = Math.max(0, hsaRoom - (y.by.hsa.rest + y.hsaEmployer.rest)); return { ps: j.ps, st: j.st, y } })
}

// ---------------- contributions against the limits ----------------
const liveTransfer = (t: Data['transactions'][number]) => t.kind === 'transfer' && t.status !== 'void' && !t.duplicate_of
/** Money moved into a set of accounts between two dates from accounts outside the set (a move between two of them is not new money) — and not
 *  from any account in `notFrom`: a rollover out of a 401(k) or another IRA is not a contribution and does not use up a limit. */
export const transfersInto = (d: Pick<Data, 'transactions'>, ids: Set<string>, from: string, to: string, notFrom?: Set<string>) => round2(sum(d.transactions.filter(t => liveTransfer(t) && !!t.to_account_id && ids.has(t.to_account_id) && !(t.account_id && (ids.has(t.account_id) || notFrom?.has(t.account_id))) && t.date >= from && t.date <= to).map(t => +t.amount || 0)))
export interface ContribLine { key: 'deferral' | 'deferral2' | 'ira' | 'hsa'; label: string; ytd: number; rest: number; total: number; limit: number; catchUp: number; room: number; over: number; show: boolean; from: string }
export interface Contributions {
  year: number; limitsYear: number; age: number | null; coverage: 'self' | 'family'; lines: ContribLine[]
  /** employer match: collected so far, still to come this year, the year's total; what each paycheck leaves uncollected and what that adds up to
   *  over the paychecks left; the share of pay that collects all of it */
  match: { ytd: number; rest: number; total: number; missedPerCheck: number; missedRest: number; neededPct: number; hasFormula: boolean }
  /** this year so far, by account: the household's own money and the employer's */
  byAccount: Record<string, { own: number; employer: number }>
  hasPayroll: boolean; hasStubs: boolean
}
/** This year's contributions against each limit. Workplace plan = the 401(k) and Roth 401(k) money on the paycheck breakdowns. IRA = transfers into
 *  IRA and Roth IRA accounts this calendar year from ordinary accounts — a rollover from a workplace plan, another IRA or an HSA is not a
 *  contribution (a contribution made early in the year for the year before is counted in this one — the app cannot tell them apart). A second
 *  workplace-plan line appears when a breakdown is marked as the spouse's or partner's. HSA = payroll HSA and the employer's HSA money, plus transfers into HSA accounts. `rest` is what the paychecks still to come
 *  will add; `room` is what is left under the limit after that. */
export function contributions(d: Data, s: Settings, year = +today().slice(0, 4), asOf = today(), leftOverride?: { id: string; left: number } | null): Contributions {
  const lim = limitsFor(s, year, asOf), rows = payrollYear(d, s, year, asOf, leftOverride), accts = investAccounts(d)
  const ofType = (...ts: AcctTaxType[]) => accts.filter(a => ts.includes(acctTypeOf(s, a)))
  const lo = `${year}-01-01`, hi = asOf < `${year}-12-31` ? asOf : `${year}-12-31`, past = asOf >= lo
  // retirement-type accounts: money arriving from one of these is a rollover, not a contribution
  const sheltered = new Set(accts.filter(a => TAX_BUCKET[acctTypeOf(s, a)] !== 'taxable').map(a => a.id))
  const into = (as: Account[]) => (past ? transfersInto(d, new Set(as.map(a => a.id)), lo, hi, sheltered) : 0)
  const mine = rows.filter(r => !r.st.partner), theirs = rows.filter(r => r.st.partner)
  const S = (f: (r: PayrollRow) => number, rs = rows) => round2(sum(rs.map(f)))
  const line = (key: ContribLine['key'], label: string, ytd: number, rest: number, limit: number, catchUp: number, show: boolean, from: string): ContribLine => ({ key, label, ytd: round2(ytd), rest: round2(rest), total: round2(ytd + rest), limit, catchUp, room: round2(Math.max(0, limit - ytd - rest)), over: round2(Math.max(0, ytd + rest - limit)), show, from })
  const iras = ofType('ira', 'rothIra'), hsas = ofType('hsa'), plans = ofType('k401', 'roth401k')
  const hsaPay = S(r => r.y.by.hsa.ytd + r.y.hsaEmployer.ytd), hsaRest = S(r => r.y.by.hsa.rest + r.y.hsaEmployer.rest), hsaMoved = into(hsas)
  const lines = [
    line('deferral', 'Workplace plan (401(k), 403(b), 457) — your own money', S(r => r.y.by.k401.ytd + r.y.by.roth401k.ytd, mine), S(r => r.y.by.k401.rest + r.y.by.roth401k.rest, mine), lim.deferral, lim.deferralCatchUp, mine.length > 0 || !theirs.length && rows.length > 0, 'the paycheck breakdowns'),
    line('deferral2', 'Workplace plan — your spouse or partner', S(r => r.y.by.k401.ytd + r.y.by.roth401k.ytd, theirs), S(r => r.y.by.k401.rest + r.y.by.roth401k.rest, theirs), lim.partnerDeferral, 0, theirs.length > 0, 'the breakdowns marked as theirs'),
    line('ira', 'IRA (traditional and Roth together)', into(iras), 0, lim.ira, lim.iraCatchUp, iras.length > 0 || rows.length > 0, 'transfers into your IRA accounts'),
    line('hsa', `HSA (${lim.coverage === 'family' ? 'family' : 'self-only'} coverage, yours and your employer's)`, hsaPay + hsaMoved, hsaRest, lim.hsa, lim.hsaCatchUp, hsas.length > 0 || hsaPay + hsaRest > 0, 'payroll and transfers into your HSA'),
  ]
  const missedPerCheck = round2(sum(rows.filter(r => r.ps.status === 'Active').map(r => matchOf(r.ps, r.st).missed)))
  const match = { ytd: S(r => r.y.match.ytd), rest: S(r => r.y.match.rest), total: S(r => r.y.match.total), missedPerCheck, missedRest: round2(sum(rows.filter(r => r.ps.status === 'Active').map(r => matchOf(r.ps, r.st).missed * r.y.left))), neededPct: Math.max(0, ...rows.map(r => matchOf(r.ps, r.st).neededPct)), hasFormula: rows.some(r => +(r.st.matchPct || 0) > 0 && +(r.st.matchUpToPct || 0) > 0) }
  const byAccount: Contributions['byAccount'] = {}; const add = (id: string | null | undefined, own: number, employer: number) => { if (!id || !(own || employer)) return; const e = byAccount[id] || (byAccount[id] = { own: 0, employer: 0 }); e.own = round2(e.own + own); e.employer = round2(e.employer + employer) }
  for (const r of rows) { add(r.st.k401Account || (plans.length === 1 ? plans[0].id : null), r.y.by.k401.ytd + r.y.by.roth401k.ytd, r.y.match.ytd); add(r.st.hsaAccount || (hsas.length === 1 ? hsas[0].id : null), r.y.by.hsa.ytd, r.y.hsaEmployer.ytd) }
  if (past) for (const a of accts) add(a.id, transfersInto(d, new Set([a.id]), lo, hi, sheltered), 0)
  return { year, limitsYear: lim.L.year, age: lim.age, coverage: lim.coverage, lines, match, byAccount, hasPayroll: rows.length > 0, hasStubs: rows.some(r => hasStub(r.st)) }
}

// ---------------- the planner's own-accord inputs ----------------
export interface YearlyContributions { pretax: number; roth: number; taxable: number; total: number; payroll: number; match: number; transfers: number }
/** What goes into the investment and retirement accounts in a year at today's pace, by how it will be taxed: the 401(k), Roth 401(k) and employer
 *  match on the paychecks of the next twelve months (the 401(k) money stopped at the yearly limit), the payroll HSA when an HSA account is among
 *  the accounts, and the transfers into the accounts over the last twelve months (rollovers between them left out). Payroll money a breakdown sends
 *  to an account that is closed or left out of the figures is not counted — the planner's balance does not hold that account either. */
export function yearlyContributions(d: Data, s: Settings, asOf = today()): YearlyContributions {
  const accts = investAccounts(d), lim = limitsFor(s, +asOf.slice(0, 4), asOf), hasHsa = accts.some(a => acctTypeOf(s, a) === 'hsa')
  let pre = 0, roth = 0, match = 0, hsa = 0; const all = new Set(accts.map(a => a.id)), gone = (id: string | null | undefined) => !!id && !all.has(id)
  for (const who of [false, true]) { let p = 0, r = 0, m = 0
    for (const ps of d.paySchedules.filter(x => hasPayroll(x) && x.status === 'Active')) { const st = stubOf(s, ps.id), per = paychecksAYear(ps, asOf); if (!!st.partner !== who) continue
      if (!gone(st.k401Account)) { p += (+(st.k401 || 0) || 0) * per; r += (+(st.roth401k || 0) || 0) * per; m += matchOf(ps, st).perCheck * per }
      if (hasHsa && !gone(st.hsaAccount)) hsa += ((+(st.hsa || 0) || 0) + (+(st.hsaEmployer || 0) || 0)) * per }
    const cap = who ? lim.partnerDeferral : lim.deferral; if (p + r > cap) { const k = cap / (p + r); p *= k; r *= k; m *= k }   // paychecks past the limit take no 401(k) money and earn no match
    pre += p; roth += r; match += m }
  if (hsa > lim.hsa) hsa = lim.hsa
  const from = addDays(asOf, -365); const moved: Buckets = { pretax: 0, roth: 0, taxable: 0 }
  for (const t of d.transactions) if (liveTransfer(t) && t.to_account_id && all.has(t.to_account_id) && !(t.account_id && all.has(t.account_id)) && t.date > from && t.date <= asOf) { const a = accts.find(x => x.id === t.to_account_id)!; moved[TAX_BUCKET[acctTypeOf(s, a)]] += +t.amount || 0 }
  const payroll = pre + roth + hsa, transfers = moved.pretax + moved.roth + moved.taxable
  return { pretax: round2(pre + match + moved.pretax), roth: round2(roth + hsa + moved.roth), taxable: round2(moved.taxable), total: round2(payroll + match + transfers), payroll: round2(payroll), match: round2(match), transfers: round2(transfers) }
}
/** Gross pay a year at today's pace: every active pay schedule's gross × its paychecks in the next twelve months. */
export const yearlyGross = (d: Pick<Data, 'paySchedules'>, asOf = today()) => round2(sum(d.paySchedules.filter(p => p.status === 'Active').map(p => grossOf(p) * paychecksAYear(p, asOf))))
export interface PlannerAuto { contribution: boolean; detected: YearlyContributions; planExtra: number; income: boolean; gross: number; mix: boolean; implied: { ret: number; vol: number } | null }
/** What the planner follows on its own, for a set of typed inputs. The contribution follows the paychecks and transfers once any are found (plus
 *  whatever an applied Plan adds), the income follows the pay schedules once they carry any pay, and — only when "Follow my mix" is ticked — the
 *  return and volatility follow the actual mix. Each can be switched off, which brings the typed number back. */
export function plannerAuto(i: RetirementInputs, d: Data, s: Settings, asOf = today()): PlannerAuto {
  const detected = yearlyContributions(d, s, asOf), gross = yearlyGross(d, asOf), implied = impliedReturn(mixOf(d.holdings).pct, s.invest)
  return { contribution: i.autoContribution !== false && detected.total > 0, detected, planExtra: round2((+(s.plan?.retireExtra || 0) || 0) * 12), income: i.autoIncome !== false && gross > 0, gross, mix: i.followMix === true && !!implied, implied }
}
/** The inputs the planner actually runs on: the typed ones with whatever it follows on its own filled in. */
export function effectiveInputs(i: RetirementInputs, a: PlannerAuto): RetirementInputs {
  return { ...i, ...(a.contribution ? { annualContribution: Math.round(a.detected.total + a.planExtra) } : {}), ...(a.income ? { currentIncome: Math.round(a.gross) } : {}), ...(a.mix && a.implied ? { expectedReturn: a.implied.ret, returnStdDev: a.implied.vol } : {}) }
}
/** The household's planner as every page should read it: saved inputs over the defaults, with the own-accord figures filled in. */
export function resolveRetirement(d: Data, s: Settings, asOf = today()): RetirementInputs { const i = { ...RETIREMENT_DEFAULTS, ...(s.retirement || {}) }; return effectiveInputs(i, plannerAuto(i, d, s, asOf)) }
