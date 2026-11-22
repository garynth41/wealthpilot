import { describe, it, expect } from 'vitest'
import { nameParts, acctTitle, acctLabel } from './accounts'
import type { Account } from '../app/data/types'

const A = (name: string, last4: string | null = null, over: Partial<Account> = {}) => ({ id: 'id-' + name + (last4 || ''), ref: 'A-1', name, last4, kind: 'checking', status: 'Active', ...over }) as unknown as Account

describe('account names say the last four digits once, at the end, in brackets (0.38.1)', () => {
  it('takes every mention of the digits out of a name the bank or the owner wrote them into', () => {
    for (const [name, l4, want] of [
      ['Adv Plus Banking- 0224 (0224)', '0224', 'Adv Plus Banking (0224)'],
      ['Advantage Savings- 0253 (0253)', '0253', 'Advantage Savings (0253)'],
      ['Gary Checking … (4019)', '4019', 'Gary Checking (4019)'],
      ['Gary Premier Savings ... (4958)', '4958', 'Gary Premier Savings (4958)'],
      ['Adv Plus Banking(0224)', '0224', 'Adv Plus Banking (0224)'],
      ['Gary Checking (4019)', '4019', 'Gary Checking (4019)'],
      ['Total Checking (x4821)', '4821', 'Total Checking (4821)'],
      ['Freedom Card ...7710', '7710', 'Freedom Card (7710)'],
      ['Savings ••4958', '4958', 'Savings (4958)'],
      ['Visa ending in 0042', '0042', 'Visa (0042)'],
      ['Card *9911 Rewards', '9911', 'Card Rewards (9911)'],
      ['Amex 1007', '1007', 'Amex (1007)'],
    ] as const) expect(acctTitle(name, l4), name).toBe(want)
  })
  it('adds the digits to a name that does not have them, and leaves a name alone when there are none', () => {
    expect(acctTitle('Indigo', '7409')).toBe('Indigo (7409)')
    expect(acctTitle('Student loan', null)).toBe('Student loan')
    expect(acctTitle('Online Savings', '')).toBe('Online Savings')
  })
  it('reads digits the name marks when the field is empty, and never takes a bare number for an account number', () => {
    expect(acctTitle('Adv Plus Banking(0224)', null)).toBe('Adv Plus Banking (0224)')
    expect(acctTitle('Freedom Card ...7710')).toBe('Freedom Card (7710)')
    expect(acctTitle('Roth IRA 2024', null)).toBe('Roth IRA 2024')
    expect(nameParts('Roth IRA 2024', null)).toEqual({ base: 'Roth IRA 2024', l4: '' })
  })
  it('keeps other numbers in the name, and a name that is only the digits', () => {
    expect(acctTitle('Roth IRA 2024 (5555)', '5555')).toBe('Roth IRA 2024 (5555)')
    expect(acctTitle('Account 12340224', '0224')).toBe('Account 12340224 (0224)')   // a longer run is another number
    expect(acctTitle('0224', '0224')).toBe('0224')
    expect(acctTitle('(0224)', '0224')).toBe('(0224)')
    expect(acctTitle('Joint', 'AB12')).toBe('Joint (AB12)')   // letters in the field: shown as typed, nothing taken out
  })
  it('acctLabel tidies a name that carries its digits and leaves other names as they are', () => {
    const all = [A('Adv Plus Banking(0224)', '0224'), A('Gary Checking (4019)', '4019'), A('Indigo', '7409'), A('Student loan')]
    expect(all.map(a => acctLabel(a, all))).toEqual(['Adv Plus Banking (0224)', 'Gary Checking (4019)', 'Indigo', 'Student loan'])
  })
  it('acctLabel tells two accounts with one name apart by their digits, in brackets, or by their reference', () => {
    const cards = [A('Visa', '1111'), A('Visa', '2222')]
    expect(cards.map(a => acctLabel(a, cards))).toEqual(['Visa (1111)', 'Visa (2222)'])
    const cars = [A('Car', null, { id: 'aaaa1', ref: 'A-7' }), A('Car', null, { id: 'bbbb2', ref: 'A-8' })]
    expect(cars.map(a => acctLabel(a, cars))).toEqual(['Car (A-7)', 'Car (A-8)'])
  })
})
