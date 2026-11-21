// 0.35.0 — the cash calendar for one account, and "How accurate was last month's forecast?"
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { demoSeed } from '../app/data/demoSeed'
import { emptyData, SETTINGS_DEFAULTS, type Account, type Category, type Data, type ForecastSnapshot, type PaySchedule, type Recurring, type Transaction } from '../app/data/types'
import { cashCalendar, cashAccounts, everydayAccount } from './forecast'
import { balanceOf } from './accounts'
import { forecastSnapshot, needsSnapshot, forecastActuals, checkForecast, forecastChecks, gradeOf, MIN_DAYS } from './forecastCheck'
import { setToday, monthEnd } from './dates'
import { NATURAL_KEY, RESTORE_ORDER } from './restore'
import { MODULES } from './access'

// the date is fixed before anything below is built: the sample household is dated from "today" while the file is being read, not when the tests run
setToday('2026-11-10'); beforeAll(() => setToday('2026-11-10')); afterAll(() => setToday(null))

describe('one cash account on its own', () => {
  const { data, household } = demoSeed(); const s = household.settings
  const cash = cashAccounts(data, s), home = everydayAccount(data, s)!, all = cashCalendar(data, s, 60)
  it('the everyday account is the one the pay lands in', () => {
    expect(cash.length).toBeGreaterThan(1); expect(home.kind).toBe('checking')
    const paid = data.paySchedules.filter(p => p.status === 'Active' && p.deposit_account_id === home.id); expect(paid.length).toBeGreaterThan(0)
  })
  it('starts from that account\'s balance, with no reserve line, and says which account it is', () => {
    for (const a of cash) { const c = cashCalendar(data, s, 60, { accountId: a.id }); expect(c.start).toBe(balanceOf(a, data)); expect(c.floor).toBe(0); expect(c.firstFloor).toBeNull(); expect(c.account?.id).toBe(a.id) }
    expect(all.account).toBeNull(); expect(all.assumed).toBe(0); expect(all.floor).toBe(3000)
  })
  it('only what touches the account is in it: pay into it, bills from it — nothing paid from a card or from another account', () => {
    const c = cashCalendar(data, s, 60, { accountId: home.id })
    for (const x of c.items) {
      const rec = data.recurring.find(r => r.id === x.id), pay = data.paySchedules.find(p => p.id === x.id)
      if (pay) expect(pay.deposit_account_id == null || pay.deposit_account_id === home.id).toBe(true)
      if (rec) expect(rec.account_id == null || rec.account_id === home.id || rec.liability_account_id === home.id).toBe(true)
    }
    const onCards = data.recurring.filter(r => r.status === 'Active' && r.account_id && !cash.some(a => a.id === r.account_id)); expect(onCards.length).toBeGreaterThan(0)
    for (const r of onCards) expect(c.items.some(x => x.id === r.id)).toBe(false)
  })
  it('a transfer between two cash accounts moves nothing overall, but leaves one account and lands in the other', () => {
    const tr = data.recurring.find(r => r.status === 'Active' && (r.kind === 'savings' || r.kind === 'transfer') && cash.some(a => a.id === r.account_id) && cash.some(a => a.id === r.liability_account_id))!
    expect(tr).toBeTruthy(); expect(all.items.some(x => x.id === tr.id)).toBe(false)
    const from = cashCalendar(data, s, 60, { accountId: tr.account_id! }).items.filter(x => x.id === tr.id), to = cashCalendar(data, s, 60, { accountId: tr.liability_account_id! }).items.filter(x => x.id === tr.id)
    expect(from.length).toBeGreaterThan(0); expect(from.every(x => x.amt < 0)).toBe(true); expect(to.length).toBe(from.length); expect(to.every(x => x.amt > 0)).toBe(true)
  })
  it('items with no account set go to the everyday account, are counted, and are in no other account', () => {
    const h = cashCalendar(data, s, 60, { accountId: home.id }); expect(h.assumed).toBeGreaterThan(0)
    const planned = data.planned.filter(p => p.status === 'Planned' && p.date <= h.daily[h.daily.length - 1].d); expect(planned.length).toBeGreaterThan(0)
    for (const p of planned) expect(h.items.some(x => x.id === p.id)).toBe(true)
    for (const a of cash.filter(x => x.id !== home.id)) { const c = cashCalendar(data, s, 60, { accountId: a.id }); expect(c.assumed).toBe(0); for (const p of planned) expect(c.items.some(x => x.id === p.id)).toBe(false) }
  })
  it('everyday spending is what was spent from that account — less than the household\'s, which includes the cards', () => {
    const flex = (c: ReturnType<typeof cashCalendar>) => -(c.items.find(x => x.src === 'flex')?.amt || 0)
    const each = cash.map(a => flex(cashCalendar(data, s, 60, { accountId: a.id }))); expect(flex(all)).toBeGreaterThan(0)
    for (const f of each) expect(f).toBeLessThan(flex(all)); expect(each.reduce((x, y) => x + y, 0)).toBeLessThan(flex(all))
  })
  it('one account can run tight while cash overall is fine — the reason for the view', () => {
    const h = cashCalendar(data, s, 60, { accountId: home.id }); expect(h.low.bal).toBeLessThan(all.low.bal); expect(all.firstFloor).toBeNull()
  })
  it('pay is weighed as a monthly amount: $1,000 a week outweighs $3,000 a month', () => {
    const d = structuredClone(data); const [a, b] = cashAccounts(d, s); const p = d.paySchedules.find(x => x.status === 'Active')!
    d.paySchedules = [{ ...p, id: 'w', frequency: 'weekly', net_amount: 1000, deposit_account_id: a.id }, { ...p, id: 'm', frequency: 'monthly', net_amount: 3000, deposit_account_id: b.id }]
    expect(everydayAccount(d, s)!.id).toBe(a.id)
    d.paySchedules = [{ ...p, id: 'w', frequency: 'weekly', net_amount: 500, deposit_account_id: a.id }, { ...p, id: 'm', frequency: 'monthly', net_amount: 3000, deposit_account_id: b.id }]; expect(everydayAccount(d, s)!.id).toBe(b.id)
  })
  it('a transfer with no "from" account comes out of the everyday account — and into it from itself is nothing at all', () => {
    const d = structuredClone(data); const other = cash.find(a => a.id !== home.id)!; const tr = d.recurring.find(r => r.status === 'Active' && (r.kind === 'savings' || r.kind === 'transfer'))!
    tr.account_id = null; tr.liability_account_id = home.id
    expect(cashCalendar(d, s, 60, { accountId: home.id }).items.some(x => x.id === tr.id)).toBe(false)
    tr.liability_account_id = other.id
    expect(cashCalendar(d, s, 60, { accountId: home.id }).items.filter(x => x.id === tr.id).every(x => x.amt < 0)).toBe(true); expect(cashCalendar(d, s, 60, { accountId: home.id }).items.some(x => x.id === tr.id)).toBe(true)
    expect(cashCalendar(d, s, 60, { accountId: other.id }).items.filter(x => x.id === tr.id).every(x => x.amt > 0)).toBe(true); expect(cashCalendar(d, s, 60, { accountId: other.id }).items.some(x => x.id === tr.id)).toBe(true)
  })
  it('a card paid automatically from an account is in that account\'s calendar, not the everyday one', () => {
    const d = structuredClone(data); const other = cash.find(a => a.id !== home.id)!
    const due = cashCalendar(d, s, 60, { accountId: home.id }).items.find(x => x.src === 'debt' && d.accounts.some(a => a.id === x.id))!; expect(due).toBeTruthy()
    d.accounts.find(a => a.id === due.id)!.autopay_account_id = other.id
    expect(cashCalendar(d, s, 60, { accountId: home.id }).items.some(x => x.id === due.id)).toBe(false); expect(cashCalendar(d, s, 60, { accountId: other.id }).items.some(x => x.id === due.id && x.amt < 0)).toBe(true)
    expect(cashCalendar(d, s, 60).items.some(x => x.id === due.id)).toBe(true)   // all cash together: unchanged
  })
  it('an account that is not there falls back to all cash', () => { const c = cashCalendar(data, s, 60, { accountId: 'nope' }); expect(c.account).toBeNull(); expect(c.start).toBe(all.start) })
})

