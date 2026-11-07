// 0.25.1 fixes (batch e): every dollar counted once and by one rule — card spending and bank-feed card payments (1), refunds in card
// statement files (9), transfers between cash accounts (13), one-off income (2), the net-worth report (6), runway month steps (15), verified
// debt balances (12), account numbers in bank-feed descriptions (16), a paycheck already received (17), one definition of spending, income
// and the savings rate (18), and averages that start with the first transaction (19).
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { setToday, mAdd } from './dates'
import { emptyData, SETTINGS_DEFAULTS, type Account, type Category, type Data, type Goal, type PaySchedule, type Recurring, type Settings, type Transaction } from '../app/data/types'
import { rangeStat, periodStat, insights, monthlyAverages, commitments, trendSeries, monthOnFile, monthsOnFile, spentIn } from './budget'
import { healthIndicators } from './intelligence'
import { buildReport } from './reports'
import { burn, cashCalendar, runwayProjection, netWorthSeries, safeToSpend, accountPaymentsDue, cashEffect } from './forecast'
import { planDedupe, unpairPatch, type DTxn } from './dedupe'
import { toNewTxns, normaliseResponse, maskDigits as maskBank, cardCredit } from './simplefin'
import { maskDigits as maskEmail } from './email/extract'
import { parseCsv, detectMapping, mapRows, dedupe as importDedupe, parseOfx } from './import'
import { monthlyIncome, PER_YEAR, nextPaycheck, oneOffPay } from './paySchedule'
import { allocatePaycheck } from './allocate'
import { buildPlan } from './plan'
import { debtTotals, simulate } from './debts'
import { utilization, debtBal, cashOnHand } from './accounts'
import { goalProgress } from './goals'
import { demoSeed } from '../app/data/demoSeed'
import { MemoryRepo } from '../app/data/memoryRepo'
import { useStore } from '../app/store'

const T0 = '2026-11-06'
beforeEach(() => setToday(T0))
afterAll(() => setToday(null))
let n = 0; const id = (p: string) => `${p}${++n}`
const acct = (o: Partial<Account>): Account => ({ id: id('a'), household_id: 'h', name: 'Checking', kind: 'checking', balance: 0, apr: 0, minimum_payment: 0, autopay: false, include_in_cash: true, include_in_net_worth: true, status: 'Active', sort_order: 1, ...o })
const card = (o: Partial<Account> = {}): Account => acct({ name: 'Visa', kind: 'credit_card', institution: 'Chase', include_in_cash: false, ...o })
const cat = (o: Partial<Category>): Category => ({ id: id('c'), household_id: 'h', name: 'Groceries', group: 'Food', kind: 'expense', priority: 'Essential', cost_type: 'Variable', default_budget: 0, budget_cadence: 'period', rollover: false, sort_order: 1, archived: false, ...o })
const txn = (o: Partial<Transaction>): Transaction => ({ id: id('t'), household_id: 'h', date: T0, kind: 'expense', amount: 0, tags: [], status: 'cleared', source: 'manual', exclude_from_budget: false, ...o })
const pay = (o: Partial<PaySchedule>): PaySchedule => ({ id: id('p'), household_id: 'h', name: 'Salary', kind: 'salary', frequency: 'biweekly', anchor_date: '2026-11-13', net_amount: 2000, status: 'Active', ...o })
const rec = (o: Partial<Recurring>): Recurring => ({ id: id('r'), household_id: 'h', name: 'Bill', kind: 'bill', amount: 100, amount_varies: false, frequency: 'monthly', day_of_month: 2, autopay: false, reminder_days: 3, status: 'Active', sort_order: 1, ...o })
const goal = (o: Partial<Goal>): Goal => ({ id: id('g'), household_id: 'h', name: 'Goal', kind: 'savings', target_amount: 1000, starting_amount: 0, monthly_contribution: 0, priority: 1, status: 'Active', sort_order: 1, ...o })
const data = (o: Partial<Data>): Data => ({ ...emptyData(), ...o })
const settings = (o: Partial<Settings> = {}): Settings => ({ ...SETTINGS_DEFAULTS, ...o })
const kpi = (d: Data, kind: 'month', anchor: string, label: string, sections = ['summary'] as Parameters<typeof buildReport>[4]) => buildReport(d, settings(), kind, anchor, sections, T0).sections.flatMap(s => s.kpis).find(k => k.label.startsWith(label))?.value
/** Apply a duplicate plan the way the store does: patch each keeper, mark each duplicate, leave them out. */
const applyPlan = (rows: Transaction[], plan: ReturnType<typeof planDedupe>) => rows.map(t => { const g = plan.auto.find(x => x.keeper === t.id); if (g) return { ...t, ...g.patch } as Transaction; const k = plan.auto.find(x => x.dups.includes(t.id)); return k ? { ...t, duplicate_of: k.keeper } : t }).filter(t => !t.duplicate_of)

