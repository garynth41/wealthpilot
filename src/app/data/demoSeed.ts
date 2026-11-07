// Offline demo data — a believable household, dated relative to today. Also used by the test suites.
import { addDays, curMonth, mAdd, monthEnd, monthStart, today, weekStart } from '../../lib/dates'
import { plannedForPeriod } from '../../lib/sinking'
import { emptyData, SETTINGS_DEFAULTS, type Category, type Data, type Household, type Priority, type CostType, type Holding } from './types'

export const STARTER_CATEGORIES: Array<[string, string, 'expense' | 'income' | 'transfer', Priority, CostType, number]> = [
  ['Income', 'Paycheck', 'income', 'Essential', 'Fixed', 1], ['Income', 'Benefits', 'income', 'Essential', 'Fixed', 2], ['Income', 'Side income', 'income', 'Important', 'Variable', 3], ['Income', 'Other income', 'income', 'Important', 'Irregular', 4],
  ['Housing', 'Rent / mortgage', 'expense', 'Essential', 'Fixed', 10], ['Housing', 'Electric', 'expense', 'Essential', 'Variable', 11], ['Housing', 'Gas', 'expense', 'Essential', 'Variable', 12], ['Housing', 'Water / sewer / trash', 'expense', 'Essential', 'Variable', 13], ['Housing', 'Internet', 'expense', 'Essential', 'Fixed', 14], ['Housing', 'Home maintenance', 'expense', 'Important', 'Irregular', 15],
  ['Transport', 'Car payment', 'expense', 'Essential', 'Fixed', 20], ['Transport', 'Fuel', 'expense', 'Essential', 'Variable', 21], ['Transport', 'Car insurance', 'expense', 'Essential', 'Fixed', 22], ['Transport', 'Maintenance & repairs', 'expense', 'Important', 'Irregular', 23], ['Transport', 'Parking / tolls / transit', 'expense', 'Important', 'Variable', 24],
  ['Food', 'Groceries', 'expense', 'Essential', 'Variable', 30], ['Food', 'Dining out', 'expense', 'Discretionary', 'Variable', 31], ['Food', 'Coffee & snacks', 'expense', 'Discretionary', 'Variable', 32],
  ['Health', 'Health insurance', 'expense', 'Essential', 'Fixed', 40], ['Health', 'Medical & dental', 'expense', 'Essential', 'Irregular', 41], ['Health', 'Pharmacy', 'expense', 'Essential', 'Variable', 42], ['Health', 'Gym & fitness', 'expense', 'Discretionary', 'Fixed', 43],
  ['Bills', 'Phone', 'expense', 'Essential', 'Fixed', 50], ['Bills', 'Subscriptions & streaming', 'expense', 'Discretionary', 'Fixed', 51], ['Bills', 'Insurance (other)', 'expense', 'Important', 'Fixed', 52], ['Bills', 'Education / childcare', 'expense', 'Essential', 'Fixed', 53],
  ['Debt', 'Credit card payments', 'expense', 'Essential', 'Fixed', 60], ['Debt', 'Loan payments', 'expense', 'Essential', 'Fixed', 61], ['Debt', 'Interest & fees', 'expense', 'Important', 'Variable', 62],
  ['Personal', 'Shopping', 'expense', 'Discretionary', 'Variable', 70], ['Personal', 'Personal care', 'expense', 'Important', 'Variable', 71], ['Personal', 'Entertainment', 'expense', 'Discretionary', 'Variable', 72], ['Personal', 'Gifts & giving', 'expense', 'Discretionary', 'Irregular', 73], ['Personal', 'Travel', 'expense', 'Discretionary', 'Irregular', 74], ['Personal', 'Kids & family', 'expense', 'Essential', 'Variable', 75], ['Personal', 'Pets', 'expense', 'Important', 'Variable', 76],
  ['Savings', 'Emergency fund', 'expense', 'Essential', 'Fixed', 80], ['Savings', 'Savings goals', 'expense', 'Important', 'Fixed', 81], ['Savings', 'Investing', 'expense', 'Important', 'Fixed', 82],
  ['Other', 'Taxes & fees', 'expense', 'Essential', 'Irregular', 90], ['Other', 'Miscellaneous', 'expense', 'Important', 'Variable', 91], ['Other', 'Transfer', 'transfer', 'Essential', 'Variable', 99],
]

let seq = 0
export const demoId = () => `d${(++seq).toString(36).padStart(5, '0')}`

