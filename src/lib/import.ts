// Statement import: CSV / OFX / QFX → transactions, with column auto-detection and de-duplication.
// Pure functions: parse text, propose a mapping, build rows. Pages do the file reading and the writes (via the store + ledger.post).
import type { Account, Data, Transaction } from '../app/data/types'
import { isLiability } from './accounts'
import { parseNum, round2 } from './money'

// ---------------- CSV ----------------
/** RFC 4180-ish CSV → rows of strings. Handles quoted fields, embedded commas/newlines, CRLF, BOM, and ; or tab delimiters. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, ''); const first = t.split(/\r?\n/, 1)[0] || ''
  const delim = [',', ';', '\t', '|'].map(c => [c, (first.match(new RegExp(c === '|' ? '\\|' : c, 'g')) || []).length] as const).sort((a, b) => b[1] - a[1])[0][0]
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += ch }
    else if (ch === '"') q = true
    else if (ch === delim) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim() !== ''))
}

// ---------------- dates ----------------
/** Accepts 2026-10-05, 10/05/2026, 10/5/26, 05-Oct-2026, Oct 5, 2026, 20261005. Ambiguous d/m vs m/d: assume US (m/d) unless the first part is > 12. */
export function parseDate(s: string): string | null {
  const v = (s || '').trim(); if (!v) return null
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return ok(+m[1], +m[2], +m[3])
  m = v.match(/^(\d{4})(\d{2})(\d{2})/); if (m) return ok(+m[1], +m[2], +m[3])
  m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/); if (m) { let a = +m[1], b = +m[2]; const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; if (a > 12 && b <= 12) [a, b] = [b, a]; return ok(y, a, b) }
  m = v.match(/^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ ,-]+(\d{4})/); if (m) return ok(+m[3], mon(m[2]), +m[1])
  m = v.match(/^([A-Za-z]{3})[A-Za-z]*\.? (\d{1,2}),? (\d{4})/); if (m) return ok(+m[3], mon(m[1]), +m[2])
  return null
}
const mon = (s: string) => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(s.slice(0, 3).toLowerCase()) + 1
const ok = (y: number, m: number, d: number) => (y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null)

// ---------------- column mapping ----------------
export interface Mapping { date: number; payee: number; amount?: number; debit?: number; credit?: number; memo?: number; id?: number; type?: number; hasHeader: boolean; negativeIsOutflow: boolean }
const H = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')
const find = (hs: string[], ...names: string[]) => { for (const n of names) { const i = hs.findIndex(h => h === n); if (i >= 0) return i } for (const n of names) { const i = hs.findIndex(h => h.includes(n)); if (i >= 0) return i } return -1 }
/** Guess which column is which from the header row (or from the data when there is no header). */
export function detectMapping(rows: string[][]): Mapping | null {
  if (!rows.length) return null
  const hs = rows[0].map(H); const hasHeader = hs.some(h => /date|amount|desc|payee|memo|debit|credit|balance|type/.test(h))
  if (hasHeader) {
    const date = find(hs, 'date', 'transactiondate', 'postdate', 'posteddate', 'postingdate', 'trandate')
    const payee = find(hs, 'description', 'payee', 'merchant', 'name', 'memo', 'details', 'transaction', 'narrative')
    const amount = find(hs, 'amount', 'transactionamount', 'amt', 'value')
    const debit = find(hs, 'debit', 'withdrawal', 'withdrawals', 'moneyout', 'outflow', 'paidout', 'charge')
    const credit = find(hs, 'credit', 'deposit', 'deposits', 'moneyin', 'inflow', 'paidin')
    const memo = hs.findIndex((h, i) => i !== payee && /memo|notes?|reference|category|extendeddescription|originaldescription/.test(h))
    const id = find(hs, 'transactionid', 'referencenumber', 'reference', 'fitid', 'id', 'checknumber', 'uniqueid')
    const type = find(hs, 'type', 'transactiontype', 'debitcredit', 'crdr')
    if (date < 0 || payee < 0 || (amount < 0 && debit < 0 && credit < 0)) return null
    return { date, payee, amount: amount >= 0 ? amount : undefined, debit: debit >= 0 ? debit : undefined, credit: credit >= 0 ? credit : undefined, memo: memo >= 0 ? memo : undefined, id: id >= 0 && id !== payee ? id : undefined, type: type >= 0 ? type : undefined, hasHeader: true, negativeIsOutflow: true }
  }
  // no header: first column that parses as a date, first that parses as a number, longest text column
  const r = rows[0]; const date = r.findIndex(c => parseDate(c)); const amount = r.findIndex((c, i) => i !== date && parseNum(c) != null && /\d/.test(c)); const payee = r.map((c, i) => [i, i === date || i === amount ? -1 : c.length] as const).sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1
  if (date < 0 || amount < 0 || payee < 0) return null
  return { date, payee, amount, hasHeader: false, negativeIsOutflow: true }
}