// ---------------------------------------------------------------- 1
describe('1 — a purchase on a card is the spending; paying the card is moving money, and a bank-feed card payment is never income', () => {
  const chk = acct({ id: 'chk', name: 'Checking', balance: 10000 }), visa = card({ id: 'visa', name: 'Visa', institution: 'Chase' })
  const groc = cat({ id: 'groc', name: 'Groceries' }), paycheck = cat({ id: 'payc', name: 'Paycheck', group: 'Income', kind: 'income' }), ccp = cat({ id: 'ccp', name: 'Credit card payments', group: 'Debt', cost_type: 'Fixed' })
  const base = () => [txn({ id: 'inc', date: '2026-10-10', kind: 'income', amount: 5000, account_id: chk.id, category_id: paycheck.id, payee: 'Employer' }), txn({ id: 'kroger', date: '2026-10-12', amount: 2000, account_id: visa.id, category_id: groc.id, payee: 'Kroger' })]
  const legs = () => [txn({ id: 'leg-out', date: '2026-10-25', amount: 2000, account_id: chk.id, payee: 'CHASE CREDIT CRD AUTOPAY PPD ID: 4433', external_id: 'sfin:chk:1', source: 'import' }), txn({ id: 'leg-in', date: '2026-10-25', kind: 'income', amount: 2000, account_id: visa.id, payee: 'PAYMENT THANK YOU', external_id: 'sfin:card:1', source: 'import' })]
  const typed = () => data({ accounts: [chk, visa], categories: [groc, paycheck, ccp], transactions: [...base(), txn({ date: '2026-10-25', kind: 'transfer', amount: 2000, account_id: chk.id, to_account_id: visa.id, category_id: ccp.id, payee: 'Visa payment' })] })
  const synced = () => data({ accounts: [chk, visa], categories: [groc, paycheck, ccp], transactions: [...base(), ...legs()] })
  const oct = { id: 'oct', household_id: 'h', period_type: 'month' as const, start_date: '2026-10-01', end_date: '2026-10-31', status: 'open' as const, expected_income: 0 }

  it('income $5,000, spending $2,000, kept $3,000 and a 60% savings rate — typed as a transfer or brought in by the bank feed', () => {
    for (const d of [typed(), synced()]) {
      const r = rangeStat(d, '2026-10-01', '2026-10-31')
      expect(r.income).toBe(5000); expect(r.spend).toBe(2000); expect(r.net).toBe(3000); expect(r.rate).toBeCloseTo(0.6, 6)
    }
    const t = rangeStat(typed(), '2026-10-01', '2026-10-31'); expect(t.cards).toBe(2000); expect(t.loans).toBe(0); expect(t.debt).toBe(2000)
  })
  it('the report, Spending Intelligence and the Budget give the same answer', () => {
    for (const d of [typed(), synced()]) {
      expect(kpi(d, 'month', '2026-10-15', 'Net (kept)')).toBe(3000); expect(kpi(d, 'month', '2026-10-15', 'Savings rate')).toBe(0.6)
      const h = healthIndicators(d, settings(), 1, T0); expect(h.burnRate).toBe(2000); expect(h.savingsRate).toBe(0.6)
      const ps = periodStat({ ...d, periods: [oct] }, settings(), oct); expect(ps.rate).toBeCloseTo(0.6, 6); expect(ps.net).toBe(3000)
    }
    expect(kpi(typed(), 'month', '2026-10-15', 'Card payments')).toBe(2000); expect(kpi(typed(), 'month', '2026-10-15', 'Loan payments')).toBe(0)
  })
  it('a card payment carrying the "Credit card payments" budget line is not budget spending (and Insights says so)', () => {
    const d = { ...typed(), periods: [oct] }; const ps = periodStat(d, settings(), oct)
    expect(ps.spA).toBe(2000)                                   // groceries bought on the card — not the payment as well
    expect(spentIn(d, ccp.id, '2026-10-01', '2026-10-31')).toBe(0)
    expect(ps.cardOnLines).toEqual([{ name: 'Credit card payments', amount: 2000 }])
    expect(insights(settings(), ps).some(i => /Card payments are not counted/.test(i.t))).toBe(true)
  })
  it('loan payments still count as money leaving the household', () => {
    const auto = acct({ id: 'auto', name: 'Car loan', kind: 'auto_loan', include_in_cash: false, balance: 9000 })
    const d = { ...typed(), accounts: [chk, visa, auto], transactions: [...typed().transactions, txn({ date: '2026-10-06', kind: 'transfer', amount: 312, account_id: chk.id, to_account_id: auto.id, payee: 'Huntington auto loan' })] }
    const r = rangeStat(d, '2026-10-01', '2026-10-31'); expect(r.loans).toBe(312); expect(r.net).toBe(3000 - 312); expect(r.debt).toBe(2312)
  })
  it("the burn rate's debt term counts loan payments only — the card's purchases are already in its spending", () => {
    const visa2 = { ...visa, balance: 2000, minimum_payment: 60, planned_payment: 300, due_date: '2026-11-20' }
    const auto = acct({ id: 'auto', name: 'Car loan', kind: 'auto_loan', include_in_cash: false, balance: 9000, minimum_payment: 250, planned_payment: 250, due_date: '2026-11-15' })
    const b = burn({ ...typed(), accounts: [chk, visa2, auto] }, settings())
    expect(b.debt).toBe(250); expect(b.cards).toBe(300); expect(b.variable).toBeGreaterThan(0)
  })
  it('the bank feed brings a payment onto a card in as a transfer into the card, a refund as a credit, never as income', () => {
    const sf = normaliseResponse({ accounts: [{ id: 'C1', name: 'Freedom ...7710', balance: '-640.12', 'balance-date': 1793600000, transactions: [
      { id: 'c1', posted: 1793500000, amount: '-64.00', description: 'AMAZON' }, { id: 'c2', posted: 1793530000, amount: '200.00', description: 'AUTOMATIC PAYMENT - THANK YOU' },
      { id: 'c3', posted: 1793540000, amount: '25.00', description: 'AMAZON RETURN' }, { id: 'c4', posted: 1793550000, amount: '15.00', description: 'AMZN MKTP US' }] }] }).accounts[0]
    expect(toNewTxns(sf, { id: 'L2', kind: 'credit_card' }).map(x => [x.kind, x.account_id, x.to_account_id])).toEqual([['expense', 'L2', null], ['transfer', null, 'L2'], ['income', 'L2', null], ['income', 'L2', null]])
    expect(toNewTxns(sf, { id: 'L1', kind: 'checking' }).map(x => x.kind)).toEqual(['expense', 'income', 'income', 'income'])   // money into checking is income
    expect([cardCredit('PAYMENT THANK YOU'), cardCredit('BEST BUY RETURN'), cardCredit('STATEMENT CREDIT'), cardCredit('AMZN MKTP US'), cardCredit('BEST BUY', 'Return'), cardCredit('BEST BUY', 'Payment')]).toEqual(['payment', 'refund', 'refund', null, 'refund', 'payment'])
  })
  it('the two bank rows of one payment become one transfer, reversibly', () => {
    const d = synced(); const plan = planDedupe(d.transactions as unknown as DTxn[], d.accounts)
    expect(plan.auto).toHaveLength(1); expect(plan.auto[0]).toMatchObject({ keeper: 'leg-out', dups: ['leg-in'], patch: { kind: 'transfer', to_account_id: 'visa' } })
    const one = applyPlan(d.transactions, plan); expect(one.filter(t => t.date === '2026-10-25')).toHaveLength(1)
    const r = rangeStat({ ...d, transactions: one }, '2026-10-01', '2026-10-31'); expect([r.income, r.spend, r.cards, r.net]).toEqual([5000, 2000, 2000, 3000])
    // restoring the card side puts the checking row back as the expense it arrived as; an ordinary duplicate is not touched
    expect(unpairPatch({ ...legs()[0], ...plan.auto[0].patch } as DTxn, legs()[1] as unknown as DTxn)).toEqual({ kind: 'expense', to_account_id: null, dedupe_ok: true })
    expect(unpairPatch({ ...legs()[0], ...plan.auto[0].patch } as DTxn, txn({ kind: 'transfer', amount: 2000, account_id: chk.id, to_account_id: visa.id, source: 'email' }) as unknown as DTxn)).toBeNull()
  })
  it('an emailed copy of the payment and both bank rows collapse into one transfer (the bank copy kept)', () => {
    const email = txn({ id: 'email', date: '2026-10-24', kind: 'transfer', amount: 2000, account_id: chk.id, to_account_id: visa.id, payee: 'Chase', source: 'email', email_item_id: 'em1' })
    const rows = [...legs(), email]; const plan = planDedupe(rows as unknown as DTxn[], [chk, visa])
    expect(plan.auto).toHaveLength(1); expect(plan.auto[0].keeper).toBe('leg-out'); expect([...plan.auto[0].dups].sort()).toEqual(['email', 'leg-in'])
    expect(plan.auto[0].patch).toMatchObject({ kind: 'transfer', to_account_id: 'visa', email_item_id: 'em1' })
    expect(applyPlan(rows, plan)).toHaveLength(1)
  })
  it('pairs only when unambiguous: same amount to the cent, at most 4 days apart, own checking or savings, not a refund, not typed', () => {
    const pairs = (rows: Transaction[], accts: Account[] = [chk, visa]) => planDedupe(rows as unknown as DTxn[], accts).auto.length
    const [out, into] = legs()
    expect(pairs([out, { ...into, amount: 1999.99 }])).toBe(0)
    expect(pairs([{ ...out, date: '2026-10-20' }, into])).toBe(0)                                          // 5 days apart
    expect(pairs([out, { ...into, payee: 'BEST BUY RETURN' }])).toBe(0)                                     // a refund stays a refund
    expect(pairs([{ ...out, external_id: null, source: 'manual' }, into])).toBe(0)                          // typed by hand: left alone
    const brokerage = acct({ id: 'brk', kind: 'investment', include_in_cash: false })
    expect(pairs([{ ...out, account_id: 'brk' }, into], [chk, visa, brokerage])).toBe(0)                    // not checking or savings
    const rent = txn({ id: 'rent', date: '2026-10-24', amount: 2000, account_id: chk.id, payee: 'ACH DEBIT WEB', external_id: 'sfin:chk:2', source: 'import' })
    expect(pairs([{ ...out, payee: 'ONLINE PMT' }, rent, into])).toBe(0)                                     // two candidates, neither names the card: no pair
    expect(pairs([out, rent, into])).toBe(1)                                                                 // the one that names the card's bank wins
    expect(pairs([out, { ...into, dedupe_ok: true }])).toBe(0)
    expect(pairs([out, into], [])).toBe(0)                                                                   // without the accounts nothing is guessed
    const fileRow = txn({ id: 'file', date: '2026-10-26', kind: 'transfer', amount: 2000, to_account_id: visa.id, payee: 'Payment Thank You', external_id: 'csv:h1', source: 'import' })
    expect(pairs([out, fileRow])).toBe(1)                                                                    // a statement file's card payment pairs too
  })
  it('restoring the card side in the app unpairs both rows for good', async () => {
    const d = synced(); const repo = new MemoryRepo({ household: { id: 'h', name: 'Test', currency: 'USD', settings: { ...SETTINGS_DEFAULTS } }, data: d })
    useStore.setState({ mode: 'demo', repo, role: 'owner', readOnly: false, offlineAt: null }); await useStore.getState().refresh()
    await vi.waitFor(() => expect(useStore.getState().data.duplicates.map(t => t.id)).toEqual(['leg-in']))
    expect(useStore.getState().data.transactions.find(t => t.id === 'leg-out')).toMatchObject({ kind: 'transfer', to_account_id: 'visa' })
    await useStore.getState().restoreDuplicate('leg-in')
    const st = useStore.getState().data; expect(st.duplicates).toHaveLength(0)
    expect(st.transactions.find(t => t.id === 'leg-out')).toMatchObject({ kind: 'expense', to_account_id: null, dedupe_ok: true }); expect(st.transactions.find(t => t.id === 'leg-in')!.dedupe_ok).toBe(true)
    expect(planDedupe(st.transactions as unknown as DTxn[], st.accounts).auto).toHaveLength(0)
    const r = rangeStat(st, '2026-10-01', '2026-10-31'); expect([r.income, r.spend]).toEqual([5000, 2000])   // still counted once while apart: the credit reads as a refund
  })
  it('a refund on a card takes spending down and is not income', () => {
    const d = data({ accounts: [chk, visa], categories: [groc], transactions: [txn({ date: '2026-10-05', amount: 300, account_id: visa.id, category_id: groc.id, payee: 'BEST BUY' }), txn({ date: '2026-10-09', kind: 'income', amount: 300, account_id: visa.id, category_id: groc.id, payee: 'BEST BUY RETURN' })] })
    const r = rangeStat(d, '2026-10-01', '2026-10-31'); expect(r.income).toBe(0); expect(r.spend).toBe(0); expect(r.refunds).toBe(300); expect(r.byCat.Groceries).toBe(0)
  })
  it('demo data: October kept +$416, a savings rate of 8%', () => {
    const { data: d, household } = demoSeed(); const r = rangeStat(d, '2026-10-01', '2026-10-31')
    expect(Math.round(r.net)).toBe(416); expect(Math.round(r.rate! * 100)).toBe(8)
    const rep = buildReport(d, { ...SETTINGS_DEFAULTS, ...household.settings }, 'month', '2026-10-15', ['summary'], T0).sections[0].kpis
    expect(Math.round(rep.find(k => k.label === 'Net (kept)')!.value)).toBe(416); expect(rep.find(k => k.label === 'Savings rate')!.value).toBe(0.08)
  })
})

