// 0.38.0 — Leave out on a bill (status Paused): it is in no due list, total or forecast, and a card or loan it pays does not bring
// the payment back through the account's own planned payment.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { demoSeed } from '../app/data/demoSeed'
import type { Data, Recurring } from '../app/data/types'
import { accountPaymentsDue, cashCalendar } from './forecast'
import { commitments } from './budget'
import { upcoming, recActive, hasPaymentItem } from './recurring'
import { liabilities, debtPlanned } from './accounts'
import { SETTINGS_DEFAULTS } from '../app/data/types'
import { setToday, addDays } from './dates'

beforeAll(() => setToday('2026-11-10')); afterAll(() => setToday(null))
const base = () => demoSeed().data
const withStatus = (d: Data, id: string, status: Recurring['status']): Data => ({ ...d, recurring: d.recurring.map(r => (r.id === id ? { ...r, status } : r)) })
const to = addDays('2026-11-10', 60)

describe('a bill that is left out', () => {
  it('drops out of bills due, monthly commitments and the cash forecast — and comes back when it is counted again', () => {
    const d = base(); const bill = recActive(d).find(r => r.kind === 'bill' && !r.liability_account_id && +r.amount > 0)!
    const due = (x: Data) => upcoming(x, '2026-11-10', to).filter(u => u.r.id === bill.id).length, inCal = (x: Data) => cashCalendar(x, SETTINGS_DEFAULTS, 60).items.filter(e => e.id === bill.id).length
    expect(due(d)).toBeGreaterThan(0); expect(inCal(d)).toBeGreaterThan(0)
    const out = withStatus(d, bill.id, 'Paused')
    expect(due(out)).toBe(0); expect(inCal(out)).toBe(0); expect(commitments(out).total).toBeLessThan(commitments(d).total)
    expect(due(withStatus(out, bill.id, 'Active'))).toBe(due(d))
  })
  it('a card or loan payment that is left out is not replaced by the account\'s own planned payment', () => {
    const d = base(); const linked = recActive(d).find(r => !!r.liability_account_id && liabilities(d).some(a => a.id === r.liability_account_id && debtPlanned(a) > 0 && !!a.due_date))
    // the sample household may pay its cards through account payments only: give one account a payment item of its own
    const acct = linked ? liabilities(d).find(a => a.id === linked.liability_account_id)! : liabilities(d).find(a => debtPlanned(a) > 0 && !!a.due_date)!
    const item: Recurring = linked || ({ ...d.recurring[0], id: 'pay-item', name: `${acct.name} payment`, kind: 'debt_payment', amount: debtPlanned(acct), liability_account_id: acct.id, status: 'Active' } as Recurring)
    const withItem: Data = linked ? d : { ...d, recurring: [...d.recurring, item] }
    const acctDue = (x: Data) => accountPaymentsDue(x, '2026-11-10', to).filter(p => p.a.id === acct.id).length
    expect(hasPaymentItem(withItem, acct.id)).toBe(true); expect(acctDue(withItem)).toBe(0)   // the bill carries the payment
    const out = withStatus(withItem, item.id, 'Paused')
    expect(acctDue(out)).toBe(0)                                                               // left out: the account does not bring it back
    expect(commitments(out).accountPayments).toBe(commitments(withItem).accountPayments); expect(commitments(out).total).toBeLessThan(commitments(withItem).total)
    expect(cashCalendar(out, SETTINGS_DEFAULTS, 60).items.filter(e => e.id === acct.id || e.id === item.id)).toEqual([])
    // cancelled, or no item at all: the account speaks for itself again
    const gone = withStatus(withItem, item.id, 'Cancelled')
    expect(hasPaymentItem(gone, acct.id)).toBe(false); expect(acctDue(gone)).toBeGreaterThan(0)
    expect(acctDue({ ...withItem, recurring: withItem.recurring.filter(r => r.id !== item.id) })).toBeGreaterThan(0)
  })
})