// ---------------- rows → transactions ----------------
export interface ImportRow { date: string; payee: string; memo: string; amount: number; kind: 'expense' | 'income'; external_id: string; raw: string[]; line: number; warn?: string }
/** FNV-1a of the stable fields — used as external_id when the file has no transaction id, so a re-import of the same file is a no-op. */
export function rowHash(date: string, amount: number, payee: string, n = 0) { let h = 0x811c9dc5; for (const ch of `${date}|${amount.toFixed(2)}|${payee.trim().toLowerCase()}|${n}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0 } return 'h' + h.toString(16).padStart(8, '0') }
/** Apply a mapping to CSV rows. Sign convention: a Type column wins; else debit/credit columns; else the sign with `negativeIsOutflow` (default true — flip it for card files that list charges as positive). */
export function mapRows(rows: string[][], m: Mapping, opts: { card?: boolean; source?: string } = {}): ImportRow[] {
  const body = m.hasHeader ? rows.slice(1) : rows; const out: ImportRow[] = []; const seen = new Map<string, number>()
  body.forEach((r, i) => {
    const date = parseDate(r[m.date] || ''); const payee = (r[m.payee] || '').trim(); const memo = m.memo != null ? (r[m.memo] || '').trim() : ''
    let amt: number | null = null, kind: ImportRow['kind'] | null = null
    if (m.debit != null || m.credit != null) { const dr = m.debit != null ? parseNum(r[m.debit]) : null, cr = m.credit != null ? parseNum(r[m.credit]) : null; if (dr) { amt = Math.abs(dr); kind = 'expense' } else if (cr) { amt = Math.abs(cr); kind = 'income' } }
    else if (m.amount != null) { const a = parseNum(r[m.amount]); if (a != null) { amt = Math.abs(a); const ty = m.type != null ? (r[m.type] || '').toLowerCase() : ''
      // a Type column is the most reliable signal; "Payment" means money INTO a card but OUT of a bank account
      if (/^(dr|debit|withdrawal|purchase|sale|charge|fee|check|pos|atm)/.test(ty) || (/^payment/.test(ty) && !opts.card)) kind = 'expense'
      else if (/^(cr|credit|deposit|refund|return|reversal)/.test(ty) || (/^payment/.test(ty) && opts.card)) kind = 'income'
      else kind = (a < 0) === m.negativeIsOutflow ? 'expense' : 'income' } }   // otherwise the sign decides; negativeIsOutflow is user-flippable (card issuers disagree: Chase sales are negative, Amex charges are positive)
    if (!date || amt == null || !amt) { if (r.some(c => c.trim())) out.push({ date: date || '', payee, memo, amount: amt || 0, kind: kind || 'expense', external_id: '', raw: r, line: i + 1 + (m.hasHeader ? 1 : 0), warn: !date ? 'no date' : 'no amount' }); return }
    const fileId = m.id != null ? (r[m.id] || '').trim() : ''; const key = `${date}|${amt.toFixed(2)}|${payee.toLowerCase()}`; const n = seen.get(key) || 0; seen.set(key, n + 1)
    out.push({ date, payee, memo, amount: round2(amt), kind: kind!, external_id: (opts.source || 'csv') + ':' + (fileId || rowHash(date, amt, payee, n)), raw: r, line: i + 1 + (m.hasHeader ? 1 : 0) })
  })
  return out
}

// ---------------- OFX / QFX ----------------
export interface OfxResult { rows: ImportRow[]; acctId?: string; acctType?: string; org?: string; balance?: number; balanceAsOf?: string; start?: string; end?: string }
const tag = (s: string, t: string) => { const m = s.match(new RegExp(`<${t}>([^<\\r\\n]*)`, 'i')); return m ? m[1].trim() : '' }
/** OFX 1.x (SGML, unclosed tags) and 2.x (XML). Reads STMTTRN blocks, the account id and the ledger balance. */
export function parseOfx(text: string): OfxResult {
  const body = text.replace(/\r/g, ''); const rows: ImportRow[] = []
  const blocks = body.split(/<STMTTRN>/i).slice(1).map(b => b.split(/<\/STMTTRN>/i)[0])
  blocks.forEach((b, i) => {
    const date = parseDate(tag(b, 'DTPOSTED').slice(0, 8)) || ''; const a = parseNum(tag(b, 'TRNAMT')); const name = tag(b, 'NAME') || tag(b, 'PAYEE'); const memo = tag(b, 'MEMO'); const fit = tag(b, 'FITID'); const type = tag(b, 'TRNTYPE').toUpperCase()
    if (!date || a == null) { rows.push({ date, payee: name, memo, amount: a || 0, kind: 'expense', external_id: '', raw: [b.trim()], line: i + 1, warn: !date ? 'no date' : 'no amount' }); return }
    const kind: ImportRow['kind'] = a < 0 || type === 'DEBIT' || type === 'FEE' || type === 'PAYMENT' && a < 0 ? 'expense' : 'income'
    rows.push({ date, payee: name, memo, amount: round2(Math.abs(a)), kind, external_id: 'ofx:' + (fit || rowHash(date, Math.abs(a), name, i)), raw: [b.trim()], line: i + 1 })
  })
  const bal = parseNum(tag(body.split(/<LEDGERBAL>/i)[1] || '', 'BALAMT')); const balAsOf = parseDate(tag(body.split(/<LEDGERBAL>/i)[1] || '', 'DTASOF').slice(0, 8)) || undefined
  return { rows, acctId: tag(body, 'ACCTID') || undefined, acctType: tag(body, 'ACCTTYPE') || (/<CCSTMTRS>/i.test(body) ? 'CREDITCARD' : undefined), org: tag(body, 'ORG') || undefined, balance: bal ?? undefined, balanceAsOf: balAsOf, start: parseDate(tag(body, 'DTSTART').slice(0, 8)) || undefined, end: parseDate(tag(body, 'DTEND').slice(0, 8)) || undefined }
}
export const sniffFormat = (name: string, text: string): 'ofx' | 'csv' => (/\.(ofx|qfx)$/i.test(name) || /<OFX>|OFXHEADER|<STMTTRN>/i.test(text.slice(0, 4000)) ? 'ofx' : 'csv')

// ---------------- de-duplication ----------------
export type DupReason = 'external_id' | 'same_day_amount_payee' | 'near_match' | 'in_file'
export interface Proposed { row: ImportRow; dup: DupReason | null; match?: Transaction; txn: Partial<Transaction>; how?: 'rule' | 'remembered' | 'history' | null }
const norm = (s?: string | null) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
/** Mark rows that already exist: same external_id (exact), or same account + amount + payee within ±3 days (likely the same transaction logged by hand or from email). */
export function dedupe(d: Data, account: Account, rows: ImportRow[]): Proposed[] {
  const byExt = new Map([...d.transactions, ...(d.duplicates || [])].filter(t => t.external_id).map(t => [t.external_id!, t])); const seenIds = new Set<string>()   // merged duplicates still count as imported
  const existing = d.transactions.filter(t => t.status !== 'void' && (t.account_id === account.id || t.to_account_id === account.id))
  return rows.map(row => {
    const txn: Partial<Transaction> = { date: row.date, kind: row.kind, amount: row.amount, account_id: account.id, payee: row.payee || null, memo: row.memo || null, tags: [], status: 'cleared', source: 'import', external_id: row.external_id || null, exclude_from_budget: false }
    if (isLiability(account) && row.kind === 'income') { txn.kind = 'transfer'; txn.account_id = null; txn.to_account_id = account.id }   // a credit on a card = a payment to it
    if (row.warn) return { row, dup: null, txn }
    if (row.external_id && byExt.has(row.external_id)) return { row, dup: 'external_id', match: byExt.get(row.external_id), txn }
    if (seenIds.has(row.external_id)) return { row, dup: 'in_file', txn }; seenIds.add(row.external_id)
    const cands = existing.filter(t => Math.abs(t.amount - row.amount) < 0.005 && Math.abs(new Date(t.date).getTime() - new Date(row.date).getTime()) <= 3 * 86400000)
    const exact = cands.find(t => t.date === row.date && norm(t.payee) === norm(row.payee)); if (exact) return { row, dup: 'same_day_amount_payee', match: exact, txn }
    const near = cands.find(t => { const a = norm(t.payee), b = norm(row.payee); return !!a && !!b && (a.includes(b.split(' ')[0]) || b.includes(a.split(' ')[0])) })
    if (near) return { row, dup: 'near_match', match: near, txn }
    return { row, dup: null, txn }
  })
}
export const DUP_LABEL: Record<DupReason, string> = { external_id: 'Already imported (same id)', same_day_amount_payee: 'Already logged (same day, amount, payee)', near_match: 'Probably logged (same amount within 3 days, similar payee)', in_file: 'Repeated in this file' }
