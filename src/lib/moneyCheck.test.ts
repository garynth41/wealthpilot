// 0.37.0 — "Check your money in and out": the rows that are probably counted wrong. The cases are Gary's own ledger from Nov 2026.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { emptyData, type Account, type Data, type Transaction } from '../app/data/types'
import { moneyChecks, checkSummary, checkTitle, checkWhy, personOf, personName, checkPattern } from './moneyCheck'
import { rangeStat } from './budget'
import { setToday } from './dates'

beforeAll(() => setToday('2026-11-21')); afterAll(() => setToday(null))
const A = (id: string, name: string, kind: Account['kind'] = 'checking', excluded = false) => ({ id, name, kind, institution: 'Bank', status: 'Active', balance: 0, excluded, household_id: 'h' }) as unknown as Account
const BOA = A('boa', 'Adv Plus Banking(0224)'), SAV = A('sav', 'Advantage Savings(0253)', 'savings'), HUN = A('hun', 'Gary Checking (4019)'), CARD = A('card', 'Ollo', 'credit_card'), SON = A('son', 'Gavionne Checking (2060)', 'checking', true)
let n = 0
const T = (p: Partial<Transaction>): Transaction => { const id = p.id || `t${++n}`; return { household_id: 'h', date: '2026-11-02', kind: 'expense', amount: 100, account_id: 'boa', to_account_id: null, category_id: null, payee: '', tags: [], status: 'cleared', source: 'import', external_id: p.source === 'manual' ? null : 'sfin:ACT:' + id, exclude_from_budget: false, ...p, id } as Transaction }
const book = (rows: Transaction[], off: Transaction[] = [], dups: Transaction[] = []): Data => ({ ...emptyData(), accounts: [BOA, SAV, HUN, CARD], transactions: rows, duplicates: dups, off: { accounts: [SON], transactions: off, duplicates: [], recurring: [], paySchedules: [], statements: [], balances: [], holdings: [], reconciliations: [], goals: [], emailItems: [], hardship: [] } })
const name = (id?: string | null) => [BOA, SAV, HUN, CARD, SON].find(a => a.id === id)?.name || '—'
const kinds = (d: Data, s = {}) => moneyChecks(d, s).map(i => i.kind)