// ---------------------------------------------------------------- 9
describe('9 — refunds in card statement files stay refunds', () => {
  const visa = card({ id: 'visa9' })
  const csv = 'Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n10/05/2026,10/06/2026,BEST BUY,Shopping,Sale,-300.00,\n10/09/2026,10/09/2026,BEST BUY,Shopping,Return,300.00,\n10/20/2026,10/20/2026,Payment Thank You,,Payment,500.00,'
  it('a Sale −$300, a Return +$300 and a Payment +$500: spending $0, debt payments $500', () => {
    const rows = parseCsv(csv); const props = importDedupe(data({ accounts: [visa] }), visa, mapRows(rows, detectMapping(rows)!, { card: true, source: 'csv' }))
    expect(props.map(p => [p.row.payee, p.txn.kind])).toEqual([['BEST BUY', 'expense'], ['BEST BUY', 'income'], ['Payment Thank You', 'transfer']])
    const d = data({ accounts: [visa], transactions: props.map(p => txn({ ...p.txn })) }); const r = rangeStat(d, '2026-10-01', '2026-10-31')
    expect(r.spend).toBe(0); expect(r.debt).toBe(500); expect(r.income).toBe(0)
  })
  it('the same rule as the bank feed: the description decides when there is no Type column; OFX credits too', () => {
    const rows = parseCsv('Date,Description,Amount\n10/05/2026,TARGET,-40.00\n10/07/2026,TARGET REFUND,40.00\n10/08/2026,ONLINE PAYMENT,250.00')
    expect(importDedupe(data({ accounts: [visa] }), visa, mapRows(rows, detectMapping(rows)!, { card: true })).map(p => p.txn.kind)).toEqual(['expense', 'income', 'transfer'])
    const ofx = parseOfx('<OFX><CCSTMTRS><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261009<TRNAMT>300.00<FITID>r1<NAME>BEST BUY RETURN</STMTTRN><STMTTRN><TRNTYPE>PAYMENT<DTPOSTED>20261020<TRNAMT>500.00<FITID>p1<NAME>THANK YOU</STMTTRN></CCSTMTRS></OFX>')
    expect(importDedupe(data({ accounts: [visa] }), visa, ofx.rows).map(p => p.txn.kind)).toEqual(['income', 'transfer'])
  })
})