export function demoSeed(): { household: Household; data: Data } {
  seq = 0
  const hh = 'demo-household', t = today(), cm = curMonth()
  const d = emptyData()
  const cat = (group: string, name: string) => { const c = d.categories.find(x => x.group === group && x.name === name); if (!c) throw new Error('no category ' + name); return c }
  STARTER_CATEGORIES.forEach(([group, name, kind, priority, cost_type, sort_order]) => d.categories.push({ id: demoId(), household_id: hh, ref: 'C-' + String(sort_order).padStart(3, '0'), name, group, kind, priority, cost_type, default_budget: 0, budget_cadence: 'period', rollover: false, sort_order, archived: false } as Category))
  const DEF: Record<string, number> = { 'Rent / mortgage': 1850, Electric: 140, Gas: 60, 'Water / sewer / trash': 75, Internet: 80, 'Car payment': 312, Fuel: 180, 'Car insurance': 128, Groceries: 650, 'Dining out': 160, 'Coffee & snacks': 40, 'Health insurance': 420, Pharmacy: 35, 'Gym & fitness': 40, Phone: 95, 'Subscriptions & streaming': 48, Shopping: 150, 'Personal care': 60, Entertainment: 80, 'Gifts & giving': 600, 'Home maintenance': 1800, Travel: 2400, 'Medical & dental': 900, 'Kids & family': 120, 'Emergency fund': 300, 'Savings goals': 200, Miscellaneous: 100, Paycheck: 4610, 'Side income': 400 }
  d.categories.forEach(c => { c.default_budget = DEF[c.name] || 0; if (['Dining out', 'Shopping', 'Entertainment', 'Gifts & giving'].includes(c.name)) c.rollover = true })
  d.categories.forEach(c => { if (['Gifts & giving', 'Home maintenance', 'Travel', 'Medical & dental'].includes(c.name)) { c.budget_cadence = 'yearly'; c.rollover = true } })   // sinking funds: yearly amounts spread per period

  // accounts
  const acc = (p: Partial<Data['accounts'][number]>) => { const a = { id: demoId(), household_id: hh, ref: 'A-' + String(d.accounts.length + 1).padStart(3, '0'), name: 'x', kind: 'checking', balance: 0, apr: 0, minimum_payment: 0, autopay: false, include_in_cash: true, include_in_net_worth: true, status: 'Active', sort_order: d.accounts.length + 1, balance_as_of: t, ...p } as Data['accounts'][number]; d.accounts.push(a); return a }
  const chk = acc({ name: 'Huntington Checking', kind: 'checking', institution: 'Huntington', last4: '4410', balance: 3184.22, color: '#3b5a8c' })
  const sav = acc({ name: 'Ally Savings', kind: 'savings', institution: 'Ally', last4: '9921', balance: 8650, color: '#15803d' })
  acc({ name: 'Fidelity 401(k)', kind: 'retirement', institution: 'Fidelity', balance: 42300, include_in_cash: false, color: '#6d5bbd' })
  const chase = acc({ name: 'Chase Freedom', kind: 'credit_card', institution: 'Chase', last4: '4821', balance: 1362.55, credit_limit: 5000, apr: 24.99, statement_date: addDays(t, -6), statement_balance: 1362.55, minimum_payment: 41, due_date: addDays(t, 19), planned_payment: 250, color: '#2f4a75' })
  const amex = acc({ name: 'Amex Blue Cash', kind: 'credit_card', color: '#c2410c', institution: 'American Express', last4: '1007', balance: 2840.2, credit_limit: 8000, apr: 27.49, statement_date: addDays(t, -12), statement_balance: 2840.2, minimum_payment: 85, due_date: addDays(t, 13), planned_payment: 300, autopay: true, autopay_account_id: chk.id, notes: 'Highest APR — pay first' })
  const auto = acc({ name: 'Auto loan', kind: 'auto_loan', color: '#5b6470', institution: 'Huntington', last4: '2210', balance: 9420, apr: 6.4, minimum_payment: 312, due_date: addDays(t, 4), planned_payment: 312, autopay: true, autopay_account_id: chk.id })
  // statements history for Chase
  ;[-66, -36, -6].forEach((k, i) => d.statements.push({ id: demoId(), household_id: hh, account_id: chase.id, statement_date: addDays(t, k), statement_balance: [1180.4, 1302.1, 1362.55][i], minimum_payment: [36, 40, 41][i], due_date: addDays(t, k + 25), paid_on: i < 2 ? addDays(t, k + 20) : null, paid_amount: i < 2 ? 250 : null, source: 'manual' }))

  // pay schedule: biweekly Friday paycheck
  const lastFri = (() => { let x = t; while (new Date(x + 'T12:00').getDay() !== 5) x = addDays(x, -1); return x })()
  const ps = { id: demoId(), household_id: hh, ref: 'P-001', name: 'Paycheck — Meridian', payer: 'Meridian Aviation Group', kind: 'salary' as const, frequency: 'biweekly' as const, anchor_date: lastFri, net_amount: 2305, gross_amount: 3269.23, deposit_account_id: chk.id, category_id: cat('Income', 'Paycheck').id, status: 'Active' as const }
  d.paySchedules.push(ps)
  d.paySchedules.push({ id: demoId(), household_id: hh, ref: 'P-002', name: 'Consulting', payer: 'Freelance', kind: 'side', frequency: 'monthly', anchor_date: cm + '-15', net_amount: 400, deposit_account_id: chk.id, category_id: cat('Income', 'Side income').id, status: 'Active' })

  // periods: last two months + this month (monthly budget)
  const months = [mAdd(cm, -2), mAdd(cm, -1), cm]
  months.forEach((m, i) => {
    const p = { id: demoId(), household_id: hh, ref: 'B-' + String(i + 1).padStart(3, '0'), period_type: 'month' as const, start_date: monthStart(m), end_date: monthEnd(m), label: null, status: (m < cm ? 'closed' : 'open') as 'closed' | 'open', expected_income: 5010 }
    d.periods.push(p)
    d.categories.filter(c => c.kind !== 'transfer' && c.default_budget > 0).forEach(c => d.lines.push({ id: demoId(), household_id: hh, period_id: p.id, category_id: c.id, planned: plannedForPeriod(c, p.start_date, p.end_date), rollover_in: 0 }))
  })

  // recurring bills
  const rec = (p: Partial<Data['recurring'][number]>) => { const r = { id: demoId(), household_id: hh, ref: 'R-' + String(d.recurring.length + 1).padStart(3, '0'), name: 'x', kind: 'bill', amount: 0, amount_varies: false, frequency: 'monthly', autopay: false, reminder_days: 3, status: 'Active', sort_order: d.recurring.length + 1, account_id: chk.id, ...p } as Data['recurring'][number]; d.recurring.push(r); return r }
  const nd = (day: number) => { const a = `${cm}-${String(day).padStart(2, '0')}`; return a >= t ? a : `${mAdd(cm, 1)}-${String(day).padStart(2, '0')}` }
  rec({ name: 'Rent', payee: 'Olentangy Property Mgmt', amount: 1850, day_of_month: 1, next_due: nd(1), category_id: cat('Housing', 'Rent / mortgage').id })
  rec({ name: 'AEP Ohio electric', payee: 'AEP Ohio', amount: 140, amount_varies: true, day_of_month: 15, next_due: nd(15), category_id: cat('Housing', 'Electric').id, autopay: true })
  rec({ name: 'Columbia Gas', payee: 'Columbia Gas', amount: 60, amount_varies: true, day_of_month: 18, next_due: nd(18), category_id: cat('Housing', 'Gas').id })
  rec({ name: 'Spectrum internet', payee: 'Spectrum', amount: 79.99, day_of_month: 12, next_due: nd(12), category_id: cat('Housing', 'Internet').id, autopay: true })
  rec({ name: 'Verizon', payee: 'Verizon', amount: 95, day_of_month: 8, next_due: nd(8), category_id: cat('Bills', 'Phone').id, autopay: true })
  rec({ name: 'GEICO auto', payee: 'GEICO', amount: 128, day_of_month: 24, next_due: nd(24), category_id: cat('Transport', 'Car insurance').id, autopay: true })
  rec({ name: 'Netflix', payee: 'Netflix', kind: 'subscription', amount: 15.49, day_of_month: 3, next_due: nd(3), category_id: cat('Bills', 'Subscriptions & streaming').id, autopay: true, account_id: chase.id })
  rec({ name: 'Spotify', payee: 'Spotify', kind: 'subscription', amount: 11.99, day_of_month: 21, next_due: nd(21), category_id: cat('Bills', 'Subscriptions & streaming').id, autopay: true, account_id: chase.id })
  rec({ name: 'Planet Fitness', payee: 'Planet Fitness', kind: 'subscription', amount: 24.99, day_of_month: 17, next_due: nd(17), category_id: cat('Health', 'Gym & fitness').id, autopay: true })
  rec({ name: 'Auto loan payment', payee: 'Huntington', kind: 'debt_payment', amount: 312, day_of_month: +addDays(t, 4).slice(8), next_due: addDays(t, 4), liability_account_id: auto.id, category_id: cat('Debt', 'Loan payments').id, autopay: true })
  rec({ name: 'Amex payment', payee: 'American Express', kind: 'debt_payment', amount: 300, day_of_month: +addDays(t, 13).slice(8), next_due: addDays(t, 13), liability_account_id: amex.id, category_id: cat('Debt', 'Credit card payments').id, autopay: true })
  rec({ name: 'Chase payment', payee: 'Chase', kind: 'debt_payment', amount: 250, day_of_month: +addDays(t, 19).slice(8), next_due: addDays(t, 19), liability_account_id: chase.id, category_id: cat('Debt', 'Credit card payments').id })
  rec({ name: 'Emergency fund transfer', payee: 'Ally', kind: 'savings', amount: 300, day_of_month: 2, next_due: nd(2), liability_account_id: sav.id, category_id: cat('Savings', 'Emergency fund').id, autopay: true })

  // transactions: ~75 days of realistic activity
  const tx = (date: string, kind: 'expense' | 'income' | 'transfer', amount: number, p: Partial<Data['transactions'][number]>) => { d.transactions.push({ id: demoId(), household_id: hh, ref: 'T-' + String(d.transactions.length + 1).padStart(3, '0'), date, kind, amount, tags: [], status: 'cleared', source: 'manual', exclude_from_budget: false, account_id: chk.id, ...p } as Data['transactions'][number]) }
  const from = monthStart(months[0])
  // paychecks
  for (let x = lastFri; x >= from; x = addDays(x, -14)) tx(x, 'income', 2305, { payee: 'Meridian Aviation Group', category_id: cat('Income', 'Paycheck').id, pay_schedule_id: ps.id, memo: 'Direct deposit', source: 'recurring' })
  months.forEach(m => { const dd = m + '-15'; if (dd <= t) tx(dd, 'income', 400, { payee: 'Freelance client', category_id: cat('Income', 'Side income').id }) })
  // bills each month
  months.forEach(m => {
    const on = (day: number) => `${m}-${String(day).padStart(2, '0')}`
    const paidIf = (day: number, fn: () => void) => { if (on(day) <= t) fn() }
    paidIf(1, () => tx(on(1), 'expense', 1850, { payee: 'Olentangy Property Mgmt', category_id: cat('Housing', 'Rent / mortgage').id, recurring_id: d.recurring[0].id, source: 'recurring' }))
    paidIf(15, () => tx(on(15), 'expense', m === cm ? 152.4 : 131.8, { payee: 'AEP Ohio', category_id: cat('Housing', 'Electric').id, recurring_id: d.recurring[1].id, source: 'email' }))
    paidIf(18, () => tx(on(18), 'expense', 58.2, { payee: 'Columbia Gas', category_id: cat('Housing', 'Gas').id, recurring_id: d.recurring[2].id }))
    paidIf(12, () => tx(on(12), 'expense', 79.99, { payee: 'Spectrum', category_id: cat('Housing', 'Internet').id, recurring_id: d.recurring[3].id, source: 'email' }))
    paidIf(8, () => tx(on(8), 'expense', 95, { payee: 'Verizon', category_id: cat('Bills', 'Phone').id, recurring_id: d.recurring[4].id, source: 'email' }))
    paidIf(24, () => tx(on(24), 'expense', 128, { payee: 'GEICO', category_id: cat('Transport', 'Car insurance').id, recurring_id: d.recurring[5].id }))
    paidIf(3, () => tx(on(3), 'expense', 15.49, { payee: 'Netflix', category_id: cat('Bills', 'Subscriptions & streaming').id, account_id: chase.id, recurring_id: d.recurring[6].id }))
    paidIf(21, () => tx(on(21), 'expense', 11.99, { payee: 'Spotify', category_id: cat('Bills', 'Subscriptions & streaming').id, account_id: chase.id, recurring_id: d.recurring[7].id }))
    paidIf(17, () => tx(on(17), 'expense', 24.99, { payee: 'Planet Fitness', category_id: cat('Health', 'Gym & fitness').id, recurring_id: d.recurring[8].id }))
    paidIf(2, () => tx(on(2), 'transfer', 300, { payee: 'Ally', to_account_id: sav.id, category_id: cat('Savings', 'Emergency fund').id, recurring_id: d.recurring[12].id, goal_id: undefined }))
    if (m < cm) { tx(on(6), 'transfer', 312, { payee: 'Huntington auto loan', to_account_id: auto.id, category_id: cat('Debt', 'Loan payments').id, recurring_id: d.recurring[9].id }); tx(on(14), 'transfer', 300, { payee: 'American Express', to_account_id: amex.id, category_id: cat('Debt', 'Credit card payments').id, recurring_id: d.recurring[10].id }); tx(on(20), 'transfer', 250, { payee: 'Chase', to_account_id: chase.id, category_id: cat('Debt', 'Credit card payments').id, recurring_id: d.recurring[11].id }) }
    // variable spend: groceries weekly, fuel, dining, shopping
    const groceries = [142.18, 96.4, 131.07, 118.5, 88.2]; let gi = 0
    for (let w = weekStart(on(1)); w <= monthEnd(m); w = addDays(w, 7)) { const dd = addDays(w, 5); if (dd >= on(1) && dd <= t && dd.slice(0, 7) === m) tx(dd, 'expense', groceries[gi++ % groceries.length], { payee: ['Kroger', 'Aldi', 'Costco'][gi % 3], category_id: cat('Food', 'Groceries').id, account_id: amex.id }) }
    ;[[4, 48.11, 'Shell', 'Transport', 'Fuel', chk.id], [11, 52.3, 'BP', 'Transport', 'Fuel', chk.id], [19, 46.72, 'Speedway', 'Transport', 'Fuel', chk.id], [26, 49.9, 'Shell', 'Transport', 'Fuel', chk.id],
      [5, 38.4, 'Chipotle', 'Food', 'Dining out', chase.id], [9, 62.15, 'Olive Garden', 'Food', 'Dining out', chase.id], [16, 27.8, 'Panera', 'Food', 'Dining out', chase.id], [23, 54.6, 'Condado Tacos', 'Food', 'Dining out', chase.id], [28, 41.25, 'Pizza Hut', 'Food', 'Dining out', chase.id],
      [7, 6.45, 'Starbucks', 'Food', 'Coffee & snacks', chase.id], [13, 5.9, 'Starbucks', 'Food', 'Coffee & snacks', chase.id], [22, 7.1, 'Tim Hortons', 'Food', 'Coffee & snacks', chase.id],
      [10, 84.99, 'Amazon', 'Personal', 'Shopping', amex.id], [20, 46.5, 'Target', 'Personal', 'Shopping', amex.id], [27, 129, 'Kohl’s', 'Personal', 'Shopping', amex.id],
      [12, 31.4, 'CVS', 'Health', 'Pharmacy', chk.id], [14, 24, 'AMC', 'Personal', 'Entertainment', chase.id], [25, 65, 'Great Clips', 'Personal', 'Personal care', chk.id], [16, 92.3, 'Kids soccer fees', 'Personal', 'Kids & family', chk.id]] .forEach(([day, amt, payee, g, n, a]) => { const dd = on(day as number); if (dd <= t) tx(dd, 'expense', amt as number, { payee: payee as string, category_id: cat(g as string, n as string).id, account_id: a as string }) })
  })
  // this month: a couple of pending email-captured items and a transfer
  tx(addDays(t, -1), 'expense', 68.4, { payee: 'Kroger', category_id: cat('Food', 'Groceries').id, account_id: amex.id, status: 'pending' })

  // goals
  d.goals.push({ id: demoId(), household_id: hh, ref: 'G-001', name: 'Emergency fund (6 months)', kind: 'emergency_fund', target_amount: 18000, target_date: addDays(t, 540), account_id: sav.id, starting_amount: 7150, monthly_contribution: 300, priority: 1, status: 'Active', color: '#15803d', sort_order: 1 })
  d.goals.push({ id: demoId(), household_id: hh, ref: 'G-002', name: 'Pay off Amex', kind: 'debt_payoff', target_amount: 2840.2, target_date: addDays(t, 300), account_id: amex.id, starting_amount: 0, monthly_contribution: 300, priority: 2, status: 'Active', color: '#f97316', sort_order: 2 })
  d.goals.push({ id: demoId(), household_id: hh, ref: 'G-003', name: 'Spring break trip', kind: 'purchase', target_amount: 2400, target_date: addDays(t, 150), inflation_pct: 3, target_base_date: addDays(t, -60), account_id: sav.id, starting_amount: 600, monthly_contribution: 200, priority: 3, status: 'Active', color: '#3b5a8c', sort_order: 3 })
  d.transactions.filter(x => x.kind === 'transfer' && x.to_account_id === sav.id).forEach(x => d.contributions.push({ id: demoId(), household_id: hh, goal_id: d.goals[0].id, date: x.date, amount: x.amount, transaction_id: x.id }))

  // holdings: the 401(k) is a target-date fund + bond fund; add a small brokerage account with a few positions
  const k401 = d.accounts.find(a => a.name === 'Fidelity 401(k)')!
  const brok = acc({ name: 'Schwab brokerage', kind: 'investment', institution: 'Schwab', last4: '7730', balance: 11860, include_in_cash: false, color: '#3b5a8c' })
  const hold = (o: Partial<Holding> & { name: string; quantity: number; price: number; cost_basis: number }) => d.holdings.push({ id: demoId(), household_id: hh, ref: `I-${String(d.holdings.length + 1).padStart(3, '0')}`, asset_class: 'etf', risk: 'medium', sort_order: d.holdings.length + 1, price_as_of: t, value: Math.round(o.quantity * o.price * 100) / 100, ...o })
  hold({ account_id: k401.id, symbol: 'FFFHX', name: 'Fidelity Freedom 2050', asset_class: 'mutual_fund', sector: 'Diversified', risk: 'medium', quantity: 1210.5, price: 28.4, cost_basis: 29800, expense_ratio: 0.75 })
  hold({ account_id: k401.id, symbol: 'FXNAX', name: 'Fidelity US Bond Index', asset_class: 'bond', sector: 'Fixed income', risk: 'low', quantity: 760.2, price: 10.4, cost_basis: 8100, expense_ratio: 0.025, yield_pct: 4.1 })
  hold({ account_id: brok.id, symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', asset_class: 'etf', sector: 'Diversified', risk: 'medium', quantity: 22, price: 268.5, cost_basis: 5100, expense_ratio: 0.03, yield_pct: 1.3 })
  hold({ account_id: brok.id, symbol: 'AAPL', name: 'Apple', asset_class: 'stock', sector: 'Technology', risk: 'high', quantity: 12, price: 231.2, cost_basis: 2150 })
  hold({ account_id: brok.id, symbol: 'JNJ', name: 'Johnson & Johnson', asset_class: 'stock', sector: 'Healthcare', risk: 'low', quantity: 9, price: 162.8, cost_basis: 1420, yield_pct: 3.1 })
  hold({ account_id: brok.id, symbol: 'BTC', name: 'Bitcoin', asset_class: 'crypto', sector: 'Crypto', risk: 'high', quantity: 0.012, price: 67200, cost_basis: 650 })
  hold({ account_id: brok.id, name: 'Settlement cash', asset_class: 'cash', sector: 'Cash', risk: 'low', quantity: 1, price: 433.2, cost_basis: 433.2 })

  // tax lots (0.22.0): VTI was bought in two lots — an older long-term gain and a recent short-term loss worth harvesting
  { const vti = d.holdings.find(h => h.symbol === 'VTI'); if (vti) d.lots.push({ id: demoId(), household_id: hh, holding_id: vti.id, acquired_on: addDays(t, -800), quantity: 15, cost: 3000 }, { id: demoId(), household_id: hh, holding_id: vti.id, acquired_on: addDays(t, -120), quantity: 7, cost: 2100, notes: 'bought near the high' }) }
  // insurance register (0.22.0): employer health, a term life policy, auto — no renters or disability yet, so the gaps card has something to say
  d.insurance.push({ id: demoId(), household_id: hh, ref: 'Y-001', kind: 'health', name: 'Medical (employer PPO)', carrier: 'Anthem', insured: 'Household', premium: 186, premium_frequency: 'monthly', deductible: 1500, through_employer: true, status: 'Active', sort_order: 1 },
    { id: demoId(), household_id: hh, ref: 'Y-002', kind: 'term_life', name: '20-year term life', carrier: 'Haven Life', insured: 'Alex', policy_last4: '4471', coverage: 250000, premium: 28.5, premium_frequency: 'monthly', renews_on: addDays(t, 40), beneficiary: 'Spouse (primary); children equally (contingent)', through_employer: false, status: 'Active', sort_order: 2 },
    { id: demoId(), household_id: hh, ref: 'Y-003', kind: 'auto', name: 'Auto — Honda CR-V', carrier: 'Progressive', insured: 'Household', coverage: 100000, deductible: 500, premium: 612, premium_frequency: 'semiannual', renews_on: addDays(t, 75), through_employer: false, status: 'Active', sort_order: 3 })
  { const k = d.accounts.find(a => a.name === 'Fidelity 401(k)'); if (k) Object.assign(k, { beneficiary: 'Spouse (primary)', beneficiary_reviewed_on: addDays(t, -1400) }) }
  // planned items, snapshots, hardship
  d.planned.push({ id: demoId(), household_id: hh, ref: 'X-001', date: addDays(t, 20), label: 'Tax refund', category: 'Tax refund', amount: 1240, status: 'Planned' })
  d.planned.push({ id: demoId(), household_id: hh, ref: 'X-002', date: addDays(t, 45), label: 'New tires', category: 'Vehicle', amount: -650, status: 'Planned' })
  d.planned.push({ id: demoId(), household_id: hh, ref: 'X-003', date: addDays(t, 80), label: 'Car registration', category: 'Vehicle', amount: -92, status: 'Planned' })
  d.hardship.push({ id: demoId(), household_id: hh, ref: 'H-001', entity: 'American Express', type: 'Credit card', account_id: amex.id, monthly_obligation: null, phone: '800-555-0199', contact_name: '', status: 'Called — waiting', program: 'Interest / APR reduction', relief_monthly: 0, last_contact: addDays(t, -3), next_followup: addDays(t, 1), reference: '', outcome: 'Hardship team to call back within 3 business days', notes: 'Ask for 12-month reduced APR program', sort_order: 1 })

  // more sample accounts so the demo covers every account type the spec lists: a second debit card, a cash wallet, a third credit card (Discover)
  const chaseChk = acc({ name: 'Chase Total Checking', kind: 'checking', institution: 'Chase', last4: '7730', balance: 1240.18, color: '#5b7fb5' })
  const wallet = acc({ name: 'Cash wallet', kind: 'cash', balance: 86, color: '#8b949e' })
  const disc = acc({ name: 'Discover it', kind: 'credit_card', institution: 'Discover', last4: '3391', balance: 412.6, credit_limit: 4000, apr: 22.99, statement_date: addDays(t, -9), statement_balance: 388.1, minimum_payment: 35, due_date: addDays(t, 16), planned_payment: 120, color: '#b45309', promo_apr: 0, promo_until: (() => { const x = new Date(t + 'T12:00:00'); x.setMonth(x.getMonth() + 4, 0); return x.toISOString().slice(0, 10) })() })   // 0% intro rate ending in ~4 months (0.20.0 promo APR demo)
  ;([[3, 'Target', 54.18, 'Personal', 'Shopping', chaseChk], [9, 'Walgreens', 23.47, 'Health', 'Pharmacy', chaseChk], [16, 'Chipotle', 14.85, 'Food', 'Dining out', chaseChk], [24, 'Shell', 48.9, 'Transport', 'Fuel', chaseChk], [38, 'Target', 61.02, 'Personal', 'Shopping', chaseChk], [45, 'Speedway', 44.3, 'Transport', 'Fuel', chaseChk],
     [2, 'Worthington Farmers Market', 22, 'Food', 'Groceries', wallet], [6, 'Parking — Short North', 8, 'Transport', 'Parking / tolls / transit', wallet], [13, 'Lunch money', 15, 'Personal', 'Kids & family', wallet], [27, 'Barber tip', 10, 'Personal', 'Personal care', wallet],
     [4, 'The Home Depot', 136.42, 'Housing', 'Home maintenance', disc], [11, 'Amazon', 38.99, 'Personal', 'Shopping', disc], [19, 'Condado Tacos', 47.8, 'Food', 'Dining out', disc], [33, 'Lowe’s', 189.39, 'Housing', 'Home maintenance', disc]] as Array<[number, string, number, string, string, { id: string }]>)
    .forEach(([k, payee, amount, g, c, a]) => tx(addDays(t, -k), 'expense', amount, { payee, category_id: cat(g, c).id, account_id: a.id }))
  // one split transaction (0.19.0): the Target run three days ago was part groceries, part household goods
  { const target = d.transactions.find(x => x.payee === 'Target' && x.amount === 54.18); if (target) { d.splits.push({ id: demoId(), household_id: hh, transaction_id: target.id, category_id: cat('Food', 'Groceries').id, amount: 31.18, memo: 'food', sort_order: 0 }, { id: demoId(), household_id: hh, transaction_id: target.id, category_id: cat('Personal', 'Shopping').id, amount: 23, memo: 'household', sort_order: 1 }) } }
  tx(addDays(t, -20), 'transfer', 200, { payee: 'Cash withdrawal (ATM)', account_id: chk.id, to_account_id: wallet.id, category_id: cat('Other', 'Transfer').id })
  tx(addDays(t, -7), 'transfer', 150, { payee: 'Discover payment', account_id: chaseChk.id, to_account_id: disc.id, category_id: cat('Debt', 'Credit card payments').id })
  // sample audit / security log (the real app fills this from a database trigger on every change)
  const act = (min: number, action: string, table: string, summary: string) => d.activity.push({ id: d.activity.length + 1, household_id: hh, user_email: 'demo@wealthpilot.app', action, table_name: table, record_id: null, summary, created_at: new Date(Date.parse(t + 'T12:00:00') - min * 60000).toISOString() })
  ;([[5, 'update', 'accounts', 'Huntington Checking balance 3184.22'], [12, 'insert', 'transactions', 'Kroger 68.4'], [40, 'update', 'goals', 'Emergency fund (6 months) monthly 300'], [95, 'insert', 'transactions', 'statement import: 14 rows'], [180, 'update', 'accounts', 'Chase Freedom statement 1362.55'],
     [600, 'insert', 'holdings', 'VTI 22 @ 268.50'], [1440, 'update', 'categories', 'Dining out budget 160'], [2900, 'insert', 'email_items', 'AEP Ohio 152.4'], [4320, 'delete', 'transactions', 'duplicate Shell 45.10'], [7200, 'update', 'households', 'tax profile saved']] as Array<[number, string, string, string]>)
    .forEach(([m, a, tb, sm]) => act(m, a, tb, sm))

  // property & vehicles (0.24.0): the car the auto loan is against, valued from Kelley Blue Book a little over a quarter ago (so the
  // update-the-value reminder shows), with the depreciation guide and two earlier values in its history
  const car = acc({ name: '2021 Honda CR-V', kind: 'other_asset', asset_type: 'vehicle', balance: 22800, balance_as_of: addDays(t, -104), value_source: 'Kelley Blue Book', depreciation_pct: 15, include_in_cash: false, linked_account_id: auto.id, color: '#64748b' })
  { const bp = (account_id: string, k: number, balance: number, source: 'book' | 'bank' | 'value', bank: number | null = null) => d.balances.push({ id: demoId(), household_id: hh, account_id, as_of: addDays(t, k), balance, bank_balance: bank, source })
    bp(car.id, -470, 26900, 'value'); bp(car.id, -287, 24600, 'value'); bp(car.id, -104, 22800, 'value')
    for (let m = 6; m >= 1; m--) bp(auto.id, -m * 30, Math.round((9420 + m * 268) * 100) / 100, 'book')
    bp(chk.id, -60, 2410.55, 'bank', 2410.55); bp(chk.id, -30, 2896.1, 'bank', 2896.1) }
  // manual credit-score trend (0.24.0): the card issuer's free FICO each quarter, one VantageScore from a monitoring app, and Sam's
  ;([['Me', -330, 688, 'Experian', 'FICO 8', 'Discover card'], ['Me', -240, 694, 'Experian', 'FICO 8', 'Discover card'], ['Me', -200, 705, 'Equifax', 'VantageScore 3.0', 'Credit Karma'], ['Me', -150, 701, 'Experian', 'FICO 8', 'Discover card'], ['Me', -60, 712, 'Experian', 'FICO 8', 'Discover card'], ['Me', -20, 716, 'Experian', 'FICO 8', 'Discover card'], ['Sam', -45, 774, 'TransUnion', 'FICO 8', 'Bank app']] as const)
    .forEach(([person, k, score, bureau, model, source], i) => d.scores.push({ id: demoId(), household_id: hh, person, date: addDays(t, k), score, bureau, model, source, notes: null, created_at: new Date(Date.parse(addDays(t, k) + 'T12:00:00') + i).toISOString() }))

  // net-worth snapshots, derived from today's balances so they always include every demo account: assets grew and debt came down over two months
  {
    const live = d.accounts.filter(a => a.status === 'Active' && a.include_in_net_worth); const LIAB = ['credit_card', 'store_card', 'loan', 'auto_loan', 'student_loan', 'mortgage', 'bnpl', 'line_of_credit', 'medical', 'collection', 'other_liability']
    const A = live.filter(a => !LIAB.includes(a.kind)).reduce((x, a) => x + (+a.balance || 0), 0), L = live.filter(a => LIAB.includes(a.kind)).reduce((x, a) => x + (+a.balance || 0), 0), CASH = live.filter(a => a.include_in_cash && !LIAB.includes(a.kind)).reduce((x, a) => x + (+a.balance || 0), 0)
    ;([[-60, 1830, 1030, 930], [-30, 1030, 400, 410], [0, 0, 0, 0]] as const).forEach(([k, da, dl, dc]) => d.snapshots.push({ id: demoId(), household_id: hh, date: addDays(t, k), cash: Math.round(CASH - dc), assets: Math.round(A - da), liabilities: Math.round(L + dl), by_account: {} }))
  }
  const household: Household = { id: hh, name: 'Sample household (demo)', currency: 'USD', settings: { ...SETTINGS_DEFAULTS, periodType: 'month', reserveFloor: 3000, runwayGreen: 6, runwayYellow: 3,
    // sample tax data (demo only): year-to-date federal withholding from the W-2 pay stubs, last year's return, Lewis Center-style local rates
    tax: { year: 2026, filingStatus: 'single', state: 'OH', localRate: 2.5, schoolDistrictRate: 0, priorYearTax: 10200, priorYearAgi: 84000, autoAggregate: true, paychecksLeft: null, extraWithholdingPerCheck: 0, plannedEstimates: 0, seSetAsidePct: 25,
      items: [{ id: 'dt1', kind: 'withholding', label: 'Federal withholding to date (pay stub, Oct 31)', amount: 8560, source: 'manual' }, { id: 'dt2', kind: 'pretax_deduction', label: '401(k) deferrals + health premiums', amount: 7800, source: 'manual' }, { id: 'dt3', kind: 'estimated_payment', label: 'Q2 estimated payment (consulting)', amount: 600, source: 'manual' }] } } }
  d.members = [{ household_id: hh, user_id: 'demo-user', email: 'demo@example.com', role: 'owner', read_only: false }, { household_id: hh, user_id: 'demo-partner', email: 'sam@example.com', display_name: 'Sam', role: 'editor', read_only: false }]
  // a comment thread (0.21.0) on the split Target run
  { const target = d.transactions.find(x => x.payee === 'Target' && x.amount === 54.18); if (target) { const at = (h: number) => new Date(Date.parse(target.date + 'T18:00:00') + h * 3600000).toISOString()
    d.comments.push({ id: demoId(), household_id: hh, transaction_id: target.id, body: 'Was the $23 the birthday gift for Maya? If so it should be Gifts, not Shopping.', author_email: 'sam@example.com', created_by: 'demo-partner', created_at: at(2), updated_at: at(2) },
      { id: demoId(), household_id: hh, transaction_id: target.id, body: 'No — that was paper towels and detergent. Shopping is right.', author_email: 'demo@example.com', created_by: 'demo-user', created_at: at(3), updated_at: at(3) }) } }
  return { household, data: d }
}
