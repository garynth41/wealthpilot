// 0.25.1 — privacy and integrity fixes from the security review: email capture never keeps a full account number and never invents
// a minimum payment.
import { describe, it, expect, beforeAll } from 'vitest'
import { setToday } from './dates'
import { extract, maskDigits, type Fact } from './email/extract'
import type { Msg } from './email/text'

beforeAll(() => setToday('2026-11-04'))
const msg = (id: string, from: string, subject: string, body: string, date = '2026-11-02'): Msg => ({ id, date: new Date(date + 'T12:00:00'), from: { name: '', email: from }, subject, body, sent: false })

describe('email capture keeps only the last four digits', () => {
  it('masks an account number that ends up inside a payee, merchant or payer name', () => {
    expect(maskDigits('Acme Water account 4400123456')).toBe('Acme Water account ••3456')
    const f = extract(msg('a', 'billing@acmewater.com', 'Payment confirmation for Acme Water account 4400123456', 'Thank you. Your payment of $61.20 was received on Nov 1, 2026.')) as Fact
    expect(JSON.stringify([f.payee, f.merchant])).not.toMatch(/\d{5,}/)
  })
})
describe('a payment email does not invent the next minimum payment', () => {
  it('takes the next due date but not the remaining balance as the amount', () => {
    const f = extract(msg('b', 'alerts@citi.com', 'Thank you for your payment', 'We received your payment of $200.00 on Nov 1, 2026 for account ending 4821. Your current balance is $1,840.12. Your next payment is due on 12/23/2026.')) as Fact
    expect(f.amount).toBe(200); expect(f.nextAmt ?? null).toBeNull()
  })
  it('still uses a next payment amount the email states', () => {
    const f = extract(msg('c', 'alerts@citi.com', 'Thank you for your payment', 'We received your payment of $200.00 on Nov 1, 2026 for account ending 4821. Your next payment of $35.00 will be due on Dec 23, 2026.')) as Fact
    expect(f.nextAmt).toBe(35)
  })
})
