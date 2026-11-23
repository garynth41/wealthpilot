// Tax moves (0.39.0): things that can still be done about this year's tax, each with what it is worth. Every figure comes from running the Tax
// page's own estimate twice — as things stand, and with the move made — so the saving is the real difference at this household's income, brackets
// and state, not a rule of thumb. Planning figures, not advice. Pure functions.
import type { Data, Settings } from '../app/data/types'
import { estimateTax, resolveProfile, tableFor, withholdingToBreakEven, mainW2Schedule, type TaxEstimate, type TaxItem, type TaxItemKind, type TaxProfile } from './tax'
import { contributions, payrollYear } from './contrib'
import { harvestCandidates, ORDINARY_OFFSET_LIMIT, isTaxableAccount, lotSummary } from './lots'
import { holdingGain } from './portfolio'
import { round2, sum } from './money'
import { today } from './dates'

export interface TaxMove {
  id: 'match' | 'k401' | 'hsa' | 'ira' | 'harvest' | 'gains0' | 'withhold_more' | 'withhold_less' | 'breakdown'
  /** save = cuts this year's tax; free = money from the employer; avoid = a penalty not paid; later = tax avoided in a later year; info = no money either way */
  kind: 'save' | 'free' | 'avoid' | 'later' | 'info'
  title: string; detail: string; amount: number; by: string; to?: string
}
export interface TaxMoves { moves: TaxMove[]; together: number; year: number; open: boolean }
const usd = (v: number) => '$' + Math.round(v).toLocaleString('en-US')
/** What this year's taxes — federal, state, city and school district — come to with extra rows added to the profile. */
const withRows = (d: Data, s: Settings, p: Partial<TaxProfile>, asOf: string, rows: Array<[TaxItemKind, number]>): TaxEstimate => {
  const base = resolveProfile(d, s, p, asOf); const extra: TaxItem[] = rows.filter(r => Math.abs(r[1]) > 0.005).map(([kind, amount], n) => ({ id: 'move' + n, kind, label: '', amount, source: 'manual' }))
  return estimateTax(d, s, { ...p, items: [...base.items, ...extra] }, asOf)
}
/** The moves open to this household for the profile's tax year, largest first. Nothing is listed for a year that has ended except what its filing
 *  deadline still allows (IRA and HSA contributions count until the return is due). `together` is the saving from making the 401(k), HSA and
 *  loss-harvesting moves at once — less than their sum when together they drop the income into a lower bracket. */
