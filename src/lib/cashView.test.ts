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
  return { start, items, daily, low, firstFloor, firstZero, floor, inTot: items.filter(x => x.amt > 0).reduce((a, x) => a + x.amt, 0), outTot: -items.filter(x => x.amt < 0).reduce((a, x) => a + x.amt, 0), end: bal, account: null, assumed: 0 }
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

// 0.35.0 — suggestions worth acting on, one account on its own, "Can I afford it?", and a day opened
import { afford, calDay, amountOf, MIN_TIP } from './cashView'
import { setLocale } from './display'
describe('0.35.0: a suggestion has to be worth acting on', () => {
  const small = base.map(x => (x[1].startsWith('Amex') ? [x[0], 'Netflix (autopay)', -15, 'sub'] as typeof x : x))
  it(`moving a due date for less than $${MIN_TIP} is not suggested — unless it closes the gap by itself`, () => {
    expect(calTips(make(5000, 1000, small)).some(t => t.key === 'move')).toBe(false)
    const closes = calTips(make(5000, 2590, small))   // $5 short of the reserve; moving the $15 covers it
    expect(closes[0].key).toBe('gap'); expect(closes.find(t => t.key === 'move')).toMatchObject({ amount: 15, label: 'Netflix' })
    expect(calTips(make(5000, 2700, small)).some(t => t.key === 'move')).toBe(false)   // $115 short: $15 does not close it
  })
  it('trimming everyday spending is suggested only when a tenth of it is worth it', () => {
    const light = base.map(x => (x[3] === 'flex' ? [x[0], x[1], -100, x[3]] as typeof x : x)); expect(calTips(make(5000, 1000, light)).some(t => t.key === 'trim')).toBe(false)
  })
  it('of several payments before payday, the one whose move helps most is the one suggested', () => {
    const two: typeof base = [...base, ['2026-12-02', 'Discover payment', -450, 'debt']]
    expect(calTips(make(6000, 1000, two)).find(t => t.key === 'move')).toMatchObject({ label: 'Discover payment', amount: 450 })
  })
  it('one account on its own: a transfer from another cash account when it runs short; nothing about the reserve', () => {
    const acct = { id: 'a1', name: 'Checking' } as NonNullable<Cal['account']>
    const short = { ...make(2500, 0, base), account: acct }; const tips = calTips(short, [{ name: 'Savings', bal: 8000 }, { name: 'Wallet', bal: 40 }])
    expect(tips[0]).toMatchObject({ key: 'transfer', amount: 200, label: 'Savings', title: 'Move $200 in from Savings' })
    expect(calTips(short, [{ name: 'Wallet', bal: 40 }])[0].key).toBe('gap')   // nothing else could cover it
    const fine = { ...make(9000, 0, base), account: acct }; expect(calTips(fine).some(t => t.key === 'reserve' || t.key === 'idle')).toBe(false)
  })
})
describe('0.35.0: Can I afford it?', () => {
  const cal = make(5000, 1000, base)   // lowest 2,300 on Dec 3; reserve 1,000
  it('fits: the new lowest point, and the most that would fit that day', () => {
    const a = afford(cal, 500, '2026-11-25'); expect(a).toMatchObject({ state: 'ok', low: { bal: 1800, date: '2026-12-03' }, max: 1300, short: 0, already: false, outside: false, fitsFrom: '2026-11-25' })
    expect(afford(cal, 1300, '2026-11-25').state).toBe('ok'); expect(afford(cal, 1300.01, '2026-11-25').state).toBe('floor')
  })
  it('dips into the reserve: how far under, and the first day the same amount fits', () => {
    const a = afford(cal, 2000, '2026-11-25'); expect(a).toMatchObject({ state: 'floor', firstBad: '2026-12-01', short: 700, max: 1300, fitsFrom: '2026-12-04' })   // after payday: 4,600 is the lowest from then on
    expect(afford(cal, 2000, '2026-12-04')).toMatchObject({ state: 'ok', low: { bal: 2300, date: '2026-12-03' }, max: 3505 })   // a later purchase does not change earlier days
  })
  it('runs out: the day, and nothing fits when no later day could hold it', () => {
    const a = afford(cal, 4500, '2026-11-25'); expect(a).toMatchObject({ state: 'out', firstBad: '2026-11-30', short: 3200 }); expect(a.fitsFrom).toBe('2026-12-18')
    expect(afford(cal, 9000, '2026-11-25').fitsFrom).toBeNull()
  })
  it('already short before the purchase; a date outside the calendar; nothing typed', () => {
    expect(afford(make(5000, 2500, base), 100, '2026-11-25')).toMatchObject({ already: true, max: 0, fitsFrom: null, state: 'floor' })
    expect(afford(cal, 100, '2027-03-01').outside).toBe(true); expect(afford(cal, 100, '2026-11-01').outside).toBe(true)
    expect(afford(cal, 0, '2026-11-25')).toMatchObject({ state: 'ok', low: { bal: 2300 }, fitsFrom: null })
  })
  it('with no reserve the line is zero', () => { expect(afford(make(5000, 0, base), 2300, '2026-11-25')).toMatchObject({ state: 'ok', max: 2300 }); expect(afford(make(5000, 0, base), 2301, '2026-11-25').state).toBe('out') })
})
describe('0.35.0: a day opened', () => {
  const cal = make(5000, 1000, base)
  it('what lands on it and what is in the bank that evening', () => {
    expect(calDay(cal, '2026-12-04')).toMatchObject({ inTot: 2300, outTot: 0, bal: 4600 }); expect(calDay(cal, '2026-12-03').items.map(x => x.label)).toEqual(['Amex payment (autopay)'])
    expect(calDay(cal, '2026-12-05')).toMatchObject({ items: [], bal: 4600 }); expect(calDay(cal, '2027-06-01').bal).toBeNull()
  })
})
describe('0.35.0: an amount as typed', () => {
  it('is read the way the rest of the app reads money; anything that is not a positive amount is 0', () => {
    expect(amountOf('900')).toBe(900); expect(amountOf(' $1,250.50 ')).toBe(1250.5); expect(amountOf('12.345')).toBe(12.35)
    for (const bad of ['', 'abc', '-5', '0', '12abc', '1.2.3']) expect(amountOf(bad)).toBe(0)
    // where a comma is the decimal mark, 12,50 is twelve and a half — not 1,250
    setLocale('de-DE'); try { expect(amountOf('12,50')).toBe(12.5); expect(amountOf('1.234,56')).toBe(1234.56) } finally { setLocale('auto') }
    expect(amountOf('12,50')).toBe(1250)
  })
})
