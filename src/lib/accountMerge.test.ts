import { describe, expect, it } from 'vitest'
import { emptyData, type Account, type Data, type Transaction } from '../app/data/types'
import { accountTwins, planAccountMerge, accountLike } from './accountMerge'

const acct = (id: string, name: string, kind: Account['kind'], extra: Partial<Account> = {}): Account => ({ id, household_id: 'h', name, kind, institution: name, balance: 0, apr: 0, minimum_payment: 0, autopay: false, include_in_cash: false, include_in_net_worth: true, status: 'Active', sort_order: 0, created_at: '2026-11-02T21:01:' + id.padStart(2, '0'), ...extra })
const tx = (id: string, p: Partial<Transaction>): Transaction => ({ id, household_id: 'h', date: '2026-11-03', kind: 'expense', amount: 10, tags: [], status: 'cleared', source: 'manual', exclude_from_budget: false, ...p })
const data = (accounts: Account[], rest: Partial<Data> = {}): Data => ({ ...emptyData(), accounts, ...rest })

describe('the same account listed more than once', () => {
  it('groups copies by name, type and institution, and keeps the one with the most on it', () => {
    const d = data([acct('1', 'Flex Rent', 'line_of_credit'), acct('2', 'Flex Rent', 'line_of_credit', { status: 'Paid off', balance: 618 }), acct('3', 'Flex Rent', 'line_of_credit'), acct('4', 'flex  rent', 'line_of_credit', { balance: -134 }), acct('5', 'Ollo', 'credit_card', { last4: '7844' }), acct('6', 'Ollo', 'credit_card', { last4: '7844' }), acct('7', 'Indigo', 'credit_card')],
      { transactions: [tx('a', { kind: 'transfer', account_id: 'bank', to_account_id: '4' }), tx('b', { kind: 'transfer', account_id: 'bank', to_account_id: '4' }), tx('c', { kind: 'transfer', account_id: 'bank', to_account_id: '1' })] })
    const t = accountTwins(d)
    expect(t.map(g => [g.name, g.keeper.id, g.others.map(o => o.id)])).toEqual([['flex  rent', '4', ['1', '3', '2']], ['Ollo', '5', ['6']]])
    expect(t[0].counts).toEqual({ 1: 1, 2: 0, 3: 0, 4: 2 })
  })
  it('never offers accounts that are really two: different last four, different type, both reported by the bank, property, or left out', () => {
    expect(accountTwins(data([acct('1', 'Checking', 'checking', { last4: '4019' }), acct('2', 'Checking', 'checking', { last4: '2060' })]))).toEqual([])
    expect(accountTwins(data([acct('1', 'Chase', 'checking'), acct('2', 'Chase', 'credit_card')]))).toEqual([])
    expect(accountTwins(data([acct('1', 'Checking', 'checking', { bank_balance: 5 }), acct('2', 'Checking', 'checking', { bank_balance: 9 })]))).toEqual([])
    expect(accountTwins(data([acct('1', 'Car', 'other_asset'), acct('2', 'Car', 'other_asset')]))).toEqual([])
    expect(accountTwins(data([acct('1', 'Checking', 'checking'), acct('2', 'Checking', 'checking', { excluded: true })]))).toEqual([])
    expect(accountTwins(data([acct('1', 'Card', 'credit_card', { institution: 'Chase' }), acct('2', 'Card', 'credit_card', { institution: 'Citi' })]))).toEqual([])
    expect(accountTwins(data([acct('1', 'New card', 'credit_card'), acct('2', 'New card', 'credit_card')]))).toEqual([])   // two rows just added, not yet named
  })
  it('the copy with a bank feed is kept even when another has more transactions; a blank last four does not split a pair', () => {
    const d = data([acct('1', 'Visa', 'credit_card', { last4: '1111' }), acct('2', 'Visa', 'credit_card', { bank_balance: 40 })], { transactions: [tx('a', { account_id: '1' }), tx('b', { account_id: '1' })] })
    expect(accountTwins(d)[0].keeper.id).toBe('2')
  })

  it('plans the merge: every link moves, what is owed comes from the freshest copy, blanks are filled, nothing is added up', () => {
    const keeper = acct('4', 'Flex Rent', 'line_of_credit', { balance: -134, due_date: '2026-10-31', status: 'Active' })
    const others = [acct('1', 'Flex Rent', 'line_of_credit', { balance: 0, due_date: '2026-11-05', minimum_payment: 67, last4: '9911' }), acct('2', 'Flex Rent', 'line_of_credit', { balance: 618, due_date: '2026-11-05', status: 'Paid off' })]
    const d = data([keeper, ...others, acct('9', 'Auto', 'auto_loan', { autopay_account_id: '1' })], {
      transactions: [tx('a', { kind: 'transfer', account_id: 'bank', to_account_id: '1' }), tx('b', { kind: 'transfer', account_id: 'bank', to_account_id: '4' }), tx('s', { kind: 'transfer', account_id: '1', to_account_id: '2' })],
      duplicates: [tx('m', { kind: 'transfer', account_id: 'bank', to_account_id: '2', duplicate_of: 'a' })],
      recurring: [{ id: 'r', account_id: 'bank', liability_account_id: '2' }] as never,
      statements: [{ id: 's1', account_id: '1', statement_date: '2026-10-05' }, { id: 's2', account_id: '2', statement_date: '2026-10-05' }, { id: 's3', account_id: '4', statement_date: '2026-09-05' }] as never,
      emailItems: [{ id: 'e', account_id: '2' }] as never,
    })
    const p = planAccountMerge(d, keeper, others, { flexrent: { account: '2' }, ollo: { account: 'x' } })
    expect(p.moves).toEqual([
      { coll: 'transactions', id: 'a', patch: { to_account_id: '4' } }, { coll: 'transactions', id: 'm', patch: { to_account_id: '4' } },   // 's' ran between two copies: left alone
      { coll: 'recurring', id: 'r', patch: { liability_account_id: '4' } },
      { coll: 'statements', id: 's1', patch: { account_id: '4' } },                                                                       // s2 is the same statement again: it goes with its copy
      { coll: 'emailItems', id: 'e', patch: { account_id: '4' } },
      { coll: 'accounts', id: '9', patch: { autopay_account_id: '4' } },
    ])
    expect(p.moved).toEqual({ transactions: 2, bills: 1, statements: 1, other: 2 })
    expect(p.keeperPatch).toMatchObject({ balance: 0, due_date: '2026-11-05', minimum_payment: 67, last4: '9911' })   // the active copy due last, not 618 + 0 − 134
    expect(p.rules).toEqual({ flexrent: { account: '4' }, ollo: { account: 'x' } })
  })
  it('what is owed comes from the copy whose balance was set last, not the one due latest', () => {
    const keeper = acct('1', 'Card', 'credit_card', { balance: 100, balance_as_of: '2026-10-01', due_date: '2026-12-20' }); const other = acct('2', 'Card', 'credit_card', { balance: 60, balance_as_of: '2026-11-05', due_date: '2026-11-20' })
    expect(planAccountMerge(data([keeper, other]), keeper, [other]).keeperPatch).toMatchObject({ balance: 60, balance_as_of: '2026-11-05', due_date: '2026-11-20' })
  })
  it('completed reconciliations cannot be moved: that copy is the one kept, two reconciled copies are not offered, and removing one is refused', () => {
    const a = acct('1', 'Checking', 'checking'), b = acct('2', 'Checking', 'checking'); const txns = [tx('a', { account_id: '1' }), tx('b', { account_id: '1' })]
    const rec = (id: string, account_id: string) => ({ id, account_id }) as never
    expect(accountTwins(data([a, b], { transactions: txns, reconciliations: [rec('k1', '2')] }))[0].keeper.id).toBe('2')
    expect(accountTwins(data([a, b], { transactions: txns, reconciliations: [rec('k1', '1'), rec('k2', '2')] }))).toEqual([])
    expect(() => planAccountMerge(data([a, b], { reconciliations: [rec('k1', '2')] }), a, [b])).toThrow(/reconciliations/)
    expect(planAccountMerge(data([a, b], { reconciliations: [rec('k1', '2')] }), b, [a]).moves.every(m => (m.coll as string) !== 'reconciliations')).toBe(true)
  })
  it('a paid-off account is active again when one of its copies is', () => {
    const keeper = acct('1', 'Loan', 'loan', { status: 'Paid off', bank_balance: 0 }); const other = acct('2', 'Loan', 'loan', { balance: 50 })
    expect(planAccountMerge(data([keeper, other]), keeper, [other]).keeperPatch).toMatchObject({ status: 'Active', balance: 50 })
  })

  it('accountLike: the account a new one would be a copy of', () => {
    const list = [acct('1', 'Flex Rent', 'line_of_credit', { status: 'Paid off' }), acct('2', 'Flex Rent', 'line_of_credit'), acct('3', 'Indigo', 'credit_card', { last4: '7409' })]
    expect(accountLike(list, { name: 'flex rent', kind: 'line_of_credit', institution: 'Flex Rent' })?.id).toBe('2')   // the active one
    expect(accountLike(list, { name: 'Indigo', kind: 'credit_card', last4: '7409' })?.id).toBe('3')
    expect(accountLike(list, { name: 'Indigo', kind: 'credit_card', last4: '1234' })).toBeNull()                       // another card from the same issuer
    expect(accountLike(list, { name: 'Indigo', kind: 'store_card' })).toBeNull()
    expect(accountLike(list, { name: 'Mission Lane', kind: 'credit_card' })).toBeNull()
    // never a guess between two cards: the exact last four wins over a blank one, and with no last four two numbered cards are ambiguous
    const cards = [acct('a', 'Visa', 'credit_card'), acct('b', 'Visa', 'credit_card', { last4: '1111' }), acct('c', 'Visa', 'credit_card', { last4: '2222' })]
    expect(accountLike(cards, { name: 'Visa', kind: 'credit_card', last4: '1111' })?.id).toBe('b')
    expect(accountLike(cards, { name: 'Visa', kind: 'credit_card', last4: '3333' })?.id).toBe('a')   // the one copy not numbered yet
    expect(accountLike(cards, { name: 'Visa', kind: 'credit_card' })).toBeNull()
    expect(accountLike([...cards, acct('d', 'Visa', 'credit_card')], { name: 'Visa', kind: 'credit_card', last4: '3333' })).toBeNull()
  })
})
