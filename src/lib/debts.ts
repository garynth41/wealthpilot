// Debt payoff math: single-account projection, avalanche / snowball across the portfolio, totals.
import type { Account, Data } from '../app/data/types'
import { debtBal, debtPlanned, isRevolving, liabilities, debtPaidInRange } from './accounts'
import { sum } from './money'
import { curMonth, monthEnd, monthStart, today, parse, iso } from './dates'
import { monthlyIncome } from './paySchedule'

// Balances are the verified ones throughout (0.25.1): pass the household's data (`d`) and the bank's figure plus anything still outstanding
// is used — the same figure the debt totals, net worth and the Plan start from; without it, the bank's figure when there is one.
type Txns = Pick<Data, 'transactions'>
export const assumedPay = (a: Account, pay: number, d?: Txns) => (pay > 0 ? pay : debtBal(a, d) >= 1 ? Math.max(25, debtBal(a, d) * 0.03) : 0)   // no minimum entered → typical issuer floor
/** Promotional APRs (0.20.0): the rate that applies in month `m` from `from` (0 = this month). `promo_apr` runs through `promo_until`, then `apr`.
 *  A month takes the rate in force on its first day — for this month that is today (0.25.1: a promotion that ended earlier this month no
 *  longer applies), for later months the 1st. So aprAt(a, 0) is the rate in force now, the same one hasPromo() shows. */
export function aprAt(a: Pick<Account, 'apr' | 'promo_apr' | 'promo_until'>, m: number, from = today()): number {
  if (a.promo_apr == null || !a.promo_until) return +a.apr || 0
  const d = parse(from); d.setDate(1); d.setMonth(d.getMonth() + m)
  const on = m <= 0 ? from.slice(0, 10) : iso(d)
  return on <= a.promo_until.slice(0, 10) ? +a.promo_apr : +a.apr || 0
}
export const hasPromo = (a: Pick<Account, 'promo_apr' | 'promo_until'>, from = today()) => a.promo_apr != null && !!a.promo_until && a.promo_until.slice(0, 10) >= from
/** Months (counting this one) the promotional rate still runs; 0 when it has ended or there is none. */
export function promoMonthsLeft(a: Pick<Account, 'promo_apr' | 'promo_until'>, from = today()): number {
  if (!hasPromo(a, from)) return 0
  let m = 0; while (m < 120) { const d = parse(from); d.setDate(1); d.setMonth(d.getMonth() + m); if (iso(d) > a.promo_until!.slice(0, 10)) break; m++ }
  return m
}
/** One account at a fixed monthly payment; interest accrues monthly at APR/12. `apr` may be a number or a per-month rate schedule (see aprAt). */
export function payoffProjection(bal: number, apr: number | ((m: number) => number), pay: number, maxMonths = 360) {
  if (bal < 1) return { months: 0, interest: 0, series: [0], paidOff: true }
  const out = [bal]; let b = bal, interest = 0; const rate = (m: number) => (typeof apr === 'function' ? apr(m) : +apr || 0) / 100 / 12
  for (let m = 1; m <= maxMonths; m++) { if (b <= 0.005) break; const i = b * rate(m - 1); interest += i; b = Math.max(0, b + i - pay); out.push(b); if (pay <= i && m > 1) return { months: Infinity, interest: Infinity, series: out, paidOff: false } }
  return { months: out.length - 1, interest, series: out, paidOff: b <= 0.005 }
}
export interface PromoAlert { account: Account; promoApr: number; apr: number; endsOn: string; monthsLeft: number; balanceAtEnd: number; interestAfterPerMonth: number; payToClear: number; clearsInTime: boolean }
/** Cards whose promotional rate ends within `horizonMonths`: the balance the planned payment leaves when the rate steps up, the interest that then starts, and the payment that would clear it in time. */
export function promoAlerts(accts: Account[], horizonMonths = 12, from = today(), d?: Txns): PromoAlert[] {
  return accts.filter(a => debtBal(a, d) >= 1 && hasPromo(a, from)).map(a => {
    const monthsLeft = promoMonthsLeft(a, from); const pay = assumedPay(a, debtPlanned(a), d); const r = +a.promo_apr! / 100 / 12; const owed = debtBal(a, d)
    let b = owed; for (let m = 0; m < monthsLeft; m++) { b = Math.max(0, b * (1 + r) - pay) }
    // payment that lands at zero exactly when the promo ends (annuity at the promo rate; straight division at 0%)
    const payToClear = monthsLeft <= 0 ? owed : r > 0 ? owed * r / (1 - Math.pow(1 + r, -monthsLeft)) : owed / monthsLeft
    return { account: a, promoApr: +a.promo_apr!, apr: +a.apr || 0, endsOn: a.promo_until!.slice(0, 10), monthsLeft, balanceAtEnd: Math.round(b * 100) / 100, interestAfterPerMonth: Math.round(b * (+a.apr || 0) / 1200 * 100) / 100, payToClear: Math.ceil(payToClear), clearsInTime: b <= 0.005 }
  }).filter(x => x.monthsLeft <= horizonMonths).sort((x, y) => x.endsOn.localeCompare(y.endsOn))
}
export type Strategy = 'avalanche' | 'snowball'
/** The payoff order as of this month (0.25.1) — the order `simulate` sends extra in during its first month: avalanche by the rate in force
 *  now (a card on a 0% promotion waits until it ends), snowball by the smallest balance. */
