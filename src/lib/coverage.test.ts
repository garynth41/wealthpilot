import { describe, it, expect } from 'vitest'
import { ytdCoverage, monthLabel } from './coverage'
import { emptyData, type Account, type Transaction } from '../app/data/types'

const acct = (id: string, name: string): Account => ({ id, name, kind: 'checking', status: 'Active', balance: 0, sort_order: 0 } as unknown as Account)
const tx = (id: string, account_id: string, date: string, extra: Partial<Transaction> = {}): Transaction => ({ id, account_id, date, kind: 'expense', amount: 10, status: 'cleared', source: 'import', tags: [], exclude_from_budget: false, ...extra } as Transaction)

describe('year-to-date coverage', () => {
  it('marks months before the first transaction as never loaded, later empty months as quiet, and a late first day as a partial month', () => {
    const d = { ...emptyData(), accounts: [acct('A', 'Checking'), acct('B', 'Card')], transactions: [tx('1', 'A', '2026-08-06'), tx('2', 'A', '2026-09-03'), tx('3', 'A', '2026-11-02'), tx('4', 'A', '2026-08-07', { duplicate_of: '1' })] }
    const c = ytdCoverage(d, '2026-11-03')
    expect(c.months).toHaveLength(11); expect(monthLabel(c.months[0])).toBe('Jan')
    const a = c.rows.find(r => r.accountId === 'A')!
    expect(a.months.slice(0, 7).every(m => m.state === 'missing')).toBe(true)
    expect(a.months.map(m => m.n)).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1])   // the duplicate on Aug 7 is not counted
    expect(a.months[9].state).toBe('quiet')
    expect(a.missing).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08 (before Aug 6)'])
    expect(c.rows.find(r => r.accountId === 'B')!.months.every(m => m.state === 'missing')).toBe(true)
    expect(c.complete).toBe(false); expect(c.firstOnFile).toBe('2026-08-06'); expect(c.missingAccounts).toBe(2)
  })
  it('is complete when every account with data reaches back to early January', () => {
    const d = { ...emptyData(), accounts: [acct('A', 'Checking')], transactions: [tx('1', 'A', '2026-01-02'), tx('2', 'A', '2026-03-10')] }
    const c = ytdCoverage(d, '2026-03-31'); expect(c.complete).toBe(true); expect(c.rows[0].months.map(m => m.state)).toEqual(['ok', 'quiet', 'ok'])
  })
})