export function taxMoves(d: Data, s: Settings, p0?: Partial<TaxProfile>, asOf = today()): TaxMoves {
  const p = resolveProfile(d, s, p0, asOf), year = p.year, T = tableFor(year), e = estimateTax(d, s, p0, asOf)
  const yearOpen = asOf <= `${year}-12-31` && asOf >= `${year}-01-01`, filing = T.calendar.find(c => c.kind === 'filing')?.date || `${year + 1}-04-15`, beforeFiling = asOf <= filing && asOf >= `${year}-01-01`
  const moves: TaxMove[] = []; const saving = (rows: Array<[TaxItemKind, number]>) => round2(e.totalTax - withRows(d, s, p0 || {}, asOf, rows).totalTax)
  const main = mainW2Schedule(d, year, asOf); const c = contributions(d, s, year, asOf, main && p.paychecksLeft != null ? { id: main.id, left: p.paychecksLeft } : null)
  const fedShare = (total: number, rows: Array<[TaxItemKind, number]>) => { const w = withRows(d, s, p0 || {}, asOf, rows); const f = round2(e.federal.total - w.federal.total); return total > 0.5 ? ` (federal ${usd(f)}, state and local ${usd(total - f)})` : '' }
  const joint: Array<[TaxItemKind, number]> = []
  if (e.income.w2 > 0 && !c.hasStubs && beforeFiling) moves.push({ id: 'breakdown', kind: 'info', title: 'Add what comes out of your paycheck', detail: 'The estimate is taxing your full gross pay and counting no tax as withheld. Enter your 401(k), health premiums and the tax withheld once on Income & Pay Periods and every figure here follows your paychecks from then on.', amount: 0, by: 'any time', to: '/income' })
  if (yearOpen && c.hasStubs) {
    // the employer match left on the table
    if (c.match.hasFormula && c.match.missedRest > 0.5) moves.push({ id: 'match', kind: 'free', title: `Collect the full employer match: ${usd(c.match.missedRest)} more this year`, detail: `Your employer matches up to ${c.match.neededPct}% of pay and you are putting in less, leaving ${usd(c.match.missedPerCheck)} uncollected each paycheck. Raising your 401(k) to ${c.match.neededPct}% of pay collects it on every paycheck left.`, amount: c.match.missedRest, by: `December 31, ${year}`, to: '/income' })
    // room under the 401(k) limit, as far as the pay still to come can fill it
    const dl = c.lines.find(l => l.key === 'deferral')!, left = main ? p.paychecksLeft || 0 : 0
    const restGross = round2(sum(estimateRestGross(d, s, year, asOf, main ? { id: main.id, left } : null)))
    const more = round2(Math.min(dl.room, Math.max(0, restGross - dl.rest)))
    const big = restGross > 0 && more > restGross * 0.5   // more than half of the pay still to come: say "up to"
    if (dl.show && more >= 50 && left > 0) { const rows: Array<[TaxItemKind, number]> = [['pretax_deduction', more]]; const sv = saving(rows); joint.push(...rows)
      if (sv > 0.5) moves.push({ id: 'k401', kind: 'save', title: `Put ${big ? 'up to ' : ''}${usd(more)} more into your 401(k) — saves ${big ? 'up to' : 'about'} ${usd(sv)}`, detail: `${more + 0.5 >= dl.room ? `That fills the ${usd(dl.limit)} limit for ${year}` : `That is all the pay still to come in ${year}; the limit is ${usd(dl.limit)}`}${dl.catchUp ? `, which includes the ${usd(dl.catchUp)} catch-up for your age` : ''}. In full it is ${usd(more / left)} more from each of the ${left} paycheck${left === 1 ? '' : 's'} left${big ? ' — most of each paycheck, so any part of it saves in proportion' : ''}, and cuts this year's income tax by about ${usd(sv)}${fedShare(sv, rows)}. Pre-tax 401(k) money is taxed when you take it out in retirement.`, amount: sv, by: `December 31, ${year}`, to: '/income' }) }
  }
  if (beforeFiling) {
    const hl = c.lines.find(l => l.key === 'hsa')!
    if (hl.show && hl.room >= 50) { const rows: Array<[TaxItemKind, number]> = [['adjustment', hl.room]]; const sv = saving(rows); joint.push(...rows)
      if (sv > 0.5) moves.push({ id: 'hsa', kind: 'save', title: `Put ${usd(hl.room)} more into your HSA — saves about ${usd(sv)}`, detail: `That fills the ${usd(hl.limit)} HSA limit for ${year} (${c.coverage === 'family' ? 'family' : 'self-only'} coverage${hl.catchUp ? ', with the catch-up from 55' : ''}); you must be covered by a high-deductible health plan to contribute. Contributions for ${year} count until the return is due. Through payroll it also escapes Social Security and Medicare tax, which is not counted here.`, amount: sv, by: `the ${year} filing deadline`, to: '/investments' }) }
    const il = c.lines.find(l => l.key === 'ira')!
    if (e.income.w2 + e.income.se > 0 && il.room >= 50) { const amt = Math.min(il.room, e.income.w2 + e.income.se), sv = saving([['adjustment', amt]])
      if (sv > 0.5) moves.push({ id: 'ira', kind: 'save', title: `Up to ${usd(amt)} into an IRA — saves up to ${usd(sv)}`, detail: `A traditional IRA contribution for ${year} can be made until the return is due and would cut this year's tax by about ${usd(sv)} if it is fully deductible. Whether it is depends on your income when you or your spouse have a retirement plan at work — the estimate here does not check that. A Roth IRA contribution saves nothing now; its growth is tax-free later.`, amount: sv, by: `the ${year} filing deadline`, to: '/investments' }) }
  }
  if (yearOpen) {
    // losses that could be taken: first against this year's gains, then up to the yearly limit against other income
    const hv = harvestCandidates(d, { asOf }), loss = round2(sum(hv.filter(h => !h.wash).map(h => h.loss)))
    if (loss >= 100) { const g = Math.max(0, e.income.ltcg), vs = Math.min(loss, g), ord = Math.min(ORDINARY_OFFSET_LIMIT(e.status), loss - vs); const rows: Array<[TaxItemKind, number]> = [['capital_gains', -vs], ['other', -ord]]; const sv = saving(rows); joint.push(...rows)
      if (sv > 0.5) moves.push({ id: 'harvest', kind: 'save', title: `Take ${usd(loss)} of investment losses — saves about ${usd(sv)}`, detail: `${hv.filter(h => !h.wash).length} holding${hv.filter(h => !h.wash).length === 1 ? ' is' : 's are'} below cost in your taxable accounts. Sold this year, ${vs > 0 ? `${usd(vs)} cancels gains you have entered and ` : ''}${usd(ord)} comes off your other income${loss - vs - ord > 0.5 ? `; the remaining ${usd(loss - vs - ord)} carries to later years` : ''}. Do not buy the same security back within 30 days before or after the sale.`, amount: sv, by: `December 31, ${year}`, to: '/investments' }) }
    // long-term gains that would be taxed at 0% federally this year
    const L = T.ltcg[e.status], room = round2(L.zeroUpTo - e.taxableIncome), gains = unrealizedLongGains(d, asOf)
    if (room >= 500 && gains >= 500) { const amt = Math.min(room, gains), cost = round2(withRows(d, s, p0 || {}, asOf, [['capital_gains', amt]]).totalTax - e.totalTax), later = round2(amt * 0.15), net = round2(later - cost)
      if (net > 0.5) moves.push({ id: 'gains0', kind: 'later', title: `Take up to ${usd(amt)} of long-term gains at the 0% federal rate`, detail: `Your taxable income is ${usd(room)} below the top of the 0% band for long-term gains, and your taxable accounts hold ${usd(gains)} of long-term gains. Selling and buying back resets the cost, so about ${usd(later)} of federal tax at 15% is never owed on that growth. It adds about ${usd(Math.max(0, cost))} to this year's tax${cost > 0.5 ? ' (state, and any knock-on effect on credits or benefits)' : ''}.`, amount: net, by: `December 31, ${year}`, to: '/investments' }) }
    // withholding: a penalty to avoid, or a refund that could be in the paychecks
    const be = withholdingToBreakEven(d, s, p0 || {}, asOf), left = p.paychecksLeft || 0
    if (!e.safeHarbor.met && (e.safeHarbor.penaltyEstimate >= 10 || e.safeHarbor.shortfall >= 1000)) moves.push({ id: 'withhold_more', kind: 'avoid', title: `Close the ${usd(e.safeHarbor.shortfall)} withholding gap — avoids about ${usd(e.safeHarbor.penaltyEstimate)} of penalty`, detail: left > 0 ? `You are short of the ${e.safeHarbor.basis} safe harbor. ${usd(e.safeHarbor.shortfall / left)} more withheld from each of the ${left} paycheck${left === 1 ? '' : 's'} left (W-4, step 4c) closes it; withholding counts as paid evenly through the year, so it also clears the earlier quarters. An estimated payment works too, but only from the day it is made.` : `You are short of the ${e.safeHarbor.basis} safe harbor. An estimated payment before the next deadline stops more penalty from building.`, amount: e.safeHarbor.penaltyEstimate, by: left > 0 ? 'your next paycheck' : 'the next estimated-payment deadline', to: '/tax' })
    else if (e.refund > 2000 && be != null && be < 0 && left > 0) moves.push({ id: 'withhold_less', kind: 'info', title: `${usd(-be)} more in each paycheck instead of a ${usd(e.refund)} refund`, detail: `At this pace the IRS returns ${usd(e.refund)} after you file. Withholding ${usd(-be)} less from each of the ${left} paycheck${left === 1 ? '' : 's'} left (a new W-4) puts that money in your pay now. The tax is the same either way.`, amount: 0, by: 'your next paycheck', to: '/tax' })
  }
  const order: Record<TaxMove['kind'], number> = { free: 0, avoid: 1, save: 2, later: 3, info: 4 }
  moves.sort((a, b) => order[a.kind] - order[b.kind] || b.amount - a.amount)
  return { moves, together: joint.length ? Math.max(0, saving(joint)) : 0, year, open: yearOpen || beforeFiling }
}
/** Gross pay still to come this tax year on the payroll jobs — the most that 401(k) money could still be taken from. */
function estimateRestGross(d: Data, s: Settings, year: number, asOf: string, leftOverride: { id: string; left: number } | null): number[] { return contributionsRows(d, s, year, asOf, leftOverride).map(r => r.y.gross.rest) }
const contributionsRows = (d: Data, s: Settings, year: number, asOf: string, lo: { id: string; left: number } | null) => payrollYear(d, s, year, asOf, lo).filter(r => r.ps.status === 'Active')
/** Long-term gains sitting in taxable accounts: the gains on lots held over a year, or, for a holding with no lots, its whole gain (assumed long-term). */
export function unrealizedLongGains(d: Pick<Data, 'holdings' | 'lots' | 'accounts'>, asOf = today()): number {
  let g = 0
  for (const h of d.holdings) { const a = h.account_id ? d.accounts.find(x => x.id === h.account_id) || null : null; if (!isTaxableAccount(a) || h.asset_class === 'cash' || !(+h.price > 0)) continue
    const ls = lotSummary(d, h, asOf); g += ls.lots.length ? sum(ls.lots.filter(l => l.term === 'long' && l.gain > 0).map(l => l.gain)) : Math.max(0, +h.cost_basis > 0 ? holdingGain(h) : 0) }
  return round2(g)
}
