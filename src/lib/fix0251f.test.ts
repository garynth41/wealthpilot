// @vitest-environment node
// 0.25.1 fixes (batch f): bills every 2, 3, 6 or 12 months get their alerts (1), one payment covers one due date (2), every day is in exactly
// one budget period (3), the low-cash alert counts overdue bills (4), and members with Limited access get only the deletion notice (5).
// Node, not jsdom: the last suite loads the notify edge function, whose npm: imports only a server-side transform leaves to the mocks below.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { addDays, parse, setToday } from './dates'
import { emptyData, SETTINGS_DEFAULTS, type Account, type BillOccurrence, type Data, type PaySchedule, type Recurring, type RecurringFreq, type Settings, type Transaction } from '../app/data/types'
import { computeAlerts, computeDigest, dueDatesN, paidDatesN, recipientsFor, isLimitedMember, billWordN, amountDueN, unpaidDuesN, payDatesN, semiPayDaysN, type NInput, type NMember } from './notify'
import { payDates } from './paySchedule'
import { dueDates, upcoming } from './recurring'
import { cashCalendar, overdueOwed, safeToSpend } from './forecast'
import { billReminders } from './reminders'
import { spanFor, nextSpan, prevSpan } from './periods'

afterAll(() => setToday(null))
let n = 0; const id = (p: string) => `${p}${++n}`
const acct = (o: Partial<Account> = {}): Account => ({ id: id('a'), household_id: 'h', name: 'Checking', kind: 'checking', balance: 3000, apr: 0, minimum_payment: 0, autopay: false, include_in_cash: true, include_in_net_worth: true, status: 'Active', sort_order: 1, ...o })
const rec = (o: Partial<Recurring>): Recurring => ({ id: id('r'), household_id: 'h', name: 'Bill', kind: 'bill', amount: 100, amount_varies: false, frequency: 'monthly', autopay: false, reminder_days: 3, status: 'Active', sort_order: 1, ...o })
const txn = (o: Partial<Transaction>): Transaction => ({ id: id('t'), household_id: 'h', date: '2026-11-01', kind: 'expense', amount: 0, tags: [], status: 'cleared', source: 'manual', exclude_from_budget: false, ...o })
const occ = (o: Partial<BillOccurrence>): BillOccurrence => ({ id: id('o'), household_id: 'h', recurring_id: 'x', due_date: '2026-11-01', amount: 0, status: 'paid', ...o })
const pay = (o: Partial<PaySchedule>): PaySchedule => ({ id: id('p'), household_id: 'h', name: 'Paycheck', kind: 'salary', frequency: 'biweekly', anchor_date: '2026-11-13', net_amount: 2000, status: 'Active', ...o })
const data = (o: Partial<Data>): Data => ({ ...emptyData(), ...o })
const settings = (o: Partial<Settings> = {}): Settings => ({ ...SETTINGS_DEFAULTS, ...o })
/** The alert rules' input for an app household. */
const nin = (d: Data, today: string, o: Partial<NInput> = {}): NInput => ({ today, now: today + 'T12:30:00Z', accounts: d.accounts, recurring: d.recurring, occurrences: d.occurrences, transactions: d.transactions, paySchedules: [], sync: null, reserveFloor: 0, prefs: {}, ...o })
const billAlerts = (d: Data, today: string) => computeAlerts(nin(d, today)).filter(a => a.kind === 'bill_due' || a.kind === 'bill_overdue').map(a => a.title).sort()

// ======================================================================================================
// 1 — bills every 2, 3, 6 or 12 months never got "due today / tomorrow" alerts
// ======================================================================================================
describe('1 — bills every 2, 3, 6 or 12 months: the alerts find their due dates', () => {
  const yr = rec({ name: 'Car registration', amount: 240, frequency: 'yearly', day_of_month: 15, next_due: '2026-11-15' })
  const q = rec({ name: 'Water', amount: 180, frequency: 'quarterly', day_of_month: 15, next_due: '2026-08-15' })
  const e2 = rec({ name: 'Lawn', amount: 90, frequency: 'every_2_months', day_of_month: 15, next_due: '2026-09-15' })
  const e6 = rec({ name: 'Insurance', amount: 600, frequency: 'every_6_months', day_of_month: 15, next_due: '2026-05-15' })
  const d = data({ accounts: [acct({ balance: 5000 })], recurring: [yr, q, e2, e6] })
  const all = (s: string) => ['Car registration', 'Insurance', 'Lawn', 'Water'].map(x => `${x} ${s}`)
  it('all due 2026-11-15: due tomorrow on the 14th, due today on the 15th, 5 days overdue on the 20th', () => {
    expect(billAlerts(d, '2026-11-14')).toEqual(all('is due tomorrow'))
    expect(billAlerts(d, '2026-11-15')).toEqual(all('is due today'))
    expect(billAlerts(d, '2026-11-20')).toEqual(all('is 5 days overdue'))
    for (const r of [yr, q, e2, e6]) { expect(dueDatesN(r, '2026-10-15', '2026-11-15')).toEqual(['2026-11-15']); expect(dueDates(r, '2026-10-15', '2026-11-15')).toEqual(['2026-11-15']) }
  })
  it('the 7-day low-cash check from Nov 28 sees a quarterly bill due Dec 2', () => {
    const water = rec({ name: 'Water', amount: 400, frequency: 'quarterly', day_of_month: 2, next_due: '2026-09-02' })
    expect(dueDatesN(water, '2026-11-28', '2026-12-05')).toEqual(['2026-12-02'])
    const low = computeAlerts(nin(data({ accounts: [acct({ balance: 300 })], recurring: [water] }), '2026-11-28')).find(a => a.kind === 'low_cash')
    expect(low).toMatchObject({ title: 'Bills due this week exceed cash on hand', body: '$400 due in 7 days, $300 available', amount: 100 })
  })
  it('dueDatesN agrees with the app\'s dueDates for every frequency, seed, month end, bound and window', () => {
    // every frequency × next due date (month ends, Feb 28 and Feb 29, none) × day of the month × start/end bound, each over sampled windows:
    // fixed ones across February and the year end plus a long one, windows that start on, end on, start after and end before one of the
    // app's own due dates, and one random window. "Today" only matters without a next due date, so the second today runs just for those.
    const freqs: RecurringFreq[] = ['weekly', 'biweekly', 'semimonthly', 'monthly', 'every_2_months', 'quarterly', 'every_6_months', 'yearly', 'irregular']
    const seeds = [null, '2026-01-31', '2026-02-28', '2026-05-30', '2026-08-31', '2026-11-15', '2028-02-29']
    const days = [null, 1, 15, 16, 29, 31]
    const bounds: Array<Partial<Recurring>> = [{}, { starts_on: '2026-12-10' }, { ends_on: '2027-03-30' }]
    const fixed: Array<[string, string]> = [['2027-02-27', '2027-03-01'], ['2028-02-28', '2028-03-01'], ['2026-12-30', '2027-01-02'], ['2026-09-01', '2027-10-05']]
    let seed = 4242; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const bad: string[] = []; let checked = 0
    try {
      for (const today of ['2026-11-07', '2027-01-31']) {
        setToday(today)
        for (const frequency of freqs) for (const next_due of seeds) for (const day_of_month of days) for (const b of bounds) {
          if (today !== '2026-11-07' && next_due) continue
          const r = rec({ frequency, next_due, day_of_month, ...b }), ref = dueDates(r, '2026-09-01', '2028-03-31')
          const windows = [...fixed]
          for (const e of [ref[0], ref[ref.length >> 1]].filter(Boolean)) windows.push([e, e], [addDays(e, 1), addDays(e, 44)], [addDays(e, -30), addDays(e, -1)])
          const from = addDays('2026-09-01', Math.floor(rnd() * 540)); windows.push([from, addDays(from, [0, 6, 30, 91][Math.floor(rnd() * 4)])])
          for (const [lo, hi] of windows) {
            const app = dueDates(r, lo, hi), alerts = dueDatesN(r, lo, hi, today); checked++
            if (app.join() !== alerts.join() && bad.length < 5) bad.push(`${frequency} next ${next_due} day ${day_of_month} ${JSON.stringify(b)} ${lo}..${hi} (today ${today}): app ${app.join(' ')} · alerts ${alerts.join(' ')}`)
          }
        }
      }
    } finally { setToday(null) }
    expect(bad).toEqual([]); expect(checked).toBeGreaterThan(10000)
  }, 20000)
})

