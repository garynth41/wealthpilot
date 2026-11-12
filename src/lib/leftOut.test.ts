import { describe, expect, it } from 'vitest'
import { emptyData, type Account, type Data, type Transaction } from '../app/data/types'
import { leaveOut, isOffTxn, unpairForLeavingOut, leftOutSummary, everyAccount } from './leftOut'
import { accountLookup, flowOf } from './budget'
import { planDedupe, type DTxn } from './dedupe'
import { splitDups, toView } from '../app/store'

const acct = (id: string, kind: Account['kind'], extra: Partial<Account> = {}): Account => ({ id, household_id: 'h', name: id, kind, balance: 0, apr: 0, minimum_payment: 0, autopay: false, include_in_cash: true, include_in_net_worth: true, status: 'Active', sort_order: 0, ...extra })
let n = 0
const tx = (p: Partial<Transaction>): Transaction => ({ id: 't' + ++n, household_id: 'h', date: '2026-11-03', kind: 'expense', amount: 10, tags: [], status: 'cleared', source: 'import', exclude_from_budget: false, ...p })
const base = (): Data => ({ ...emptyData(), accounts: [acct('mine', 'checking'), acct('save', 'savings'), acct('son', 'checking', { excluded: true }), acct('card', 'credit_card')], categories: [{ id: 'c-move', household_id: 'h', name: 'Transfer', kind: 'transfer', priority: 'Important', cost_type: 'Variable', default_budget: 0, budget_cadence: 'period', rollover: false, sort_order: 0, archived: false }, { id: 'c-food', household_id: 'h', name: 'Food', kind: 'expense', priority: 'Essential', cost_type: 'Variable', default_budget: 0, budget_cadence: 'period', rollover: false, sort_order: 1, archived: false }] })

describe('leaving an account out of the figures', () => {
  it('nothing left out: the data comes back untouched', () => { const d = { ...base(), accounts: [acct('mine', 'checking')] }; expect(leaveOut(d)).toBe(d) })

  it('takes the account and the rows that sit only on it off every list', () => {
    const d = base()
    d.transactions = [tx({ id: 'a', account_id: 'mine' }), tx({ id: 'b', account_id: 'son' }), tx({ id: 'c', kind: 'income', account_id: 'son', amount: 500 }), tx({ id: 'd', kind: 'transfer', account_id: 'mine', to_account_id: 'son' }), tx({ id: 'e', kind: 'transfer', account_id: 'son', to_account_id: 'mine' }), tx({ id: 'f', kind: 'transfer', account_id: null, to_account_id: 'son' })]
    d.duplicates = [tx({ id: 'g', account_id: 'son', duplicate_of: 'b' }), tx({ id: 'h', account_id: 'mine', duplicate_of: 'a' })]
    d.balances = [{ id: 'b1', household_id: 'h', account_id: 'son', as_of: '2026-11-01', balance: 5, bank_balance: 5, source: 'bank' }, { id: 'b2', household_id: 'h', account_id: 'mine', as_of: '2026-11-01', balance: 5, bank_balance: 5, source: 'bank' }]
    const v = leaveOut(d)
    expect(v.accounts.map(a => a.id)).toEqual(['mine', 'save', 'card'])
    expect(v.transactions.map(t => t.id)).toEqual(['a', 'd', 'e'])            // its own rows are gone; transfers with a counted account stay
    expect(v.duplicates.map(t => t.id)).toEqual(['h'])
    expect(v.balances.map(b => b.id)).toEqual(['b2'])
    expect(v.off!.accounts.map(a => a.id)).toEqual(['son'])
    expect(v.off!.transactions.map(t => t.id)).toEqual(['b', 'c', 'f'])
    expect(v.off!.duplicates.map(t => t.id)).toEqual(['g'])
    expect(everyAccount(v).map(a => a.id).sort()).toEqual(['card', 'mine', 'save', 'son'])
    expect(d.transactions).toHaveLength(6)                                    // the loaded data is not changed
  })

  it('bills, income and goals that live on the account go with it; a bill you pay toward it stays', () => {
    const d = base()
    d.recurring = [{ id: 'r1', account_id: 'son' }, { id: 'r2', account_id: 'mine', liability_account_id: 'son' }, { id: 'r3', account_id: null, liability_account_id: 'son' }, { id: 'r4', account_id: 'mine' }] as never
    d.paySchedules = [{ id: 'p1', deposit_account_id: 'son' }, { id: 'p2', deposit_account_id: 'mine' }] as never
    d.goals = [{ id: 'g1', account_id: 'son' }, { id: 'g2', account_id: 'save' }] as never
    const v = leaveOut(d)
    expect(v.recurring.map(r => r.id)).toEqual(['r2', 'r4']); expect(v.off!.recurring.map(r => r.id)).toEqual(['r1', 'r3'])
    expect(v.paySchedules.map(r => r.id)).toEqual(['p2']); expect(v.goals.map(r => r.id)).toEqual(['g2'])
  })

  it('is what the store shows: merged copies split first, then the left-out account', () => {
    const d = base(); d.transactions = [tx({ id: 'a', account_id: 'mine' }), tx({ id: 'b', account_id: 'son' }), tx({ id: 'c', account_id: 'mine', duplicate_of: 'a' })]
    const v = toView(d)
    expect(v.transactions.map(t => t.id)).toEqual(['a']); expect(v.duplicates.map(t => t.id)).toEqual(['c']); expect(v.off!.transactions.map(t => t.id)).toEqual(['b'])
    expect(splitDups(d).accounts).toHaveLength(4)
  })

  it('isOffTxn: only rows with no counted account on them', () => {
    const off = new Set(['son', 'son2'])
    expect(isOffTxn({ account_id: 'son', to_account_id: null }, off)).toBe(true)
    expect(isOffTxn({ account_id: 'son', to_account_id: 'son2' }, off)).toBe(true)
    expect(isOffTxn({ account_id: null, to_account_id: 'son' }, off)).toBe(true)
    expect(isOffTxn({ account_id: 'son', to_account_id: 'mine' }, off)).toBe(false)
    expect(isOffTxn({ account_id: 'mine', to_account_id: 'son' }, off)).toBe(false)
    expect(isOffTxn({ account_id: null, to_account_id: null }, off)).toBe(false)
  })
})

