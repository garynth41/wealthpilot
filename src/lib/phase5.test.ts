// 0.21.0 — everyday money and alerts: paycheck allocation, rule tags / review / goals, "apply to earlier", the new alert rules and
// per-member routing.
import { describe, it, expect, beforeAll } from 'vitest'
import { setToday, addDays } from './dates'
import { scheduleFor, recentPaychecks, allocatePaycheck } from './allocate'
import { suggest, applySuggestion, planAutoCategorise, goalLinks, similarEarlier, REVIEW_TAG } from './rules'
import { computeAlerts, recipientsFor, DIGEST_NOTICES, type NInput } from './notify'
import { maskFileName } from './email/mail'
import { demoSeed } from '../app/data/demoSeed'
import type { Data, PayeeRule, Settings, Transaction } from '../app/data/types'
import { SETTINGS_DEFAULTS } from '../app/data/types'
import notifySource from './notify.ts?raw'
import notifyCopy from '../../supabase/functions/notify/notify.ts?raw'

const T0 = '2026-11-04'
beforeAll(() => setToday(T0))
const seed = () => { const s = demoSeed(); return { d: s.data, s: { ...SETTINGS_DEFAULTS, ...s.household.settings } as Settings } }
const txn = (o: Partial<Transaction>): Transaction => ({ id: 't' + Math.random().toString(36).slice(2), household_id: 'h', date: T0, kind: 'expense', amount: 10, account_id: null, category_id: null, payee: '', memo: '', tags: [], status: 'cleared', source: 'manual', exclude_from_budget: false, ...o } as Transaction)
const rule = (o: Partial<PayeeRule>): PayeeRule => ({ id: 'r' + Math.random().toString(36).slice(2), pattern: '', match: 'contains', enabled: true, ...o })

describe('paycheck allocation', () => {
  it('finds the pay schedule a deposit belongs to — by its link or by amount near a pay date', () => {
    const { d } = seed(); const ps = d.paySchedules[0]
    const linked = d.transactions.find(t => t.pay_schedule_id === ps.id)!; expect(scheduleFor(d, linked)?.id).toBe(ps.id)
    const unlinked = txn({ kind: 'income', amount: ps.net_amount + 12, date: linked.date, account_id: ps.deposit_account_id })
    expect(scheduleFor(d, unlinked)?.id).toBe(ps.id)
    expect(scheduleFor(d, txn({ kind: 'income', amount: 9999, date: linked.date }))).toBeNull()
    expect(scheduleFor(d, txn({ kind: 'expense', amount: ps.net_amount, date: linked.date }))).toBeNull()
  })
  it('lists paychecks that landed recently, newest first', () => {
    const { d } = seed(); expect(recentPaychecks(d, 3, T0)).toHaveLength(0)
    const r = recentPaychecks(d, 7, T0); expect(r.length).toBe(1); expect(r[0].pay_schedule_id).toBe(d.paySchedules[0].id)
    const all = recentPaychecks(d, 45, T0); expect(all.map(x => x.date)).toEqual([...all.map(x => x.date)].sort().reverse())
  })
  it('splits a paycheck into bills, payments, goals and everyday spending until the next payday, and what is left', () => {
    const { d, s } = seed(); const pay = recentPaychecks(d, 7, T0)[0]
    const a = allocatePaycheck(d, s, pay, T0)
    expect(a.amount).toBe(pay.amount); expect(a.nextPay).toBe(addDays(pay.date, 14)); expect(a.until).toBe(addDays(pay.date, 13)); expect(a.days).toBe(14)
    for (const l of a.lines.filter(l => l.date)) { expect(l.date! >= T0).toBe(true); expect(l.date! <= a.until).toBe(true) }   // nothing already behind us, nothing after the next payday
    const goals = a.lines.filter(l => l.group === 'goals'); expect(goals.map(g => g.label)).toEqual(expect.arrayContaining(['Emergency fund (6 months)', 'Spring break trip']))
    expect(goals.some(g => /Amex/.test(g.label))).toBe(false)   // a debt-payoff goal is a card payment, not a goal transfer
    const ef = goals.find(g => /Emergency/.test(g.label))!; expect(ef.amount).toBeCloseTo(300 / (26 / 12), 2)   // the monthly contribution shared across ~2.17 biweekly checks
    expect(a.lines.some(l => l.group === 'everyday')).toBe(true)
    const total = Object.values(a.byGroup).reduce((x, y) => x + y, 0); expect(total).toBeCloseTo(a.committed, 2)
    expect(a.leftover).toBeCloseTo(a.amount - a.committed, 2); expect(a.short).toBe(Math.max(0, +(a.committed - a.amount).toFixed(2)))
  })
  it("adds the applied plan's extra per paycheck", () => {
    const { d, s } = seed(); const pay = recentPaychecks(d, 7, T0)[0]
    const base = allocatePaycheck(d, s, pay, T0), withPlan = allocatePaycheck(d, { ...s, plan: { debtExtra: 260, retireExtra: 130 } as Settings['plan'] }, pay, T0)
    expect(withPlan.byGroup.plan).toBeCloseTo((260 + 130) / (26 / 12), 1); expect(withPlan.committed).toBeGreaterThan(base.committed)
  })
})

