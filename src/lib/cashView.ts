// The Cash calendar as a person reads it (0.33.0): one plain answer, the weeks, and what would raise the lowest point.
// Everything here is worked out from cashCalendar()'s items — nothing new is assumed about the household.
import type { CalItem, cashCalendar } from './forecast'
import { addDays, diffDays, parse, fmtD } from './dates'
import { fmtMoney, parseNum } from './money'

export type Cal = ReturnType<typeof cashCalendar>
export interface CalWeek { from: string; to: string; items: CalItem[]; inTot: number; outTot: number; net: number; end: number; low: number }

/** The calendar in weeks, Monday to Sunday. The first and last are cut to the window. */
export function calWeeks(cal: Cal): CalWeek[] {
  const out: CalWeek[] = []; const days = cal.daily; if (!days.length) return out
  const last = days[days.length - 1].d; let from = days[0].d
  while (from <= last) {
    const dow = parse(from).getDay(), toSun = (7 - dow) % 7; const to = addDays(from, toSun) > last ? last : addDays(from, toSun)
    const items = cal.items.filter(x => x.date >= from && x.date <= to), inside = days.filter(x => x.d >= from && x.d <= to)
    const inTot = items.reduce((a, x) => a + (x.amt > 0 ? x.amt : 0), 0), outTot = items.reduce((a, x) => a + (x.amt < 0 ? -x.amt : 0), 0)
    out.push({ from, to, items, inTot, outTot, net: inTot - outTot, end: inside[inside.length - 1].bal, low: Math.min(...inside.map(x => x.bal)) })
    from = addDays(to, 1)
  }
  return out
}
/** The week that runs shortest (most going out against what comes in) — null when no week runs short. */
export function tightestWeek(weeks: CalWeek[]): CalWeek | null {
  let t: CalWeek | null = null; for (const w of weeks) if (w.net < -0.005 && (!t || w.net < t.net)) t = w
  return t
}
/** The lowest balance a list of items would reach from a starting balance, over the same days. */
export function lowOf(cal: Cal, items: CalItem[]): { bal: number; date: string } {
  let bal = cal.start; let low = { bal, date: cal.daily[0]?.d || '' }
  for (const { d } of cal.daily) { for (const x of items) if (x.date === d) bal += x.amt; if (bal < low.bal) low = { bal, date: d } }
  return low
}
export interface CalVerdict { state: 'ok' | 'floor' | 'out'; date: string | null; low: { bal: number; date: string }; cushion: number; change: number; paydayNext: boolean }
/** The answer the card opens with: covered, dips below the reserve, or runs out. */
export function calVerdict(cal: Cal): CalVerdict {
  const state = cal.firstZero ? 'out' : cal.firstFloor ? 'floor' : 'ok'
  const paydayNext = cal.items.some(x => x.src === 'pay' && x.amt > 0 && x.date === addDays(cal.low.date, 1))
  return { state, date: cal.firstZero || cal.firstFloor || null, low: cal.low, cushion: cal.low.bal - cal.floor, change: cal.end - cal.start, paydayNext }
}

export interface CalTip { key: 'move' | 'trim' | 'idle' | 'gap' | 'reserve' | 'transfer'; title: string; text: string; gain: string; to?: string; amount: number; date?: string; label?: string }
const FIXED_DATE = /\b(rent|mortgage|tax|hoa|tuition|child support|alimony)\b/i
/** A suggestion has to be worth acting on (0.35.0): moving a due date for $15 is not. Below this it is shown only when it closes a gap on its own. */
export const MIN_TIP = 50
// amounts go through fmtMoney, so they are masked when amounts are hidden
const money = (n: number) => fmtMoney(Math.abs(n))
/** Up to three things that would help, each from the person's own items:
 *   gap   how much is missing and by when                                                  (when cash dips below the reserve or zero)
 *   transfer  one account on its own runs short while another cash account could cover it  (one-account view)
 *   move  a card, loan or bill payment that lands in the days before a paycheck, right where cash is lowest — moved to after payday
 *   trim  everyday spending cut by a tenth
 *   idle  cash above the reserve even on the lowest day, that could go to debt or a goal   (covered households)
 *   reserve  no reserve is set, so "safe" has nothing to be measured against
 *  move and trim are left out when they would change less than MIN_TIP. `others` are the other cash accounts, for the one-account view. */