// ---------------------------------------------------------------- 13
describe('13 — a transfer between two cash accounts moves nothing in the cash calendar', () => {
  const chk = acct({ id: 'c13', name: 'Checking', balance: 2000 }), ally = acct({ id: 's13', name: 'Ally Savings', kind: 'savings', balance: 8000 }), brk = acct({ id: 'b13', name: 'Brokerage', kind: 'investment', include_in_cash: false, balance: 5000 })
  const toAlly = rec({ id: 'r13', name: 'Emergency fund transfer', payee: 'Ally', kind: 'savings', amount: 300, day_of_month: 2, next_due: '2026-12-02', account_id: chk.id, liability_account_id: ally.id, autopay: true })
  it('checking $2,000 + Ally $8,000 with $300 a month to Ally: the 60-day calendar ends at $10,000, like the runway', () => {
    const d = data({ accounts: [chk, ally], recurring: [toAlly] })
    const cal = cashCalendar(d, settings(), 60); expect(cal.start).toBe(10000); expect(cal.end).toBe(10000); expect(cal.items).toHaveLength(0)
    expect(runwayProjection(d, settings(), { months: 2 }).ys).toEqual([10000, 10000, 10000])
  })
  it('a transfer to an account that is not cash is money out; one coming back from it is money in', () => {
    const toBrk = { ...toAlly, id: 'r13b', liability_account_id: brk.id }, fromBrk = { ...toAlly, id: 'r13c', account_id: brk.id, liability_account_id: chk.id }
    const d = data({ accounts: [chk, ally, brk], recurring: [toBrk, fromBrk] })
    expect([cashEffect(d, settings(), toAlly), cashEffect(d, settings(), toBrk), cashEffect(d, settings(), fromBrk), cashEffect(d, settings(), rec({}))]).toEqual([0, -1, 1, -1])
    const cal = cashCalendar(d, settings(), 60); expect(cal.items.map(i => i.amt).sort()).toEqual([-300, -300, 300, 300]); expect(cal.end).toBe(10000)
  })
  it('a late transfer to savings is not money owed: safe to spend does not take it off', () => {
    const late = { ...toAlly, next_due: '2026-11-02' }
    expect(safeToSpend(data({ accounts: [chk, ally], recurring: [late] }), settings()).overdue).toBeCloseTo(0, 6)
    expect(safeToSpend(data({ accounts: [chk, ally], recurring: [{ ...late, name: 'Gym', kind: 'bill', liability_account_id: null }] }), settings()).overdue).toBe(300)   // a bill is still owed
  })
})

