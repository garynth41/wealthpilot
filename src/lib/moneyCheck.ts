// "Check your money in and out" (0.37.0 — Gary, Nov 21): the rows that are probably counted wrong, each with what to do about it.
//
// Income and spending are only right when money that merely moved is not counted as either. The bank feed cannot always tell: a transfer
// whose other half sits in an account left out of the figures, money sent to a person and sent straight back, a transfer the engine would
// not pair because two rows could be its other half, a payment that was paired as a transfer by mistake. This finds them. Nothing here
// changes anything — the screen (components/MoneyCheck.tsx) offers the fixes: make it one transfer, leave it out, keep it as counted,
// undo a pairing.
//
// A row is asked about once: leaving it out, or keeping it (dedupe_ok — "this is what it looks like, do not pair or ask again"), takes it
// off the list. A description the household said is always fine (settings.checkOk) is never listed.
import type { Account, Data, Settings, Transaction } from '../app/data/types'
import { LIABILITY_KINDS } from '../app/data/types'
import { MAX_GAP_DAYS, namesSomeoneElse, payeeTokens, readsAsPayApp, type DTxn } from './dedupe'
import { isMoveText, merchantIdentity } from './merchants'
import { isSplit } from './splits'
import { addDays, diffDays, today } from './dates'
import { round2 } from './money'

export type CheckKind =
  /** a transfer that reads as a payment to someone else */ | 'mispaired'
  /** sent to a left-out account and the same amount came back */ | 'passthrough'
  /** sent to a person and received back from the same person */ | 'roundtrip'
  /** two rows that read as one move between counted accounts */ | 'pair'
  /** money that came from an account left out of the figures */ | 'from_off'
  /** money that went to an account left out of the figures */ | 'to_off'
  /** reads as a transfer, the other side is not on file */ | 'move'
export interface CheckItem {
  id: string; kind: CheckKind; date: string
  /** the counted rows this is about: both halves of a pair, or every row of a group of like descriptions */
  rows: Transaction[]
  /** 'mispaired': the row merged into the transfer, which undoing brings back */
  dup?: Transaction
  /** the left-out account on the other side, when there is one */
  offAccount?: Account
  /** what income and spending would lose if this were left out */
  income: number; spending: number
  /** the description a rule or "always fine" would use; '' when there is none */
  pattern: string
}
const P2P = { test: (s: string) => readsAsPayApp(s) }
const P2P_WORDS = new Set(['zelle', 'venmo', 'cash', 'app', 'cashapp', 'paypal', 'apple', 'square', 'transaction', 'sent', 'received', 'pmnt', 'rcvd', 'money'])
/** The person a pay-app row names: its plain words, less the app's own and anything with a digit in it (confirmation codes). */
const personWords = (payee?: string | null) => payeeTokens(payee).filter(w => !/\d/.test(w) && !P2P_WORDS.has(w))
/** …as a key: the same person whichever way round the bank wrote the name. */
export const personOf = (payee?: string | null) => personWords(payee).sort().join(' ')
/** …as the bank wrote it, for showing. */
export const personName = (payee?: string | null) => personWords(payee).join(' ').replace(/\b[a-z]/g, c => c.toUpperCase()) || 'someone'
const cents = (t: Transaction) => Math.round((+t.amount || 0) * 100)
const gap = (a: Transaction, b: Transaction) => Math.abs(diffDays(a.date, b.date))
/** How far apart the two ends of money that went out and came back may be. */
export const BACK_DAYS = 3
/** How far back the check looks unless told otherwise. */
export const CHECK_DAYS = 180
export const checkPattern = (payee?: string | null) => merchantIdentity(payee).pattern || ''

