import { describe, it, expect, beforeAll } from 'vitest'
import { setToday } from './dates'
import { demoSeed } from '../app/data/demoSeed'
import { parseCsv, parseDate, detectMapping, mapRows, parseOfx, sniffFormat, dedupe, rowHash } from './import'

beforeAll(() => setToday('2026-11-04'))

describe('import: csv parsing', () => {
  it('handles quotes, embedded commas, CRLF and BOM', () => {
    const rows = parseCsv('﻿Date,Description,Amount\r\n10/05/2026,"KROGER #1234, COLUMBUS",-54.20\r\n10/06/2026,"He said ""hi""",12\r\n')
    expect(rows).toHaveLength(3); expect(rows[1][1]).toBe('KROGER #1234, COLUMBUS'); expect(rows[2][1]).toBe('He said "hi"')
  })
  it('detects ; and tab delimiters', () => { expect(parseCsv('a;b;c\n1;2;3')[1]).toEqual(['1', '2', '3']); expect(parseCsv('a\tb\n1\t2')[1]).toEqual(['1', '2']) })
  it('parses the date formats banks use', () => { for (const [s, e] of [['2026-10-05', '2026-10-05'], ['10/05/2026', '2026-10-05'], ['10/5/26', '2026-10-05'], ['25/10/2026', '2026-10-25'], ['05-Oct-2026', '2026-10-05'], ['Oct 5, 2026', '2026-10-05'], ['20261005120000.000', '2026-10-05'], ['nope', null]] as const) expect(parseDate(s)).toBe(e) })
})
describe('import: column mapping', () => {
  it('maps a Chase-style file (single signed Amount)', () => {
    const rows = parseCsv('Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n10/05/2026,10/06/2026,KROGER #1234,Groceries,Sale,-54.20,\n10/07/2026,10/07/2026,Payment Thank You,,Payment,250.00,')
    const m = detectMapping(rows)!; expect(m.date).toBe(0); expect(m.payee).toBe(2); expect(m.amount).toBe(5); expect(m.type).toBe(4); expect(m.hasHeader).toBe(true)
    const r = mapRows(rows, m, { card: true }); expect(r[0]).toMatchObject({ date: '2026-10-05', payee: 'KROGER #1234', amount: 54.2, kind: 'expense' }); expect(r[1].kind).toBe('income')
  })
  it('a Type column wins over the sign; card charges are positive', () => {
    const rows = parseCsv('Date,Description,Type,Amount\n10/05/2026,KROGER,Sale,54.20\n10/07/2026,PAYMENT,Payment,-250.00\n10/08/2026,REFUND,Return,-10')
    const r = mapRows(rows, detectMapping(rows)!, { card: true }); expect(r.map(x => x.kind)).toEqual(['expense', 'income', 'income'])
    const bank = parseCsv('Date,Description,Type,Amount\n10/07/2026,CHASE CARD,Payment,-250.00'); expect(mapRows(bank, detectMapping(bank)!)[0].kind).toBe('expense')   // same word, opposite meaning on a bank account
    const amex = parseCsv('Date,Description,Amount\n10/05/2026,KROGER,54.20\n10/07/2026,PAYMENT RECEIVED,-250.00'); const m = { ...detectMapping(amex)!, negativeIsOutflow: false }; expect(mapRows(amex, m, { card: true }).map(x => x.kind)).toEqual(['expense', 'income'])
  })
  it('maps a debit/credit two-column file and a headerless file', () => {
    const rows = parseCsv('Date,Details,Withdrawals,Deposits,Balance\n2026-10-05,ACH PAYROLL,,2305.00,5000\n2026-10-06,SHELL OIL,41.10,,4958.90')
    const r = mapRows(rows, detectMapping(rows)!); expect(r[0]).toMatchObject({ kind: 'income', amount: 2305 }); expect(r[1]).toMatchObject({ kind: 'expense', amount: 41.1, payee: 'SHELL OIL' })
    const nh = parseCsv('10/05/2026,KROGER STORE,-54.20\n10/06/2026,PAYROLL,2305'); const m = detectMapping(nh)!; expect(m.hasHeader).toBe(false); const x = mapRows(nh, m); expect(x[0].kind).toBe('expense'); expect(x[1].kind).toBe('income'); expect(x[1].payee).toBe('PAYROLL')
  })
  it('flags rows without a usable date or amount instead of dropping them silently', () => {
    const rows = parseCsv('Date,Description,Amount\nTotal,,\n10/05/2026,KROGER,abc\n10/06/2026,SHELL,-20')
    const r = mapRows(rows, detectMapping(rows)!); expect(r).toHaveLength(3); expect(r[0].warn).toBe('no date'); expect(r[1].warn).toBe('no amount'); expect(r[2].warn).toBeUndefined()
  })
  it('external ids are stable across re-imports and distinct for identical-looking rows', () => {
    const rows = parseCsv('Date,Description,Amount\n10/05/2026,COFFEE,-4.50\n10/05/2026,COFFEE,-4.50')
    const a = mapRows(rows, detectMapping(rows)!), b = mapRows(rows, detectMapping(rows)!); expect(a[0].external_id).toBe(b[0].external_id); expect(a[0].external_id).not.toBe(a[1].external_id); expect(rowHash('2026-10-05', 4.5, 'coffee')).toMatch(/^h[0-9a-f]{8}$/)
  })
})
describe('import: ofx / qfx', () => {
  const ofx = `OFXHEADER:100\nDATA:OFXSGML\n<OFX><SIGNONMSGSRSV1><SONRS><FI><ORG>Huntington</ORG></FI></SONRS></SIGNONMSGSRSV1><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD<BANKACCTFROM><BANKID>044000024<ACCTID>XXXX4321<ACCTTYPE>CHECKING</BANKACCTFROM><BANKTRANLIST><DTSTART>20261001<DTEND>20261031\n<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261005120000.000[-5:EST]<TRNAMT>-54.20<FITID>2026100500123<NAME>KROGER #1234<MEMO>POS PURCHASE</STMTTRN>\n<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261010<TRNAMT>2305.00<FITID>2026101000456<NAME>NETJETS PAYROLL</STMTTRN>\n</BANKTRANLIST><LEDGERBAL><BALAMT>5102.33<DTASOF>20261031</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`
  it('reads SGML OFX 1.x statements', () => {
    const r = parseOfx(ofx); expect(r.rows).toHaveLength(2); expect(r.rows[0]).toMatchObject({ date: '2026-10-05', payee: 'KROGER #1234', memo: 'POS PURCHASE', amount: 54.2, kind: 'expense', external_id: 'ofx:2026100500123' }); expect(r.rows[1].kind).toBe('income')
    expect(r.acctId).toBe('XXXX4321'); expect(r.acctType).toBe('CHECKING'); expect(r.org).toBe('Huntington'); expect(r.balance).toBe(5102.33); expect(r.balanceAsOf).toBe('2026-10-31'); expect(r.start).toBe('2026-10-01')
  })
  it('reads XML OFX 2.x and sniffs the format', () => {
    const xml = `<?xml version="1.0"?><?OFX OFXHEADER="200"?><OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CCACCTFROM><ACCTID>1111</ACCTID></CCACCTFROM><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261012</DTPOSTED><TRNAMT>-19.99</TRNAMT><FITID>abc</FITID><NAME>NETFLIX</NAME></STMTTRN></BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`
    const r = parseOfx(xml); expect(r.rows[0]).toMatchObject({ date: '2026-10-12', amount: 19.99, payee: 'NETFLIX', external_id: 'ofx:abc' }); expect(r.acctType).toBe('CREDITCARD')
    expect(sniffFormat('x.qfx', '')).toBe('ofx'); expect(sniffFormat('x.csv', ofx)).toBe('ofx'); expect(sniffFormat('x.csv', 'a,b')).toBe('csv')
  })
})
describe('import: de-duplication', () => {
  it('skips rows already imported, already logged, or near matches; posts card credits as payments', () => {
    const { data } = demoSeed(); const chk = data.accounts.find(a => a.name === 'Huntington Checking')!; const card = data.accounts.find(a => a.name === 'Chase Freedom')!
    const logged = data.transactions.find(t => t.account_id === chk.id && t.kind === 'expense' && t.payee)!
    const withExt = { ...data, transactions: [...data.transactions, { ...logged, id: 'xx', external_id: 'csv:known1' }] }
    const rows = [
      { date: logged.date, payee: logged.payee!, memo: '', amount: logged.amount, kind: 'expense' as const, external_id: 'csv:n1', raw: [], line: 1 },
      { date: logged.date, payee: logged.payee!.toUpperCase() + ' #99', memo: '', amount: logged.amount, kind: 'expense' as const, external_id: 'csv:n2', raw: [], line: 2 },
      { date: '2026-10-05', payee: 'BRAND NEW', memo: '', amount: 1.23, kind: 'expense' as const, external_id: 'csv:known1', raw: [], line: 3 },
      { date: '2026-10-06', payee: 'ALSO NEW', memo: '', amount: 7.77, kind: 'expense' as const, external_id: 'csv:n4', raw: [], line: 4 },
      { date: '2026-10-06', payee: 'ALSO NEW', memo: '', amount: 7.77, kind: 'expense' as const, external_id: 'csv:n4', raw: [], line: 5 },
    ]
    const p = dedupe(withExt, chk, rows); expect(p.map(x => x.dup)).toEqual(['same_day_amount_payee', 'near_match', 'external_id', null, 'in_file']); expect(p[0].match?.id).toBe(logged.id)
    const c = dedupe(data, card, [{ date: '2026-10-07', payee: 'PAYMENT THANK YOU', memo: '', amount: 250, kind: 'income', external_id: 'csv:p', raw: [], line: 1 }])[0]
    expect(c.txn.kind).toBe('transfer'); expect(c.txn.to_account_id).toBe(card.id); expect(c.txn.account_id).toBeNull()
  })
})