// ---------------------------------------------------------------- 2
describe('2 — one-off (Irregular) income is counted once, in its month', () => {
  const chk = acct({ id: 'c2', balance: 5000 })
  const job = pay({ id: 'job', frequency: 'biweekly', anchor_date: '2026-11-13', net_amount: 2000 }), bonus = pay({ id: 'bonus', name: 'Year-end bonus', frequency: 'irregular', anchor_date: '2026-12-18', net_amount: 8000 })
  const d = () => data({ accounts: [chk], paySchedules: [job, bonus] })
  it('$2,000 every 2 weeks + an $8,000 bonus on Dec 18: $4,333 a month; the runway and the Plan end at $65,000', () => {
    expect(PER_YEAR.irregular).toBe(0); expect(monthlyIncome([job, bonus])).toBeCloseTo(2000 * 26 / 12, 6)
    expect(burn(d(), settings()).income).toBeCloseTo(4333.33, 2)
    expect(runwayProjection(d(), settings(), { months: 12 }).ys.at(-1)).toBeCloseTo(65000, 2)
    expect(buildPlan(d(), settings(), { months: 12 }).endCash).toBeCloseTo(65000, 2)
    expect(cashCalendar(d(), settings(), 365).items.filter(i => i.src === 'pay').reduce((a, i) => a + i.amt, 0)).toBe(60000)   // 26 paychecks + the bonus once
    expect(oneOffPay(d(), T0, '2027-12-31').map(x => [x.date, x.amount])).toEqual([['2026-12-18', 8000]])
  })
  it('a bonus after the income stops does not come; one already received is not counted again', () => {
    expect(runwayProjection(d(), settings(), { months: 12, incomeEndsOn: '2026-12-01' }).inc.slice(1, 3)).toEqual([0, 0])
    const got = data({ accounts: [chk], paySchedules: [bonus], transactions: [txn({ kind: 'income', date: '2026-12-18', amount: 8000, pay_schedule_id: 'bonus' })] })
    expect(oneOffPay(got, T0, '2027-12-31')).toEqual([])
  })
  it('paycheck allocation still splits a goal for a one-off paycheck (one month\'s share)', () => {
    const g = goal({ monthly_contribution: 600, target_amount: 5000 }); const t = txn({ kind: 'income', date: T0, amount: 8000, account_id: chk.id, pay_schedule_id: 'bonus2' })
    const a = allocatePaycheck(data({ accounts: [chk], paySchedules: [{ ...bonus, id: 'bonus2', anchor_date: T0 }], goals: [g], transactions: [t] }), settings(), t)
    expect(a.lines.find(l => l.goalId === g.id)!.amount).toBe(600)
  })
})

