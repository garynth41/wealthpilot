// The Cash calendar as a person reads it (0.33.0): one plain answer, the weeks, and what would raise the lowest point.
// Everything here is worked out from cashCalendar()'s items — nothing new is assumed about the household.
import type { CalItem, cashCalendar } from './forecast'
import { addDays, diffDays, parse } from './dates'
import { fmtMoney } from './money'

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

export interface CalTip { key: 'move' | 'trim' | 'idle' | 'gap' | 'reserve'; title: string; text: string; gain: string; to?: string; amount: number; date?: string; label?: string }
const FIXED_DATE = /\b(rent|mortgage|tax|hoa|tuition|child support|alimony)\b/i
// amounts go through fmtMoney, so they are masked when amounts are hidden
const money = (n: number) => fmtMoney(Math.abs(n))
/** Up to three things that would help, each from the person's own items:
 *   move  a card, loan or bill payment that lands in the days before a paycheck, right where cash is lowest — moved to after payday
 *   trim  everyday spending cut by a tenth
 *   idle  cash above the reserve even on the lowest day, that could go to debt or a goal   (covered households)
 *   gap   how much is missing and by when                                                  (when cash dips below the reserve or zero)
 *   reserve  no reserve is set, so "safe" has nothing to be measured against */
export function calTips(cal: Cal): CalTip[] {
  const tips: CalTip[] = []; const v = calVerdict(cal); const L = cal.low.date, first = cal.daily[0]?.d || ''
  if (v.state !== 'ok') {
    const need = v.state === 'out' ? -cal.low.bal + cal.floor : cal.floor - cal.low.bal
    tips.push({ key: 'gap', amount: need, date: v.date || L, title: v.state === 'out' ? 'Close the gap before cash runs out' : 'Stay above your reserve',
      text: `At the lowest point you are ${money(need)} short of ${cal.floor ? 'your reserve' : 'zero'}. Moving a payment, a transfer from savings or extra income before then would cover it.`, gain: `${money(need)} needed`, to: v.state === 'out' ? '/hardship' : '/plan' })
  }
  // a payment sitting just before payday, at the low point
  if (L && L !== first) {
    const pay = cal.items.find(x => x.src === 'pay' && x.amt > 0 && x.date > L && diffDays(x.date, L) <= 10)
    if (pay) {
      const near = cal.items.filter(x => x.amt < 0 && x.date <= L && diffDays(L, x.date) <= 6 && (x.src === 'debt' || x.src === 'bill' || x.src === 'sub') && !FIXED_DATE.test(x.label))
      const pick = near.filter(x => x.src === 'debt').sort((a, b) => a.amt - b.amt)[0] || near.sort((a, b) => a.amt - b.amt)[0]
      if (pick) {
        const moved = cal.items.map(x => (x === pick ? { ...x, date: addDays(pay.date, 1) } : x)); const gain = lowOf(cal, moved).bal - cal.low.bal
        if (gain >= 1) { const name = pick.label.replace(/ \(autopay\)$/, ''), gap = diffDays(pay.date, pick.date)
          tips.push({ key: 'move', amount: gain, date: pay.date, label: name, title: `Move the ${name.replace(/ payment$/, '')} due date`,
            text: `${name} (${money(pick.amt)}) is due ${gap} day${gap === 1 ? '' : 's'} before your next paycheck, right where your cash is lowest. Ask for a due date just after payday.`, gain: `Lowest point rises by ${money(gain)}` }) }
      }
    }
  }
  const flex = cal.items.filter(x => x.src === 'flex')
  if (flex.length) { const total = -flex.reduce((a, x) => a + x.amt, 0), week = -flex[0].amt
    tips.push({ key: 'trim', amount: total * 0.1, title: 'Trim everyday spending 10%', text: `Everyday spending — groceries, gas, eating out, shopping — runs about ${money(week)} a week. A tenth less is about ${money(week * 0.1)} a week.`, gain: `+${money(total * 0.1)} over these ${cal.daily.length - 1} days`, to: '/budget' }) }
  if (v.state === 'ok') {
    if (!cal.floor) tips.push({ key: 'reserve', amount: 0, title: 'Set a reserve', text: 'A reserve is the amount you never want cash to go below. With one set, this page can tell you how much of your cash is really free.', gain: 'Settings → Planning thresholds', to: '/settings' })
    else if (v.cushion >= Math.max(500, cal.outTot / Math.max(1, (cal.daily.length - 1) / 7))) tips.push({ key: 'idle', amount: v.cushion, title: 'Put idle cash to work', text: `Even on your lowest day you hold ${money(v.cushion)} more than your reserve. Part of it could go to a debt or a goal without touching the reserve.`, gain: 'Open the Plan to split it', to: '/plan' })
  }
  return tips.slice(0, 3)
}
/** The months the window touches, as YYYY-MM. */
export function calMonths(cal: Cal): string[] { const out: string[] = []; for (const { d } of cal.daily) { const m = d.slice(0, 7); if (out[out.length - 1] !== m) out.push(m) } return out }