describe('transfers across the line', () => {
  // the bank's two rows of one transfer, paired by the duplicate engine: the out row is kept as the transfer, the in row is merged into it
  const paired = (from: string, to: string, extra: Partial<Transaction> = {}) => { const k = tx({ kind: 'transfer', account_id: from, to_account_id: to, amount: 100, payee: 'Zelle payment to Gavionne', external_id: 'sfin:a:' + ++n, ...extra }); const dup = tx({ kind: 'income', account_id: to, amount: 100, payee: 'Zelle from Gary', external_id: 'sfin:b:' + ++n, duplicate_of: k.id }); return { k, dup } }

  it('switching the account off takes each paired transfer apart: the counted side reads as the bank reported it', () => {
    const d = { ...base(), accounts: base().accounts.map(a => ({ ...a, excluded: false })) }
    const out = paired('mine', 'son', { category_id: 'c-move' }), back = paired('son', 'mine', { category_id: 'c-food' }), own = paired('mine', 'save'), typed = tx({ kind: 'transfer', account_id: 'mine', to_account_id: 'son', source: 'manual' })
    d.transactions = [out.k, back.k, own.k, typed]; d.duplicates = [out.dup, back.dup, own.dup]
    const plan = unpairForLeavingOut(d, 'son')
    expect(plan).toEqual([
      { keeper: out.k.id, restore: out.dup.id, patch: { kind: 'expense', to_account_id: null, category_id: null } },   // a transfer category does not describe spending: cleared, to be filed
      { keeper: back.k.id, restore: back.dup.id, patch: { kind: 'expense', to_account_id: null } },                     // a real category is kept
    ])
    expect(plan.every(u => !('dedupe_ok' in u.patch))).toBe(true)   // not marked "not a duplicate": counted again, they pair again
    expect(leftOutSummary(d, 'son')).toMatchObject({ pairs: 2, crossing: 3, txns: 0 })
    // applied, then viewed with the account off: money out on my account, money in on my account, the rest off the books
    const after: Data = { ...d, accounts: d.accounts.map(a => (a.id === 'son' ? { ...a, excluded: true } : a)), transactions: [{ ...out.k, ...plan[0].patch }, { ...back.k, ...plan[1].patch }, own.k, typed, { ...out.dup, duplicate_of: null }, { ...back.dup, duplicate_of: null }] as Transaction[], duplicates: [own.dup] }
    const v = leaveOut(after)
    expect(v.transactions.map(t => `${t.kind}:${t.account_id}>${t.to_account_id ?? ''}`).sort()).toEqual(['expense:mine>', 'income:mine>', 'transfer:mine>save', 'transfer:mine>son'])
    expect(v.off!.transactions.map(t => `${t.kind}:${t.account_id}`).sort()).toEqual(['expense:son', 'income:son'])
  })

  it('the duplicate engine does not pair across the line while the account is off, and pairs again when it is back', () => {
    const rows = [tx({ id: 'o', kind: 'expense', account_id: 'mine', amount: 100, payee: 'Online banking transfer to Gavionne', external_id: 'sfin:a:1' }), tx({ id: 'i', kind: 'income', account_id: 'son', amount: 100, payee: 'Online banking transfer from Gary', external_id: 'sfin:b:1' })] as unknown as DTxn[]
    const accounts = base().accounts
    expect(planDedupe(rows, accounts.filter(a => !a.excluded)).auto).toHaveLength(0)
    expect(planDedupe(rows, accounts.map(a => ({ ...a, excluded: false }))).auto).toEqual([expect.objectContaining({ keeper: 'o', dups: ['i'], patch: expect.objectContaining({ kind: 'transfer', to_account_id: 'son' }) })])
  })

  it('a transfer typed across the line is spending (out) or income (back) to the budget', () => {
    const v = leaveOut(base()); const look = accountLookup(v)
    expect(flowOf({ kind: 'transfer', account_id: 'mine', to_account_id: 'son' }, look)).toBe('spend')
    expect(flowOf({ kind: 'transfer', account_id: 'son', to_account_id: 'mine' }, look)).toBe('income')
    expect(flowOf({ kind: 'transfer', account_id: 'son', to_account_id: 'card' }, look)).toBe('card')   // a payment onto my card is still a card payment
    expect(flowOf({ kind: 'transfer', account_id: 'mine', to_account_id: 'save' }, look)).toBe('save')
    expect(flowOf({ kind: 'transfer', account_id: 'mine', to_account_id: 'gone' }, look)).toBe('move')  // an unknown account is not a left-out one
  })
})

describe('demo ids after a reload (0.28.0)', () => {
  it('a row added after the saved demo is loaded never reuses an id already in it', async () => {
    const { demoId, demoIdsAfter } = await import('../app/data/demoSeed')
    const taken = ['d00zzz', 'd0a000', 'not-one', null, 'd00001']; demoIdsAfter(taken)
    const next = demoId(); expect(taken).not.toContain(next); expect(parseInt(next.slice(1), 36)).toBeGreaterThan(parseInt('0a000', 36))
  })
})
