// 0.36.0 — the global search, and "my default account"
import { describe, it, expect } from 'vitest'
import { demoSeed } from '../app/data/demoSeed'
import type { ActivityRow, Data, Transaction } from '../app/data/types'
import { buildIndex, searchAll, filterActivity, ledgerSearchLink, fold, words, TXN_SHOWN, ACT_SHOWN, type PageRef } from './search'
import { defaultAccountOf, withDefaultAccount, openOn, localKey } from './defaultAccount'

const { data } = demoSeed()
const PAGES: PageRef[] = [{ path: '/', title: 'Dashboard', sub: 'Where you stand today', zone: 'Overview' }, { path: '/transactions', title: 'Transactions', sub: 'Every dollar in and out', zone: 'Spending Intelligence' }, { path: '/accounts', title: 'Account Balances', sub: 'Every account', zone: 'Accounts' },
  { path: '/bills', title: 'Bills & Subscriptions', sub: 'What is due', zone: 'Bills' }, { path: '/goals', title: 'Goals', sub: 'Savings goals', zone: 'Plan' }, { path: '/forecast', title: 'Cash Flow Forecast', sub: 'Day-by-day calendar', zone: 'Overview' }, { path: '/settings', title: 'Settings', sub: 'Household, categories, activity log', zone: 'Security & Settings' }]
const base = data.transactions.find(t => t.kind === 'expense')!
const tx = (id: string, over: Partial<Transaction>): Transaction => ({ ...base, id, memo: null, tags: [], ref: null, ...over })
const act = (id: number, over: Partial<ActivityRow>): ActivityRow => ({ id, household_id: 'h', user_email: 'gary@example.test', action: 'update', table_name: 'transactions', record_id: 'r' + id, summary: null, created_at: '2026-11-12T15:00:00Z', ...over })
const groceries = data.categories.find(c => /grocer/i.test(c.name))!, checking = data.accounts.find(a => a.kind === 'checking')!
const d: Data = { ...data, transactions: [...data.transactions,
  tx('z1', { payee: 'CAFÉ Zürich #4471', amount: 45.2, date: '2026-11-12', category_id: groceries.id, account_id: checking.id, memo: 'birthday lunch', tags: ['zqtag'], ref: 'CHK-1042' }),
  tx('z2', { payee: 'Zurich Insurance', amount: 45.99, date: '2025-03-02', category_id: null, account_id: checking.id }),
  tx('z3', { payee: 'Hardware Hank', amount: 450, date: '2026-10-30', category_id: null, account_id: checking.id }),
  tx('z4', { payee: 'Split Mart', amount: 80, date: '2026-10-01', category_id: null, account_id: checking.id })],
  splits: [...data.splits, { id: 's1', household_id: base.household_id, transaction_id: 'z4', category_id: groceries.id, amount: 30, memo: 'school supplies' } as Data['splits'][number]],
  activity: [act(1, { action: 'delete', summary: 'Zurich Insurance 45.99' }), act(2, { action: 'insert', table_name: 'recurring_items', summary: 'Rent', user_email: 'sam@example.test', created_at: '2026-10-03T09:00:00Z' }), act(3, { summary: 'CAFÉ Zürich 45.2' }), ...Array.from({ length: 6 }, (_, i) => act(10 + i, { summary: 'Balance updated ' + i, table_name: 'accounts' }))] }
const ix = buildIndex(d); const find = (q: string, pages = PAGES) => searchAll(q, ix, d, pages)