export function payoffOrder(accts: Account[], strategy: Strategy = 'avalanche', from = today(), d?: Txns): Account[] {
  return accts.slice().sort((x, y) => strategy === 'avalanche' ? aprAt(y, 0, from) - aprAt(x, 0, from) : debtBal(x, d) - debtBal(y, d))
}
/** Whole-portfolio simulation: every account gets its planned payment, `extra` goes to the focus account, freed payments roll over. */
export function simulate(accts: Account[], extra: number, strategy: Strategy = 'avalanche', minOnly = false, d?: Txns) {
  const from = today(); let bal = accts.filter(a => debtBal(a, d) >= 1).map(a => ({ id: a.id, name: a.name, apr: aprAt(a, 0, from) / 100 / 12, rate: (m: number) => aprAt(a, m, from) / 100 / 12, b: debtBal(a, d), pay: assumedPay(a, minOnly ? +a.minimum_payment || 0 : debtPlanned(a), d), paidOffMonth: null as number | null }))
  const series = [sum(bal.map(x => x.b))]; let interest = 0, m = 0, paid = 0
  while (bal.some(x => x.b > 0.005) && m < 600) {
    m++; let pool = extra
    bal.forEach(x => { x.apr = x.rate(m - 1) })   // promotional rates step up on their end date; avalanche re-ranks on the live rate
    bal.sort((a, b) => strategy === 'avalanche' ? b.apr - a.apr : a.b - b.b)
    bal.forEach(x => { if (x.b <= 0.005) { pool += x.pay; return } const i = x.b * x.apr; interest += i; x.b += i; const p = Math.min(x.b, x.pay); x.b -= p; pool += x.pay - p; paid += p })   // a final payment smaller than the planned one frees the rest this month
    for (const x of bal) { if (pool <= 0) break; if (x.b <= 0.005) continue; const p = Math.min(x.b, pool); x.b -= p; pool -= p; paid += p }
    bal.forEach(x => { if (x.b <= 0.005 && x.paidOffMonth == null) x.paidOffMonth = m })
    series.push(sum(bal.map(x => Math.max(0, x.b))))
    if (m > 1 && series[m] >= series[m - 1] - 0.01) return { months: Infinity, interest: Infinity, series, order: bal, paid }
  }
  return { months: m, interest, series, order: bal, paid }
}
export function debtTotals(d: Data) {
  const a = liabilities(d), m = curMonth()
  const balance = sum(a.map(x => debtBal(x, d))), minimum = sum(a.map(x => +x.minimum_payment || 0)), planned = sum(a.map(debtPlanned)), paidMonth = sum(a.map(x => debtPaidInRange(d, x, monthStart(m), monthEnd(m))))
  const rev = a.filter(x => isRevolving(x) && +(x.credit_limit || 0) > 0); const limit = sum(rev.map(x => +x.credit_limit!)), cardBal = sum(rev.map(x => debtBal(x, d)))
  // the rate in force this month (0.25.1): a card on a promotional rate costs its promotional rate until the promotion ends
  const wApr = balance ? sum(a.map(x => debtBal(x, d) * aprAt(x, 0))) / balance : 0, interestMonth = sum(a.map(x => debtBal(x, d) * aprAt(x, 0) / 100 / 12))   // the same verified balances as the total (0.25.1)
  const income = monthlyIncome(d.paySchedules)
  return { count: a.length, balance, minimum, planned, paidMonth, limit, cardBal, util: limit ? cardBal / limit : 0, wApr, interestMonth, dti: income ? planned / income : null }
}
