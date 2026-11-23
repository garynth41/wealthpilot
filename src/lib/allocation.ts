// Target mix, drift and performance (0.39.0). Holdings are sorted into five groups; a target mix is set in those groups; drift is how far the
// actual mix has moved from it, with what to sell, what to buy and where new contributions should go. Performance reads the balance history the
// database already keeps for every account and separates what was put in from what the investments earned. Pure functions.
import type { Account, AllocGroup, Data, Holding, InvestSettings, Settings } from '../app/data/types'
import { holdingValue } from './portfolio'
import { balanceOf } from './accounts'
import { round2, sum } from './money'
import { addDays, monthEnd, monthKey, mAdd, today } from './dates'
import { payDates } from './paySchedule'
import { hasPayroll, matchOf, stubOf } from './paycheck'

export const ALLOC_GROUPS: AllocGroup[] = ['stocks', 'bonds', 'cash', 'real_estate', 'other']
export const ALLOC_LABEL: Record<AllocGroup, string> = { stocks: 'Stocks', bonds: 'Bonds', cash: 'Cash', real_estate: 'Real estate', other: 'Crypto, alternatives, other' }
/** The group a holding counts in. Funds are stock funds unless their sector says otherwise: a fund (ETF, mutual fund, stock) whose sector is
 *  "Fixed income" counts as bonds, "Cash" as cash and "Real estate" as real estate. */
export function groupOf(h: Pick<Holding, 'asset_class' | 'sector'>): AllocGroup {
  if (h.asset_class === 'bond') return 'bonds'; if (h.asset_class === 'cash') return 'cash'; if (h.asset_class === 'real_estate') return 'real_estate'
  if (h.asset_class === 'crypto' || h.asset_class === 'alternative' || h.asset_class === 'other') return 'other'
  return h.sector === 'Fixed income' ? 'bonds' : h.sector === 'Cash' ? 'cash' : h.sector === 'Real estate' ? 'real_estate' : 'stocks'
}
export type Mix = Record<AllocGroup, number>
const zero = (): Mix => ({ stocks: 0, bonds: 0, cash: 0, real_estate: 0, other: 0 })
/** The actual mix: dollars in each group and each group's share (0–1) of the total. */
export function mixOf(holdings: Holding[]): { value: Mix; pct: Mix; total: number } {
  const value = zero(); for (const h of holdings) value[groupOf(h)] = round2(value[groupOf(h)] + holdingValue(h))
  const total = round2(sum(ALLOC_GROUPS.map(g => value[g]))); const pct = zero(); for (const g of ALLOC_GROUPS) pct[g] = total > 0 ? value[g] / total : 0
  return { value, pct, total }
}
/** A saved target as whole percents for all five groups; null when none is set or it does not add up to 100. */
export function targetOf(inv: InvestSettings | undefined): Mix | null {
  const t = inv?.targets; if (!t) return null; const out = zero(); for (const g of ALLOC_GROUPS) out[g] = Math.max(0, +(t[g] ?? 0) || 0)
  return Math.abs(sum(ALLOC_GROUPS.map(g => out[g])) - 100) < 0.01 ? out : null
}
/** The actual mix rounded to whole percents that add up to exactly 100 (the largest group takes the rounding difference). */
export function mixAsTarget(pct: Mix): Mix { const out = zero(); for (const g of ALLOC_GROUPS) out[g] = Math.round(pct[g] * 100); const top = [...ALLOC_GROUPS].sort((a, b) => out[b] - out[a])[0]; out[top] += 100 - sum(ALLOC_GROUPS.map(g => out[g])); return out }
/** A common rule of thumb, offered as a starting point and nothing more: 110 minus your age in stocks (kept between 20% and 90%), 5% cash, the rest bonds. */
export function ruleOfThumb(age: number): Mix { const stocks = Math.min(90, Math.max(20, Math.round(110 - (+age || 0)))); return { stocks, bonds: 100 - stocks - 5, cash: 5, real_estate: 0, other: 0 } }

/** How far off target a group may be, in percentage points, before the mix counts as drifted. */
export const DRIFT_BAND = 5
export interface DriftRow { group: AllocGroup; value: number; pct: number; target: number; diff: number; amount: number }
export interface Drift { rows: DriftRow[]; total: number; maxDiff: number; drifted: boolean; sell: DriftRow[]; buy: DriftRow[]; moveTotal: number }
/** The actual mix against the target. `diff` = actual − target in percentage points; `amount` = dollars over (+) or under (−) target. To get back to
 *  target, the overweight groups sell their `amount` and the underweight groups buy theirs; `moveTotal` is the money that has to change groups. */