// ---------------------------------------------------------------- 6
describe('6 — the net-worth report agrees with itself', () => {
  const chk = acct({ balance: 10000 }), biz = acct({ name: 'Business account', kind: 'investment', balance: 20000, include_in_cash: false, include_in_net_worth: false }), cc = card({ name: 'Card', balance: 1500, bank_balance: 2500 })
  const d = data({ accounts: [chk, biz, cc], snapshots: [{ id: 's1', household_id: 'h', date: '2026-10-01', cash: 10000, assets: 10000, liabilities: 2500, by_account: {} }] })
  it("today's point leaves out accounts excluded from net worth and uses the verified card balance: $7,500, no change", () => {
    expect(netWorthSeries(d).at(-1)).toMatchObject({ assets: 10000, liabilities: 2500, net: 7500 })
    const sec = buildReport(d, settings(), 'month', '2026-11-01', ['networth'], T0).sections[0]
    expect(sec.kpis.map(k => [k.label, k.value])).toEqual([['Net worth today', 7500], ['Change since 2026-10-01', 0], ['Assets today', 10000], ['Liabilities today', 2500]])
    expect(sec.table!.rows.map(r => [r[0], r[3]])).toEqual([['Checking', 10000], ['Card', -2500]])
  })
})

// ---------------------------------------------------------------- 15
describe('15 — runway months never skip a month at the end of a month', () => {
  it('Jan 31 → Feb 28 → Mar 31 → Apr 30 → May 31', () => {
    setToday('2027-01-31')
    const rp = runwayProjection(data({ accounts: [acct({ balance: 1000 })], planned: [{ id: 'x', household_id: 'h', date: '2027-02-15', label: 'Tuition', category: 'School', amount: -5000, status: 'Planned' }] }), settings(), { months: 4 })
    expect(rp.xs).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']); expect(rp.zeroAt).toBe('2027-02-28')
  })
})

