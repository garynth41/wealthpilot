// 0.33.0 — the Cash calendar's answer, weeks and suggestions.
import { describe, it, expect } from 'vitest'
import type { CalItem } from './forecast'
import { calWeeks, tightestWeek, calVerdict, calTips, lowOf, calMonths, type Cal } from './cashView'
import { addDays } from './dates'

// a hand-made calendar: start on a Friday with 5,000; rent and a card payment just before a paycheck
function make(start: number, floor: number, list: Array<[string, string, number, CalItem['src']]>, first = '2026-11-20', days = 30): Cal {
  const items: CalItem[] = list.map(([date, label, amt, src]) => ({ date, label, amt, src, kind: amt >= 0 ? 'in' : 'out' })); items.sort((a, b) => a.date.localeCompare(b.date) || b.amt - a.amt)
  let bal = start; const daily: Array<{ d: string; bal: number }> = []; let low = { bal: start, date: first }, firstFloor: string | null = null, firstZero: string | null = null
  for (let i = 0; i <= days; i++) { const d = addDays(first, i); items.filter(x => x.date === d).forEach(x => { bal += x.amt; x.bal = bal }); daily.push({ d, bal }); if (bal < low.bal) low = { bal, date: d }; if (floor && bal < floor && !firstFloor) firstFloor = d; if (bal < 0 && !firstZero) firstZero = d }
  return { start, items, daily, low, firstFloor, firstZero, floor, inTot: items.filter(x => x.amt > 0).reduce((a, x) => a + x.amt, 0), outTot: -items.filter(x => x.amt < 0).reduce((a, x) => a + x.amt, 0), end: bal }
}
const base: Array<[string, string, number, CalItem['src']]> = [
  ['2026-11-23', 'Everyday spending (recent average per week)', -300, 'flex'], ['2026-11-30', 'Everyday spending (recent average per week)', -300, 'flex'],
  ['2026-12-01', 'Rent', -1800, 'bill'], ['2026-12-03', 'Amex payment (autopay)', -300, 'debt'], ['2026-12-04', 'Paycheck', 2300, 'pay'], ['2026-12-10', 'Verizon (autopay)', -95, 'bill'], ['2026-12-18', 'Paycheck', 2300, 'pay']]

describe('the Cash calendar, read as weeks', () => {
  const cal = make(5000, 1000, base); const weeks = calWeeks(cal)
  it('weeks run Monday to Sunday, cut to the window, and add up to the whole', () => {
    expect(weeks[0]).toMatchObject({ from: '2026-11-20', to: '2026-11-22' }); expect(weeks[1]).toMatchObject({ from: '2026-11-23', to: '2026-11-29', outTot: 300, inTot: 0, net: -300 })
    expect(weeks[weeks.length - 1].to).toBe('2026-12-20'); expect(weeks.reduce((a, w) => a + w.inTot, 0)).toBe(cal.inTot); expect(weeks.reduce((a, w) => a + w.outTot, 0)).toBe(cal.outTot)
    expect(weeks[weeks.length - 1].end).toBe(cal.end); expect(Math.min(...weeks.map(w => w.low))).toBe(cal.low.bal)
  })
  it('the tightest week is the one that runs shortest; none when every week comes out ahead', () => {
    expect(tightestWeek(weeks)!.from).toBe('2026-11-23'); expect(tightestWeek(calWeeks(make(100, 0, [['2026-11-24', 'Paycheck', 500, 'pay']])))).toBeNull()
  })
  it('months the window touches', () => { expect(calMonths(cal)).toEqual(['2026-11', '2026-12']) })
})
describe('the answer', () => {
  it('covered: the lowest day, the cushion over the reserve, and that payday is next', () => {
    const v = calVerdict(make(5000, 1000, base)); expect(v).toMatchObject({ state: 'ok', date: null, low: { bal: 2300, date: '2026-12-03' }, cushion: 1300, paydayNext: true }); expect(v.change).toBe(1805)
  })
  it('dips below the reserve, or runs out', () => {
    expect(calVerdict(make(5000, 2500, base))).toMatchObject({ state: 'floor', date: '2026-12-03', cushion: -200 })
    expect(calVerdict(make(2500, 0, base))).toMatchObject({ state: 'out', date: '2026-12-03' })
  })
})
describe('suggestions', () => {
  it('a card payment just before payday, at the low point: moving it past payday raises the low by its amount — rent is never the one suggested', () => {
    const cal = make(5000, 1000, base); const tips = calTips(cal); const move = tips.find(t => t.key === 'move')!
    expect(move.label).toBe('Amex payment'); expect(move.amount).toBe(300); expect(move.title).toBe('Move the Amex due date'); expect(move.gain).toBe('Lowest point rises by $300'); expect(tips.some(t => /rent/i.test(t.title))).toBe(false)
    // …and the figure is real: the calendar with that payment moved has a low point exactly that much higher
    const moved = cal.items.map(x => (x.label.startsWith('Amex') ? { ...x, date: '2026-12-05' } : x)); expect(lowOf(cal, moved).bal - cal.low.bal).toBe(300)
  })
  it('no "move" when nothing movable sits before payday, when the low is today, or when moving would not help', () => {
    expect(calTips(make(5000, 1000, base.filter(x => !x[1].startsWith('Amex')))).some(t => t.key === 'move')).toBe(false)
    expect(calTips(make(5000, 1000, [['2026-11-27', 'Paycheck', 2000, 'pay']])).some(t => t.key === 'move')).toBe(false)
    // the payment is before payday, but a bigger drop comes later: the low point would not move
    const later = make(5000, 0, [['2026-11-24', 'Chase payment', -200, 'debt'], ['2026-11-25', 'Paycheck', 300, 'pay'], ['2026-12-10', 'Rent', -4000, 'bill']])
    expect(later.low.date).toBe('2026-12-10'); expect(calTips(later).some(t => t.key === 'move')).toBe(false)
  })
  it('everyday spending: a tenth of what the window holds', () => { const t = calTips(make(5000, 1000, base)).find(t => t.key === 'trim')!; expect(t.amount).toBe(60); expect(t.gain).toBe('+$60 over these 30 days') })
  it('covered with room to spare: idle cash; no reserve set: set one; short: the gap comes first', () => {
    expect(calTips(make(9000, 1000, base)).find(t => t.key === 'idle')!.amount).toBe(5300); expect(calTips(make(5000, 1000, base)).some(t => t.key === 'idle')).toBe(true)
    expect(calTips(make(2400, 1000, [['2026-12-01', 'Rent', -1300, 'bill'], ['2026-12-04', 'Paycheck', 2300, 'pay']])).some(t => t.key === 'idle')).toBe(false)   // 100 over the reserve is not idle
    expect(calTips(make(5000, 0, base)).map(t => t.key)).toContain('reserve')
    const short = calTips(make(5000, 2500, base)); expect(short[0]).toMatchObject({ key: 'gap', amount: 200, to: '/plan' }); expect(short.some(t => t.key === 'idle')).toBe(false)
    expect(calTips(make(2500, 0, base))[0]).toMatchObject({ key: 'gap', amount: 200, to: '/hardship' })
    expect(calTips(make(5000, 1000, base)).length).toBeLessThanOrEqual(3)
  })
})
