// 0.25.1 fixes: safe to spend and overdue bills, paychecks logged once, the Plan page's allocation modes, promotional vs regular APRs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setToday } from './dates'
import { emptyData, SETTINGS_DEFAULTS, type Account, type Data, type Goal, type PaySchedule, type Recurring, type RetirementInputs, type Settings, type Transaction } from '../app/data/types'
import { safeToSpend, runwayProjection } from './forecast'
import { computeDigest } from './notify'
import { paycheckOnFile, payDates } from './paySchedule'
import { buildPlan, applyPlanPatches, affordableExtra } from './plan'
import { projectRetirement, RETIREMENT_DEFAULTS } from './retirement'
import { aprAt, debtTotals, payoffOrder, simulate } from './debts'
import { buildReport } from './reports'
import { MemoryRepo } from '../app/data/memoryRepo'
import { demoSeed } from '../app/data/demoSeed'
import { useStore } from '../app/store'

const T0 = '2026-11-06'
beforeAll(() => setToday(T0))
afterAll(() => setToday(null))
let n = 0; const id = (p: string) => `${p}${++n}`
const acct = (o: Partial<Account>): Account => ({ id: id('a'), household_id: 'h', name: 'Checking', kind: 'checking', balance: 0, apr: 0, minimum_payment: 0, autopay: false, include_in_cash: true, include_in_net_worth: true, status: 'Active', sort_order: 1, ...o })
const card = (o: Partial<Account>): Account => acct({ name: 'Card', kind: 'credit_card', include_in_cash: false, balance: 1000, apr: 20, minimum_payment: 50, planned_payment: 50, ...o })
const bill = (o: Partial<Recurring>): Recurring => ({ id: id('r'), household_id: 'h', name: 'Electric', kind: 'bill', amount: 150, amount_varies: false, frequency: 'monthly', day_of_month: 1, autopay: false, reminder_days: 3, status: 'Active', sort_order: 1, ...o })
const pay = (o: Partial<PaySchedule>): PaySchedule => ({ id: id('p'), household_id: 'h', name: 'Paycheck', kind: 'salary', frequency: 'biweekly', anchor_date: '2026-11-13', net_amount: 2000, status: 'Active', ...o })
const txn = (o: Partial<Transaction>): Transaction => ({ id: id('t'), household_id: 'h', date: T0, kind: 'expense', amount: 0, tags: [], status: 'cleared', source: 'manual', exclude_from_budget: false, ...o })
const goal = (o: Partial<Goal>): Goal => ({ id: id('g'), household_id: 'h', name: 'Trip', kind: 'purchase', target_amount: 600, starting_amount: 0, monthly_contribution: 0, priority: 1, status: 'Active', sort_order: 1, ...o })
const data = (o: Partial<Data>): Data => ({ ...emptyData(), ...o })
const settings = (o: Partial<Settings> = {}): Settings => ({ ...SETTINGS_DEFAULTS, ...o })

// ---------------------------------------------------------------- bug 1
describe('safe to spend takes off bills that are already overdue', () => {
  const chk = acct({ balance: 3000 })
  const paid = bill({ name: 'Water', amount: 60, day_of_month: 2 })
  const d = data({ accounts: [chk], paySchedules: [pay({ deposit_account_id: chk.id })],
    recurring: [bill({ name: 'Electric', amount: 150, day_of_month: 1 }), bill({ name: 'Gym', kind: 'subscription', amount: 40, day_of_month: 3, autopay: true }), paid],
    transactions: [txn({ date: '2026-11-02', amount: 60, account_id: chk.id, recurring_id: paid.id })] })
  const s = settings({ reserveFloor: 500 })
  it('an unpaid bill past its due date, and an autopay one that never went through, are still owed', () => {
    const r = safeToSpend(d, s)
    expect(r.payday).toBe('2026-11-13')
    expect(r.overdue).toBeCloseTo(190, 2)                 // Electric 150 + Gym 40; Water is paid
    expect(r.committed).toBeCloseTo(190, 2)
    expect(r.safe).toBeCloseTo(3000 - 190 - 500, 2)
    expect(r.items.map(x => x.label).join('|')).toMatch(/Electric/)
  })
  it('a card or loan payment past its due date counts too', () => {
    const c = card({ due_date: '2026-11-03', minimum_payment: 35, planned_payment: 35, last_paid_due: null })
    const r = safeToSpend({ ...d, accounts: [chk, c] }, s)
    expect(r.overdue).toBeCloseTo(190 + 35, 2); expect(r.safe).toBeCloseTo(3000 - 225 - 500, 2)
  })
  it('the Monday digest takes the same overdue amounts off (autopay included)', () => {
    const dg = computeDigest({ today: '2026-11-09', reserveFloor: 500, occurrences: [], transactions: [],
      accounts: [{ id: 'chk', name: 'Checking', kind: 'checking', status: 'Active', balance: 3000, include_in_cash: true }],
      recurring: [{ id: 'e', name: 'Electric', kind: 'bill', amount: 150, frequency: 'monthly', day_of_month: 1, status: 'Active', autopay: false }, { id: 'g', name: 'Gym', kind: 'subscription', amount: 40, frequency: 'monthly', day_of_month: 3, status: 'Active', autopay: true }] })
    expect(dg.dueTotal).toBe(0); expect(dg.overdueTotal).toBeCloseTo(190, 2)
    expect(dg.safeThisWeek).toBeCloseTo(3000 - 190 - 500, 2)
    expect(dg.overdue.map(o => [o.name, o.autopay])).toEqual([['Electric', false], ['Gym', true]])
  })
})