export function calTips(cal: Cal, others: Array<{ name: string; bal: number }> = []): CalTip[] {
  const tips: CalTip[] = []; const v = calVerdict(cal); const L = cal.low.date, first = cal.daily[0]?.d || '', one = cal.account
  const need = v.state === 'ok' ? 0 : cal.floor - cal.low.bal
  if (v.state !== 'ok') {
    const from = one ? others.filter(o => o.bal >= need).sort((x, y) => y.bal - x.bal)[0] : undefined
    if (one && from) tips.push({ key: 'transfer', amount: need, date: v.date || L, label: from.name, title: `Move ${money(need)} in from ${from.name}`,
      text: `This account runs ${money(need)} short on its lowest day, while ${from.name} holds ${money(from.bal)}. A transfer before ${fmtD(v.date || L)} covers it — your cash overall does not change.`, gain: `${money(need)} needed by ${fmtD(v.date || L)}` })
    else tips.push({ key: 'gap', amount: need, date: v.date || L, title: v.state === 'out' ? 'Close the gap before cash runs out' : 'Stay above your reserve',
      text: `At the lowest point you are ${money(need)} short of ${cal.floor ? 'your reserve' : 'zero'}. Moving a payment, a transfer from savings or extra income before then would cover it.`, gain: `${money(need)} needed`, to: v.state === 'out' ? '/hardship' : '/plan' })
  }
  // a payment sitting just before payday, at the low point: the one whose move raises the lowest point most
  if (L && L !== first) {
    const pay = cal.items.find(x => x.src === 'pay' && x.amt > 0 && x.date > L && diffDays(x.date, L) <= 10)
    if (pay) {
      const near = cal.items.filter(x => x.amt < 0 && x.date <= L && diffDays(L, x.date) <= 6 && (x.src === 'debt' || x.src === 'bill' || x.src === 'sub') && !FIXED_DATE.test(x.label))
      const best = near.map(pick => ({ pick, gain: lowOf(cal, cal.items.map(x => (x === pick ? { ...x, date: addDays(pay.date, 1) } : x))).bal - cal.low.bal })).sort((x, y) => y.gain - x.gain)[0]
      if (best && (best.gain >= MIN_TIP || (need > 0 && best.gain >= need - 0.005))) { const { pick, gain } = best, name = pick.label.replace(/ \(autopay\)$/, ''), gap = diffDays(pay.date, pick.date)
        tips.push({ key: 'move', amount: gain, date: pay.date, label: name, title: `Move the ${name.replace(/ payment$/, '')} due date`,
          text: `${name} (${money(pick.amt)}) is due ${gap} day${gap === 1 ? '' : 's'} before your next paycheck, right where ${one ? 'this account' : 'your cash'} is lowest. A date just after payday would lift it — ask the biller or lender for a new due date, or reschedule it if it is your own transfer.`, gain: `Lowest point rises by ${money(gain)}` }) }
    }
  }
  const flex = cal.items.filter(x => x.src === 'flex')
  if (flex.length) { const total = -flex.reduce((a, x) => a + x.amt, 0), week = -flex[0].amt
    if (total * 0.1 >= MIN_TIP) tips.push({ key: 'trim', amount: total * 0.1, title: 'Trim everyday spending 10%', text: `Everyday spending — groceries, gas, eating out, shopping — runs about ${money(week)} a week${one ? ' from this account' : ''}. A tenth less is about ${money(week * 0.1)} a week.`, gain: `+${money(total * 0.1)} over these ${cal.daily.length - 1} days`, to: '/budget' }) }
  // the reserve is about all cash together, so neither of these is said about one account
  if (v.state === 'ok' && !one) {
    if (!cal.floor) tips.push({ key: 'reserve', amount: 0, title: 'Set a reserve', text: 'A reserve is the amount you never want cash to go below. With one set, this page can tell you how much of your cash is really free.', gain: 'Settings → Planning thresholds', to: '/settings' })
    else if (v.cushion >= Math.max(500, cal.outTot / Math.max(1, (cal.daily.length - 1) / 7))) tips.push({ key: 'idle', amount: v.cushion, title: 'Put idle cash to work', text: `Even on your lowest day you hold ${money(v.cushion)} more than your reserve. Part of it could go to a debt or a goal without touching the reserve.`, gain: 'Open the Plan to split it', to: '/plan' })
  }
  return tips.slice(0, 3)
}