export function moneyChecks(d: Data, s: Pick<Settings, 'checkOk'> = {}, opts: { since?: string } = {}): CheckItem[] {
  const since = opts.since ?? addDays(today(), -CHECK_DAYS); const okPat = new Set(s.checkOk || [])
  const acct = new Map([...d.accounts, ...(d.off?.accounts || [])].map(a => [a.id, a])); const offIds = new Set((d.off?.accounts || []).map(a => a.id))
  const asset = (id?: string | null) => { const a = id ? acct.get(id) : undefined; return !!a && !LIABILITY_KINDS.includes(a.kind) }
  const items: CheckItem[] = []
  const sums = (rows: Transaction[]) => ({ income: round2(rows.filter(t => t.kind === 'income').reduce((n, t) => n + t.amount, 0)), spending: round2(rows.filter(t => t.kind === 'expense').reduce((n, t) => n + t.amount, 0)) })

  // a transfer that reads as a payment to someone else: paired by an earlier version of the engine, or by hand
  for (const k of d.transactions) {
    if (k.kind !== 'transfer' || k.status === 'void' || k.dedupe_ok || k.date < since || !k.account_id || !k.to_account_id || !asset(k.account_id) || !asset(k.to_account_id)) continue
    const dup = d.duplicates.find(x => x.duplicate_of === k.id && x.kind === 'income' && x.account_id === k.to_account_id); if (!dup) continue
    // it names someone else, or it went through a pay app while the row it was joined to is a bank's own transfer
    if (namesSomeoneElse(k as unknown as DTxn, [acct.get(k.account_id), acct.get(k.to_account_id)]) || readsAsPayApp(k.payee) !== readsAsPayApp(dup.payee)) items.push({ id: 'mis:' + k.id, kind: 'mispaired', date: k.date, rows: [k], dup, income: 0, spending: 0, pattern: checkPattern(k.payee) })
  }

  // the rows that count as income or spending and have not been looked at
  const open = d.transactions.filter(t => (t.kind === 'income' || t.kind === 'expense') && t.status !== 'void' && !t.duplicate_of && !t.exclude_from_budget && !t.dedupe_ok && t.date >= since && +t.amount > 0 && asset(t.account_id) && !isSplit(d, t) && !okPat.has(checkPattern(t.payee)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  // the other end in a left-out account: the same amount the other way within a few days, on the same rail — a bank transfer with a bank
  // transfer, a pay-app row with a pay-app row — and, when the counted row names a person, only an account that carries that name
  // ("Zelle payment to Gavionne" reaches Gavionne Checking; "Zelle payment from Zonja Francis" did not come from it)
  const label = new Map([...acct.values()].map(a => [a.id, new Set(payeeTokens(`${a.name || ''} ${a.institution || ''}`))]))
  const sameRail = (r: Transaction, o: Transaction) => { const pr = P2P.test(r.payee || ''), po = P2P.test(o.payee || ''); if (pr !== po) return false; const between = [acct.get(r.account_id!), acct.get(o.account_id!)]
    if (!pr) return (isMoveText(r.payee) || isMoveText(o.payee)) && !namesSomeoneElse(r as unknown as DTxn, between) && !namesSomeoneElse(o as unknown as DTxn, between)   // a card purchase on that account is not the other end of a transfer
    const who = personWords(r.payee); return !who.length || who.some(w => label.get(o.account_id!)?.has(w)) }
  const offRows = (d.off?.transactions || []).filter(t => (t.kind === 'income' || t.kind === 'expense') && t.status !== 'void' && !t.duplicate_of && !!t.account_id && offIds.has(t.account_id))
  const offUsed = new Set<string>(), offOf = new Map<string, Transaction>()
  for (const r of open) {
    const c = offRows.filter(o => !offUsed.has(o.id) && o.kind !== r.kind && cents(o) === cents(r) && gap(o, r) <= BACK_DAYS && sameRail(r, o)).sort((a, b) => gap(a, r) - gap(b, r))[0]
    if (c) { offUsed.add(c.id); offOf.set(r.id, c) }
  }
  const used = new Set<string>(); const take = (...rows: Transaction[]) => rows.forEach(r => used.add(r.id))
  const outs = open.filter(t => t.kind === 'expense'), ins = open.filter(t => t.kind === 'income')
  const nearest = (from: Transaction, pool: Transaction[], ok: (t: Transaction) => boolean, days: number) => pool.filter(t => !used.has(t.id) && cents(t) === cents(from) && gap(t, from) <= days && ok(t)).sort((a, b) => gap(a, from) - gap(b, from))[0]

  // sent to a left-out account, and the same amount came back from it
  for (const e of outs) { const x = offOf.get(e.id); if (!x || used.has(e.id)) continue
    const i = nearest(e, ins, t => offOf.get(t.id)?.account_id === x.account_id, BACK_DAYS); if (!i) continue
    take(e, i); items.push({ id: `pass:${e.id}:${i.id}`, kind: 'passthrough', date: i.date > e.date ? i.date : e.date, rows: [e, i], offAccount: acct.get(x.account_id!), ...sums([e, i]), pattern: '' }) }
  // sent to a person through a pay app and received back from the same person
  for (const e of outs) { if (used.has(e.id) || !P2P.test(e.payee || '')) continue; const who = personOf(e.payee); if (!who) continue
    const i = nearest(e, ins, t => P2P.test(t.payee || '') && personOf(t.payee) === who, BACK_DAYS); if (!i) continue
    take(e, i); items.push({ id: `round:${e.id}:${i.id}`, kind: 'roundtrip', date: i.date > e.date ? i.date : e.date, rows: [e, i], ...sums([e, i]), pattern: '' }) }
  // two counted rows that read as one transfer: the engine pairs these on its own unless more than one row could be the other half
  for (const i of ins) { if (used.has(i.id) || offOf.has(i.id) || !isMoveText(i.payee)) continue
    const e = nearest(i, outs, t => t.account_id !== i.account_id && !offOf.has(t.id) && isMoveText(t.payee), MAX_GAP_DAYS); if (!e) continue
    take(e, i); items.push({ id: `pair:${e.id}:${i.id}`, kind: 'pair', date: i.date > e.date ? i.date : e.date, rows: [e, i], ...sums([e, i]), pattern: '' }) }
  // what is left, one row at a time, gathered by description: money to or from a left-out account, and transfers with no other side
  const groups = new Map<string, CheckItem>()
  for (const r of open) { if (used.has(r.id)) continue; const o = offOf.get(r.id)
    const kind: CheckKind | null = o ? (r.kind === 'income' ? 'from_off' : 'to_off') : isMoveText(r.payee) ? 'move' : null; if (!kind) continue
    const pattern = checkPattern(r.payee); const key = `${kind}|${r.kind}|${pattern || r.id}|${o?.account_id || ''}`
    const g = groups.get(key); if (g) { g.rows.push(r); if (r.date > g.date) g.date = r.date; const t = sums(g.rows); g.income = t.income; g.spending = t.spending }
    else groups.set(key, { id: `one:${key}`, kind, date: r.date, rows: [r], offAccount: o ? acct.get(o.account_id!) : undefined, ...sums([r]), pattern }) }
  items.push(...groups.values())
  const order: CheckKind[] = ['mispaired', 'passthrough', 'roundtrip', 'pair', 'from_off', 'to_off', 'move']
  return items.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
}
/** How many things there are to look at, and how much income and spending they put in doubt. */
export function checkSummary(items: CheckItem[]) { return { n: items.length, rows: items.reduce((n, i) => n + i.rows.length, 0), income: round2(items.reduce((n, i) => n + i.income, 0)), spending: round2(items.reduce((n, i) => n + i.spending, 0)) } }

/** What an item is, in a few plain words — the heading on the screen. */
export function checkTitle(i: CheckItem, name: (id?: string | null) => string): string {
  const [a, b] = i.rows; const off = i.offAccount?.name || 'a left-out account'
  switch (i.kind) {
    case 'mispaired': return `${a.payee || 'A payment'} is recorded as a move between your accounts`
    case 'passthrough': return `Sent to ${off} and came back`
    case 'roundtrip': return `Sent to ${personName(a.payee)} and received back`
    case 'pair': return `One move from ${name(a.account_id)} to ${name(b.account_id)}`
    case 'from_off': return `${i.rows.length === 1 ? 'Money' : `${i.rows.length} deposits`} from ${off}`
    case 'to_off': return `${i.rows.length === 1 ? 'Money' : `${i.rows.length} payments`} to ${off}`
    case 'move': return `${i.rows.length === 1 ? 'A transfer' : `${i.rows.length} transfers`} with no other side on file`
  }
}
/** Why it is on the list and how it counts today. */
export function checkWhy(i: CheckItem, name: (id?: string | null) => string): string {
  const [a] = i.rows; const inc = i.rows.some(r => r.kind === 'income'), many = i.rows.length > 1
  switch (i.kind) {
    case 'mispaired': return `It moved from ${name(a.account_id)} to ${name(a.to_account_id)} on paper, but it reads as a payment to someone else, so it is missing from your spending. Undo the pairing to count it as a payment again.`
    case 'passthrough': return 'The same amount went out and came back within a few days. Today it counts once as spending and once as income.'
    case 'roundtrip': return 'The same amount went to this person and came back within a few days. Today it counts once as spending and once as income.'
    case 'pair': return 'Both rows read as a transfer between your own accounts. Until they are one transfer, one counts as spending and the other as income.'
    case 'from_off': return `${i.offAccount?.name || 'That account'} is left out of your figures, so ${many ? 'these count' : 'this counts'} as income. Leave ${many ? 'them' : 'it'} out if it is your own money coming back.`
    case 'to_off': return `${i.offAccount?.name || 'That account'} is left out of your figures, so ${many ? 'these count' : 'this counts'} as spending. Leave ${many ? 'them' : 'it'} out if you do not want ${many ? 'them' : 'it'} in your numbers.`
    case 'move': return `${many ? 'These read' : 'This reads'} as money moved between accounts, but the other account is not connected, so ${many ? 'they count' : 'it counts'} as ${inc ? 'income' : 'spending'}.`
  }
}
