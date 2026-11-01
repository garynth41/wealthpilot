import { describe, it, expect, beforeAll } from 'vitest'
import { setToday } from '../dates'
import { extract, isSkip, type Fact } from './extract'
import { propose } from './propose'
import { applyMany, type Ctx } from './apply'
import type { Msg } from './text'
import { MemoryRepo } from '../../app/data/memoryRepo'
import { demoSeed } from '../../app/data/demoSeed'
import type { Settings } from '../../app/data/types'

beforeAll(() => setToday('2026-11-04'))
const msg = (id: string, from: string, subject: string, body: string, date = '2026-11-02', name = ''): Msg => ({ id, date: new Date(date + 'T12:00:00'), from: { name, email: from }, subject, body, sent: false })
const H = (rows: string[][], head: string) => `<html><body><h1>${head}</h1><table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table><p>Questions? Visit our help center.</p></body></html>`

describe('extract', () => {
  it('a card statement: balance, minimum, due date, last 4', () => {
    const f = extract(msg('1', 'alerts@chase.com', 'Your statement is ready', 'Chase Freedom account ending in 4821. Statement balance: $1,362.55. Minimum payment due: $41.00. Payment due date: 11/23/2026.')) as Fact
    expect(f.kind).toBe('bill'); expect(f.payee).toBe('Chase'); expect(f.stmtBal).toBe(1362.55); expect(f.minDue).toBe(41); expect(f.dueDate).toBe('2026-11-23'); expect(f.last4).toBe('4821'); expect(f.conf).toBe('high')
  })
  it('a payment confirmation', () => {
    const f = extract(msg('2', 'noreply@verizonwireless.com', 'Thanks for your payment', 'We received your payment of $95.00 on Nov 1, 2026 for account ending 8831. Paid with Visa ending 4410.')) as Fact
    expect(f.kind).toBe('paid'); expect(f.amount).toBe(95); expect(f.txnDate).toBe('2026-11-01'); expect(f.last4).toBe('8831'); expect(f.fromLast4).toBe('4410'); expect(f.payee).toBe('Verizon')
  })
  it('a direct deposit from payroll', () => {
    const f = extract(msg('3', 'alerts@huntington.com', 'Direct deposit received', H([['Amount', '$2,305.00'], ['From', 'MERIDIAN AVIATION PAYROLL'], ['Date', '10/30/2026']], 'A direct deposit was credited to your account'))) as Fact
    expect(f.kind).toBe('income'); expect(f.amount).toBe(2305); expect(f.ptype).toBe('payroll'); expect(f.txnDate).toBe('2026-10-30'); expect(f.bank).toBe('Huntington')
  })
  it('skips promotions and summaries, keeps past-due', () => {
    const promo = extract(msg('4', 'deals@shop.com', 'A new statement of savings for members', 'See if you pre-qualify — limited time offer, earn up to $200 bonus.')); expect(isSkip(promo)).toBe(true); expect(extract(msg('4b', 'news@shop.com', 'Weekly digest', 'Top stories this week.'))).toBeNull()
    const f = extract(msg('5', 'billing@columbiagas.com', 'Your account is past due', 'Amount past due: $58.20. Please pay by 11/10/2026 to avoid disconnection.')) as Fact
    expect(f.kind).toBe('pastdue'); expect(f.amount).toBe(58.2); expect(f.dueDate).toBe('2026-11-10')
  })
  it('an autopay notice', () => { const f = extract(msg('6', 'autopay@aep.com', 'Your AutoPay payment is scheduled', 'Your automatic payment of $152.40 will be processed on 11/15/2026 from account ending 4410.')) as Fact; expect(f.kind).toBe('scheduled'); expect(f.amount).toBe(152.4); expect(f.txnDate).toBe('2026-11-15'); expect(f.autopay).toBe(true) })
})