// ---------------------------------------------------------------- 12
describe('12 — debt projections start from the verified balance, like the totals', () => {
  const c2 = card({ id: 'amex', name: 'Amex', balance: 1500, bank_balance: 2500, apr: 24, minimum_payment: 100, credit_limit: 5000 })
  it('book $1,500, bank $2,500: total owed, payoff, the Plan, utilization and interest all use $2,500', () => {
    const d = data({ accounts: [c2] })
    expect(debtTotals(d)).toMatchObject({ balance: 2500, interestMonth: 50, wApr: 24 })
    expect(simulate([c2], 0).series[0]).toBe(2500); expect(simulate([c2], 0, 'avalanche', false, d).series[0]).toBe(2500)
    expect(buildPlan(d, settings(), {}).startDebt).toBe(2500); expect(utilization(c2)).toBe(0.5); expect(utilization(c2, d)).toBe(0.5)
  })
  it('with a payment still outstanding, every figure takes it off the bank balance', () => {
    const d = data({ accounts: [c2], transactions: [txn({ kind: 'transfer', amount: 500, to_account_id: 'amex', status: 'pending', payee: 'Amex payment' })] })
    expect(debtBal(c2, d)).toBe(2000); expect(debtTotals(d)).toMatchObject({ balance: 2000, interestMonth: 40 }); expect(simulate([c2], 0, 'avalanche', false, d).series[0]).toBe(2000)
    expect(buildPlan(d, settings(), {}).startDebt).toBe(2000); expect(utilization(c2, d)).toBe(0.4)
    expect(goalProgress(d, goal({ kind: 'debt_payoff', account_id: 'amex', target_amount: 3000 })).saved).toBe(1000)
    const run = runwayProjection({ ...d, accounts: [acct({ balance: 50000 }), c2] }, settings(), { months: 36 }); expect(run.out.reduce((a, b) => a + b, 0)).toBeGreaterThan(2000)   // pays off the $2,000 plus interest, not $1,500
  })
})

// ---------------------------------------------------------------- 16
describe('16 — bank-feed descriptions keep at most the last four digits of any number', () => {
  it('runs of 5 or more digits (spaces or dashes inside allowed) become •• and the last four', () => {
    expect(maskBank('PAYMENT TO ACCT 4400123456')).toBe('PAYMENT TO ACCT ••3456'); expect(maskBank('CARD 4111 1111 1111 1234')).toBe('CARD ••1234')
    expect(maskBank('REF 1234-5678-9012')).toBe('REF ••9012'); expect(maskBank('ID 12345')).toBe('ID ••2345'); expect(maskBank('KROGER #123 4410')).toBe('KROGER #••4410')   // 7 digits with a space inside
    for (const keep of ['KROGER #123', 'Checking (4019)', 'Visa ...7710', 'PAYMENT 10/31 $250.00']) expect(maskBank(keep)).toBe(keep)
    for (const s of ['Acme Water account 4400123456', 'CARD 4111 1111 1111 1234', 'REF 1234-5678-9012']) expect(maskBank(s)).toBe(maskEmail(s))
  })
  it('the payee saved from the bank feed and the account names it reports are masked', () => {
    const n16 = normaliseResponse({ accounts: [{ id: 'A9', name: 'Everyday Checking 4400123456', balance: '10', transactions: [{ id: 't1', posted: 1793500000, amount: '-20.00', description: 'ONLINE TRANSFER TO SAV 1234567890 CONF 778899' }] }] }).accounts[0]
    expect(n16.name).toBe('Everyday Checking ••3456')
    expect(toNewTxns(n16, { id: 'L9', kind: 'checking' })[0].payee).toBe('ONLINE TRANSFER TO SAV ••7890 CONF ••8899')
    expect(toNewTxns(n16, { id: 'L9', kind: 'checking' }, s => s + ' 99887766')[0].payee).not.toMatch(/\d{5,}/)
  })
})

// ---------------------------------------------------------------- 17
describe('17 — a paycheck already received is not counted again', () => {
  it('demo on payday (Fri Nov 6, the deposit on file): the calendar starts with it in cash and does not add it; next paycheck Nov 20', () => {
    const { data: d, household } = demoSeed(); const s = { ...SETTINGS_DEFAULTS, ...household.settings }
    const cal = cashCalendar(d, s, 60); expect(cal.items.filter(i => i.src === 'pay' && i.date === T0)).toEqual([])
    expect(cal.items.filter(i => i.src === 'pay' && i.label.startsWith('Paycheck')).map(i => i.date)).toEqual(['2026-11-20', '2026-12-04', '2026-12-18', '2027-01-01'])
    expect(nextPaycheck(d)).toMatchObject({ d: '2026-11-15' })   // the monthly consulting check comes first; the Meridian one on Nov 20
    expect(nextPaycheck({ ...d, paySchedules: d.paySchedules.filter(p => p.name.startsWith('Paycheck')) })).toMatchObject({ d: '2026-11-20' })
  })
  it('a deposit that landed a day early (not linked, within 2%) counts as that payday', () => {
    const chk = acct({ balance: 3000 }); const p = pay({ id: 'p17', anchor_date: '2026-11-13', net_amount: 2000 })
    const early = data({ accounts: [chk], paySchedules: [p], transactions: [txn({ kind: 'income', date: '2026-11-12', amount: 2010, account_id: chk.id, payee: 'PAYROLL' })] })
    setToday('2026-11-12'); expect(cashCalendar(early, settings(), 20).items.filter(i => i.src === 'pay').map(i => i.date)).toEqual(['2026-11-27'])
    expect(cashCalendar({ ...early, transactions: [] }, settings(), 20).items.filter(i => i.src === 'pay').map(i => i.date)).toEqual(['2026-11-13', '2026-11-27'])
  })
})