// ======================================================================================================
// 2 — one payment marked several weekly or every-2-weeks due dates paid
// ======================================================================================================
describe('2 — one payment covers one due date', () => {
  const T = '2026-11-06'
  beforeAll(() => setToday(T))
  const chk = acct({ id: 'chk', balance: 3000 })
  const daycare = rec({ id: 'dc', name: 'Daycare', payee: 'Bright Horizons', amount: 300, frequency: 'weekly', next_due: '2026-11-02', starts_on: '2026-10-26' })
  const d = data({ accounts: [chk], recurring: [daycare], transactions: [txn({ id: 'pay1', date: '2026-11-02', amount: 300, account_id: 'chk', payee: 'Bright Horizons', recurring_id: 'dc' })] })
  it('a weekly $300 bill paid once on Nov 2 is paid for Nov 2 only: Oct 26 is still overdue, Nov 9 still due', () => {
    expect(upcoming(d, '2026-10-26', '2026-11-30').map(u => [u.date, u.status, u.txn?.id ?? null])).toEqual([['2026-10-26', 'overdue', null], ['2026-11-02', 'paid', 'pay1'], ['2026-11-09', 'due_soon', null], ['2026-11-16', 'due', null], ['2026-11-23', 'due', null], ['2026-11-30', 'due', null]])
  })
  it('the cash calendar keeps next week\'s $300, and Safe to spend counts last week\'s as overdue', () => {
    expect(cashCalendar(d, settings(), 30).items.filter(i => i.label === 'Daycare').map(i => [i.date, i.amt])).toEqual([['2026-11-09', -300], ['2026-11-16', -300], ['2026-11-23', -300], ['2026-11-30', -300]])
    expect(overdueOwed(d).map(x => [x.date, x.amt])).toEqual([['2026-10-26', -300]])
    expect(safeToSpend(d, settings()).overdue).toBe(300)
  })
  const lawn = rec({ id: 'lawn', name: 'Lawn', payee: 'GreenCo', amount: 300, frequency: 'biweekly', next_due: '2026-10-30', starts_on: '2026-10-30' })
  const d2 = data({ accounts: [chk], recurring: [lawn], transactions: [txn({ id: 'late', date: '2026-11-04', amount: 300, payee: 'GreenCo', recurring_id: 'lawn' })] })
  it('an every-2-weeks bill paid 5 days late pays that bill, not the next one', () => {
    expect(upcoming(d2, '2026-10-26', '2026-12-31').map(u => [u.date, u.status])).toEqual([['2026-10-30', 'paid'], ['2026-11-13', 'due'], ['2026-11-27', 'due'], ['2026-12-11', 'due'], ['2026-12-25', 'due']])
  })
  it('two payments in one week pay that week; the extra one does not pay the next week', () => {
    const two = data({ recurring: [daycare], transactions: [txn({ id: 'a1', date: '2026-11-01', amount: 300, payee: 'BRIGHT HORIZONS' }), txn({ id: 'a2', date: '2026-11-03', amount: 300, payee: 'BRIGHT HORIZONS' })] })
    expect(upcoming(two, '2026-10-26', '2026-11-09').map(u => [u.date, u.status, u.txn?.id ?? null])).toEqual([['2026-10-26', 'overdue', null], ['2026-11-02', 'paid', 'a1'], ['2026-11-09', 'due_soon', null]])
  })
  it('a payment halfway between two due dates covers the earlier one when both are unpaid, the later one when the earlier is paid', () => {
    const mid = txn({ id: 'mid', date: '2026-11-06', amount: 300, payee: 'GREENCO' })   // 7 days after Oct 30, 7 days before Nov 13
    expect(upcoming(data({ recurring: [lawn], transactions: [mid] }), '2026-10-30', '2026-11-13').map(u => [u.date, u.status])).toEqual([['2026-10-30', 'paid'], ['2026-11-13', 'due']])
    const marked = data({ recurring: [lawn], transactions: [mid], occurrences: [occ({ recurring_id: 'lawn', due_date: '2026-10-30', status: 'paid' })] })
    expect(upcoming(marked, '2026-10-30', '2026-11-13').map(u => [u.date, u.status, u.txn?.id ?? null])).toEqual([['2026-10-30', 'paid', null], ['2026-11-13', 'paid', 'mid']])
  })
  it('a payment recorded for one due date (Mark paid) is not reused for the next one', () => {
    const marked = data({ recurring: [daycare], occurrences: [occ({ recurring_id: 'dc', due_date: '2026-10-26', status: 'paid', transaction_id: 'mp' })], transactions: [txn({ id: 'mp', date: '2026-11-02', amount: 300, payee: 'Bright Horizons', recurring_id: 'dc' })] })
    expect(upcoming(marked, '2026-10-26', '2026-11-09').map(u => [u.date, u.status, u.txn?.id ?? null])).toEqual([['2026-10-26', 'paid', 'mp'], ['2026-11-02', 'overdue', null], ['2026-11-09', 'due_soon', null]])
    expect(billAlerts(marked, T)).toEqual(['Daycare is 4 days overdue'])
  })
  it('a payment tied to another bill does not count for this one, even from the same payee', () => {
    const gas = rec({ id: 'gas', name: 'Gas', payee: 'AEP', amount: 100, day_of_month: 3, next_due: '2026-11-03' }), elec = rec({ id: 'elec', name: 'Electric', payee: 'AEP', amount: 100, day_of_month: 3, next_due: '2026-11-03' })
    const dd = data({ recurring: [gas, elec], transactions: [txn({ id: 'g', date: '2026-11-03', amount: 100, payee: 'AEP OHIO', recurring_id: 'gas' })] })
    expect(upcoming(dd, '2026-11-03', '2026-11-03').map(u => [u.r.name, u.status])).toEqual([['Gas', 'paid'], ['Electric', 'overdue']])
    expect(billAlerts(dd, T)).toEqual(['Electric is 3 days overdue'])
  })
  it('monthly bills keep the window from 12 days before to 10 days after', () => {
    const rent = rec({ id: 'rent', name: 'Rent', payee: 'Landlord', amount: 1450, day_of_month: 1, next_due: '2026-12-01' })
    const at = (date: string) => upcoming(data({ recurring: [rent], transactions: [txn({ date, amount: 1450, payee: 'LANDLORD LLC' })] }), '2026-12-01', '2026-12-01')[0].status
    expect(at('2026-11-19')).toBe('paid'); expect(at('2026-12-11')).toBe('paid'); expect(at('2026-11-18')).not.toBe('paid'); expect(at('2026-12-12')).not.toBe('paid')
  })
  it('the alerts and the phone reminders agree with the Bills page', () => {
    expect(billAlerts(d, T)).toEqual(['Daycare is 11 days overdue'])                                     // Oct 26; Nov 2 is paid
    expect(billReminders({ today: T, recurring: d.recurring, occurrences: d.occurrences, transactions: d.transactions, horizonDays: 7 }).map(x => x.key)).toEqual(['rem:dc:2026-11-09:early', 'rem:dc:2026-11-09:day'])
    expect(billAlerts(d2, '2026-11-12')).toEqual(['Lawn is due tomorrow'])                               // the Oct 30 payment does not cover Nov 13
    expect(computeDigest({ today: '2026-11-09', accounts: d.accounts, recurring: d.recurring, occurrences: [], transactions: d.transactions, reserveFloor: 0 }).week.map(w => w.due)).toEqual(['2026-11-09'])
  })
  it('the Bills page and the alerts agree on every paid date (randomized households)', () => {
    let seed = 20261107; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648; const pick = <X,>(xs: X[]) => xs[Math.floor(rnd() * xs.length)]
    const freqs: RecurringFreq[] = ['weekly', 'biweekly', 'semimonthly', 'monthly', 'every_2_months', 'quarterly']
    const bad: string[] = []
    try {
      for (let k = 0; k < 300; k++) {
        const today = addDays('2026-09-01', Math.floor(rnd() * 120)); setToday(today)
        const r = rec({ id: 'r' + k, name: 'Bill ' + k, payee: 'Acme Utility', amount: 100, amount_varies: rnd() < 0.2, frequency: freqs[k % freqs.length], next_due: addDays(today, Math.floor(rnd() * 40) - 20), day_of_month: null })
        const tx = Array.from({ length: Math.floor(rnd() * 7) }, () => txn({ date: addDays(today, Math.floor(rnd() * 80) - 60), amount: pick([100, 100, 104, 160, 40]), payee: pick(['ACME UTILITY CO', 'Acme', 'Other store']), recurring_id: pick([null, null, r.id, 'other']), status: rnd() < 0.1 ? 'void' : 'cleared', duplicate_of: rnd() < 0.1 ? 'x' : null }))
        const dates = dueDates(r, addDays(today, -60), addDays(today, 20)); const occs: BillOccurrence[] = []
        for (const due of dates) if (rnd() < 0.15) occs.push(occ({ recurring_id: r.id, due_date: due, status: pick<BillOccurrence['status']>(['paid', 'skipped', 'due', 'scheduled']), transaction_id: rnd() < 0.5 && tx.length ? pick(tx).id : null }))
        const dd = data({ recurring: [r], transactions: tx, occurrences: occs }), from = addDays(today, -45), to = addDays(today, 14)
        const app = upcoming(dd, from, to).filter(u => u.status === 'paid' || u.status === 'skipped').map(u => u.date)
        const paid = paidDatesN(r, from, to, occs, tx, today); const alerts = dueDates(r, from, to).filter(x => paid.has(x))
        if (app.join() !== alerts.join() && bad.length < 5) bad.push(`#${k} ${r.frequency} next ${r.next_due} today ${today}: app ${app.join(' ')} · alerts ${alerts.join(' ')}`)
      }
    } finally { setToday(T) }
    expect(bad).toEqual([])
  }, 20000)
})

