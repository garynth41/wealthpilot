import { describe, it, expect } from 'vitest'
import { computeAlerts, computeDigest, dueDatesN, payDatesN, type NInput } from './notify'

const base = (over: Partial<NInput> = {}): NInput => ({ today: '2026-11-05', now: '2026-11-05T12:30:00Z', reserveFloor: 3000, prefs: {}, sync: null,
  accounts: [{ id: 'chk', name: 'Checking', kind: 'checking', status: 'Active', balance: 5000, bank_balance: 5200, include_in_cash: true }, { id: 'cc', name: 'Card', kind: 'credit_card', status: 'Active', balance: 800, include_in_cash: false }],
  recurring: [{ id: 'r1', name: 'AEP Ohio', kind: 'bill', amount: 150, frequency: 'monthly', day_of_month: 6, next_due: '2026-11-06', status: 'Active', autopay: false }, { id: 'r2', name: 'Netflix', kind: 'subscription', amount: 15.49, frequency: 'monthly', day_of_month: 22, next_due: '2026-10-22', status: 'Active', autopay: false }],
  occurrences: [], transactions: [], paySchedules: [{ id: 'p1', name: 'NetJets', frequency: 'biweekly', anchor_date: '2026-11-04', net_amount: 2865, status: 'Active' }], ...over })