// a small household for the accuracy check: checking + savings (cash), a card, a brokerage
const H = 'h1', at = '2026-10-01T06:00:00.000Z'
const acct = (id: string, kind: Account['kind'], balance: number, cash: boolean): Account => ({ id, household_id: H, name: id, kind, balance, apr: 0, minimum_payment: 0, autopay: false, include_in_cash: cash, include_in_net_worth: true, status: 'Active', sort_order: 1 } as Account)
const cat = (id: string, kind: 'expense' | 'income'): Category => ({ id, household_id: H, name: id, kind, priority: 'Essential', cost_type: 'Variable', default_budget: 0, budget_cadence: 'period', rollover: false, sort_order: 1, archived: false } as Category)
let n = 0
const tx = (date: string, kind: Transaction['kind'], amount: number, account_id: string, extra: Partial<Transaction> = {}): Transaction => ({ id: 't' + (++n), household_id: H, date, kind, amount, account_id, tags: [], status: 'cleared', source: 'manual', exclude_from_budget: false, created_at: date + 'T12:00:00.000Z', ...extra } as Transaction)
function household(): Data {
  const d = emptyData()
  d.accounts = [acct('chk', 'checking', 3000, true), acct('sav', 'savings', 5000, true), acct('card', 'credit_card', 400, false), acct('brk', 'investment', 9000, false)]
  d.categories = [cat('rent', 'expense'), cat('food', 'expense'), cat('pay', 'income')]
  d.paySchedules = [{ id: 'p1', household_id: H, name: 'Job', kind: 'salary', frequency: 'biweekly', anchor_date: '2026-10-02', net_amount: 2000, deposit_account_id: 'chk', status: 'Active' } as PaySchedule]
  d.recurring = [{ id: 'r1', household_id: H, name: 'Rent', kind: 'bill', amount: 1200, amount_varies: false, frequency: 'monthly', day_of_month: 5, next_due: '2026-11-05', account_id: 'chk', category_id: 'rent', autopay: false, reminder_days: 0, status: 'Active', sort_order: 1 } as Recurring]
  return d
}
const saved = (over: Partial<ForecastSnapshot> = {}): ForecastSnapshot => ({ id: 'f1', household_id: H, taken_on: '2026-10-01', through: '2026-10-31', start_cash: 8000, expected_in: 4000, expected_out: 2300, expected_end: 9700, expected_low: 7000, low_date: '2026-10-05',
  by_source: { in_pay: 4000, out_bills: 1200, out_everyday: 600, out_debt: 500 }, created_at: at, updated_at: at, ...over })