/** "Can I afford it?" (0.35.0): what spending `amount` on `date` does to the days that follow, worked out from a calendar that already
 *  covers that date. Nothing is assumed beyond the calendar itself: every balance from that day on is lower by the amount.
 *   state     ok — stays above the reserve (or zero, with none set) · floor — dips below the reserve · out — goes below zero
 *   already   the calendar was short before this was added, so the purchase is not the cause (it makes it worse)
 *   short     how far below the reserve (or zero) the lowest day would be
 *   max       the most that could be spent on that date and still stay above the reserve
 *   fitsFrom  the first day, on or after `date`, the same amount would fit — null when no day in the calendar does */
export interface Afford { state: 'ok' | 'floor' | 'out'; low: { bal: number; date: string }; before: { bal: number; date: string }; firstBad: string | null; short: number; max: number; fitsFrom: string | null; already: boolean; outside: boolean }
export function afford(cal: Cal, amount: number, date: string): Afford {
  const days = cal.daily, amt = Math.max(0, +amount || 0), last = days[days.length - 1]?.d || '', first = days[0]?.d || ''
  const outside = !days.length || date > last || date < first
  let low = { bal: cal.start, date: first }, firstZero: string | null = null, firstFloor: string | null = null
  for (const x of days) { const b = x.bal - (x.d >= date ? amt : 0); if (b < low.bal) low = { bal: b, date: x.d }; if (b < 0 && !firstZero) firstZero = x.d; if (cal.floor && b < cal.floor && !firstFloor) firstFloor = x.d }
  const state = firstZero ? 'out' : firstFloor ? 'floor' : 'ok'
  // the lowest balance from each day to the end: what a purchase on that day has to leave standing
  const suffix: number[] = new Array(days.length); for (let i = days.length - 1, m = Infinity; i >= 0; i--) { m = Math.min(m, days[i].bal); suffix[i] = m }
  const already = !!(cal.firstZero || cal.firstFloor), at = days.findIndex(x => x.d >= date)
  const max = already || at < 0 ? 0 : Math.max(0, suffix[at] - cal.floor)
  let fitsFrom: string | null = null
  if (!already && amt > 0 && at >= 0) for (let i = at; i < days.length; i++) if (suffix[i] - amt >= cal.floor - 0.005) { fitsFrom = days[i].d; break }
  return { state, low, before: cal.low, firstBad: firstZero || firstFloor, short: Math.max(0, cal.floor - low.bal), max, fitsFrom, already, outside }
}
/** An amount as typed into "Can I afford it?" or a day's plan, read the way the rest of the app reads money — so "12,50" is twelve and a
 *  half where a comma is the decimal mark, and 1,250 in the US. 0 when it is not a positive amount (the screen then asks for a number). */
export const amountOf = (typed: string): number => { const v = parseNum(typed); return v != null && isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0 }
/** One day of the calendar: what lands on it, the totals, and what is in the bank that evening (null outside the window). */
export function calDay(cal: Cal, date: string) {
  const items = cal.items.filter(x => x.date === date), bal = cal.daily.find(x => x.d === date)?.bal ?? null
  return { date, items, bal, inTot: items.reduce((a, x) => a + (x.amt > 0 ? x.amt : 0), 0), outTot: items.reduce((a, x) => a + (x.amt < 0 ? -x.amt : 0), 0) }
}
/** The months the window touches, as YYYY-MM. */
export function calMonths(cal: Cal): string[] { const out: string[] = []; for (const { d } of cal.daily) { const m = d.slice(0, 7); if (out[out.length - 1] !== m) out.push(m) } return out }
