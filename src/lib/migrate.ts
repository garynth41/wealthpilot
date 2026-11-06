// Moving in from another app (0.24.0): Mint, YNAB, Quicken (CSV or QIF) and Monarch exports → this household. Unlike a bank
// statement these files hold many accounts and their categories, so the import maps each export account and category to one here
// (or creates it), pairs the two sides of transfers, and skips anything already in the ledger. Balances are not moved: an export is
// history, and today's balance comes from the bank or is typed once.
import type { AccountKind, Category, Data, Transaction } from '../app/data/types'
import { parseCsv, parseDate, rowHash } from './import'
import { parseNum, round2 } from './money'
import { diffDays } from './dates'

export type Source = 'mint' | 'ynab' | 'monarch' | 'quicken' | 'qif'
export const SOURCE_LABEL: Record<Source, string> = { mint: 'Mint', ynab: 'YNAB', monarch: 'Monarch Money', quicken: 'Quicken (CSV)', qif: 'Quicken / QIF' }
/** One line of the export: amount signed from the account's point of view (+ money in, − money out). */
export interface MRow { line: number; date: string; payee: string; amount: number; account: string; category: string; group: string; memo: string; tags: string[]; transferTo: string | null; check: string | null; skip?: string }
export interface Parsed { source: Source; rows: MRow[]; skipped: MRow[]; accounts: Array<{ name: string; count: number; out: number; inn: number }>; categories: Array<{ name: string; group: string; count: number; out: number; inn: number }>; from: string | null; to: string | null }

const H = (h: string) => h.trim().toLowerCase().replace(/\s+/g, ' ')
export function detectSource(headers: string[]): Source | null {
  const h = new Set(headers.map(H)); const has = (...k: string[]) => k.every(x => h.has(x))
  if (has('date', 'description', 'amount', 'transaction type', 'account name')) return 'mint'
  if (has('account', 'date', 'payee', 'outflow', 'inflow')) return 'ynab'
  if (has('date', 'merchant', 'category', 'account', 'amount') && (h.has('original statement') || h.has('notes'))) return 'monarch'
  if (h.has('date') && h.has('amount') && h.has('account') && (h.has('payee') || h.has('description')) && h.has('category')) return 'quicken'
  return null
}
const TRANSFER_CAT = /^(transfer|transfers|credit card payment|transfer for cash spending|balance adjustment)$/i
const isOpening = (payee: string, cat: string) => /^(starting balance|opening balance)$/i.test(payee.trim()) || /ready to assign|to be budgeted/i.test(cat) && /starting balance/i.test(payee)

function fromCsv(text: string): { source: Source; rows: MRow[] } | null {
  const all = parseCsv(text); if (all.length < 2) return null
  const head = all[0].map(H); const source = detectSource(all[0]); if (!source) return null
  const col = (...names: string[]) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i } return -1 }
  const get = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '')
  const out: MRow[] = []
  all.slice(1).forEach((r, k) => {
    const line = k + 2; let amount = 0, payee = '', category = '', group = '', account = '', memo = '', tags: string[] = [], transferTo: string | null = null, check: string | null = null
    const date = parseDate(get(r, col('date')))
    if (source === 'mint') {
      payee = get(r, col('description')) || get(r, col('original description')); const v = Math.abs(parseNum(get(r, col('amount'))) ?? 0); amount = /credit/i.test(get(r, col('transaction type'))) ? v : -v
      category = get(r, col('category')); account = get(r, col('account name')); memo = get(r, col('notes')); tags = get(r, col('labels')).split(/[,;]/).map(x => x.trim()).filter(Boolean)
    } else if (source === 'ynab') {
      payee = get(r, col('payee')); account = get(r, col('account')); memo = get(r, col('memo'))
      amount = round2((parseNum(get(r, col('inflow'))) ?? 0) - (parseNum(get(r, col('outflow'))) ?? 0))
      const cg = get(r, col('category group/category')); group = get(r, col('category group')) || (cg.includes(':') ? cg.split(':')[0].trim() : ''); category = get(r, col('category')) || (cg.includes(':') ? cg.split(':').slice(1).join(':').trim() : cg)
      const m = payee.match(/^Transfer\s*:\s*(.+)$/i); if (m) { transferTo = m[1].trim(); category = 'Transfer' }
      const flag = get(r, col('flag')); if (flag) tags = [flag.toLowerCase()]
    } else if (source === 'monarch') {
      payee = get(r, col('merchant')) || get(r, col('original statement')); amount = parseNum(get(r, col('amount'))) ?? 0; category = get(r, col('category')); account = get(r, col('account')); memo = get(r, col('notes'))
      tags = get(r, col('tags')).split(/[,;]/).map(x => x.trim()).filter(Boolean)
    } else {
      payee = get(r, col('payee', 'description')); amount = parseNum(get(r, col('amount'))) ?? 0; category = get(r, col('category')); account = get(r, col('account')); memo = get(r, col('memo', 'notes')); check = get(r, col('num', 'check #', 'check number')) || null
      tags = get(r, col('tag', 'tags')).split(/[,;:]/).map(x => x.trim()).filter(Boolean)
      const m = category.match(/^\[(.+)\]$/) || category.match(/^Transfer (?:to|from) (.+)$/i); if (m) { transferTo = m[1].trim(); category = 'Transfer' }
      if (category.includes(':')) { group = category.split(':')[0].trim(); category = category.split(':').slice(1).join(':').trim() }
    }
    const row: MRow = { line, date: date || '', payee, amount: round2(amount), account: account || 'Imported account', category, group, memo, tags, transferTo, check }
    if (!date) row.skip = 'no readable date'; else if (!amount) row.skip = 'zero amount'; else if (isOpening(payee, category)) row.skip = 'opening balance'
    out.push(row)
  })
  return { source, rows: out }
}