export function driftOf(holdings: Holding[], target: Mix): Drift {
  const m = mixOf(holdings)
  const rows = ALLOC_GROUPS.map(g => ({ group: g, value: m.value[g], pct: m.pct[g], target: target[g], diff: round2(m.pct[g] * 100 - target[g]), amount: round2(m.value[g] - m.total * target[g] / 100) })).filter(r => r.value > 0 || r.target > 0)
  const maxDiff = rows.length ? Math.max(...rows.map(r => Math.abs(r.diff))) : 0
  const sell = rows.filter(r => r.amount > 0.5).sort((a, b) => b.amount - a.amount), buy = rows.filter(r => r.amount < -0.5).sort((a, b) => a.amount - b.amount)
  return { rows, total: m.total, maxDiff, drifted: m.total > 0 && maxDiff > DRIFT_BAND, sell, buy, moveTotal: round2(sum(sell.map(r => r.amount))) }
}
/** Getting back to target without selling: send new money to the underweight groups, in proportion to how far under each is. `months` is how long
 *  the yearly contribution takes to close the gap (null when nothing is contributed or nothing is under target). The new money makes the whole
 *  portfolio bigger, so the underweight groups have a larger target to reach: with their target shares adding up to `t`, closing a gap of G takes
 *  G ÷ (1 − t) of new money, not G. */
export function contributionPlan(dr: Drift, yearlyContribution: number): { split: Array<{ group: AllocGroup; share: number; perMonth: number }>; months: number | null } {
  const under = sum(dr.buy.map(r => -r.amount)), monthly = Math.max(0, yearlyContribution) / 12
  if (!(under > 0)) return { split: [], months: null }
  const t = sum(dr.buy.map(r => r.target)) / 100, need = t < 1 ? under / (1 - t) : Infinity
  return { split: dr.buy.map(r => ({ group: r.group, share: -r.amount / under, perMonth: round2(monthly * -r.amount / under) })), months: monthly > 0 && isFinite(need) ? Math.ceil(need / monthly - 1e-9) : null }
}

/** Long-run planning assumptions, nominal, a year: what each group is assumed to return and how much it swings. These are starting points a household
 *  can change (Settings.invest.assumptions) — not forecasts, and not taken from any one source. */
export const ASSUMPTIONS: Record<AllocGroup, { ret: number; vol: number }> = { stocks: { ret: 0.07, vol: 0.16 }, bonds: { ret: 0.04, vol: 0.06 }, cash: { ret: 0.03, vol: 0.01 }, real_estate: { ret: 0.06, vol: 0.14 }, other: { ret: 0.06, vol: 0.2 } }
export const assumptionsOf = (inv?: InvestSettings): Record<AllocGroup, { ret: number; vol: number }> => Object.fromEntries(ALLOC_GROUPS.map(g => [g, { ...ASSUMPTIONS[g], ...(inv?.assumptions?.[g] || {}) }])) as Record<AllocGroup, { ret: number; vol: number }>
/** How much two groups are assumed to move together: cash with nothing, stocks and real estate closely (0.6), every other pair loosely (0.3). */
const corr = (a: AllocGroup, b: AllocGroup) => (a === b ? 1 : a === 'cash' || b === 'cash' ? 0 : (a === 'stocks' && b === 'real_estate') || (a === 'real_estate' && b === 'stocks') ? 0.6 : 0.3)
/** The return and volatility a mix implies under the assumptions: the weighted return, and the portfolio's standard deviation from the groups'
 *  volatilities and the correlations above. Null when there is nothing invested. */
export function impliedReturn(pct: Mix, inv?: InvestSettings): { ret: number; vol: number } | null {
  const A = assumptionsOf(inv); if (!(sum(ALLOC_GROUPS.map(g => pct[g])) > 0)) return null
  let ret = 0, v = 0; for (const a of ALLOC_GROUPS) { ret += pct[a] * A[a].ret; for (const b of ALLOC_GROUPS) v += pct[a] * pct[b] * A[a].vol * A[b].vol * corr(a, b) }
  return { ret: Math.round(ret * 10000) / 10000, vol: Math.round(Math.sqrt(Math.max(0, v)) * 10000) / 10000 }
}

// ---------------- performance over time ----------------
/** The accounts the Investments page is about: active investment and retirement accounts that are not left out of the figures. */
export const investAccounts = (d: Pick<Data, 'accounts'>): Account[] => d.accounts.filter(a => a.status === 'Active' && !a.excluded && (a.kind === 'investment' || a.kind === 'retirement'))
/** An account's value today: the larger of its balance and its itemised holdings (the same rule as the Retirement assets tile). */
export const accountValue = (d: Data, a: Account) => Math.max(balanceOf(a, d), round2(sum(d.holdings.filter(h => h.account_id === a.id).map(holdingValue))))
export interface PerfPoint { month: string; value: number; flow: number; growth: number; ret: number | null; contributed: number; earned: number }
export interface Performance { points: PerfPoint[]; from: string | null; months: number; contributed: number; earned: number; ytd: number | null; year: number | null; sinceStart: number | null; annualized: number | null }
/** Month by month: what the investment and retirement accounts were worth, what went in and what the investments earned.
 *  Value = each account's last recorded balance on or before the month's end (the database's balance history; this month, the latest one). An
 *  account with no recorded balance is left out, and so is the value of holdings that the account's balance does not include.
 *  Money in = transfers into those accounts less transfers out (moves between two of them cancel), plus the payroll money from the paycheck
 *  breakdown — 401(k), Roth 401(k) and employer match on each payday, and payroll HSA — at today's per-paycheck amounts for earlier paydays too.
 *  Payroll money is counted only when the account it goes into is one of the followed accounts: the account named on the breakdown, else the only
 *  workplace plan (or HSA), else any followed account of that type. Earned = change in value − money in. Each month's return is earned ÷ (starting value + half the money in), the
 *  Modified Dietz method; months are chained for year-to-date, the last twelve months and since the start (annualized past a year).
 *  History starts at the first month every followed account has a balance; fewer than two months gives no return. */
