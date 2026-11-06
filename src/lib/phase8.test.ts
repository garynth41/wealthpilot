// 0.24.0 — data: moving in from Mint / YNAB / Quicken / Monarch, balance history and balance-on-date, property and vehicle values,
// the credit-score trend.
import { describe, it, expect, beforeAll } from 'vitest'
import { setToday, addDays } from './dates'
import { detectSource, parseExport, parseQif, proposeAccounts, proposeCategories, buildPlan, accountsFrom, categoriesFrom, resolveIds, guessKind } from './migrate'
import { balanceOn, historySeries, historyFor } from './history'
import { assetRows, estimateNow, revalueDue } from './assets'
import { band, creditTrends, creditTips } from './credit'
import { computeAlerts, type NInput } from './notify'
import { MemoryRepo } from '../app/data/memoryRepo'
import { demoSeed } from '../app/data/demoSeed'
import { emptyData, type Account, type Data, type CreditScore } from '../app/data/types'

const T0 = '2026-11-04'
beforeAll(() => setToday(T0))
const seed = () => demoSeed().data

const MINT = `"Date","Description","Original Description","Amount","Transaction Type","Category","Account Name","Labels","Notes"
"10/28/2026","Kroger","KROGER #551","84.12","debit","Groceries","Chase Checking","",""
"10/27/2026","Payroll","ACME PAYROLL","2400.00","credit","Paycheck","Chase Checking","",""
"10/25/2026","Credit Card Payment","PAYMENT THANK YOU","300.00","debit","Credit Card Payment","Chase Checking","",""
"10/25/2026","Credit Card Payment","PAYMENT RECEIVED","300.00","credit","Credit Card Payment","Freedom Visa","",""
"10/20/2026","Chipotle","CHIPOTLE 2211","14.50","debit","Fast Food","Freedom Visa","lunch",""
"10/19/2026","Transfer to savings","ONLINE TRANSFER","100.00","debit","Transfer","Chase Checking","",""`
const YNAB = `"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"
"Checking","","10/28/2026","Kroger","Everyday: Groceries","Everyday","Groceries","","$84.12","$0.00","Cleared"
"Checking","","10/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","","$0.00","$1,500.00","Reconciled"
"Checking","Red","10/20/2026","Transfer : Savings","","","","","$250.00","$0.00","Cleared"
"Savings","","10/20/2026","Transfer : Checking","","","","","$0.00","$250.00","Cleared"`
const MONARCH = `Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags
2026-10-28,Kroger,Groceries,Joint Checking (...4421),KROGER 551,,-84.12,
2026-10-26,Netflix,Entertainment & Recreation,Amex Gold (...1009),NETFLIX.COM,,-15.49,subscription
2026-10-25,Paycheck,Paychecks,Joint Checking (...4421),ACME,,2400.00,`
const QUICKEN = `Date,Account,Num,Payee,Memo,Category,Tag,Clr,Amount
10/28/2026,Checking,1043,City Water,,Utilities:Water,,R,-48.20
10/25/2026,Checking,,Transfer,,[Savings],,R,-500.00`
const QIF = `!Account
NChecking
TBank
^
!Type:Bank
D10/28'26
T-84.12
PKroger
LFood:Groceries
^
D10/27/2026
T2,400.00
PACME Payroll
LIncome:Salary
^
D10/25/2026
T-300.00
PCard payment
L[Visa]
^`

