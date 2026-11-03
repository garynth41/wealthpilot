// Debt payoff math: single-account projection, avalanche / snowball across the portfolio, totals.
import type { Account, Data } from '../app/data/types'
import { debtBal, debtPlanned, isRevolving, liabilities, debtPaidInRange } from './accounts'
import { sum } from './money'
import { curMonth, monthEnd, monthStart } from './dates'
import { monthlyIncome } from './paySchedule'

export const assumedPay = (a: Account, pay: number) => (pay > 0 ? pay : debtBal(a) >= 1 ? Math.max(25, debtBal(a) * 0.03) : 0)   // no minimum entered → typical issuer floor
/** One account at a fixed monthly payment; interest accrues monthly at APR/12. */
export function payoffProjection(bal: number, apr: number, pay: number, maxMonths = 360) {
  if (bal < 1) return { months: 0, interest: 0, series: [0], paidOff: true }
  const out = [bal]; let b = bal, interest = 0; const r = (+apr || 0) / 100 / 12
  for (let m = 1; m <= maxMonths; m++) { if (b <= 0.005) break; const i = b * r; interest += i; b = Math.max(0, b + i - pay); out.push(b); if (pay <= i && m > 1) return { months: Infinity, interest: Infinity, series: out, paidOff: false } }
  return { months: out.length - 1, interest, series: out, paidOff: b <= 0.005 }
}
export type Strategy = 'avalanche' | 'snowball'
/** Whole-portfolio simulation: every account gets its planned payment, `extra` goes to the focus account, freed payments roll over. */
export function simulate(accts: Account[], extra: number, strategy: Strategy = 'avalanche', minOnly = false) {
  let bal = accts.filter(a => debtBal(a) >= 1).map(a => ({ id: a.id, name: a.name, apr: (+a.apr || 0) / 100 / 12, b: debtBal(a), pay: assumedPay(a, minOnly ? +a.minimum_payment || 0 : debtPlanned(a)), paidOffMonth: null as number | null }))
  const series = [sum(bal.map(x => x.b))]; let interest = 0, m = 0, paid = 0
  while (bal.some(x => x.b > 0.005) && m < 600) {
    m++; let pool = extra
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
  const wApr = balance ? sum(a.map(x => debtBal(x) * (+x.apr || 0))) / balance : 0, interestMonth = sum(a.map(x => debtBal(x) * (+x.apr || 0) / 100 / 12))
  const income = monthlyIncome(d.paySchedules)
  return { count: a.length, balance, minimum, planned, paidMonth, limit, cardBal, util: limit ? cardBal / limit : 0, wApr, interestMonth, dti: income ? planned / income : null }
}