export function performance(d: Data, s: Pick<Settings, 'payStubs' | 'invest'>, asOf = today(), typeOf?: (a: Account) => string): Performance {
  const none: Performance = { points: [], from: null, months: 0, contributed: 0, earned: 0, ytd: null, year: null, sinceStart: null, annualized: null }
  const all = investAccounts(d); const hist = new Map(all.map(a => [a.id, (d.balances || []).filter(b => b.account_id === a.id && (b.balance != null || b.bank_balance != null)).sort((x, y) => x.as_of.localeCompare(y.as_of))]))
  const accts = all.filter(a => hist.get(a.id)!.length > 0); const ids = new Set(accts.map(a => a.id))   // an account with no recorded balance yet cannot be followed
  const firsts = accts.map(a => hist.get(a.id)![0].as_of); if (!firsts.length) return none
  const start = monthKey(firsts.sort()[firsts.length - 1]), end = monthKey(asOf); if (start >= end) return none
  const valueAt = (a: Account, date: string) => { const h = hist.get(a.id)!; let v: number | null = null; for (const p of h) { if (p.as_of > date) break; v = +(p.balance ?? p.bank_balance ?? 0) } return v ?? 0 }
  const ty = typeOf || ((a: Account) => (a.kind === 'retirement' ? 'k401' : 'taxable')); const isPlan = (a: Account) => ty(a) === 'k401' || ty(a) === 'roth401k', isHsa = (a: Account) => ty(a) === 'hsa'
  /** does payroll money of this kind land in a followed account? */
  const lands = (named: string | null | undefined, kind: (a: Account) => boolean) => { const dest = named || (all.filter(kind).length === 1 ? all.filter(kind)[0].id : null); return dest ? ids.has(dest) : accts.some(kind) }
  const payroll = d.paySchedules.filter(p => hasPayroll(p) && (p.status === 'Active' || (p.status === 'Ended' && !!p.ends_on))).map(p => ({ p: p.status === 'Active' ? p : { ...p, status: 'Active' as const }, st: stubOf(s, p.id) }))
  const flowIn = (from: string, to: string) => {
    let f = 0
    for (const t of d.transactions) { if (t.kind !== 'transfer' || t.status === 'void' || t.duplicate_of || t.date < from || t.date > to) continue; const into = !!t.to_account_id && ids.has(t.to_account_id), outOf = !!t.account_id && ids.has(t.account_id); if (into && !outOf) f += +t.amount || 0; else if (outOf && !into) f -= +t.amount || 0 }
    for (const { p, st } of payroll) { const per = (lands(st.k401Account, isPlan) ? (+(st.k401 || 0) || 0) + (+(st.roth401k || 0) || 0) + matchOf(p, st).perCheck : 0) + (lands(st.hsaAccount, isHsa) ? (+(st.hsa || 0) || 0) + (+(st.hsaEmployer || 0) || 0) : 0); if (per > 0) f += per * payDates(p, from, to).length }
    return round2(f)
  }
  const points: PerfPoint[] = []; let prev = round2(sum(accts.map(a => valueAt(a, monthEnd(start))))), contributed = 0, earned = 0
  for (let m = mAdd(start, 1); m <= end; m = mAdd(m, 1)) {
    const last = m === end; const value = round2(sum(accts.map(a => valueAt(a, last ? asOf : monthEnd(m)))))
    const flow = flowIn(m + '-01', last ? asOf : monthEnd(m)), growth = round2(value - prev - flow), base = prev + flow / 2
    contributed = round2(contributed + flow); earned = round2(earned + growth)
    points.push({ month: m, value, flow, growth, ret: base > 0 ? growth / base : null, contributed, earned }); prev = value
  }
  const chain = (ps: PerfPoint[]) => { const xs = ps.filter(p => p.ret != null); return xs.length ? xs.reduce((a, p) => a * (1 + (p.ret as number)), 1) - 1 : null }
  const yr = asOf.slice(0, 4), sinceStart = chain(points), n = points.length
  return { points, from: addDays(monthEnd(start), 0), months: n, contributed, earned, ytd: chain(points.filter(p => p.month.startsWith(yr))), year: n > 12 ? chain(points.slice(-12)) : null, sinceStart, annualized: sinceStart != null && n > 12 ? Math.pow(1 + sinceStart, 12 / n) - 1 : null }
}