describe('finding transactions', () => {
  it('by payee — accents and capitals do not matter — newest first', () => {
    const r = find('zurich'); expect(r.txnIds).toEqual(['z1', 'z2']); expect(r.transactions[0]).toMatchObject({ kind: 'transaction', title: 'CAFÉ Zürich #4471' }); expect(r.transactions[0].to).toContain('/transactions?'); expect(find('ZÜRICH').txnIds).toEqual(['z1', 'z2'])
  })
  it('by memo, tag, reference, category, account and the categories and memos of its splits', () => {
    for (const q of ['birthday', 'zqtag', 'chk-1042', '4471']) expect(find(q).txnIds, q).toEqual(['z1'])
    expect(find('school supplies').txnIds).toEqual(['z4'])
    expect(find(groceries.name).txnIds).toEqual(expect.arrayContaining(['z1', 'z4'])); expect(find(groceries.name).txnIds).not.toContain('z3')
    expect(find(checking.name).txnIds).toEqual(expect.arrayContaining(['z1', 'z2', 'z3', 'z4']))
    expect(find('uncategorized hardware').txnIds).toEqual(['z3'])
  })
  it('several words narrow it: every word has to be found', () => {
    expect(find('zurich birthday').txnIds).toEqual(['z1']); expect(find('zurich insurance').txnIds).toEqual(['z2']); expect(find('zurich hardware').txnTotal).toBe(0)
  })
  it('a number finds an amount: dollars alone cover the cents, dollars and cents are exact', () => {
    expect(find('zurich 45').txnIds).toEqual(['z1', 'z2']); expect(find('45.20').txnIds).toEqual(['z1']); expect(find('$45.99').txnIds).toEqual(['z2']); expect(find('zurich 450').txnTotal).toBe(0)
    expect(find('450').txnIds).toContain('z3'); expect(find('450').txnIds).not.toContain('z1')
  })
  it('by date, as written or as shown', () => {
    expect(find('2026-11-12 zurich').txnIds).toEqual(['z1']); expect(find('nov 12 zurich').txnIds).toEqual(['z1']); expect(find('zurich 2025').txnIds).toEqual(['z2'])
  })
  it('shows the first few and counts them all; the ids are every match', () => {
    const r = find(checking.name); expect(r.txnTotal).toBeGreaterThan(TXN_SHOWN); expect(r.transactions).toHaveLength(TXN_SHOWN); expect(r.txnIds).toHaveLength(r.txnTotal)
    expect(r.transactions.map(h => h.key)).toEqual(r.txnIds.slice(0, TXN_SHOWN).map(id => 't' + id))
    const dates = r.txnIds.map(id => d.transactions.find(t => t.id === id)!.date); expect(dates).toEqual(dates.slice().sort().reverse())
  })
})
describe('finding activity', () => {
  it('by what changed, who, the kind of change, the table and the date', () => {
    expect(find('zurich').actTotal).toBe(2); expect(find('deleted zurich').activity.map(h => h.key)).toEqual(['l1']); expect(find('sam@example.test').actTotal).toBe(1)
    expect(find('added bill rent').activity[0]).toMatchObject({ kind: 'activity', title: 'Rent' }); expect(find('oct 3 rent').actTotal).toBe(1); expect(find('balance updated').actTotal).toBe(6)
  })
  it('shows the first few; each opens the activity log filtered the same way', () => {
    const r = find('balance updated'); expect(r.activity).toHaveLength(ACT_SHOWN); expect(r.activity[0].to).toBe('/settings?tab=activity&q=balance%20updated')
  })
  it('the activity log\'s own filter uses the same rule', () => {
    expect(filterActivity(d.activity, 'deleted zurich').map(a => a.id)).toEqual([1]); expect(filterActivity(d.activity, '  ')).toBe(d.activity); expect(filterActivity(d.activity, 'nothing-like-this')).toEqual([])
  })
})
describe('finding places', () => {
  it('pages, accounts, bills, goals and planned items by name — the closest match first', () => {
    expect(find('trans').go[0]).toMatchObject({ kind: 'page', to: '/transactions' }); expect(find(checking.name).go[0]).toMatchObject({ kind: 'account', title: checking.name })
    const bill = d.recurring.find(r => r.status === 'Active')!; expect(find(bill.name).go.some(h => h.kind === 'bill' && h.title === bill.name)).toBe(true)
    const goal = d.goals.find(g => g.status === 'Active')!; expect(find(goal.name).go.some(h => h.kind === 'goal')).toBe(true)
    const pl = d.planned.find(p => p.status === 'Planned')!; expect(find(pl.label).go.some(h => h.kind === 'planned' && h.to === '/forecast?view=long')).toBe(true)
  })
  it('with nothing typed: the pages, and nothing else', () => { const r = find(''); expect(r.go.every(h => h.kind === 'page')).toBe(true); expect(r.go.length).toBe(PAGES.length); expect(r.txnTotal + r.actTotal).toBe(0) })
  it('only what this person can open: no ledger page, no transactions; no Settings, no activity; no Accounts, no accounts', () => {
    const limited = PAGES.filter(p => !['/transactions', '/settings', '/accounts'].includes(p.path)); const r = find('zurich', limited); expect(r.txnTotal).toBe(0); expect(r.actTotal).toBe(0)
    expect(find(checking.name, limited).go.some(h => h.kind === 'account')).toBe(false)
  })
})
describe('the pieces', () => {
  it('folding and words', () => { expect(fold('  CAFÉ   Zürich!! ')).toBe('cafe zurich'); expect(words('  rent   $1,850.00 ')).toEqual(['rent', '$1850.00']); expect(find('1,850').txnTotal).toBe(find('1850').txnTotal); expect(find('1850').txnTotal).toBeGreaterThan(0); expect(words('')).toEqual([]) })
  it('"See all" opens the ledger on exactly the matches; a long set is handed over by name, and never cut short', () => {
    expect(ledgerSearchLink(['a', 'b'], ' rent & co ')).toBe('/transactions?ids=a,b&from=search&q=rent%20%26%20co')
    const many = Array.from({ length: 301 }, (_, i) => 'id' + i); const kept: Record<string, string> = {}
    expect(ledgerSearchLink(many, 'x', { setItem: (k, v) => { kept[k] = v } })).toBe('/transactions?ids=@set&from=search&q=x'); expect(JSON.parse(kept['cresari.ledgerSet'])).toEqual(many)
    expect(ledgerSearchLink(many, 'x', { setItem: () => { throw new Error('full') } })).toContain('ids=id0,id1,'); expect(ledgerSearchLink(many, 'x', null).split(',').length).toBe(301)
  })
})