describe('payee rules: tags, review and goals', () => {
  const base = (): { d: Data; s: Settings } => { const { d, s } = seed(); return { d, s: { ...s, rules: [] } } }
  it('a rule adds its tags (lower-case) and the review tag, and keeps the tags already there', () => {
    const { d, s } = base(); s.rules = [rule({ pattern: 'venmo', tags: ['Shared', 'kids'], review: true })]
    const sg = suggest(d, s, { payee: 'VENMO *Sam', kind: 'expense' }); expect(sg.tags).toEqual(['shared', 'kids', REVIEW_TAG])
    expect(applySuggestion({ tags: ['kids', 'trip'] }, sg)?.tags).toEqual(['kids', 'trip', 'shared', REVIEW_TAG])
    expect(applySuggestion({ tags: ['shared', 'kids', REVIEW_TAG] }, { ...sg, category_id: undefined, account_id: undefined, exclude_from_budget: undefined })).toBeNull()
  })
  it('a goal rule marks transactions — transfers included — and the goal gets one contribution per transaction', () => {
    const { d, s } = base(); const g = d.goals.find(x => x.kind === 'emergency_fund')!
    s.rules = [rule({ pattern: 'to savings', goal_id: g.id })]
    const tr = txn({ kind: 'transfer', payee: 'Transfer to savings', amount: 150, category_id: 'already-set' }); d.transactions.push(tr)
    const plan = planAutoCategorise(d, s); const p = plan.find(x => x.t.id === tr.id)!
    expect(p.patch).toEqual({ goal_id: g.id })   // a transfer never gets a guessed category, only the rule's goal and tags
    const marked = { ...tr, ...p.patch }; expect(goalLinks(d, [marked])).toEqual([{ goal_id: g.id, date: tr.date, amount: 150, transaction_id: tr.id, notes: 'marked by a payee rule' }])
    d.contributions.push({ id: 'c1', household_id: 'h', goal_id: g.id, date: tr.date, amount: 150, transaction_id: tr.id })
    expect(goalLinks(d, [marked])).toEqual([])   // already logged
    expect(goalLinks(d, [{ ...marked, status: 'void' }, { ...marked, id: 'x', goal_id: 'no-such-goal' }])).toEqual([])
  })
  it('history and remembered payees never touch transfers', () => {
    const { d, s } = base(); const tr = txn({ kind: 'transfer', payee: 'Kroger' }); d.transactions.push(tr)
    expect(planAutoCategorise(d, s).some(x => x.t.id === tr.id)).toBe(false)
  })
  it('categorized rows are revisited only when a rule would add tags or a goal; re-run replaces what is there', () => {
    const { d, s } = base(); const k = d.transactions.find(t => /kroger/i.test(t.payee || '') && t.category_id)!
    s.rules = [rule({ pattern: 'kroger', category_id: 'other-cat' })]
    expect(planAutoCategorise(d, s).some(x => x.t.id === k.id)).toBe(false)
    expect(planAutoCategorise(d, s, { onlyUncategorised: false }).find(x => x.t.id === k.id)?.patch.category_id).toBe('other-cat')
    s.rules = [rule({ pattern: 'kroger', review: true })]
    expect(planAutoCategorise(d, s).find(x => x.t.id === k.id)?.patch).toEqual({ tags: [...(k.tags || []), REVIEW_TAG] })
  })
})