// ======================================================================================================
// 3 — budget periods could leave a day out or overlap
// ======================================================================================================
describe('3 — every day is in exactly one budget period', () => {
  const none = data({})
  it('twice a month on the 15th and 31st: Nov 30 and Feb 28 start the second half, and Next moves on', () => {
    const s = settings({ periodType: 'semimonthly', semimonthlyDays: [15, 31] })
    expect(spanFor(none, s, '2026-11-29')).toMatchObject({ start: '2026-11-15', end: '2026-11-29' })
    expect(spanFor(none, s, '2026-11-30')).toMatchObject({ start: '2026-11-30', end: '2026-12-14' })
    expect(spanFor(none, s, '2027-02-27')).toMatchObject({ start: '2027-02-15', end: '2027-02-27' })
    expect(spanFor(none, s, '2027-02-28')).toMatchObject({ start: '2027-02-28', end: '2027-03-14' })
    const nov = spanFor(none, s, '2026-11-15'), next = nextSpan(none, s, nov)
    expect(next).toMatchObject({ start: '2026-11-30', end: '2026-12-14' }); expect(prevSpan(none, s, next)).toMatchObject({ start: '2026-11-15', end: '2026-11-29' })
  })
  it('every 2 weeks with no anchor date: alternate Mondays, one period straight after another', () => {
    const s = settings({ periodType: 'biweekly', periodAnchor: null })
    let sp = spanFor(none, s, '2026-11-20'); expect(parse(sp.start).getDay()).toBe(1)
    for (let i = 0; i < 8; i++) { const nx = nextSpan(none, s, sp); expect(nx.start).toBe(addDays(sp.end, 1)); expect(nx.end).toBe(addDays(nx.start, 13)); sp = nx }
    // a two-week budget already started keeps its place: Nov 29 – Dec 12 is followed by Dec 13 – Dec 26 (it used to be Dec 1 – Dec 14)
    const started = data({ periods: [{ id: 'p1', household_id: 'h', period_type: 'biweekly', start_date: '2026-11-15', end_date: '2026-11-28', status: 'open', expected_income: 0 }] })
    expect(spanFor(started, s, '2026-11-20')).toMatchObject({ start: '2026-11-15', end: '2026-11-28' })
    expect(spanFor(started, s, '2026-12-05')).toMatchObject({ start: '2026-11-29', end: '2026-12-12' })
    expect(nextSpan(started, s, spanFor(started, s, '2026-12-05'))).toMatchObject({ start: '2026-12-13', end: '2026-12-26' })
  })
  const D0 = '2026-11-01', D1 = '2028-10-31'   // two years: Nov 30, Feb 28 2027 and the leap day Feb 29 2028
  const cadences: Array<[string, Settings, Data]> = [
    ['month', settings({ periodType: 'month' }), none],
    ['week', settings({ periodType: 'week' }), none],
    ['every 2 weeks from an anchor', settings({ periodType: 'biweekly', periodAnchor: '2026-10-26' }), none],
    ['every 2 weeks, no anchor', settings({ periodType: 'biweekly', periodAnchor: null }), none],
    ['every 2 weeks, no anchor, one already started', settings({ periodType: 'biweekly', periodAnchor: null }), data({ periods: [{ id: 'p1', household_id: 'h', period_type: 'biweekly', start_date: '2027-03-03', end_date: '2027-03-16', status: 'open', expected_income: 0 }] })],
    ['custom', settings({ periodType: 'custom', periodAnchor: '2027-03-03' }), none],
    ...([[1, 15], [15, 31], [1, 31], [30, 31], [29, 30], [14, 28], [5, 20], [10, 10], [31, 1], [15, 30]] as number[][]).map((dd): [string, Settings, Data] => [`twice a month on ${dd.join(' and ')}`, settings({ periodType: 'semimonthly', semimonthlyDays: dd }), none]),
    ...(['weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'yearly'] as const).map((f): [string, Settings, Data] => [`pay period, paid ${f}`, settings({ periodType: 'pay' }), data({ paySchedules: [pay({ frequency: f, anchor_date: '2026-01-31', semimonthly_days: [15, 31] })] })]),
    ['pay period, income that starts in 2027', settings({ periodType: 'pay' }), data({ paySchedules: [pay({ starts_on: '2027-06-10' })] })],
    ['pay period, income that ended in 2027', settings({ periodType: 'pay' }), data({ paySchedules: [pay({ frequency: 'monthly', anchor_date: '2026-01-31', ends_on: '2027-05-20' })] })],
    ['pay period, a three-week job', settings({ periodType: 'pay' }), data({ paySchedules: [pay({ starts_on: '2027-01-01', ends_on: '2027-01-20' })] })],
    ['pay period, irregular income', settings({ periodType: 'pay' }), data({ paySchedules: [pay({ frequency: 'irregular', anchor_date: '2027-02-10' })] })],
    ['pay period, no income', settings({ periodType: 'pay' }), none],
  ]
  for (const [name, s, d] of cadences) it(`${name}: every day in exactly one period over two years; Next and Previous always move`, () => {
    let sp = spanFor(d, s, D0); expect(sp.start <= D0 && D0 <= sp.end).toBe(true); let count = 0
    while (sp.start <= D1) {
      expect(sp.start <= sp.end, `${sp.start}..${sp.end}`).toBe(true)
      for (let x = sp.start; x <= sp.end; x = addDays(x, 1)) { const own = spanFor(d, s, x); if (own.start !== sp.start || own.end !== sp.end) throw new Error(`${x} falls in ${own.start}..${own.end}, not ${sp.start}..${sp.end}`) }
      const nx = nextSpan(d, s, sp); expect(nx.start, `after ${sp.start}..${sp.end}`).toBe(addDays(sp.end, 1))
      expect(prevSpan(d, s, nx)).toMatchObject({ start: sp.start, end: sp.end }); sp = nx; count++
    }
    expect(count).toBeGreaterThan(1)
  }, 20000)
})

// ======================================================================================================
// 4 — the low-cash alert's 7-day total left out overdue bills
// ======================================================================================================
describe('4 — the low-cash alert counts what is already overdue, like Safe to spend and the Monday digest', () => {
  const T = '2026-11-06'
  const chk = acct({ id: 'chk4', balance: 1000 })
  const late = rec({ name: 'Electric', payee: 'AEP', amount: 450, day_of_month: 1, next_due: '2026-11-01' })                                         // 5 days overdue
  const auto = rec({ name: 'Gym', payee: 'Planet Fitness', kind: 'subscription', amount: 150, day_of_month: 3, next_due: '2026-11-03', autopay: true })   // an autopay that never went through
  const soon = rec({ name: 'Phone', payee: 'Verizon', amount: 500, day_of_month: 9, next_due: '2026-11-09', starts_on: '2026-11-01' })               // due in 3 days
  const water = rec({ name: 'Water', payee: 'City Water', amount: 80, day_of_month: 2, next_due: '2026-11-02' })                                      // paid
  const d = data({ accounts: [chk], recurring: [late, auto, soon, water], transactions: [txn({ date: '2026-11-02', amount: 80, payee: 'CITY WATER', account_id: 'chk4' })] })
  it('$600 overdue + $500 due this week is more than $1,000 cash: the alert fires and names both', () => {
    const low = computeAlerts(nin(d, T)).find(a => a.kind === 'low_cash')
    expect(low).toMatchObject({ key: 'low_cash:due7:2026-11-06', title: 'Overdue bills and bills due this week exceed cash on hand', body: '$600 overdue and $500 due in 7 days, $1,000 available', amount: 100 })
  })
  it('Safe to spend and the Monday digest take off the same $600 the alert counts', () => {
    setToday(T)
    try {
      expect(safeToSpend(d, settings()).overdue).toBe(600)
      const dg = computeDigest({ today: T, accounts: d.accounts, recurring: d.recurring, occurrences: d.occurrences, transactions: d.transactions, reserveFloor: 0 })
      expect(dg.overdueTotal).toBe(600); expect(dg.overdue.map(o => o.name)).toEqual(['Electric', 'Gym'])
    } finally { setToday(null) }
  })
  it('once the overdue bills are paid, $500 due against $1,000 cash is fine', () => {
    const paid = { ...d, transactions: [...d.transactions, txn({ date: '2026-11-05', amount: 450, payee: 'AEP OHIO' }), txn({ date: '2026-11-04', amount: 150, payee: 'PLANET FITNESS' })] }
    expect(computeAlerts(nin(paid, T)).some(a => a.kind === 'low_cash')).toBe(false)
  })
})

// ======================================================================================================
// 5 — security: alerts ignored section limits
// ======================================================================================================
describe('5 — members with Limited access get only the deletion notice', () => {
  const owner: NMember = { user_id: 'u-own', email: 'own@x.test', role: 'owner', modules: null }
  const full: NMember = { user_id: 'u-full', email: 'full@x.test', role: 'editor', modules: null }
  const lim: NMember = { user_id: 'u-lim', email: 'lim@x.test', role: 'editor', modules: ['budget'] }
  it('who counts as Limited: a non-owner with a list of sections (owners never; modules never loaded count as limited)', () => {
    expect([owner, full, lim].map(isLimitedMember)).toEqual([false, false, true])
    expect(isLimitedMember({ role: 'owner', modules: ['budget'] })).toBe(false); expect(isLimitedMember({ role: 'viewer', modules: [] })).toBe(true)
    expect(isLimitedMember({ role: 'viewer', modules: null })).toBe(false); expect(isLimitedMember({ role: 'editor' })).toBe(true)
  })
  it('no alert kind and no digest reaches them, even when they turned push and email on for themselves', () => {
    const prefs = { push: true, email: true, members: { 'u-lim': { push: true, email: true, email_to: 'lim@home.test', digest: true, kinds: null } } }
    for (const kind of ['bill_due', 'bill_overdue', 'low_cash', 'large_charge', 'paycheck', 'sync', 'price_rise', 'new_recurring', 'reconcile', 'revalue', 'digest']) {
      expect(recipientsFor(prefs, [owner, full, lim], kind), kind).toEqual({ push: ['u-own', 'u-full'], email: [{ to: 'own@x.test', user_id: null }] })   // their own email choice does not switch the household address off
    }
    expect(recipientsFor(prefs, [owner, full, lim], 'deletion')).toEqual({ push: ['u-own', 'u-full', 'u-lim'], email: [{ to: 'lim@home.test', user_id: 'u-lim' }, { to: 'own@x.test', user_id: null }] })
    expect(recipientsFor({ email: true }, [lim, full], 'bill_due').email).toEqual([{ to: 'full@x.test', user_id: null }])   // with no owner listed the household address never falls back to theirs
  })
})

// ======================================================================================================
// Follow-up A — a bill with no Payee: the Bills page never matched it, the alerts matched it on its name — even "Gas" to a gas station
// ======================================================================================================
describe('A — one rule finds a bill\'s payment, with or without a Payee', () => {
  it('the word a payment must carry: the Payee\'s first word, else the first word of the name that names a company', () => {
    expect(billWordN({ payee: 'Landlord LLC', name: 'Rent' })).toBe('landlord')
    expect(billWordN({ payee: null, name: 'AEP Ohio' })).toBe('aep'); expect(billWordN({ name: 'Columbia Gas' })).toBe('columbia'); expect(billWordN({ payee: '  ', name: 'Netflix' })).toBe('netflix')
    expect(billWordN({ name: 'City of Columbus water' })).toBe('columbus'); expect(billWordN({ name: 'Disney+' })).toBe('disney'); expect(billWordN({ name: 'AT&T' })).toBe('at&t')
    for (const name of ['Gas', 'Rent', 'Water bill', 'Car insurance', 'Auto loan payment', 'Emergency fund transfer', 'Daycare', 'TV']) expect(billWordN({ name }), name).toBe('')
  })
  // Nov 10: "AEP Ohio" (due Nov 6) was paid at AEP on Nov 7; "Gas" (due Nov 4, amount varies) was not — the Shell purchase is petrol
  const T = '2026-11-10'
  const aep = rec({ id: 'aep', name: 'AEP Ohio', payee: null, amount: 150, day_of_month: 6, next_due: '2026-11-06' })
  const gas = rec({ id: 'gas', name: 'Gas', payee: null, amount: 58, amount_varies: true, day_of_month: 4, next_due: '2026-11-04' })
  const d = data({ accounts: [acct({ id: 'chkA', balance: 3000 })], recurring: [aep, gas], transactions: [txn({ id: 'aep-pay', date: '2026-11-07', amount: 148, payee: 'AEP OHIO ELECTRIC', source: 'import' }), txn({ id: 'shell', date: '2026-11-05', amount: 52.4, payee: 'SHELL OIL 5741 GAS', source: 'import' })] })
  it('a bill with no Payee: the Bills page, Safe to spend, the alerts, the Monday digest and the phone reminders agree', () => {
    setToday(T)
    try {
      expect(upcoming(d, '2026-10-20', '2026-11-10').map(u => [u.r.name, u.date, u.status, u.txn?.id ?? null])).toEqual([['Gas', '2026-11-04', 'overdue', null], ['AEP Ohio', '2026-11-06', 'paid', 'aep-pay']])
      expect(safeToSpend(d, settings()).overdue).toBe(58)
    } finally { setToday(null) }
    expect(billAlerts(d, T)).toEqual(['Gas is 6 days overdue'])
    expect(computeDigest({ today: T, accounts: d.accounts, recurring: d.recurring, occurrences: [], transactions: d.transactions, reserveFloor: 0 }).overdue.map(o => o.name)).toEqual(['Gas'])
    // before the due dates: AEP paid early at AEP gets no reminder; Gas, with only the Shell purchase, still does
    const early = { ...d, transactions: [txn({ date: '2026-11-02', amount: 148, payee: 'AEP OHIO ELECTRIC' }), txn({ date: '2026-11-01', amount: 52.4, payee: 'SHELL OIL 5741 GAS' })] }
    expect(billReminders({ today: '2026-11-02', recurring: early.recurring, occurrences: [], transactions: early.transactions, horizonDays: 7 }).map(x => x.key)).toEqual(['rem:gas:2026-11-04:day'])
  })
  it('a bill named for its kind never "goes up" at an unrelated merchant; one named for its company still does', () => {
    const fixed = rec({ id: 'gasf', name: 'Gas', payee: null, amount: 58, day_of_month: 4, next_due: '2026-11-04' }), nf = rec({ id: 'nf', name: 'Netflix', payee: null, kind: 'subscription', amount: 15.49, day_of_month: 3, next_due: '2026-11-03' })
    const a = computeAlerts(nin(data({ recurring: [fixed, nf], transactions: [txn({ id: 's', date: '2026-11-06', amount: 70, payee: 'SHELL OIL GAS' }), txn({ id: 'n', date: '2026-11-03', amount: 17.99, payee: 'NETFLIX.COM' })] }), T)).filter(x => x.kind === 'price_rise')
    expect(a.map(x => x.title)).toEqual(['Netflix went up'])
  })
  it('the Bills page and the alerts agree on paid dates and amounts for bills with and without a Payee (randomized households)', () => {
    let seed = 7101; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648; const pick = <X,>(xs: X[]) => xs[Math.floor(rnd() * xs.length)]
    const bills: Array<[string, string | null]> = [['AEP Ohio', null], ['Gas', null], ['Water bill', null], ['Acme Utility', null], ['Car insurance', null], ['Electric', 'AEP Ohio'], ['Phone', 'Verizon']]
    const freqs: RecurringFreq[] = ['weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly']
    const bad: string[] = []
    try {
      for (let k = 0; k < 300; k++) {
        const today = addDays('2026-09-01', Math.floor(rnd() * 120)); setToday(today)
        const [name, payee] = pick(bills)
        const r = rec({ id: 'b' + k, name, payee, amount: 100, amount_varies: rnd() < 0.3, frequency: freqs[k % freqs.length], next_due: addDays(today, Math.floor(rnd() * 40) - 20), day_of_month: null })
        const tx = Array.from({ length: Math.floor(rnd() * 7) }, () => txn({ date: addDays(today, Math.floor(rnd() * 80) - 60), amount: pick([100, 96, 120, 160, 40]), payee: pick(['AEP OHIO ELECTRIC', 'SHELL OIL GAS', 'ACME UTILITY CO', 'CITY WATER', 'VERIZON WRLS', 'GEICO', 'Other store']), recurring_id: pick([null, null, null, r.id, 'other']), status: rnd() < 0.1 ? 'void' : 'cleared' }))
        const occs: BillOccurrence[] = []
        for (const due of dueDates(r, addDays(today, -60), addDays(today, 20))) if (rnd() < 0.25) occs.push(occ({ recurring_id: r.id, due_date: due, status: pick<BillOccurrence['status']>(['paid', 'skipped', 'due', 'scheduled']), amount: pick([0, 87.5, 100, 131.25]), transaction_id: rnd() < 0.3 && tx.length ? pick(tx).id : null }))
        const dd = data({ recurring: [r], transactions: tx, occurrences: occs }), from = addDays(today, -45), to = addDays(today, 14)
        const ups = upcoming(dd, from, to), paid = paidDatesN(r, from, to, occs, tx, today)
        const appPaid = ups.filter(u => u.status === 'paid' || u.status === 'skipped').map(u => u.date), alertsPaid = dueDates(r, from, to).filter(x => paid.has(x))
        const appOwed = ups.filter(u => u.status !== 'paid' && u.status !== 'skipped').map(u => `${u.date} ${u.amount}`), alertsOwed = unpaidDuesN({ today, recurring: [r], occurrences: occs, transactions: tx }, from, to).map(x => `${x.due} ${x.amount}`)
        if ((appPaid.join() !== alertsPaid.join() || appOwed.join() !== alertsOwed.join()) && bad.length < 5) bad.push(`#${k} ${name}/${payee} ${r.frequency} today ${today}: paid ${appPaid.join(' ')} vs ${alertsPaid.join(' ')} · owed ${appOwed.join(', ')} vs ${alertsOwed.join(', ')}`)
      }
    } finally { setToday(null) }
    expect(bad).toEqual([])
  }, 20000)
})

// ======================================================================================================
// Follow-up B — the alerts used the listed amount; the app uses the amount filed for the due date
// ======================================================================================================
describe('B — one rule for what a due date asks for', () => {
  it('the amount filed on the date\'s occurrence, else what was paid when the amount varies, else the listed amount', () => {
    const varies = rec({ amount: 140, amount_varies: true }), fixed = rec({ amount: 140 })
    expect(amountDueN(varies, { amount: 152.4 })).toBe(152.4); expect(amountDueN(fixed, { amount: 152.4 }, { amount: 99 })).toBe(152.4)
    expect(amountDueN(varies, null, { amount: 131.8 })).toBe(131.8); expect(amountDueN(fixed, null, { amount: 131.8 })).toBe(140)
    expect(amountDueN(varies, null)).toBe(140); expect(amountDueN(fixed, { amount: null })).toBe(140)
  })
  // an email filed AEP's Nov 15 bill at $152.40 (listed at $140, amount varies); on Nov 20 it is still unpaid
  const T = '2026-11-20'
  const aepB = rec({ id: 'aepB', name: 'AEP Ohio', payee: 'AEP', amount: 140, amount_varies: true, day_of_month: 15, next_due: '2026-11-15', starts_on: '2026-11-01' })
  const d = data({ accounts: [acct({ id: 'chkB', balance: 100 })], recurring: [aepB], occurrences: [occ({ recurring_id: 'aepB', due_date: '2026-11-15', status: 'due', amount: 152.4 }), occ({ recurring_id: 'aepB', due_date: '2026-12-15', status: 'due', amount: 160.1 })] })
  it('the Bills page, Safe to spend, the overdue alert, the low-cash alert and the Monday digest all owe $152.40', () => {
    setToday(T)
    try {
      expect(upcoming(d, '2026-11-15', '2026-11-15').map(u => [u.status, u.amount])).toEqual([['overdue', 152.4]])
      expect(safeToSpend(d, settings()).overdue).toBe(152.4)
    } finally { setToday(null) }
    const a = computeAlerts(nin(d, T))
    expect(a.find(x => x.kind === 'bill_overdue')).toMatchObject({ title: 'AEP Ohio is 5 days overdue', body: '$152 was due 2026-11-15', amount: 152.4 })
    expect(a.find(x => x.kind === 'low_cash')).toMatchObject({ body: '$152 overdue and $0 due in 7 days, $100 available', amount: 52.4 })
    const dg = computeDigest({ today: T, accounts: d.accounts, recurring: d.recurring, occurrences: d.occurrences, transactions: [], reserveFloor: 0 })
    expect(dg.overdue).toEqual([{ name: 'AEP Ohio', amount: 152.4, due: '2026-11-15', autopay: false }]); expect(dg.overdueTotal).toBe(152.4)
  })
  it('the phone reminder names the filed amount instead of "amount varies"', () => {
    const r = billReminders({ today: '2026-12-10', recurring: d.recurring, occurrences: d.occurrences, transactions: [], horizonDays: 10 })
    expect(r.map(x => x.body)).toEqual(['$160.10 on 2026-12-15', '$160.10 — mark it paid in WealthPilot once it is done'])
    expect(billReminders({ today: '2026-12-10', recurring: d.recurring, occurrences: [], transactions: [], horizonDays: 10 })[0].body).toBe('amount varies on 2026-12-15')
  })
})

// ======================================================================================================
// Follow-up C — twice-a-month paychecks with no pay days set: the app paid on the 15th and the last day, the alerts expected the 1st and 15th
// ======================================================================================================
describe('C — twice-a-month paychecks with no pay days set: one default, the 15th and the last day of the month', () => {
  const semi = pay({ id: 'semi', name: 'Acme payroll', frequency: 'semimonthly', anchor_date: '2026-01-15', semimonthly_days: null, net_amount: 2000 })
  it('the app\'s pay dates and the alerts\' expected paydays agree, month ends and February included', () => {
    const want = ['2026-11-15', '2026-11-30', '2026-12-15', '2026-12-31', '2027-01-15', '2027-01-31', '2027-02-15', '2027-02-28', '2027-03-15', '2027-03-31', '2027-04-15', '2027-04-30']
    expect(payDates(semi, '2026-11-01', '2027-04-30')).toEqual(want); expect(payDatesN(semi, '2026-11-01', '2027-04-30')).toEqual(want)
    expect(semiPayDaysN(null)).toEqual([15, 31]); expect(semiPayDaysN([])).toEqual([15, 31]); expect(semiPayDaysN([20, 5])).toEqual([5, 20])
    for (const days of [null, [1, 15], [15, 30], [5, 20], [30, 31]]) {   // and over every window of half a year, with no days set or the schedule's own
      const p = { ...semi, semimonthly_days: days }
      for (let from = '2026-11-01'; from <= '2027-04-30'; from = addDays(from, 3)) for (const len of [0, 1, 13, 31]) { const to = addDays(from, len); expect(payDatesN(p, from, to), `${days} ${from}..${to}`).toEqual(payDates(p, from, to)) }
    }
  })
  it('a missed paycheck is flagged the day after its payday — after Nov 30 and Feb 28, nothing on the 2nd', () => {
    const missed = (today: string, transactions: NInput['transactions'] = []) => computeAlerts({ ...nin(data({}), today), paySchedules: [semi], transactions }).filter(a => a.kind === 'paycheck').map(a => a.body)
    const body = (d: string) => `$2,000 was expected on ${d} — check the account or the schedule`
    expect(missed('2026-12-01')).toEqual([body('2026-11-30')]); expect(missed('2027-03-01')).toEqual([body('2027-02-28')]); expect(missed('2026-11-16')).toEqual([body('2026-11-15')])
    expect(missed('2026-11-02')).toEqual([]); expect(missed('2026-12-02')).toEqual([])                       // no payday on the 1st
    expect(missed('2026-12-01', [{ id: 'in', date: '2026-11-30', kind: 'income', amount: 2000 }])).toEqual([])   // it arrived
  })
})

// The notify edge function itself (supabase/functions/notify/index.ts) over an in-memory database: the PostgREST calls it makes, the push
// service and the Resend API. A select returns only the columns asked for, so a column the function forgets to load is really missing.
const fn = vi.hoisted(() => {
  type Row = Record<string, unknown>
  const db: Record<string, Row[]> = {}
  const sent = { push: [] as Array<{ endpoint: string; title: string }>, email: [] as Array<{ to: string; subject: string }> }
  const env: Record<string, string> = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key', VAPID_PUBLIC_KEY: 'vapid-public', VAPID_PRIVATE_KEY: 'vapid-private', RESEND_API_KEY: 're_test', CRON_SECRET: 'cron-secret-for-the-unit-tests-0123456789' }
  let seq = 0
  class Q {
    private t: string; private cols: string[] | null = null; private where: Array<(r: Row) => boolean> = []; private op: 'select' | 'insert' | 'update' | 'delete' = 'select'; private payload: unknown = null; private one = false; private max = Infinity
    constructor(t: string) { this.t = t }
    select(cols = '*') { if (this.op === 'select') this.cols = cols === '*' ? null : cols.split(',').map(c => c.trim()); return this }
    eq(k: string, v: unknown) { this.where.push(r => r[k] === v); return this }
    gte(k: string, v: string) { this.where.push(r => r[k] != null && String(r[k]) >= v); return this }
    in(k: string, vs: unknown[]) { this.where.push(r => vs.includes(r[k])); return this }
    like(k: string, pat: string) { const re = new RegExp('^' + pat.split('%').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$'); this.where.push(r => re.test(String(r[k]))); return this }
    limit(n: number) { this.max = n; return this }
    single() { this.one = true; return this }
    maybeSingle() { this.one = true; return this }
    insert(p: unknown) { this.op = 'insert'; this.payload = p; return this }
    update(p: unknown) { this.op = 'update'; this.payload = p; return this }
    delete() { this.op = 'delete'; return this }
    private run() {
      const rows = (db[this.t] ||= []), hit = rows.filter(r => this.where.every(w => w(r)))
      if (this.op === 'insert') { for (const p of (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[]) rows.push({ id: `row-${++seq}`, ...p }); return { data: null, error: null } }
      if (this.op === 'update') { for (const r of hit) Object.assign(r, this.payload); return { data: null, error: null } }
      if (this.op === 'delete') { db[this.t] = rows.filter(r => !hit.includes(r)); return { data: null, error: null } }
      const out = hit.slice(0, this.max).map(r => (this.cols ? Object.fromEntries(this.cols.filter(c => c in r).map(c => [c, r[c]])) : { ...r }))
      return this.one ? { data: out[0] ?? null, error: out.length || this.t !== 'households' ? null : { message: 'not found' } } : { data: out, error: null }
    }
    then<A, B>(ok: (v: unknown) => A, bad?: (e: unknown) => B) { return Promise.resolve(this.run()).then(ok, bad) }
  }
  const client = (key: string, auth?: string) => ({ from: (t: string) => new Q(t), rpc: async () => ({ data: null, error: null }), auth: { getUser: async () => ({ data: { user: key === 'anon-key' && auth?.startsWith('Bearer tok-') ? { id: auth.slice(11) } : null } }) } })
  const handlers: Array<(req: Request) => Promise<Response>> = []
  return { db, sent, env, client, handlers, reset: () => { for (const k of Object.keys(db)) delete db[k]; sent.push.length = 0; sent.email.length = 0 } }
})
vi.mock('npm:@supabase/supabase-js@2', () => ({ createClient: (_url: string, key: string, opts?: { global?: { headers?: Record<string, string> } }) => fn.client(key, opts?.global?.headers?.Authorization) }))
vi.mock('npm:web-push@3.6.7', () => ({ default: { setVapidDetails: () => {}, sendNotification: async (sub: { endpoint: string }, payload: string) => { fn.sent.push.push({ endpoint: sub.endpoint, title: JSON.parse(payload).title }) } } }))

describe('5 — the notify function keeps Limited members to the deletion notice', () => {
  const H = 'hh-1', FN: string = '../../supabase/functions/notify/index.ts'
  const seedDb = (o: { deletion?: string; limitedAsked?: boolean } = {}) => {
    fn.reset()
    fn.db.households = [{ id: H, name: 'Test household', deletion_scheduled_for: o.deletion ?? null, settings: { reserveFloor: 0, notify: { push: true, email: true, digest: true, ...(o.limitedAsked ? { members: { 'u-lim': { push: true, email: true, email_to: 'lim@home.test', digest: true } } } : {}) } } }]
    fn.db.household_members = [{ household_id: H, user_id: 'u-own', email: 'own@x.test', role: 'owner', modules: null, read_only: false }, { household_id: H, user_id: 'u-full', email: 'full@x.test', role: 'editor', modules: null, read_only: false }, { household_id: H, user_id: 'u-lim', email: 'lim@x.test', role: 'editor', modules: ['budget'], read_only: false }]
    fn.db.push_subscriptions = ['u-own', 'u-full', 'u-lim'].map(u => ({ id: 'sub-' + u, household_id: H, user_id: u, endpoint: 'https://push.test/' + u, p256dh: 'k', auth: 'a', failures: 0 }))
    fn.db.accounts = [{ id: 'chk', household_id: H, name: 'Checking', kind: 'checking', status: 'Active', balance: 5000, bank_balance: null, include_in_cash: true }]
    fn.db.recurring = [{ id: 'r-elec', household_id: H, name: 'Electric', payee: 'AEP', kind: 'bill', amount: 150, amount_varies: false, frequency: 'monthly', day_of_month: 10, next_due: '2026-11-10', starts_on: null, ends_on: null, status: 'Active', autopay: false }]
    fn.db.transactions = [{ id: 'big', household_id: H, date: '2026-11-09', kind: 'expense', amount: 900, payee: 'Best Buy', created_at: '2026-11-09T09:00:00Z', status: 'cleared', duplicate_of: null }]
  }
  const call = (body: object, headers: Record<string, string> = {}) => fn.handlers[0](new Request('https://fn.test/notify', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }))
  const cron = () => ({ 'x-cron-secret': fn.env.CRON_SECRET }), as = (u: string) => ({ Authorization: 'Bearer tok-' + u })
  const devices = () => [...new Set(fn.sent.push.map(p => p.endpoint.replace('https://push.test/', '')))].sort()
  const inboxes = () => [...new Set(fn.sent.email.map(e => e.to))].sort()
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-09T17:00:00Z'))   // Monday, noon in Ohio
    vi.stubGlobal('Deno', { env: { get: (k: string) => fn.env[k], toObject: () => ({ ...fn.env }) }, serve: (h: (req: Request) => Promise<Response>) => { fn.handlers.push(h) } })
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => { const b = JSON.parse(init.body); fn.sent.email.push({ to: b.to[0], subject: b.subject }); return new Response('{"id":"e"}', { status: 200 }) })
    await import(/* @vite-ignore */ FN)
  })
  afterAll(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
  it('the daily alerts go to the owner and the full member only, even when the Limited member asked for push and email', async () => {
    seedDb({ limitedAsked: true })
    const res = await call({ action: 'run_daily' }, cron()); expect(res.status).toBe(200)
    expect(fn.sent.push.map(p => p.title)).toEqual(expect.arrayContaining(['Electric is due tomorrow']))
    expect(devices()).toEqual(['u-full', 'u-own']); expect(inboxes()).toEqual(['own@x.test'])
  })
  it('the Monday digest skips them too', async () => {
    seedDb({ limitedAsked: true })
    expect((await call({ action: 'digest' }, cron())).status).toBe(200)
    expect(fn.sent.push.length).toBeGreaterThan(0); expect(devices()).toEqual(['u-full', 'u-own']); expect(inboxes()).toEqual(['own@x.test'])
  })
  it('the deletion notice reaches every member, Limited ones included', async () => {
    seedDb({ deletion: '2026-11-16T15:00:00Z', limitedAsked: true })
    expect((await call({ action: 'run_daily' }, cron())).status).toBe(200)
    expect(fn.sent.push.every(p => p.title === 'This household will be permanently deleted on 2026-11-16')).toBe(true)
    expect(devices()).toEqual(['u-full', 'u-lim', 'u-own']); expect(inboxes()).toEqual(['lim@home.test', 'own@x.test'])
  })
  it('preview and test answer 403 "Alerts need full access" to a Limited member and send nothing; others still get them', async () => {
    seedDb()
    for (const action of ['preview', 'test']) {
      const res = await call({ action, household_id: H }, as('u-lim')); expect(res.status, action).toBe(403); expect(await res.json()).toEqual({ error: 'Alerts need full access' })
    }
    expect(fn.sent.push).toEqual([]); expect(fn.sent.email).toEqual([])
    const own = await call({ action: 'preview', household_id: H }, as('u-own')); expect(own.status).toBe(200)
    expect((await own.json()).alerts.map((a: { title: string }) => a.title)).toEqual(expect.arrayContaining(['Electric is due tomorrow']))
    expect((await call({ action: 'preview', household_id: H }, as('u-full'))).status).toBe(200)
    expect((await call({ action: 'test', household_id: H }, as('u-own'))).status).toBe(200); expect(devices()).toEqual(['u-own'])
    expect((await call({ action: 'preview', household_id: H }, as('u-stranger'))).status).toBe(403)
  })
})