describe('propose + apply (demo household)', () => {
  const setup = () => { const repo = new MemoryRepo(demoSeed()); const settings = (): Settings => repo.household.settings; const ctx: Ctx = { data: () => repo.data, settings, insert: (c, r) => repo.insert(c, r), update: (c, id, p) => repo.update(c, id, p), saveSettings: async p => { await repo.saveSettings(p) }, ledger: r => repo.ledger(r) }; return { repo, ctx } }
  const facts = () => [
    { ...(extract(msg('a1', 'alerts@chase.com', 'Your statement is ready', 'Chase Freedom account ending in 4821. New balance: $1,410.20. Minimum payment due: $44.00. Payment due date: 12/02/2026. Statement date: 11/03/2026.', '2026-11-03')) as Fact), ev: [{ msg_id: 'a1', src: 'gmail', subject: 'Your statement is ready', date: '2026-11-03' }] },
    { ...(extract(msg('a2', 'billing@verizonwireless.com', 'Your Verizon bill is ready', H([['Account ending', '8831'], ['Amount due', '$95.00'], ['Due date', '11/08/2026']], 'Your bill is ready'), '2026-11-01')) as Fact), ev: [{ msg_id: 'a2', src: 'gmail', subject: 'Your Verizon bill is ready', date: '2026-11-01' }] },
    { ...(extract(msg('a3', 'alerts@huntington.com', 'Direct deposit received', H([['Amount', '$400.00'], ['From', 'FREELANCE CLIENT LLC'], ['Date', '11/02/2026']], 'A direct deposit was credited to your account'), '2026-11-02')) as Fact), ev: [{ msg_id: 'a3', src: 'gmail', subject: 'Direct deposit received', date: '2026-11-02' }] },
    { ...(extract(msg('a4', 'noreply@spotify.com', 'Your receipt from Spotify', 'Thanks for your payment. Amount paid: $11.99 on Oct 21, 2026. Your subscription has renewed.', '2026-10-21')) as Fact), ev: [{ msg_id: 'a4', src: 'gmail', subject: 'Your receipt from Spotify', date: '2026-10-21' }] },
    { ...(extract(msg('a5', 'statements@missionlane.com', 'Your Mission Lane statement is available', 'Account ending in 7788. Statement balance: $612.40. Minimum payment: $35.00. Due date: 11/28/2026.', '2026-11-03')) as Fact), ev: [{ msg_id: 'a5', src: 'gmail', subject: 'Mission Lane statement', date: '2026-11-03' }] },
  ]
  it('matches to accounts, recurring bills and categories', () => {
    const { repo } = setup(); const props = propose(repo.data, repo.household.settings, facts())
    const chase = props.find(p => (p.f as Fact).payee === 'Chase')!; expect(chase.target.startsWith('account:')).toBe(true); expect(chase.changes.join(' ')).toMatch(/statement balance .* → \$1,410.20/)
    const vz = props.find(p => (p.f as Fact).payee === 'Verizon')!; expect(vz.target.startsWith('recurring:')).toBe(true)
    const dep = props.find(p => (p.f as Fact).kind === 'income')!; expect(dep.target.startsWith('category:')).toBe(true)
    const sp = props.find(p => (p.f as Fact).payee === 'Spotify')!; expect(sp.kind).toBe('current'); expect(sp.dup).toBe(true)   // already logged on Oct 21
    const ml = props.find(p => (p.f as Fact).payee === 'Mission Lane')!; expect(ml.target).toBe('new-account'); expect(ml.checked).toBe(true)
  })
  it('apply writes statements, transactions, occurrences and a new account', async () => {
    const { repo, ctx } = setup(); const props = propose(repo.data, repo.household.settings, facts()).filter(p => p.kind === 'item' && p.checked)
    const n0 = repo.data.transactions.length
    await applyMany(ctx, props)
    const chase = repo.data.accounts.find(a => a.name === 'Chase Freedom')!; expect(chase.statement_balance).toBe(1410.2); expect(chase.minimum_payment).toBe(44); expect(chase.due_date).toBe('2026-12-02'); expect(chase.last_paid_due).toBeNull()
    expect(repo.data.statements.filter(s => s.account_id === chase.id).length).toBe(4)
    expect(repo.data.transactions.length).toBe(n0 + 1); const dep = repo.data.transactions[n0]; expect(dep.kind).toBe('income'); expect(dep.amount).toBe(400); expect(dep.source).toBe('email')
    const vz = repo.data.recurring.find(r => r.name === 'Verizon')!; expect(repo.data.occurrences.some(o => o.recurring_id === vz.id && o.due_date === '2026-11-08')).toBe(true)
    const ml = repo.data.accounts.find(a => a.name === 'Mission Lane')!; expect(ml.kind).toBe('credit_card'); expect(ml.last4).toBe('7788'); expect(ml.minimum_payment).toBe(35)
    expect(repo.data.emailItems.length).toBe(4); expect(repo.data.emailLedger.length).toBe(4)
    expect(repo.household.settings.finmail?.rules?.['verizon']?.recurring).toBe(vz.id)
    // the same emails again are "already recorded"
    const again = propose(repo.data, repo.household.settings, facts()); expect(again.filter(p => p.kind === 'current').length).toBe(5)
  })
})