describe('apply to earlier transactions', () => {
  it('category: the same merchant in the last 12 months filed differently, newest first; nothing for an unknown payee', () => {
    const { d } = seed(); const ks = d.transactions.filter(t => /kroger/i.test(t.payee || '') && t.kind === 'expense').sort((a, b) => b.date.localeCompare(a.date)); const row = ks[0]
    const got = similarEarlier(d, row, 'category_id', row.payee, 'new-cat')
    expect(got.length).toBe(ks.length - 1); expect(got.every(t => t.id !== row.id && t.category_id !== 'new-cat')).toBe(true)
    expect(got.map(t => t.date)).toEqual([...got.map(t => t.date)].sort().reverse())
    expect(similarEarlier(d, { ...row, payee: '' }, 'category_id', '', 'new-cat')).toEqual([])
    const old = { ...ks[1], id: 'old', date: addDays(row.date, -400), category_id: null }; d.transactions.push(old)
    expect(similarEarlier(d, row, 'category_id', row.payee, 'new-cat').some(t => t.id === 'old')).toBe(false)   // older than 12 months
  })
  it('payee rename: exact old name only, not other spellings, and nothing when the name did not change', () => {
    const { d } = seed(); const a = txn({ payee: 'SQ *BLUE BOTTLE 123', date: '2026-10-01' }), b = txn({ payee: 'SQ *BLUE BOTTLE 123', date: '2026-09-01' }), c = txn({ payee: 'Blue Bottle', date: '2026-09-15' })
    d.transactions.push(a, b, c)
    expect(similarEarlier(d, a, 'payee', 'SQ *BLUE BOTTLE 123', 'Blue Bottle').map(t => t.id)).toEqual([b.id])
    expect(similarEarlier(d, a, 'payee', 'SQ *BLUE BOTTLE 123', 'sq *blue bottle 123')).toEqual([])
  })
})

describe('new alert rules', () => {
  const base = (over: Partial<NInput> = {}): NInput => ({ today: '2026-11-05', now: '2026-11-05T12:30:00Z', reserveFloor: 0, prefs: {}, sync: null, occurrences: [], paySchedules: [],
    accounts: [{ id: 'chk', name: 'Checking', kind: 'checking', status: 'Active', balance: 5000, include_in_cash: true, last_reconciled_on: '2026-10-20' }],
    recurring: [{ id: 'nf', name: 'Netflix', payee: 'Netflix', kind: 'subscription', amount: 15.49, frequency: 'monthly', day_of_month: 3, status: 'Active', autopay: true }], transactions: [], ...over })
  it('price rise: a subscription charged more than $1 and 5% over its listed amount', () => {
    const up = computeAlerts(base({ transactions: [{ id: 'x1', date: '2026-11-03', kind: 'expense', amount: 17.99, payee: 'NETFLIX.COM' }] })).filter(a => a.kind === 'price_rise')
    expect(up).toHaveLength(1); expect(up[0].key).toBe('price_rise:nf:x1'); expect(up[0].amount).toBeCloseTo(2.5, 2)
    expect(computeAlerts(base({ transactions: [{ id: 'x2', date: '2026-11-03', kind: 'expense', amount: 15.99, payee: 'NETFLIX.COM' }] })).some(a => a.kind === 'price_rise')).toBe(false)   // 50¢ is noise
    expect(computeAlerts(base({ recurring: [{ id: 'el', name: 'AEP', payee: 'AEP', kind: 'bill', amount: 100, amount_varies: true, frequency: 'monthly', status: 'Active', autopay: false }], transactions: [{ id: 'x3', date: '2026-11-03', kind: 'expense', amount: 160, payee: 'AEP' }] })).some(a => a.kind === 'price_rise')).toBe(false)   // a bill that varies never "goes up"
  })
  it('new repeating charge: the same merchant in each of the last three months, similar amounts, not on Bills', () => {
    const tx = (id: string, date: string, amount: number, payee = 'CALM.COM SUBSCRIPTION') => ({ id, date, kind: 'expense', amount, payee })
    const three = [tx('a', '2026-09-02', 14.99), tx('b', '2026-10-02', 14.99), tx('c', '2026-11-02', 14.99)]
    const n = computeAlerts(base({ transactions: three })).filter(a => a.kind === 'new_recurring'); expect(n).toHaveLength(1); expect(n[0].key).toMatch(/^new_recurring:.*:2026-11$/)
    expect(computeAlerts(base({ transactions: three.slice(1) })).some(a => a.kind === 'new_recurring')).toBe(false)   // only two months
    expect(computeAlerts(base({ transactions: [tx('a', '2026-09-02', 14.99), tx('b', '2026-10-02', 40), tx('c', '2026-11-02', 14.99)] })).some(a => a.kind === 'new_recurring')).toBe(false)   // amounts too different
    expect(computeAlerts(base({ transactions: three.map(t => ({ ...t, payee: 'Netflix' })) })).some(a => a.kind === 'new_recurring')).toBe(false)   // already a bill
  })
  it('reconcile: weekly after 35 days, once for a bank-fed account never reconciled', () => {
    const due = computeAlerts(base({ today: '2026-11-30' })).filter(a => a.kind === 'reconcile'); expect(due).toHaveLength(1); expect(due[0].key).toBe('reconcile:chk:5')
    expect(computeAlerts(base()).some(a => a.kind === 'reconcile')).toBe(false)
    const never = computeAlerts(base({ accounts: [{ id: 'sv', name: 'Savings', kind: 'savings', status: 'Active', balance: 100, bank_balance: 100, include_in_cash: true, created_at: '2026-08-01T00:00:00Z' }] })).filter(a => a.kind === 'reconcile')
    expect(never.map(a => a.key)).toEqual(['reconcile:sv:never'])
  })
  it('each new rule can be switched off, and all three are listed in the digest', () => {
    const inp = base({ today: '2026-11-30', prefs: { reconcile: false } }); expect(computeAlerts(inp).some(a => a.kind === 'reconcile')).toBe(false)
    expect(DIGEST_NOTICES).toEqual(['price_rise', 'new_recurring', 'reconcile', 'revalue'])
  })
  it('the edge function runs the same rules (engine copy is identical)', () => { expect(notifyCopy).toBe(notifySource) })
})