// ---------------------------------------------------------------- 18
describe('18 — one definition of spending, income and the savings rate on every page', () => {
  it('demo, Nov 6: the Budget spends what Transactions and Trends spend ($300 to Ally is saving), one savings rate everywhere', () => {
    const { data: d, household } = demoSeed(); const s = { ...SETTINGS_DEFAULTS, ...household.settings }
    const nov = d.periods.find(p => p.start_date === '2026-11-01')!; const ps = periodStat(d, s, nov); const r = rangeStat(d, '2026-11-01', '2026-11-30')
    expect(ps.spA).toBeCloseTo(r.spend, 2); expect(ps.spA).toBeCloseTo(2233, 0); expect(ps.saved).toBe(300)
    const trendNov = trendSeries(d, 'month').find(x => x.key === '2026-11')!
    expect(ps.rate).toBeCloseTo(r.rate!, 10); expect(trendNov.rate).toBeCloseTo(r.rate!, 10); expect(Math.round(r.rate! * 100)).toBe(3)   // Dashboard shows ps.rate
    const h = healthIndicators(d, s, 3, T0); const av = monthlyAverages(d, ['2026-08', '2026-09', '2026-10'])   // Spending Intelligence: the same rule over its own months
    expect(h.savingsRate).toBeCloseTo(Math.round(av.rate! * 100) / 100, 2); expect(h.burnRate).toBeCloseTo(Math.round(av.out * 100) / 100, 2)
  })
  it('monthly debt payments agree: Bills, Debts and Accounts all say $982, and the Discover payment is due Nov 22', () => {
    const { data: d } = demoSeed()
    expect(kpi(d, 'month', '2026-11-01', 'Monthly commitments', ['bills'])).toBeCloseTo(3687.46, 2)   // was $3,567.46: the $120 Discover payment left out
    const c = commitments(d)
    expect(c.debt).toBe(982); expect(debtTotals(d).planned).toBe(982); expect(c.accountPayments).toBe(120)
    expect(accountPaymentsDue(d, T0, '2026-12-06').map(x => [x.a.name, x.date, x.amount])).toEqual([['Discover it', '2026-11-22', 120]])
    expect(kpi(d, 'month', '2026-11-01', 'Monthly commitments', ['bills'])).toBe(c.total)
  })
})

// ---------------------------------------------------------------- 19
describe('19 — averages stand on the completed months since the first transaction', () => {
  it('the months-on-file rule: none before the first transaction, not the month still running, the first by its share, at least one', () => {
    const d = data({ transactions: [txn({ date: '2026-09-20', amount: 10 })] })
    expect([monthOnFile(d, '2026-08'), monthOnFile(d, '2026-09'), monthOnFile(d, '2026-10'), monthOnFile(d, '2026-11')]).toEqual([0, 11 / 30, 1, 0])
    expect(monthsOnFile(d, ['2026-08', '2026-09', '2026-10'])).toBeCloseTo(1 + 11 / 30, 10); expect(monthsOnFile(d, ['2026-09'])).toBe(1); expect(monthsOnFile(data({}), ['2026-09'])).toBe(0)
  })
  it('demo, Nov 6 (tracking began Sep 1): Spending Intelligence averages September and October, not an empty August', () => {
    const { data: d, household } = demoSeed(); const s = { ...SETTINGS_DEFAULTS, ...household.settings }
    const h = healthIndicators(d, s, 3, T0); expect(h.income).toBe(5010); expect(h.months).toBe(2)
    const sep = rangeStat(d, '2026-09-01', '2026-09-30'), oct = rangeStat(d, '2026-10-01', '2026-10-31')
    expect(h.burnRate).toBeCloseTo(Math.round((sep.spend + sep.loans + oct.spend + oct.loans) / 2 * 100) / 100, 2); expect(h.monthsCovered).toBeCloseTo(Math.round(cashOnHand(d, s) / h.burnRate * 100) / 100, 2)
  })
  it('demo, Nov 6: Trends and the 12-month report average $5,010 of income over 2 months — not over empty months or the month still running', () => {
    const { data: d } = demoSeed()
    expect(kpi(d, 'month', '2026-11-01', 'Average monthly income', ['trend'])).toBe(5010)
    const six = [...Array(6)].map((_, i) => mAdd('2026-11', i - 5)); const av = monthlyAverages(d, six); expect(av.months).toBe(2); expect(av.income).toBe(5010)
  })
})