// ---------------------------------------------------------------- bug 4
describe('a paycheck is recorded once', () => {
  const ps = pay({ id: 'ps1', net_amount: 2000 })
  it('recognizes a deposit already on file: same schedule, or the take-home within 2% or $5, within 2 days', () => {
    const at = (t: Partial<Transaction>) => paycheckOnFile(data({ transactions: [txn({ kind: 'income', ...t })] }), ps, '2026-11-13')
    expect(at({ date: '2026-11-13', amount: 1500, pay_schedule_id: 'ps1' })).not.toBeNull()   // linked: any amount
    expect(at({ date: '2026-11-12', amount: 2030 })).not.toBeNull()                            // bank feed, 1.5% off, a day early
    expect(at({ date: '2026-11-15', amount: 2000 })).not.toBeNull()
    expect(at({ date: '2026-11-16', amount: 2000 })).toBeNull()                                // 3 days away
    expect(at({ date: '2026-11-13', amount: 2100 })).toBeNull()                                // 5% off
    expect(at({ date: '2026-11-13', amount: 2000, pay_schedule_id: 'other' })).toBeNull()      // someone else's paycheck
    expect(at({ date: '2026-11-13', amount: 2000, status: 'void' })).toBeNull()
    expect(at({ date: '2026-11-13', amount: 2000, kind: 'expense' })).toBeNull()
    expect(paycheckOnFile(data({ transactions: [txn({ kind: 'income', date: '2026-11-13', amount: 2600 })] }), ps, '2026-11-13', 2600)).not.toBeNull()   // the amount typed in
  })
  it('logging the same paycheck twice (double click, or after the bank feed brought it in) adds one transaction', async () => {
    const seed = demoSeed(); const repo = new MemoryRepo(seed)
    useStore.setState({ mode: 'demo', repo, role: 'owner', readOnly: false, offlineAt: null }); await useStore.getState().refresh()
    const st = useStore.getState(); const p = st.data.paySchedules.find(x => x.status === 'Active' && +x.net_amount > 0)!
    const date = payDates(p, '2027-03-01', '2027-03-31')[0]; const acctId = p.deposit_account_id!
    const before = st.data.accounts.find(a => a.id === acctId)!.balance
    const row = { kind: 'income' as const, amount: +p.net_amount, date, account_id: acctId, pay_schedule_id: p.id, payee: p.name, tags: [], status: 'cleared' as const, source: 'manual' as const, exclude_from_budget: false }
    const [a, b] = await Promise.all([useStore.getState().logPaycheck(row), useStore.getState().logPaycheck(row)])
    const mine = () => useStore.getState().data.transactions.filter(t => t.kind === 'income' && t.date === date)
    expect(mine()).toHaveLength(1); expect([a.existing, b.existing].sort()).toEqual([false, true]); expect(a.txn.id).toBe(b.txn.id)
    expect(useStore.getState().data.accounts.find(x => x.id === acctId)!.balance).toBeCloseTo(before + +p.net_amount, 2)   // the balance moved once
    // the next payday arrived from the bank feed first (no schedule link, a little more than the take-home)
    const next = payDates(p, '2027-04-01', '2027-04-30')[0]
    await useStore.getState().insert('transactions', { kind: 'income', amount: +p.net_amount + 3, date: next, account_id: acctId, payee: 'PAYROLL DEP', tags: [], status: 'cleared', source: 'import', exclude_from_budget: false })
    const c = await useStore.getState().logPaycheck({ ...row, date: next })
    expect(c.existing).toBe(true); expect(useStore.getState().data.transactions.filter(t => t.kind === 'income' && t.date === next)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------- bug 6
describe('the Plan page: every allocation mode does what it says', () => {
  const RI: RetirementInputs = { ...RETIREMENT_DEFAULTS, currentAge: 40, retireAge: 65, annualContribution: 0, desiredIncome: 30000, socialSecurity: 0, ssMonthly: null, ssStartAge: 67, pensions: [] }
  const chk = acct({ balance: 50000 })
  const mk = (o: Partial<Data> = {}) => data({ accounts: [chk, card({ id: 'debt1' })], paySchedules: [pay({ frequency: 'monthly', anchor_date: '2026-11-15', net_amount: 6000 })], goals: [goal({ id: 'trip' })], ...o })
  const s = settings({ retirement: RI })
  const need = (projectRetirement(0, RI).contributionForTarget || 0) / 12     // what retirement still needs each month to be fully funded
  const debtLeft = 1000 * (1 + 20 / 1200) - 50                               // this month's balance after interest and the planned payment
  const now = (mode: 'debt_first' | 'goals_first' | 'retirement_first' | 'split', extra: number, more: object = {}, d = mk(), st = s) => buildPlan(d, st, { extra, mode, ...more }).now
  const goalsNow = (x: ReturnType<typeof now>) => Object.values(x.goals).reduce((a, b) => a + b, 0)
  it('the fixture: retirement is short, so it has a monthly need', () => { expect(need).toBeGreaterThan(1000); expect(need).toBeLessThan(2000) })
  it('Debt first: debt, then goals, then retirement up to its need; the rest stays as cash', () => {
    const r = now('debt_first', 5000)
    expect(r.debt).toBeCloseTo(debtLeft, 1); expect(goalsNow(r)).toBeCloseTo(600, 1); expect(r.retirement).toBeCloseTo(need, 1)
    expect(r.cash).toBeCloseTo(5000 - debtLeft - 600 - need, 1)
    expect(now('debt_first', 400).debt).toBe(400)
  })
  it('Goals first: goals, then debt, then retirement', () => {
    const r = now('goals_first', 1000); expect(goalsNow(r)).toBeCloseTo(600, 1); expect(r.debt).toBeCloseTo(400, 1); expect(r.retirement).toBe(0)
  })
  it('Retirement first: retirement up to what it still needs, then debt, then goals', () => {
    const small = now('retirement_first', 500); expect(small.retirement).toBe(500); expect(small.debt).toBe(0)
    const big = now('retirement_first', 2000); expect(big.retirement).toBeCloseTo(need, 1); expect(big.debt).toBeCloseTo(2000 - need, 1); expect(goalsNow(big)).toBe(0); expect(big.cash).toBe(0)
    const huge = now('retirement_first', 5000); expect(huge.retirement).toBeCloseTo(need, 1); expect(huge.debt).toBeCloseTo(debtLeft, 1); expect(goalsNow(huge)).toBeCloseTo(600, 1)
    expect(huge.cash).toBeCloseTo(5000 - need - debtLeft - 600, 1)
    const funded = now('retirement_first', 500, {}, mk(), settings({ retirement: { ...RI, desiredIncome: 0 } }))   // nothing more needed for retirement
    expect(funded.retirement).toBe(0); expect(funded.debt).toBe(500)
  })
  it('Split: by the shares; a share that cannot be used passes on, and what is still left goes to whatever can take it', () => {
    const r = now('split', 1000, { split: { debt: 50, goals: 30, retirement: 20 } }); expect(r.debt).toBeCloseTo(500, 1); expect(goalsNow(r)).toBeCloseTo(300, 1); expect(r.retirement).toBeCloseTo(200, 1); expect(r.cash).toBe(0)
    const all = now('split', 3000, { split: { debt: 0, goals: 0, retirement: 100 } })
    expect(all.retirement).toBeCloseTo(need, 1); expect(all.debt).toBeCloseTo(debtLeft, 1); expect(goalsNow(all)).toBeCloseTo(600, 1); expect(all.cash).toBeCloseTo(3000 - need - debtLeft - 600, 1)
  })
  it('Stays as cash: with no debt, every goal full and retirement fully funded, the extra stays in unallocated cash', () => {
    const d = mk({ accounts: [chk], goals: [goal({ id: 'trip', starting_amount: 600 })] }); const st = settings({ retirement: { ...RI, desiredIncome: 0 } })
    const r = buildPlan(d, st, { extra: 400, mode: 'debt_first' }), none = buildPlan(d, st, { extra: 0, mode: 'debt_first' })
    expect(r.now).toMatchObject({ debt: 0, retirement: 0, cash: 400 }); expect(r.months[0].toCash).toBe(400)
    expect(r.months.map(m => m.cash)).toEqual(none.months.map(m => m.cash))      // it is not spent anywhere
    for (const mode of ['goals_first', 'retirement_first', 'split'] as const) expect(buildPlan(d, st, { extra: 400, mode }).now.cash).toBe(400)
    const af = affordableExtra(d, st); expect(af.full).toBe(true); expect(af.max).toBe(0)
  })
  it('every dollar of extra lands in exactly one place, in every mode, every month', () => {
    for (const mode of ['debt_first', 'goals_first', 'retirement_first', 'split'] as const) for (const extra of [300, 2500, 9000]) {
      const r = buildPlan(mk(), s, { extra, mode, rollFreed: false })
      for (const m of r.months) expect(m.debtExtra + m.goalExtra + m.retireExtra + m.toCash).toBeCloseTo(extra, 1)
    }
  })
  it('after Apply the plan is not counted twice: retirement extra still comes out of cash, goals get it once', () => {
    for (const mode of ['retirement_first', 'goals_first', 'split'] as const) {
      const d = mk(); const r1 = buildPlan(d, s, { extra: 700, mode }); const p = applyPlanPatches(d, s, r1)
      const d2 = { ...d, goals: d.goals.map(g => { const x = p.goals.find(y => y.id === g.id); return x ? { ...g, monthly_contribution: x.to } : g }) }
      const s2 = { ...s, plan: p.plan, retirement: { ...RI, annualContribution: p.retirement.to } }
      const r2 = buildPlan(d2, s2, { extra: 700, mode })
      expect(r2.months.map(m => [m.cash, m.retireBal, m.goalsSaved, m.goalBase + m.goalExtra, m.retireExtra])).toEqual(r1.months.map(m => [m.cash, m.retireBal, m.goalsSaved, m.goalBase + m.goalExtra, m.retireExtra]))
      expect(r2.now).toEqual(r1.now)
    }
  })
})

// ---------------------------------------------------------------- bug 7
describe('promotional and regular APRs each apply on their own dates', () => {
  it('a promotion that ended earlier this month no longer applies this month', () => {
    const ended = card({ apr: 24.99, promo_apr: 0, promo_until: '2026-11-03' })
    expect(aprAt(ended, 0)).toBe(24.99); expect(aprAt(ended, 1)).toBe(24.99)
    const running = card({ apr: 24.99, promo_apr: 0, promo_until: '2026-11-30' }); expect(aprAt(running, 0)).toBe(0); expect(aprAt(running, 1)).toBe(24.99)
  })
  const promo = card({ id: 'promo', name: 'Promo card', balance: 3000, apr: 29.99, promo_apr: 0, promo_until: '2027-06-30', planned_payment: 100 })
  const std = card({ id: 'std', name: 'Standard card', balance: 3000, apr: 18, planned_payment: 100 })
  it('interest cost and weighted APR use the promotional rate while it runs', () => {
    const t = debtTotals(data({ accounts: [promo, std] }))
    expect(t.interestMonth).toBeCloseTo(3000 * 18 / 1200, 2); expect(t.wApr).toBeCloseTo(9, 2)
  })
  it('the avalanche order shown matches the projection: a 0% card waits until its promotion ends', () => {
    expect(payoffOrder([promo, std], 'avalanche').map(a => a.id)).toEqual(['std', 'promo'])
    const sim = simulate([promo, std], 300, 'avalanche'); const off = (k: string) => sim.order.find(o => o.id === k)!.paidOffMonth!
    expect(off('std')).toBeLessThan(off('promo'))        // the projection sends the extra to the 18% card first, as the order says
    expect(payoffOrder([promo, std], 'snowball').map(a => a.id)).toEqual(['promo', 'std'])
  })
  it('the cash runway pays a promotional balance off on the promotional schedule', () => {
    const chk = acct({ balance: 20000 })
    const short = card({ balance: 1200, apr: 29.99, promo_apr: 0, promo_until: '2028-12-31', minimum_payment: 100, planned_payment: 100 })
    const with0 = runwayProjection(data({ accounts: [chk, short] }), settings(), { months: 24 })
    const without = runwayProjection(data({ accounts: [chk, { ...short, promo_apr: null, promo_until: null }] }), settings(), { months: 24 })
    const total = (r: typeof with0) => r.out.reduce((a, b) => a + b, 0)
    expect(total(with0)).toBeCloseTo(1200, 0)            // twelve $100 payments at 0%
    expect(total(without)).toBeGreaterThan(1300)         // interest at 29.99% stretches it out
  })
  it('the Debt report shows the rate in force today and the interest it costs', () => {
    const rep = buildReport(data({ accounts: [promo, std] }), settings(), 'month', '2026-11-01', ['debts'], T0)
    const sec = rep.sections[0]; const row = sec.table!.rows.find(r => r[0] === 'Promo card')!
    expect(row[3]).toBe(0); expect(row[7]).toBe(0)
    expect(sec.notes!.join(' ')).toMatch(/Promo card.*0%.*29\.99%/)
  })
})