describe('who gets what', () => {
  const members = [{ user_id: 'u1', email: 'gary@x.com', role: 'owner' }, { user_id: 'u2', email: 'sam@x.com', role: 'editor' }]
  it('no member settings: everyone gets push, the household address gets email', () => {
    expect(recipientsFor({ push: true, email: true }, members, 'bill_due')).toEqual({ push: ['u1', 'u2'], email: [{ to: 'gary@x.com', user_id: null }] })
    expect(recipientsFor({ push: true, email: true, email_to: 'Home@X.com' }, members, 'bill_due').email).toEqual([{ to: 'home@x.com', user_id: null }])
    expect(recipientsFor({ push: false, email: false }, members, 'bill_due')).toEqual({ push: [], email: [] })
  })
  it('member choices win: own address, push off, only some alerts, no digest', () => {
    const prefs = { push: true, email: true, members: { u2: { email: true, email_to: 'sam@work.com', push: false, kinds: ['low_cash'], digest: false } } }
    expect(recipientsFor(prefs, members, 'bill_due')).toEqual({ push: ['u1'], email: [] })   // Sam only wants low cash; the household address is not used once a member picked email
    expect(recipientsFor(prefs, members, 'low_cash')).toEqual({ push: ['u1'], email: [{ to: 'sam@work.com', user_id: 'u2' }] })
    expect(recipientsFor(prefs, members, 'digest')).toEqual({ push: ['u1'], email: [] })
  })
  it('the same address is emailed once', () => {
    const prefs = { email: true, members: { u1: { email: true, email_to: 'family@x.com' }, u2: { email: true, email_to: 'FAMILY@x.com' } } }
    expect(recipientsFor(prefs, members, 'sync').email).toEqual([{ to: 'family@x.com', user_id: 'u1' }])
  })
})

describe('statement PDFs from email', () => {
  it('long digit runs in a file name are masked to the last four', () => {
    expect(maskFileName('Statement_4111222233334444_Oct.pdf')).toBe('Statement_••4444_Oct.pdf')
    expect(maskFileName('Acct 1234 5678 9012.pdf')).toBe('Acct ••9012.pdf')
    expect(maskFileName('eStmt_2026-10-31.pdf')).toBe('eStmt_2026-10-31.pdf')
  })
})
