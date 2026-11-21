// "How accurate was last month's forecast?" (0.35.0 — Gary, Nov 21).
// Once a month the app saves what the cash calendar expects for the rest of that month (forecastSnapshot → table forecast_snapshots,
// migration 0024). When the month is over the saved forecast is compared with the transactions recorded for the same days
// (forecastActuals), so the page can say how close it was and where it missed. A saved forecast is never changed afterwards.
// Everything is in cash terms — what reached or left the accounts that count as cash — so the parts add up to the balance.
import type { Data, ForecastGroup, ForecastSnapshot, Settings, Transaction } from '../app/data/types'
import { cashCalendar, cashAccounts, type CalItem } from './forecast'
import { countsAsCash } from './accounts'
import { recActive } from './recurring'
import { payDates, paycheckOnFile } from './paySchedule'
import { LIABILITY_KINDS } from './reconcile'
import { addDays, curMonth, diffDays, monthEnd, today } from './dates'

/** A forecast is only saved with at least this many days of the month left: less than that says nothing about how good it is. */
export const MIN_DAYS = 5
export const GROUPS: ForecastGroup[] = ['in_pay', 'in_other', 'out_bills', 'out_debt', 'out_everyday', 'out_other']
export const GROUP_LABEL: Record<ForecastGroup, string> = { in_pay: 'Paychecks', in_other: 'Other money in', out_bills: 'Bills and subscriptions', out_debt: 'Card and loan payments', out_everyday: 'Everyday spending', out_other: 'Planned items, tax and transfers out' }
const round2 = (n: number) => Math.round(n * 100) / 100
const groupOf = (x: CalItem): ForecastGroup => x.amt > 0 ? (x.src === 'pay' ? 'in_pay' : 'in_other') : x.src === 'bill' || x.src === 'sub' ? 'out_bills' : x.src === 'debt' ? 'out_debt' : x.src === 'flex' ? 'out_everyday' : 'out_other'

/** What to save today: the calendar's expectation from today to the end of this month, all cash together. Null when too little of the
 *  month is left, or there is nothing to forecast from (no cash and nothing scheduled). */
export function forecastSnapshot(d: Data, s: Settings): Omit<ForecastSnapshot, 'id' | 'household_id'> | null {
  const t = today(), through = monthEnd(curMonth()), days = diffDays(through, t)
  if (days < MIN_DAYS) return null
  const cal = cashCalendar(d, s, days)
  if (!cal.items.length && Math.abs(cal.start) < 0.005) return null
  const by: Partial<Record<ForecastGroup, number>> = {}
  for (const x of cal.items) { const g = groupOf(x); by[g] = round2((by[g] || 0) + Math.abs(x.amt)) }
  // what was on file when this was worked out, by the server's own clock: the newest transaction's timestamp (none yet: this device's time)
  const stamps = [...d.transactions, ...d.duplicates].map(x => x.created_at || '').filter(Boolean).sort(), observed_at = stamps[stamps.length - 1] || new Date().toISOString()
  return { cash_accounts: cashAccounts(d, s).map(a => a.id), observed_at, taken_on: t, through, start_cash: round2(cal.start), expected_in: round2(cal.inTot), expected_out: round2(cal.outTot), expected_end: round2(cal.end), expected_low: round2(cal.low.bal), low_date: cal.low.date, by_source: by, notes: null }
}
/** This month's forecast still has to be saved (nothing on file running to this month's end). */
export const needsSnapshot = (d: Pick<Data, 'forecasts'>) => !(d.forecasts || []).some(f => f.through.slice(0, 10) === monthEnd(curMonth()))

export interface ForecastActuals { in: number; out: number; end: number; by: Record<ForecastGroup, number>; count: number }
/** What the recorded transactions show for the days a saved forecast covered: the day after it was saved through its last day, plus
 *  anything dated the same day but entered after it was saved. Counted the way the forecast counts cash:
 *   in   income into a cash account, and transfers into cash from an account that is not cash
 *   out  spending from a cash account, and transfers out of cash to an account that is not cash (a card or loan payment, an investment)
 *  A move between two cash accounts changes nothing. What is bought on a card is not cash out until the card is paid.
 *  "Cash" is the accounts that counted as cash when the forecast was saved (its start_cash is their total), so marking an account
 *  differently later does not turn a past transfer into a difference. "Entered after" is judged against what was on file when the
 *  forecast was worked out (observed_at), not the moment the row reached the database. */