describe('alert rules', () => {
  it('a bill due tomorrow and an unpaid one from last month; paying it (occurrence or transaction) clears it', () => {
    const a = computeAlerts(base({ transactions: [{ id: 'oct', date: '2026-10-07', kind: 'expense', amount: 148, payee: 'AEP OHIO ELECTRIC' }] }))   // October's AEP was paid by payee + close amount
    expect(a.map(x => x.kind)).toContain('bill_due'); expect(a.find(x => x.kind === 'bill_due')!.title).toMatch(/AEP Ohio is due tomorrow/)
    expect(a.filter(x => x.kind === 'bill_overdue').map(x => x.title)).toEqual(['Netflix is 14 days overdue'])
    const paid = computeAlerts(base({ occurrences: [{ recurring_id: 'r2', due_date: '2026-10-22', status: 'paid' }], transactions: [{ id: 't', date: '2026-11-05', kind: 'expense', amount: 150, recurring_id: 'r1' }, { id: 'oct', date: '2026-10-07', kind: 'expense', amount: 148, payee: 'AEP OHIO ELECTRIC' }] }))
    expect(paid.some(x => x.kind === 'bill_overdue' || x.kind === 'bill_due')).toBe(false)
  })
  it('low cash: below the floor, or bills in 7 days exceed cash; keys carry the day so a repeat is deduplicated', () => {
    const low = computeAlerts(base({ accounts: [{ id: 'chk', name: 'Checking', kind: 'checking', status: 'Active', balance: 2000, bank_balance: null, include_in_cash: true }] }))
    expect(low.find(x => x.kind === 'low_cash')!.key).toBe('low_cash:floor:2026-11-05')
    const tight = computeAlerts(base({ reserveFloor: 0, accounts: [{ id: 'chk', name: 'Checking', kind: 'checking', status: 'Active', balance: 100, include_in_cash: true }] }))
    expect(tight.find(x => x.kind === 'low_cash')!.title).toMatch(/exceed cash/)
    expect(computeAlerts(base()).some(x => x.kind === 'low_cash')).toBe(false)
  })
  it('large charges arriving in the last day; the paycheck rule fires only after the pay date has passed without income', () => {
    const big = computeAlerts(base({ transactions: [{ id: 'x', date: '2026-11-05', kind: 'expense', amount: 640, payee: 'Best Buy', created_at: '2026-11-05T09:00:00Z' }, { id: 'old', date: '2026-10-20', kind: 'expense', amount: 900, created_at: '2026-10-20T09:00:00Z' }] }))
    expect(big.filter(x => x.kind === 'large_charge')).toHaveLength(1); expect(big.find(x => x.kind === 'large_charge')!.title).toMatch(/Best Buy/)
    expect(computeAlerts(base({ prefs: { large: 1000 }, transactions: [{ id: 'x', date: '2026-11-05', kind: 'expense', amount: 640, created_at: '2026-11-05T09:00:00Z' }] })).some(x => x.kind === 'large_charge')).toBe(false)
    const pay = computeAlerts(base()); expect(pay.find(x => x.kind === 'paycheck')!.body).toMatch(/2026-11-04/)
    const got = computeAlerts(base({ transactions: [{ id: 'i', date: '2026-11-04', kind: 'income', amount: 2860 }] })); expect(got.some(x => x.kind === 'paycheck')).toBe(false)
  })
  it('sync errors and stale feeds; preferences switch rules off; crit sorts first', () => {
    const s = computeAlerts(base({ sync: { status: 'error', last_sync_at: '2026-11-05T10:00:00Z', last_error: 'SimpleFIN 403' } })); expect(s.find(x => x.kind === 'sync')!.body).toMatch(/403/)
    const stale = computeAlerts(base({ sync: { status: 'connected', last_sync_at: '2026-11-01T10:00:00Z' } })); expect(stale.find(x => x.kind === 'sync')!.title).toMatch(/3 days/)
    const off = computeAlerts(base({ prefs: { bills: false, paycheck: false, sync: false, low_cash: false, large: 0 }, sync: { status: 'error', last_sync_at: null } })); expect(off).toHaveLength(0)
    const all = computeAlerts(base()); expect(all[0].severity).toBe('crit')
  })
  it('due-date and pay-date generators match the app rules for monthly, biweekly, semimonthly and every-2-months items', () => {
    expect(dueDatesN({ id: 'a', name: 'a', kind: 'bill', amount: 1, frequency: 'monthly', day_of_month: 31, status: 'Active', autopay: false }, '2026-11-01', '2027-02-28')).toEqual(['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28'])
    expect(dueDatesN({ id: 'b', name: 'b', kind: 'bill', amount: 1, frequency: 'biweekly', next_due: '2026-11-06', status: 'Active', autopay: false }, '2026-11-01', '2026-12-05')).toEqual(['2026-11-06', '2026-11-20', '2026-12-04'])
    expect(dueDatesN({ id: 'c', name: 'c', kind: 'bill', amount: 1, frequency: 'semimonthly', day_of_month: 1, status: 'Active', autopay: false }, '2026-11-01', '2026-11-30')).toEqual(['2026-11-01', '2026-11-16'])
    expect(dueDatesN({ id: 'd', name: 'd', kind: 'bill', amount: 1, frequency: 'every_2_months', next_due: '2026-11-10', status: 'Active', autopay: false }, '2026-11-01', '2027-03-31')).toEqual(['2026-11-10', '2027-01-10', '2027-03-10'])
    expect(payDatesN({ id: 'p', name: 'p', frequency: 'semimonthly', anchor_date: '2026-01-15', semimonthly_days: [15, 30], net_amount: 1, status: 'Active' }, '2026-02-01', '2026-02-28')).toEqual(['2026-02-15', '2026-02-28'])
    expect(payDatesN({ id: 'p', name: 'p', frequency: 'biweekly', anchor_date: '2026-11-04', net_amount: 1, status: 'Active' }, '2026-11-10', '2026-12-05')).toEqual(['2026-11-18', '2026-12-02'])
    expect(payDatesN({ id: 'p', name: 'p', frequency: 'monthly', anchor_date: '2026-01-31', net_amount: 1, status: 'Active' }, '2026-02-01', '2026-03-31')).toEqual(['2026-02-28', '2026-03-31'])
  })
  it('the weekly digest: cash, what is due this week, last week vs the week before, top payees', () => {
    const d = computeDigest({ today: '2026-11-09', reserveFloor: 3000, accounts: base().accounts, recurring: base().recurring, occurrences: [], transactions: [{ id: '1', date: '2026-11-03', kind: 'expense', amount: 120, payee: 'Kroger' }, { id: '2', date: '2026-11-05', kind: 'expense', amount: 80, payee: 'Shell' }, { id: '3', date: '2026-10-28', kind: 'expense', amount: 300 }, { id: '4', date: '2026-11-04', kind: 'income', amount: 2865 }] })
    expect(d.cash).toBe(5200); expect(d.lastWeek).toBe(200); expect(d.priorWeek).toBe(300); expect(d.income).toBe(2865); expect(d.topPayees[0]).toEqual(['Kroger', 120])
    expect(d.overdue.map(o => o.name)).toContain('Netflix'); expect(d.week.every(w => w.due >= '2026-11-09' && w.due <= '2026-11-15')).toBe(true); expect(d.safeThisWeek).toBe(Math.max(0, 5200 - d.dueTotal - 3000))
  })
})

import engineSource from './notify.ts?raw'
import functionCopy from '../../supabase/functions/notify/notify.ts?raw'
it('the notify function carries an identical copy of the alert rules (npm run engines:sync)', () => { expect(functionCopy).toBe(engineSource) })
