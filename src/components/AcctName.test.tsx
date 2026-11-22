import { describe, it, expect } from 'vitest'
import { acctNameNode } from './AcctName'
import { textOf } from './Table'

describe('the account name cell keeps its text for search and file exports (0.38.1)', () => {
  it('reads as "Name (1234)" — one space, the digits once', () => {
    expect(textOf(acctNameNode('Adv Plus Banking(0224)', '0224'))).toBe('Adv Plus Banking (0224)')
    expect(textOf(acctNameNode('Gary Checking … (4019)', '4019'))).toBe('Gary Checking (4019)')
    expect(textOf(acctNameNode('Indigo', '7409'))).toBe('Indigo (7409)')
  })
  it('an account with no digits reads as its name alone', () => { expect(textOf(acctNameNode('Student loan', null))).toBe('Student loan') })
})