describe('what the recorded transactions show for a saved forecast', () => {
  const s = SETTINGS_DEFAULTS
  it('counts cash in and out the way the forecast does', () => {
    const d = household(); d.transactions = [
      tx('2026-10-02', 'income', 2000, 'chk', { pay_schedule_id: 'p1' }), tx('2026-10-16', 'income', 2010, 'chk'),          // tagged, and matched to a pay date by amount
      tx('2026-10-20', 'income', 75, 'chk'),                                                                               // other money in
      tx('2026-10-05', 'expense', 1200, 'chk', { recurring_id: 'r1' }), tx('2026-10-09', 'expense', 80, 'chk', { category_id: 'rent' }),   // a bill, and spending in a bill's category
      tx('2026-10-11', 'expense', 310, 'chk', { category_id: 'food' }),                                                     // everyday, from cash
      tx('2026-10-12', 'expense', 999, 'card', { category_id: 'food' }),                                                    // on the card: not cash yet
      tx('2026-10-18', 'transfer', 450, 'chk', { to_account_id: 'card' }),                                                  // the card payment is
      tx('2026-10-19', 'transfer', 200, 'chk', { to_account_id: 'brk' }), tx('2026-10-21', 'transfer', 60, 'brk', { to_account_id: 'chk' }),   // out of cash, and back in
      tx('2026-10-22', 'transfer', 700, 'chk', { to_account_id: 'sav' }),                                                   // between two cash accounts: nothing
    ]
    const a = forecastActuals(d, s, saved())
    expect(a.by).toEqual({ in_pay: 4010, in_other: 135, out_bills: 1280, out_debt: 450, out_everyday: 310, out_other: 200 })
    expect(a).toMatchObject({ in: 4145, out: 2240, end: 8000 + 4145 - 2240, count: 9 })
  })
  it('only the days the forecast covered: after the day it was saved, through its last day — and the same day only if entered afterwards', () => {
    const d = household(); d.transactions = [
      tx('2026-09-30', 'expense', 11, 'chk'), tx('2026-11-01', 'expense', 13, 'chk'),                                  // before and after
      tx('2026-10-01', 'expense', 17, 'chk', { created_at: '2026-10-01T05:00:00.000Z' }),                             // that morning, already in the starting cash
      tx('2026-10-01', 'expense', 19, 'chk', { created_at: '2026-10-01T09:00:00.000Z' }),                             // that day, entered after the forecast was saved
      tx('2026-10-31', 'expense', 23, 'chk'), tx('2026-10-15', 'expense', 29, 'chk', { status: 'void' }), tx('2026-10-15', 'expense', 31, 'chk', { duplicate_of: 't0' }),
    ]
    expect(forecastActuals(d, s, saved())).toMatchObject({ out: 42, in: 0, count: 2 })
  })
  it('keeps to the accounts that counted as cash when it was saved, whatever is marked as cash later', () => {
    const d = household(); d.transactions = [tx('2026-10-10', 'transfer', 2000, 'chk', { to_account_id: 'sav' }), tx('2026-10-12', 'expense', 40, 'sav')]
    const f = saved({ cash_accounts: ['chk', 'sav'] }); expect(forecastActuals(d, s, f)).toMatchObject({ out: 40, in: 0 })
    d.accounts[1].include_in_cash = false   // savings no longer counts as cash: the saved forecast still started from both
    expect(forecastActuals(d, s, f)).toMatchObject({ out: 40, in: 0 }); expect(forecastActuals(d, s, saved())).toMatchObject({ out: 2000 })   // a row saved without the list falls back to today's marking
  })
  it('"entered afterwards" is judged against what was on file when the forecast was worked out, not when the row was stored', () => {
    const d = household(); d.transactions = [tx('2026-10-01', 'expense', 100, 'chk', { created_at: '2026-10-01T06:00:03.000Z' })]
    // another device entered it after this one read the data (05:59:58) but before the forecast row was stored (06:00:05): it is not in start_cash, so it counts
    expect(forecastActuals(d, s, saved({ created_at: '2026-10-01T06:00:05.000Z', observed_at: '2026-10-01T05:59:58.000Z' }))).toMatchObject({ out: 100, count: 1 })
    expect(forecastActuals(d, s, saved({ created_at: '2026-10-01T06:00:05.000Z', observed_at: null }))).toMatchObject({ out: 0 })
    // and timestamps are compared as moments, whatever form they are written in
    expect(forecastActuals(d, s, saved({ observed_at: '2026-10-01T05:59:58+00:00' }))).toMatchObject({ out: 100 })
  })
  it('an account left out of the figures, or one that does not count as cash, is not cash', () => {
    const d = household(); d.accounts[1].include_in_cash = false; d.transactions = [tx('2026-10-10', 'expense', 50, 'sav'), tx('2026-10-10', 'transfer', 300, 'chk', { to_account_id: 'sav' })]
    expect(forecastActuals(d, s, saved()).by).toMatchObject({ out_everyday: 0, out_other: 300 })
  })
})
describe('how close it was', () => {
  const s = SETTINGS_DEFAULTS
  it('the difference, the grade and the part that explains most of it', () => {
    const d = household(); d.transactions = [tx('2026-10-02', 'income', 2000, 'chk', { pay_schedule_id: 'p1' }), tx('2026-10-16', 'income', 2000, 'chk', { pay_schedule_id: 'p1' }), tx('2026-10-05', 'expense', 1200, 'chk', { recurring_id: 'r1' }), tx('2026-10-11', 'expense', 940, 'chk', { category_id: 'food' }), tx('2026-10-18', 'transfer', 500, 'chk', { to_account_id: 'card' })]
    const c = checkForecast(d, s, saved())
    expect(c).toMatchObject({ diff: -340, grade: 'close', days: 30, empty: false, biggest: { g: 'out_everyday', diff: 340, side: 'out' } }); expect(c.actual.end).toBe(9360); expect(c.pct).toBeCloseTo(340 / 9700, 6)
    expect(c.rows.map(r => r.g)).toEqual(['in_pay', 'out_bills', 'out_debt', 'out_everyday']); expect(c.rows.find(r => r.g === 'out_debt')).toMatchObject({ expected: 500, actual: 500, diff: 0 })
  })
  it('grades: within 5% close, within 15% fair, beyond that off — measured against the money expected to move when the balance is small', () => {
    const f = { expected_end: 10000, expected_in: 4000, expected_out: 4000 }
    expect(gradeOf(500, f).grade).toBe('close'); expect(gradeOf(-501, f).grade).toBe('fair'); expect(gradeOf(1500, f).grade).toBe('fair'); expect(gradeOf(-1501, f).grade).toBe('off')
    expect(gradeOf(150, { expected_end: 50, expected_in: 4000, expected_out: 4000 })).toMatchObject({ grade: 'close' }); expect(gradeOf(0, { expected_end: 0, expected_in: 0, expected_out: 0 }).pct).toBe(0)
  })
  it('nothing recorded for the period: said, not graded as a miss; small differences name no culprit', () => {
    const d = household(); expect(checkForecast(d, s, saved())).toMatchObject({ empty: true })
    d.transactions = [tx('2026-10-02', 'income', 4000, 'chk', { pay_schedule_id: 'p1' }), tx('2026-10-05', 'expense', 1210, 'chk', { recurring_id: 'r1' }), tx('2026-10-11', 'expense', 600, 'chk'), tx('2026-10-18', 'transfer', 500, 'chk', { to_account_id: 'card' })]
    expect(checkForecast(d, s, saved()).biggest).toBeNull()
  })
  it('finished months are checked, newest first; the one still running is kept apart', () => {
    const d = household(); d.forecasts = [saved({ id: 'a', taken_on: '2026-09-01', through: '2026-09-30' }), saved({ id: 'b' }), saved({ id: 'c', taken_on: '2026-11-02', through: '2026-11-30' })]
    const r = forecastChecks(d, s); expect(r.done.map(x => x.f.id)).toEqual(['b', 'a']); expect(r.running?.id).toBe('c')
  })
})
describe('saving this month\'s forecast', () => {
  const s = { ...SETTINGS_DEFAULTS, reserveFloor: 1000 }
  it('what the calendar expects from today to the end of the month, by kind of item, adding up', () => {
    const d = household(); const f = forecastSnapshot(d, s)!
    expect(f).toMatchObject({ taken_on: '2026-11-10', through: '2026-11-30', start_cash: 8000, notes: null })
    expect(f.cash_accounts).toEqual(['sav', 'chk']); expect(Number.isNaN(Date.parse(f.observed_at!))).toBe(false)
    d.transactions = [tx('2026-11-02', 'expense', 5, 'chk', { created_at: '2026-11-02T10:00:00.000Z' }), tx('2026-11-08', 'expense', 5, 'chk', { created_at: '2026-11-09T08:30:00.000Z' })]; expect(forecastSnapshot(d, s)!.observed_at).toBe('2026-11-09T08:30:00.000Z'); d.transactions = []
    expect(f.expected_in).toBe(4000); expect(f.by_source.in_pay).toBe(4000)          // paydays Nov 13 and Nov 27; rent was due on the 5th, before today
    expect(f.expected_end).toBe(Math.round((f.start_cash + f.expected_in - f.expected_out) * 100) / 100)
    const parts = Object.entries(f.by_source); expect(parts.filter(([k]) => k.startsWith('in')).reduce((a, [, v]) => a + v!, 0)).toBeCloseTo(f.expected_in, 2); expect(parts.filter(([k]) => k.startsWith('out')).reduce((a, [, v]) => a + v!, 0)).toBeCloseTo(f.expected_out, 2)
    const cal = cashCalendar(d, s, 20); expect(f.expected_low).toBe(Math.round(cal.low.bal * 100) / 100); expect(f.low_date).toBe(cal.low.date)
  })
  it(`not with fewer than ${MIN_DAYS} days of the month left, and not for a household with nothing in it`, () => {
    setToday('2026-11-26'); expect(forecastSnapshot(household(), s)).toBeNull(); setToday('2026-11-25'); expect(forecastSnapshot(household(), s)?.through).toBe('2026-11-30'); setToday('2026-11-10')
    expect(forecastSnapshot(emptyData(), s)).toBeNull()
  })
  it('once a month: needed until one runs to this month\'s end', () => {
    const d = household(); expect(needsSnapshot(d)).toBe(true); d.forecasts = [saved()]; expect(needsSnapshot(d)).toBe(true)
    d.forecasts.push(saved({ id: 'n', taken_on: '2026-11-10', through: monthEnd('2026-11') })); expect(needsSnapshot(d)).toBe(false)
  })
  it('the sample household has two finished months to show, both adding up', () => {
    const { data, household: hh } = demoSeed(); const r = forecastChecks(data, hh.settings); expect(r.done.length).toBe(2)
    for (const c of r.done) { expect(c.empty).toBe(false); expect(c.f.expected_end).toBeCloseTo(c.f.start_cash + c.f.expected_in - c.f.expected_out, 2); expect(['close', 'fair']).toContain(c.grade) }
  })
})
describe('where saved forecasts sit in the rest of the app', () => {
  it('restored with a backup (one per month), never rewritten, and read with the Accounts section', () => {
    expect(RESTORE_ORDER).toContain('forecasts'); expect(NATURAL_KEY.forecasts!({ through: '2026-10-31T00:00:00' })).toBe('!2026-10-31')
    expect(MODULES.find(m => m.k === 'accounts')!.tables).toContain('forecast_snapshots')
  })
})