describe('moving in from another app', () => {
  it('recognizes each app from its column headings', () => {
    expect(detectSource(MINT.split('\n')[0].split(',').map(h => h.replace(/"/g, '')))).toBe('mint')
    expect(detectSource(YNAB.split('\n')[0].split(',').map(h => h.replace(/"/g, '')))).toBe('ynab')
    expect(detectSource(MONARCH.split('\n')[0].split(','))).toBe('monarch')
    expect(detectSource(QUICKEN.split('\n')[0].split(','))).toBe('quicken')
    expect(detectSource(['Date', 'Description', 'Amount'])).toBeNull()
  })
  it('Mint: debit/credit gives the sign; accounts and categories are listed', () => {
    const p = parseExport(MINT, 'transactions.csv')!; expect(p.source).toBe('mint'); expect(p.rows).toHaveLength(6)
    expect(p.rows[0]).toMatchObject({ date: '2026-10-28', payee: 'Kroger', amount: -84.12, account: 'Chase Checking', category: 'Groceries' }); expect(p.rows[1].amount).toBe(2400)
    expect(p.accounts.map(a => a.name)).toEqual(['Chase Checking', 'Freedom Visa']); expect(p.categories.map(c => c.name)).toEqual(['Groceries', 'Paycheck', 'Fast Food'])   // transfers are not categories
    expect(p.from).toBe('2026-10-19'); expect(p.to).toBe('2026-10-28')
  })
  it('YNAB: outflow/inflow, "Transfer : X" payees, starting balances skipped', () => {
    const p = parseExport(YNAB)!; expect(p.source).toBe('ynab'); expect(p.skipped.map(r => r.skip)).toEqual(['opening balance'])
    expect(p.rows[0]).toMatchObject({ amount: -84.12, category: 'Groceries', group: 'Everyday' }); expect(p.rows[1]).toMatchObject({ transferTo: 'Savings', amount: -250, tags: ['red'] })
  })
  it('Monarch and Quicken CSV, and QIF with accounts, categories and bracketed transfers', () => {
    const m = parseExport(MONARCH)!; expect(m.source).toBe('monarch'); expect(m.rows[1]).toMatchObject({ amount: -15.49, account: 'Amex Gold (...1009)', tags: ['subscription'] })
    const q = parseExport(QUICKEN)!; expect(q.source).toBe('quicken'); expect(q.rows[0]).toMatchObject({ category: 'Water', group: 'Utilities', check: '1043' }); expect(q.rows[1]).toMatchObject({ transferTo: 'Savings', category: 'Transfer' })
    const r = parseQif(QIF); expect(r).toHaveLength(3); expect(r[0]).toMatchObject({ account: 'Checking', date: '2026-10-28', amount: -84.12, category: 'Groceries', group: 'Food' }); expect(r[1].amount).toBe(2400); expect(r[2]).toMatchObject({ transferTo: 'Visa' })
    expect(parseExport(QIF, 'export.qif')!.source).toBe('qif')
  })
  it('guesses account types from names', () => {
    expect(guessKind('Freedom Visa', 10, 1)).toBe('credit_card'); expect(guessKind('Ally Savings', 1, 5)).toBe('savings'); expect(guessKind('Fidelity Roth IRA', 0, 3)).toBe('retirement'); expect(guessKind('Chase Checking', 10, 5)).toBe('checking')
  })
  it('maps to existing accounts and categories by name, and plans the rest as new', () => {
    const d = seed(); const p = parseExport(MONARCH)!
    const am = proposeAccounts(d, p); expect(am['Amex Gold (...1009)'].target).toBe('new'); expect(am['Amex Gold (...1009)'].kind).toBe('credit_card'); expect(am['Joint Checking (...4421)'].kind).toBe('checking')
    const cm = proposeCategories(d, p); expect(d.categories.find(c => c.id === cm['Groceries'])?.name).toBe('Groceries')
  })
  it('pairs the two legs of a transfer into one; a one-sided leg stays out of the budget; nothing moves balances', () => {
    const d: Data = { ...emptyData() }; const p = parseExport(MINT)!
    const amap = accountsFrom(proposeAccounts(d, p)); const cmap = categoriesFrom(Object.fromEntries(p.categories.map(c => [c.name, 'none'])))
    const plan = buildPlan(d, p, amap, cmap); expect(plan.transfers).toBe(1); expect(plan.oneSided).toBe(1); expect(plan.add).toHaveLength(5)
    const pay = plan.add.find(t => t.kind === 'transfer')!; expect(pay).toMatchObject({ amount: 300, account_id: 'new:acct:Chase Checking', to_account_id: 'new:acct:Freedom Visa', date: '2026-10-25' })
    const save = plan.add.find(t => t.payee === 'Transfer to savings')!; expect(save).toMatchObject({ kind: 'expense', exclude_from_budget: true, tags: ['transfer'] })
    expect(plan.add.find(t => t.payee === 'Chipotle')!.tags).toEqual(['lunch'])
    const ids = resolveIds(plan.add, { 'new:acct:Chase Checking': 'A1', 'new:acct:Freedom Visa': 'A2' }); expect(ids.find(t => t.kind === 'transfer')).toMatchObject({ account_id: 'A1', to_account_id: 'A2' })
  })
  it('a YNAB transfer pairs by the payee naming the other account; re-importing the same file adds nothing', () => {
    const d: Data = { ...emptyData() }; const p = parseExport(YNAB)!; const amap = accountsFrom(proposeAccounts(d, p))
    const plan = buildPlan(d, p, amap, categoriesFrom({ Groceries: 'none' })); expect(plan.transfers).toBe(1); expect(plan.add).toHaveLength(2)
    const again = buildPlan({ ...d, transactions: plan.add.map((t, i) => ({ ...t, id: 'x' + i } as never)) }, p, amap, categoriesFrom({ Groceries: 'none' })); expect(again.add).toHaveLength(0); expect(again.dups).toBe(2)
  })
  it('skipped accounts and an earliest date leave rows out', () => {
    const d: Data = { ...emptyData() }; const p = parseExport(MINT)!; const amap = { ...accountsFrom(proposeAccounts(d, p)), 'Freedom Visa': 'skip' }
    const plan = buildPlan(d, p, amap, {}, { since: '2026-10-26' }); expect(plan.add.map(t => t.payee).sort()).toEqual(['Kroger', 'Payroll'])
  })
})

describe('balance history', () => {
  it('the demo repo records a row per account per day whenever a balance changes, like the database trigger', async () => {
    const r = new MemoryRepo(demoSeed()); const a = r['data'].accounts[0] as Account
    await r.update('accounts', a.id, { balance: +a.balance + 10 }); await r.update('accounts', a.id, { balance: +a.balance + 25 })
    const rows = historyFor(r['data'], a.id).filter(x => x.as_of === T0); expect(rows).toHaveLength(1); expect(rows[0].balance).toBe(+a.balance + 25)
    await r.update('accounts', a.id, { bank_balance: 999, bank_balance_as_of: '2026-11-02' }); expect(historyFor(r['data'], a.id).find(x => x.as_of === '2026-11-02')).toMatchObject({ bank_balance: 999, source: 'bank' })
    await expect(r.insert('balances', {})).rejects.toThrow(/written by the database/)
  })
  it('balance on a past date: a recorded day, else today\'s balance with later transactions undone', () => {
    const d = seed(); const chk = d.accounts.find(a => a.kind === 'checking')!
    const after = d.transactions.filter(t => t.date > addDays(T0, -10) && (t.account_id === chk.id || t.to_account_id === chk.id) && t.status !== 'void'); expect(after.length).toBeGreaterThan(0)
    const b = balanceOn(d, chk, addDays(T0, -10), T0); expect(b.from).toBe('ledger')
    const net = after.reduce((n, t) => n + (t.kind === 'income' ? t.amount : t.kind === 'expense' ? -t.amount : t.account_id === chk.id ? -t.amount : t.amount), 0)
    expect(b.balance).toBeCloseTo(+chk.balance - net, 2)
    d.balances = [{ id: 'h', household_id: 'h', account_id: chk.id, as_of: addDays(T0, -10), balance: 4321, bank_balance: 4300, source: 'bank' }]
    expect(balanceOn(d, chk, addDays(T0, -10), T0)).toMatchObject({ balance: 4321, bank: 4300, from: 'history', recordedOn: addDays(T0, -10) })
    expect(balanceOn(d, chk, T0, T0).balance).toBe(+chk.balance)
    expect(historySeries(d, chk, T0).map(p => p.date)).toEqual([addDays(T0, -10), T0])
    // a date before the recorded day rolls back from that day's figure, not from today's (a balance typed in between stays right)
    const before = d.transactions.filter(t => t.status !== 'void' && t.date > addDays(T0, -20) && t.date <= addDays(T0, -10) && (t.account_id === chk.id || t.to_account_id === chk.id))
    const net2 = before.reduce((n, t) => n + (t.kind === 'income' ? t.amount : t.kind === 'expense' ? -t.amount : t.account_id === chk.id ? -t.amount : t.amount), 0)
    expect(balanceOn(d, chk, addDays(T0, -20), T0)).toMatchObject({ from: 'ledger', recordedOn: addDays(T0, -10) }); expect(balanceOn(d, chk, addDays(T0, -20), T0).balance).toBeCloseTo(4321 - net2, 2)
  })
})

describe('property and vehicles', () => {
  const asset = (o: Partial<Account>): Account => ({ id: 'car', household_id: 'h', name: 'Honda CR-V', kind: 'other_asset', asset_type: 'vehicle', balance: 24000, balance_as_of: '2025-11-04', apr: 0, minimum_payment: 0, planned_payment: 0, autopay: false, include_in_cash: false, include_in_net_worth: true, status: 'Active', sort_order: 1, ...o } as Account)
  it('equity against the linked loan, a quarter-old value is due, and the depreciation guide estimates today', () => {
    const d = seed(); const loan = { ...d.accounts.find(a => a.kind === 'credit_card')!, id: 'carloan', kind: 'auto_loan' as const, balance: 9000, linked_account_id: 'car' } as Account
    d.accounts.push(asset({ depreciation_pct: 15 }), loan)
    const r = assetRows(d, T0).find(x => x.a.id === 'car')!; expect(r.loan?.id).toBe('carloan'); expect(r.owed).toBe(9000); expect(r.equity).toBe(15000); expect(r.ltv).toBe(0.38); expect(r.stale).toBe(true)
    expect(r.estimate).toBeCloseTo(24000 * Math.pow(0.85, 365 / 365.25), 0); expect(estimateNow(asset({ depreciation_pct: null }), T0)).toBeNull()
    expect(revalueDue(d, T0).map(x => x.a.id)).toContain('car')
    const fresh = { ...d, accounts: d.accounts.map(a => a.id === 'car' ? { ...a, balance_as_of: addDays(T0, -30) } : a) }; expect(revalueDue(fresh, T0).map(x => x.a.id)).not.toContain('car')
  })
})

describe('credit-score trend', () => {
  const sc = (o: Partial<CreditScore>): CreditScore => ({ id: Math.random().toString(36), household_id: 'h', person: 'Gary', date: '2026-01-01', score: 700, ...o })
  it('bands follow the FICO ranges', () => { expect(band(812).label).toBe('Exceptional'); expect(band(745).label).toBe('Very good'); expect(band(700).label).toBe('Good'); expect(band(600).label).toBe('Fair'); expect(band(540).label).toBe('Poor') })
  it('change compares the same bureau and model; the next band and staleness are reported per person', () => {
    const t = creditTrends({ scores: [sc({ date: '2026-05-01', score: 690, bureau: 'Experian' }), sc({ date: '2026-06-01', score: 720, bureau: 'Equifax' }), sc({ date: '2026-07-01', score: 702, bureau: 'Experian' }), sc({ person: 'Sam', date: '2026-10-20', score: 810 })] }, T0)
    const g = t.find(x => x.person === 'Gary')!; expect(g.latest.score).toBe(702); expect(g.previous?.score).toBe(690); expect(g.change).toBe(12); expect(g.nextBand).toEqual({ label: 'Very good', points: 38 }); expect(g.stale).toBe(true); expect(Object.keys(g.byBureau).sort()).toEqual(['Equifax', 'Experian'])
    const s = t.find(x => x.person === 'Sam')!; expect(s.nextBand).toBeNull(); expect(s.stale).toBe(false); expect(s.change).toBeNull()
  })
  it('tips start from the household\'s utilization', () => { expect(creditTips(0.45)[0]).toMatch(/under 30%/); expect(creditTips(0.05)[0]).toMatch(/helps/); expect(creditTips(null)[0]).toMatch(/Payment history/) })
})

describe('the quarterly reminder to update a value', () => {
  const inp = (as_of: string | null, prefs = {}): NInput => ({ today: T0, accounts: [{ id: 'home', name: 'Home', kind: 'other_asset', asset_type: 'home', status: 'Active', balance: 340000, include_in_cash: false, balance_as_of: as_of }], recurring: [], occurrences: [], transactions: [], paySchedules: [], sync: null, reserveFloor: 0, prefs })
  it('fires once a value is 90 days old, once per quarter, and for an undated value; it can be switched off', () => {
    expect(computeAlerts(inp(addDays(T0, -60))).filter(a => a.kind === 'revalue')).toHaveLength(0)
    const a = computeAlerts(inp(addDays(T0, -95))).filter(a => a.kind === 'revalue'); expect(a).toHaveLength(1); expect(a[0].key).toBe(`revalue:home:${addDays(T0, -95)}:1`); expect(a[0].url).toBe('/accounts')
    expect(computeAlerts(inp(addDays(T0, -120)))[0].key).toBe(`revalue:home:${addDays(T0, -120)}:1`); expect(computeAlerts(inp(addDays(T0, -190)))[0].key).toBe(`revalue:home:${addDays(T0, -190)}:2`)
    expect(computeAlerts(inp(null))[0].key).toBe('revalue:home:undated'); expect(computeAlerts(inp(addDays(T0, -200), { revalue: false }))).toHaveLength(0)
  })
})