describe('what is found', () => {
  it('money sent to a left-out account that came straight back', () => {
    const out = T({ id: 'z', amount: 200, payee: 'Zelle payment to Gavionne Conf# tcpnq1vmx', category_id: 'kids' }), back = T({ id: 'b', kind: 'income', amount: 200, account_id: 'hun', payee: 'INTERNET TFR FRM CHECKING', category_id: 'other' })
    const off = [T({ id: 'g1', kind: 'income', amount: 200, account_id: 'son', payee: 'Zelle Transaction ••1031 BACtcpnq1vmx' }), T({ id: 'g2', amount: 200, account_id: 'son', payee: 'INTERNET TFR TO CHECKING' })]
    const [i] = moneyChecks(book([out, back], off)); expect(i).toMatchObject({ kind: 'passthrough', income: 200, spending: 200 }); expect(i.rows.map(r => r.id)).toEqual(['z', 'b']); expect(i.offAccount?.id).toBe('son')
    expect(checkTitle(i, name)).toBe('Sent to Gavionne Checking (2060) and came back'); expect(checkWhy(i, name)).toMatch(/once as spending and once as income/)
  })
  it('money sent to yourself through a pay app and received back', () => {
    const d = book([T({ id: 'o', amount: 200, payee: 'Zelle payment to Gary Thomas Conf# x88o8v05v', category_id: 'rent' }), T({ id: 'i', kind: 'income', amount: 200, payee: 'Zelle payment from Gary Thomas Conf# VW09FJP', category_id: 'other' })])
    const [i] = moneyChecks(d); expect(i.kind).toBe('roundtrip'); expect(checkTitle(i, name)).toBe('Sent to Gary Thomas and received back')
    expect(personOf('Zelle payment to Gary Thomas Conf# x88o8v05v')).toBe('gary thomas'); expect(personOf('Zelle payment from Gary Thomas Conf# VW09FJP')).toBe('gary thomas')
    // the key does not care which way round the name is written; the name shown is as the bank wrote it
    expect(personOf('Venmo payment to Pat Lee 1a2b')).toBe(personOf('ZELLE PAYMENT FROM LEE PAT')); expect(personName('Zelle payment to Pat Lee Conf# a1x9')).toBe('Pat Lee'); expect(personName('ZELLE')).toBe('someone')
    // a different person, a different amount, or a week apart is two real payments
    expect(kinds(book([T({ amount: 200, payee: 'Zelle payment to Farda Sesi Conf# a1' }), T({ kind: 'income', amount: 200, payee: 'Zelle payment from Gary Thomas Conf# b2' })]))).toEqual([])
    expect(kinds(book([T({ amount: 200, payee: 'Zelle payment to Gary Thomas Conf# a1' }), T({ kind: 'income', amount: 150, payee: 'Zelle payment from Gary Thomas Conf# b2' })]))).toEqual([])
    expect(kinds(book([T({ amount: 200, payee: 'Zelle payment to Gary Thomas Conf# a1', date: '2026-11-02' }), T({ kind: 'income', amount: 200, payee: 'Zelle payment from Gary Thomas Conf# b2', date: '2026-11-10' })]))).toEqual([])
  })
  it('money from, and to, an account left out of the figures — gathered by description', () => {
    const rows = [T({ id: 'a', kind: 'income', amount: 50, account_id: 'hun', payee: 'INTERNET TFR FRM CHECKING', date: '2026-11-02' }), T({ id: 'b', kind: 'income', amount: 350, account_id: 'hun', payee: 'INTERNET TFR FRM CHECKING', date: '2026-11-12' }), T({ id: 'c', amount: 20, account_id: 'hun', payee: 'INTERNET TFR TO CHECKING', date: '2026-11-09', category_id: 'internet' })]
    const off = [T({ amount: 50, account_id: 'son', payee: 'INTERNET TFR TO CHECKING', date: '2026-11-02' }), T({ amount: 350, account_id: 'son', payee: 'INTERNET TFR TO CHECKING', date: '2026-11-12' }), T({ kind: 'income', amount: 20, account_id: 'son', payee: 'INTERNET TFR FRM CHECKING', date: '2026-11-09' })]
    const items = moneyChecks(book(rows, off)); expect(items.map(i => [i.kind, i.rows.length, i.income, i.spending])).toEqual([['from_off', 2, 400, 0], ['to_off', 1, 0, 20]])
    expect(checkTitle(items[0], name)).toBe('2 deposits from Gavionne Checking (2060)'); expect(items[0].pattern).toBe(checkPattern('INTERNET TFR FRM CHECKING')); expect(items[0].pattern).not.toBe('')
    expect(checkSummary(items)).toEqual({ n: 2, rows: 3, income: 400, spending: 20 })
  })
  it('a like amount in the left-out account is not its other end unless the rail and the name fit', () => {
    // Zonja paid $400 by Zelle; two days later $400 left Gavionne's account by internal transfer — unrelated
    const zonja = T({ kind: 'income', amount: 400, payee: 'Zelle payment from ZONJA S FRANCIS for "c"; Conf# q1', date: '2026-09-14', category_id: 'other' })
    expect(kinds(book([zonja], [T({ amount: 400, account_id: 'son', payee: 'INTERNET TFR TO SAVINGS', date: '2026-09-16' })]))).toEqual([])
    // …nor when it left his account by Zelle: the payment names Zonja, not him
    expect(kinds(book([zonja], [T({ amount: 400, account_id: 'son', payee: 'Zelle Transaction ••0914 H50Pabc', date: '2026-09-14' })]))).toEqual([])
    // a transfer in is not the other end of a card purchase on his account
    expect(kinds(book([T({ kind: 'income', amount: 200, account_id: 'hun', payee: 'INTERNET TFR FRM CHECKING', date: '2026-11-02' })], [T({ amount: 200, account_id: 'son', payee: 'PURCHASE PAYPAL *THOMAS GAVIONN', date: '2026-11-02' })]))).toEqual(['move'])
    // a payment that names him does reach his account
    const [i] = moneyChecks(book([T({ amount: 100, account_id: 'sav', payee: 'Zelle payment to Gavionne Conf# y6y7dlmdd', date: '2026-11-05', category_id: 'travel' })], [T({ kind: 'income', amount: 100, account_id: 'son', payee: 'Zelle Transaction XXXX1105 BACy6y7dlmdd', date: '2026-11-05' })]))
    expect(i).toMatchObject({ kind: 'to_off', spending: 100 }); expect(i.offAccount?.id).toBe('son')
  })
  it('two rows that read as one transfer but were not paired, and a transfer whose other side is not on file', () => {
    // two same-amount moves the same day: the engine will not guess which is which, so they wait here
    const rows = [T({ id: 'o1', amount: 240, account_id: 'hun', payee: 'INTERNET TFR TO SAVINGS', date: '2026-09-30', category_id: 'internet' }), T({ id: 'i1', kind: 'income', amount: 240, account_id: 'sav', payee: 'INTERNET TFR FRM CHECKING', date: '2026-09-30' }),
      T({ id: 'x', kind: 'income', amount: 18, account_id: 'hun', payee: 'INTERNET TFR FRM CHECKING', date: '2026-09-28' })]
    const items = moneyChecks(book(rows)); expect(items.map(i => i.kind)).toEqual(['pair', 'move']); expect(items[0].rows.map(r => r.id)).toEqual(['o1', 'i1'])
    expect(checkTitle(items[0], name)).toBe('One move from Gary Checking (4019) to Advantage Savings(0253)'); expect(checkWhy(items[1], name)).toMatch(/counts as income/)
  })
  it('"Make it one transfer" is offered only for rows the engine itself would read as one', () => {
    // a pay-app payment that happens to say "transfer", and a bank's own transfer in: two different things
    const rows = [T({ id: 'o', amount: 90, payee: 'APPLE CASH TRANSFER TO DANA WHITFIELD', date: '2026-11-10' }), T({ id: 'i', kind: 'income', amount: 90, account_id: 'sav', payee: 'INTERNET TFR FRM CHECKING', date: '2026-11-10' })]
    expect(kinds(book(rows))).not.toContain('pair')
    // a fee is not a transfer
    expect(kinds(book([T({ amount: 12, payee: 'OVERDRAFT PROTECTION TRANSFER FEE', date: '2026-11-10', category_id: 'fees' })]))).toEqual([])
  })
  it('a transfer that reads as a payment to someone else', () => {
    const keeper = T({ id: 'k', kind: 'transfer', amount: 100, account_id: 'boa', to_account_id: 'hun', payee: 'MESSERLI KRAMER DES:ePay ID:XXXXX2041 INDN:Gary Thomas', date: '2026-11-13' })
    const dup = T({ id: 'd', kind: 'income', amount: 100, account_id: 'hun', payee: 'INTERNET TFR FRM CHECKING', date: '2026-11-13', duplicate_of: 'k' })
    const [i] = moneyChecks(book([keeper], [], [dup])); expect(i).toMatchObject({ kind: 'mispaired', dup: { id: 'd' } }); expect(checkWhy(i, name)).toMatch(/missing from your spending/)
    // a pay-app payment joined to a bank's own transfer, and a card purchase joined to one (both in Gary's ledger)
    const apple = T({ id: 'k3', kind: 'transfer', amount: 30, account_id: 'boa', to_account_id: 'sav', payee: 'PMNT SENT 0918 APPLE CASH SENT M XXXXX8552 C', date: '2026-09-21' }), d3 = T({ id: 'd3', kind: 'income', amount: 30, account_id: 'sav', payee: 'INTERNET TFR FRM CHECKING', date: '2026-09-23', duplicate_of: 'k3' })
    const flex = T({ id: 'k4', kind: 'transfer', amount: 400, account_id: 'hun', to_account_id: 'sav', payee: 'PURCHASE FLEX* FLEXIBLE FINANCE', date: '2026-09-17' }), d4 = T({ id: 'd4', kind: 'income', amount: 400, account_id: 'sav', payee: 'INTERNET TFR FRM CHECKING', date: '2026-09-16', duplicate_of: 'k4' })
    expect(moneyChecks(book([apple, flex], [], [d3, d4]), {}, { since: '2026-09-01' }).map(x => [x.kind, x.rows[0].id])).toEqual([['mispaired', 'k3'], ['mispaired', 'k4']])
    // your own Zelle from one bank to another, paired, is fine: both rows are pay-app rows and neither names a stranger
    const own = T({ id: 'k5', kind: 'transfer', amount: 100, account_id: 'hun', to_account_id: 'boa', payee: 'Zelle Transaction ••0917 H50Pj1YDbPV9', date: '2026-09-16' }), d5 = T({ id: 'd5', kind: 'income', amount: 100, account_id: 'boa', payee: 'Zelle payment from GARY THOMAS for "test"; Conf# abc', date: '2026-09-16', duplicate_of: 'k5' })
    expect(moneyChecks(book([own], [], [d5]), {}, { since: '2026-09-01' })).toEqual([])
    // a row that names the account it went to is not naming a stranger: "to GARY THOMAS" into Gary Checking, as the engine itself pairs it
    const mine = T({ id: 'k6', kind: 'transfer', amount: 200, account_id: 'boa', to_account_id: 'hun', payee: 'Zelle payment to GARY THOMAS Conf# x88', date: '2026-11-02' }), d6 = T({ id: 'd6', kind: 'income', amount: 200, account_id: 'hun', payee: 'Zelle Transaction ••1102 H50Pj1YDbPV9', date: '2026-11-02', duplicate_of: 'k6' })
    expect(moneyChecks(book([mine], [], [d6]))).toEqual([])
    // a transfer someone typed, with the bank's deposit merged into it, is theirs
    const typed = T({ id: 'k7', kind: 'transfer', amount: 150, account_id: 'boa', to_account_id: 'sav', payee: 'Rainy Day Fund', source: 'manual', date: '2026-11-15' }), d7 = T({ id: 'd7', kind: 'income', amount: 150, account_id: 'sav', payee: 'ONLINE TRANSFER FROM CHK', date: '2026-11-15', duplicate_of: 'k7' })
    expect(moneyChecks(book([typed], [], [d7]))).toEqual([])
    // an ordinary paired transfer is not questioned
    const fine = T({ id: 'k2', kind: 'transfer', amount: 596, account_id: 'boa', to_account_id: 'sav', payee: 'Online Banking transfer to SAV 0253 Confirmation# 1', date: '2026-11-16' })
    expect(kinds(book([fine], [], [T({ id: 'd2', kind: 'income', amount: 596, account_id: 'sav', payee: 'Online Banking transfer from CHK 0224', date: '2026-11-16', duplicate_of: 'k2' })]))).toEqual([])
  })
})