export function forecastActuals(d: Data, s: Settings, f: ForecastSnapshot): ForecastActuals {
  const acct = new Map([...(d.off?.accounts || []), ...d.accounts].map(a => [a.id, a]))
  const then = Array.isArray(f.cash_accounts) && f.cash_accounts.length ? new Set(f.cash_accounts) : null
  const cash = (id?: string | null) => { if (then) return !!id && then.has(id); const a = id ? acct.get(id) : undefined; return !!a && !a.excluded && countsAsCash(a, s) }
  const from = f.taken_on.slice(0, 10), to = f.through.slice(0, 10), saved = f.observed_at || f.created_at || ''
  const inWindow = (t: Transaction) => { const dt = t.date.slice(0, 10); return t.status !== 'void' && !t.duplicate_of && dt <= to && (dt > from || (dt === from && !!saved && !!t.created_at && Date.parse(t.created_at) > Date.parse(saved))) }
  // which deposits are paychecks: tagged to a pay schedule, or matching one on a pay date (the same test the calendar uses)
  const paychecks = new Set<string>()
  d.paySchedules.forEach(p => payDates(p, addDays(from, -2), addDays(to, 2)).forEach(dd => { const hit = paycheckOnFile(d, p, dd); if (hit) paychecks.add(hit.id) }))
  const billCats = new Set(recActive(d).map(r => r.category_id).filter(Boolean))
  const by = Object.fromEntries(GROUPS.map(g => [g, 0])) as Record<ForecastGroup, number>; let count = 0
  for (const t of d.transactions) {
    if (!inWindow(t)) continue
    const amt = Math.abs(+t.amount || 0); if (amt < 0.005) continue
    let g: ForecastGroup | null = null
    if (t.kind === 'income') { if (cash(t.account_id)) g = t.pay_schedule_id || paychecks.has(t.id) ? 'in_pay' : 'in_other' }
    else if (t.kind === 'expense') { if (cash(t.account_id)) g = t.recurring_id || (t.category_id && billCats.has(t.category_id)) ? 'out_bills' : 'out_everyday' }
    else { const a = cash(t.account_id), b = cash(t.to_account_id), dest = t.to_account_id ? acct.get(t.to_account_id) : undefined
      if (a && !b) g = dest && LIABILITY_KINDS.includes(dest.kind) ? 'out_debt' : 'out_other'
      else if (!a && b) g = 'in_other' }
    if (!g) continue
    by[g] += amt; count++
  }
  GROUPS.forEach(g => { by[g] = round2(by[g]) })
  const inn = round2(by.in_pay + by.in_other), out = round2(by.out_bills + by.out_debt + by.out_everyday + by.out_other)
  return { in: inn, out, end: round2(+f.start_cash + inn - out), by, count }
}

export type Grade = 'close' | 'fair' | 'off'
export interface ForecastCheck {
  f: ForecastSnapshot; days: number; actual: ForecastActuals
  /** actual end minus expected end: positive = you ended with more than expected */
  diff: number; pct: number; grade: Grade
  rows: Array<{ g: ForecastGroup; label: string; expected: number; actual: number; diff: number; side: 'in' | 'out' }>
  /** the part that explains most of the difference — null when everything was within a few dollars */
  biggest: { g: ForecastGroup; label: string; diff: number; side: 'in' | 'out' } | null
  /** no transactions at all were recorded for the period: there is nothing to compare with */
  empty: boolean
}
/** Within 5% of the balance expected is close; within 15% is fair. Measured against the expected balance, or against the money that was
 *  expected to move when the balance itself is small. */
export function gradeOf(diff: number, f: Pick<ForecastSnapshot, 'expected_end' | 'expected_in' | 'expected_out'>): { pct: number; grade: Grade } {
  const base = Math.max(Math.abs(+f.expected_end), (+f.expected_in + +f.expected_out) / 2, 1), pct = Math.abs(diff) / base
  return { pct, grade: pct <= 0.05 ? 'close' : pct <= 0.15 ? 'fair' : 'off' }
}
/** Compare one finished forecast with what happened. */
export function checkForecast(d: Data, s: Settings, f: ForecastSnapshot): ForecastCheck {
  const actual = forecastActuals(d, s, f), diff = round2(actual.end - +f.expected_end), { pct, grade } = gradeOf(diff, f)
  const rows = GROUPS.map(g => { const expected = +(f.by_source?.[g] || 0), a = actual.by[g]; return { g, label: GROUP_LABEL[g], expected, actual: a, diff: round2(a - expected), side: (g.startsWith('in') ? 'in' : 'out') as 'in' | 'out' } }).filter(r => r.expected > 0.005 || r.actual > 0.005)
  const top = rows.slice().sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff))[0]
  return { f, days: diffDays(f.through.slice(0, 10), f.taken_on.slice(0, 10)), actual, diff, pct, grade, rows, biggest: top && Math.abs(top.diff) >= 25 ? { g: top.g, label: top.label, diff: top.diff, side: top.side } : null, empty: actual.count === 0 }
}
/** Every saved forecast: the finished ones compared with what happened (newest first), and the one still running. */
export function forecastChecks(d: Data, s: Settings): { done: ForecastCheck[]; running: ForecastSnapshot | null } {
  const t = today(), all = (d.forecasts || []).slice().sort((a, b) => b.through.localeCompare(a.through))
  return { done: all.filter(f => f.through.slice(0, 10) < t).slice(0, 12).map(f => checkForecast(d, s, f)), running: all.find(f => f.through.slice(0, 10) >= t) || null }
}