/** Quicken Interchange Format: !Account blocks name the account, !Type:… blocks hold transactions (D date, T amount, P payee, L category or [transfer account], M memo, N check). */
export function parseQif(text: string): MRow[] {
  const out: MRow[] = []; let account = 'Imported account', inAccount = false, cur: Record<string, string> = {}, line = 0, inTxn = false
  const flush = () => { if (!inTxn || !cur.D) { cur = {}; return } const date = parseDate(cur.D.replace(/'/g, '/').replace(/\s+/g, '')) || ''; const amount = parseNum(cur.T ?? cur.U ?? '') ?? 0
    let category = cur.L || '', group = '', transferTo: string | null = null; const m = category.match(/^\[(.+)\]$/); if (m) { transferTo = m[1]; category = 'Transfer' } else if (category.includes(':')) { group = category.split(':')[0]; category = category.split(':').slice(1).join(':') }
    const row: MRow = { line, date, payee: cur.P || '', amount: round2(amount), account, category, group, memo: cur.M || '', tags: [], transferTo, check: cur.N || null }
    if (!date) row.skip = 'no readable date'; else if (!amount) row.skip = 'zero amount'; else if (/^opening balance$/i.test(row.payee)) row.skip = 'opening balance'
    out.push(row); cur = {} }
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) { line++; const l = raw.trimEnd(); if (!l) continue
    if (l.startsWith('!')) { flush(); const t = l.toLowerCase(); inAccount = t === '!account'; inTxn = t.startsWith('!type:') && !/!type:(cat|class|memorized|prices|security)/.test(t); continue }
    if (l === '^') { if (inAccount) { account = cur.N || account; cur = {} } else flush(); continue }
    const k = l[0], v = l.slice(1); if (k === 'S' || k === 'E' || k === '$') continue   // split lines: the parent's L and T stand for the whole
    cur[k] = v }
  flush(); return out
}

/** Read an export file (CSV from Mint / YNAB / Monarch / Quicken, or QIF) into rows with the accounts and categories it uses. */
export function parseExport(text: string, name = ''): Parsed | null {
  const qif = /\.qif$/i.test(name) || /^!(type|account|option)/im.test(text.slice(0, 500))
  const res = qif ? { source: 'qif' as Source, rows: parseQif(text) } : fromCsv(text); if (!res || !res.rows.length) return null
  const rows = res.rows.filter(r => !r.skip), skipped = res.rows.filter(r => r.skip)
  const acc = new Map<string, { name: string; count: number; out: number; inn: number }>(), cat = new Map<string, { name: string; group: string; count: number; out: number; inn: number }>()
  for (const r of rows) { const a = acc.get(r.account) || { name: r.account, count: 0, out: 0, inn: 0 }; a.count++; if (r.amount < 0) a.out++; else a.inn++; acc.set(r.account, a)
    if (r.category && !TRANSFER_CAT.test(r.category) && !r.transferTo) { const c = cat.get(r.category) || { name: r.category, group: r.group, count: 0, out: 0, inn: 0 }; c.count++; if (r.amount < 0) c.out++; else c.inn++; cat.set(r.category, c) } }
  const dates = rows.map(r => r.date).sort()
  return { source: res.source, rows, skipped, accounts: [...acc.values()].sort((a, b) => b.count - a.count), categories: [...cat.values()].sort((a, b) => b.count - a.count), from: dates[0] || null, to: dates[dates.length - 1] || null }
}

// ---------------- mapping ----------------
const norm = (s?: string | null) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
export function guessKind(name: string, out: number, inn: number): AccountKind {
  const n = name.toLowerCase()
  if (/visa|mastercard|amex|american express|discover|credit card|\bcard\b|sapphire|freedom|venture/.test(n)) return 'credit_card'
  if (/mortgage|heloc/.test(n)) return 'mortgage'; if (/auto loan|car loan/.test(n)) return 'auto_loan'; if (/student/.test(n)) return 'student_loan'; if (/loan|line of credit/.test(n)) return /line/.test(n) ? 'line_of_credit' : 'loan'
  if (/401|403b|ira\b|roth|pension|retire/.test(n)) return 'retirement'; if (/brokerage|invest|stock|etf/.test(n)) return 'investment'
  if (/saving|money market|emergency|hysa|high yield/.test(n)) return 'savings'; if (/cash|wallet/.test(n)) return 'cash'
  return out > inn * 4 && /card/.test(n) ? 'credit_card' : 'checking'
}
/** Map each export account to an account here by name (or name + last four), else propose creating it. */
export function proposeAccounts(d: Data, p: Parsed): Record<string, { target: string; kind: AccountKind }> {
  const out: Record<string, { target: string; kind: AccountKind }> = {}
  for (const a of p.accounts) {
    const n = norm(a.name), last4 = a.name.match(/(\d{4})\D*$/)?.[1]
    const hit = d.accounts.find(x => norm(x.name) === n) || (last4 ? d.accounts.find(x => x.last4 === last4) : undefined) || d.accounts.find(x => n.length > 3 && (norm(x.name).includes(n) || n.includes(norm(x.name)) && norm(x.name).length > 3))
    out[a.name] = hit ? { target: hit.id, kind: hit.kind } : { target: 'new', kind: guessKind(a.name, a.out, a.inn) }
  }
  return out
}
/** Common names in other apps → a category here (by name). */
const ALIAS: Record<string, string[]> = { groceries: ['groceries', 'grocery', 'food groceries'], 'dining out': ['restaurants', 'fast food', 'dining', 'restaurants bars', 'coffee shops', 'food dining'], fuel: ['gas fuel', 'gas', 'auto gas', 'gas stations'], rent: ['rent', 'mortgage rent'], electric: ['utilities electric', 'electric', 'electricity', 'gas electric'], internet: ['internet', 'internet cable', 'mobile phone internet'], phone: ['mobile phone', 'phone', 'cell phone'], shopping: ['shopping', 'clothing', 'amazon'], paycheck: ['paycheck', 'salary', 'income paycheck', 'payroll'], 'subscriptions streaming': ['subscriptions', 'streaming', 'entertainment subscriptions', 'television'] }
export function proposeCategories(d: Data, p: Parsed): Record<string, string> {
  const cats = d.categories.filter(c => !c.archived); const byName = new Map(cats.map(c => [norm(c.name), c]))
  const out: Record<string, string> = {}
  for (const c of p.categories) {
    const n = norm(c.name); let hit: Category | undefined = byName.get(n) || cats.find(x => norm(x.name) === norm(`${c.group} ${c.name}`))
    if (!hit) for (const [ours, theirs] of Object.entries(ALIAS)) if (theirs.includes(n)) { hit = cats.find(x => norm(x.name) === ours || norm(x.name).startsWith(ours)); if (hit) break }
    if (!hit) hit = cats.find(x => n.length > 4 && (norm(x.name).includes(n) || n.includes(norm(x.name))) && norm(x.name).length > 4)
    out[c.name] = hit ? hit.id : c.count >= 5 ? 'new' : 'none'
  }
  return out
}

// ---------------- building ----------------
export interface Plan { add: Array<Partial<Transaction>>; dups: number; transfers: number; oneSided: number; byAccount: Record<string, number>; skippedAccounts: number }
/** The two legs of a transfer between accounts in the file (opposite amounts within 3 days) become one transfer; a leg whose other
 *  side is not in the file is kept but left out of the budget. Rows already in the ledger — same external id, or the same account,
 *  amount and day with a similar payee — are skipped. */
export function buildPlan(d: Data, p: Parsed, amap: Record<string, string>, cmap: Record<string, string | null>, opts: { since?: string | null } = {}): Plan {
  const rows = p.rows.filter(r => amap[r.account] && amap[r.account] !== 'skip' && (!opts.since || r.date >= opts.since))
  const skippedAccounts = p.rows.filter(r => !amap[r.account] || amap[r.account] === 'skip').length
  const isTransfer = (r: MRow) => !!r.transferTo || TRANSFER_CAT.test(r.category)
  const used = new Set<number>(); const out: Array<Partial<Transaction>> = []; let transfers = 0, oneSided = 0
  const seen = new Map<string, number>(); const ext = (r: MRow) => { const base = `${p.source}|${r.account}|${r.date}|${r.amount}|${r.payee}`; const n = seen.get(base) || 0; seen.set(base, n + 1); return `mig:${p.source}:${rowHash(r.date, r.amount, r.account + '|' + r.payee, n)}` }
  rows.forEach((r, i) => {
    if (used.has(i)) return
    const acct = amap[r.account]
    if (isTransfer(r)) {
      const j = rows.findIndex((x, k) => k !== i && !used.has(k) && isTransfer(x) && x.account !== r.account && Math.abs(x.amount + r.amount) < 0.005 && Math.abs(diffDays(x.date, r.date)) <= 3 && (!r.transferTo || norm(r.transferTo) === norm(x.account)))
      if (j >= 0) { used.add(i); used.add(j); const out_ = r.amount < 0 ? r : rows[j], in_ = r.amount < 0 ? rows[j] : r
        out.push({ date: out_.date, kind: 'transfer', amount: Math.abs(r.amount), account_id: amap[out_.account], to_account_id: amap[in_.account], payee: out_.payee || `Transfer to ${in_.account}`, memo: out_.memo || null, tags: [], status: 'cleared', source: 'import', external_id: ext(out_), exclude_from_budget: false }); transfers++; return }
      const other = r.transferTo ? Object.entries(amap).find(([name]) => norm(name) === norm(r.transferTo!))?.[1] || d.accounts.find(a => norm(a.name) === norm(r.transferTo!))?.id : undefined
      used.add(i)
      if (other && other !== 'skip' && other !== 'new') { out.push({ date: r.date, kind: 'transfer', amount: Math.abs(r.amount), account_id: r.amount < 0 ? acct : other, to_account_id: r.amount < 0 ? other : acct, payee: r.payee || 'Transfer', memo: r.memo || null, tags: [], status: 'cleared', source: 'import', external_id: ext(r), exclude_from_budget: false }); transfers++; return }
      oneSided++
      out.push({ date: r.date, kind: r.amount < 0 ? 'expense' : 'income', amount: Math.abs(r.amount), account_id: acct, payee: r.payee || 'Transfer', memo: r.memo || null, tags: ['transfer'], status: 'cleared', source: 'import', external_id: ext(r), exclude_from_budget: true }); return
    }
    used.add(i); const c = cmap[r.category]; const cat = c && c !== 'none' && c !== 'new' ? c : null
    out.push({ date: r.date, kind: r.amount < 0 ? 'expense' : 'income', amount: Math.abs(r.amount), account_id: acct, category_id: cat, payee: r.payee || null, memo: r.memo || null, check_number: r.check && /^\d+$/.test(r.check) ? r.check : null, tags: r.tags.map(t => t.toLowerCase()), status: 'cleared', source: 'import', external_id: ext(r), exclude_from_budget: false })
  })
  // duplicates of what is already in the ledger
  const byExt = new Set([...d.transactions, ...(d.duplicates || [])].map(t => t.external_id).filter(Boolean)); let dups = 0; const add: Array<Partial<Transaction>> = []; const byAccount: Record<string, number> = {}
  for (const t of out) {
    const dup = (t.external_id && byExt.has(t.external_id)) || d.transactions.some(x => x.status !== 'void' && x.account_id === t.account_id && Math.abs(x.amount - (t.amount || 0)) < 0.005 && Math.abs(diffDays(x.date, t.date!)) <= 2 && (x.kind === t.kind) && (!t.payee || !x.payee || norm(x.payee).split(' ')[0] === norm(t.payee).split(' ')[0]))
    if (dup) { dups++; continue } add.push(t); byAccount[t.account_id || ''] = (byAccount[t.account_id || ''] || 0) + 1
  }
  return { add, dups, transfers, oneSided, byAccount, skippedAccounts }
}
/** Placeholder ids ('new:<export name>') resolved once the new accounts and categories exist. */
export function resolveIds(rows: Array<Partial<Transaction>>, ids: Record<string, string>): Array<Partial<Transaction>> {
  return rows.map(t => ({ ...t, account_id: t.account_id && ids[t.account_id] ? ids[t.account_id] : t.account_id, to_account_id: t.to_account_id && ids[t.to_account_id] ? ids[t.to_account_id] : t.to_account_id, category_id: t.category_id && ids[t.category_id] ? ids[t.category_id] : t.category_id }))
}
export const isPlaceholder = (id?: string | null) => !!id && id.startsWith('new:')
export const accountsFrom = (amap: Record<string, { target: string; kind: AccountKind }>) => Object.fromEntries(Object.entries(amap).map(([n, v]) => [n, v.target === 'new' ? 'new:acct:' + n : v.target]))
export const categoriesFrom = (cmap: Record<string, string>) => Object.fromEntries(Object.entries(cmap).map(([n, v]) => [n, v === 'new' ? 'new:cat:' + n : v === 'none' ? null : v]))