describe('what is left alone', () => {
  const pay = T({ kind: 'income', amount: 2868.13, payee: 'NETJETS SERVICES DES:PAYROLL ID:XXXX INDN:GARY THOMAS', category_id: 'pay' })
  it('paychecks, purchases, card payments and ordinary pay-app payments', () => {
    expect(kinds(book([pay, T({ amount: 137.24, payee: 'Spectrum', category_id: 'internet' }), T({ amount: 25, payee: 'Zelle payment to Farda Sesi Conf# wi5', category_id: 'care' }), T({ kind: 'transfer', amount: 27, to_account_id: 'card', payee: 'Ollo' }), T({ kind: 'income', amount: 14.36, account_id: 'card', payee: 'PURCHASE REFUND' })]))).toEqual([])
  })
  it('a row already left out, one kept as it is, a void one, a split one, and anything older than the look-back', () => {
    const row = (p: Partial<Transaction>) => T({ kind: 'income', amount: 18, account_id: 'hun', payee: 'INTERNET TFR FRM CHECKING', ...p })
    expect(kinds(book([row({})]))).toEqual(['move'])
    expect(kinds(book([row({ exclude_from_budget: true })]))).toEqual([]); expect(kinds(book([row({ dedupe_ok: true })]))).toEqual([]); expect(kinds(book([row({ status: 'void' })]))).toEqual([])
    expect(kinds(book([row({ date: '2026-01-05' })]))).toEqual([]); expect(moneyChecks(book([row({ date: '2026-01-05' })]), {}, { since: '2026-01-01' })).toHaveLength(1)
    const split = row({ id: 'sp' }); expect(kinds({ ...book([split]), splits: [{ id: 's1', transaction_id: 'sp', amount: 18 } as never] })).toEqual([])
  })
  it('a description the household said is always fine', () => {
    const d = book([T({ kind: 'income', amount: 18, account_id: 'hun', payee: 'INTERNET TFR FRM CHECKING' })])
    expect(kinds(d, { checkOk: [checkPattern('INTERNET TFR FRM CHECKING')] })).toEqual([]); expect(kinds(d, { checkOk: ['something else'] })).toEqual(['move'])
  })
  it('each row is on the list once', () => {
    const rows = [T({ id: 'z', amount: 200, payee: 'Zelle payment to Gavionne Conf# tc' }), T({ id: 'b', kind: 'income', amount: 200, account_id: 'hun', payee: 'INTERNET TFR FRM CHECKING' }), T({ id: 'b2', kind: 'income', amount: 200, account_id: 'hun', payee: 'INTERNET TFR FRM CHECKING', date: '2026-11-03' })]
    const off = [T({ kind: 'income', amount: 200, account_id: 'son', payee: 'Zelle Transaction BACtc' }), T({ amount: 200, account_id: 'son', payee: 'INTERNET TFR TO CHECKING' }), T({ amount: 200, account_id: 'son', payee: 'INTERNET TFR TO CHECKING', date: '2026-11-03' })]
    const items = moneyChecks(book(rows, off)); const ids = items.flatMap(i => i.rows.map(r => r.id)); expect(ids.sort()).toEqual(['b', 'b2', 'z']); expect(items.map(i => i.kind)).toEqual(['passthrough', 'from_off'])
  })
})

describe('leaving a row out takes it out of income and spending', () => {
  it('and off the list', () => {
    const out = T({ id: 'o', amount: 200, payee: 'Zelle payment to Gary Thomas Conf# a1', category_id: 'rent' }), inn = T({ id: 'i', kind: 'income', amount: 200, payee: 'Zelle payment from Gary Thomas Conf# b2' })
    const pay = T({ kind: 'income', amount: 2868.13, payee: 'NETJETS PAYROLL' }), shop = T({ amount: 40, payee: 'Kroger' })
    const before = rangeStat(book([out, inn, pay, shop]), '2026-11-01', '2026-11-30'); expect([before.income, before.spend]).toEqual([3068.13, 240])
    const d = book([{ ...out, exclude_from_budget: true }, { ...inn, exclude_from_budget: true }, pay, shop]); const after = rangeStat(d, '2026-11-01', '2026-11-30')
    expect([after.income, after.spend]).toEqual([2868.13, 40]); expect(moneyChecks(d)).toEqual([])
  })
})