describe('my default account', () => {
  const accts = d.accounts, a = accts.find(x => x.status === 'Active')!, b = accts.find(x => x.status === 'Active' && x.id !== a.id)!
  it('is each person\'s own, and only an account still in use', () => {
    const s = { defaultAccounts: { u1: a.id, u2: b.id, u3: 'gone' } }
    expect(defaultAccountOf(s, 'u1', accts)?.id).toBe(a.id); expect(defaultAccountOf(s, 'u2', accts)?.id).toBe(b.id); expect(defaultAccountOf(s, 'u3', accts)).toBeNull(); expect(defaultAccountOf(s, 'u9', accts)).toBeNull(); expect(defaultAccountOf({}, 'u1', accts)).toBeNull()
    expect(defaultAccountOf(s, 'u1', accts.map(x => (x.id === a.id ? { ...x, status: 'Closed' as const } : x)))).toBeNull()
    expect(defaultAccountOf(s, 'u1', accts.map(x => (x.id === a.id ? { ...x, excluded: true } : x)))).toBeNull()
  })
  it('someone who cannot edit the household keeps theirs on the device', () => { expect(defaultAccountOf({}, 'u1', accts, b.id)?.id).toBe(b.id); expect(defaultAccountOf({ defaultAccounts: { u1: a.id } }, 'u1', accts, b.id)?.id).toBe(a.id); expect(localKey('h1', 'u1')).toBe('cresari.defaultAccount.h1.u1') })
  it('setting or clearing one leaves everyone else\'s alone', () => {
    const s = { defaultAccounts: { u1: a.id, u2: b.id } }
    expect(withDefaultAccount(s, 'u1', b.id)).toEqual({ defaultAccounts: { u1: b.id, u2: b.id } }); expect(withDefaultAccount(s, 'u1', null)).toEqual({ defaultAccounts: { u2: b.id } }); expect(withDefaultAccount({}, 'u1', a.id)).toEqual({ defaultAccounts: { u1: a.id } })
    expect(s.defaultAccounts).toEqual({ u1: a.id, u2: b.id })   // not changed in place
  })
  it('a page opens on it only when it offers that account', () => { expect(openOn(a, [a, b], b.id)).toBe(a.id); expect(openOn(a, [b], b.id)).toBe(b.id); expect(openOn(null, [a, b], b.id)).toBe(b.id) })
})
