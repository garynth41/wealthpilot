// Group money facts, settle them against each other, match them to what the household already tracks, and describe what Apply will do.
import type { Account, Category, Data, EmailItem, Recurring, Settings } from '../../app/data/types'
import { addDays, diffDays, fmtD, today } from '../dates'
import { close, fm2 } from '../money'
import { liabilities, acctLabel, debtBal } from '../accounts'
import { DEBT_KINDS, eventDate, when, type Fact, type Skip, type PayeeKind } from './extract'

export const key = (s: string) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/\b(inc|llc|corp|pbc|co|the|services?|billing)\b/g, ' ').replace(/[^a-z0-9]+/g, '')
const tok = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9+ ]+/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !/^(the|and|bank|card|credit|mastercard|visa|services?|billing|inc|llc|company|account|subscription|plan|monthly|payment)$/.test(w))
export const nameHit = (a?: string | null, b?: string | null) => { const A = tok(a || ''), B = tok(b || ''); if (!A.length || !B.length) return false; const k = key(a || ''), kb = key(b || ''); return (k.length >= 4 && kb.includes(k)) || (kb.length >= 4 && k.includes(kb)) || A.some(w => B.includes(w)) }
export const LINE_HINT: Partial<Record<PayeeKind, RegExp>> = { phone: /cell|phone|wireless|mobile/i, electric: /electric|power|utilit/i, gasutil: /\bgas\b|natural gas|heat|utilit/i, water: /water|sewer|trash|utilit/i, internet: /internet|cable|wi-?fi/i, insurance: /insurance/i, auto: /car payment|auto loan|car loan|vehicle|loan payment/i, student: /student|loan payment/i, school: /tuition|school|education|childcare/i, rent: /rent|mortgage|housing/i, sub: /subscri|stream/i, hsa: /health/i, card: /credit card payment/i, bnpl: /credit card payment|loan payment/i, loan: /loan payment/i, collection: /loan payment|misc/i }
export const NEW_CAT: Partial<Record<PayeeKind, ['Fixed' | 'Variable', 'Essential' | 'Important' | 'Discretionary', string]>> = { phone: ['Fixed', 'Essential', 'Bills'], electric: ['Variable', 'Essential', 'Housing'], gasutil: ['Variable', 'Essential', 'Housing'], water: ['Variable', 'Essential', 'Housing'], internet: ['Fixed', 'Essential', 'Housing'], insurance: ['Fixed', 'Essential', 'Bills'], auto: ['Fixed', 'Essential', 'Debt'], student: ['Fixed', 'Essential', 'Debt'], school: ['Fixed', 'Essential', 'Bills'], rent: ['Fixed', 'Essential', 'Housing'], sub: ['Fixed', 'Discretionary', 'Bills'], hsa: ['Fixed', 'Important', 'Health'] }

export interface Evidence { msg_id: string; thread_id?: string; src: string; url?: string; subject: string; date: string; /** the message carries a PDF (in memory only — never stored) */ pdf?: boolean }
export type FactG = Fact & { ev: Evidence[]; settled?: FactG; resolvedBy?: FactG; paidBy?: FactG; bill?: FactG }
export type Target = `account:${string}` | `recurring:${string}` | `category:${string}` | 'new-account' | 'new-recurring' | 'new-category' | 'none'
export interface Proposal { kind: 'item' | 'current' | 'info'; f: FactG | (Skip & { ev?: Evidence[] }); checked: boolean; changes: string[]; target: Target; how: string; dup: boolean; auto: boolean; account?: Account | null; category?: Category | null; recurring?: Recurring | null; ex?: EmailItem; why?: string; month?: string }
const rules = (s: Settings) => (s.finmail?.rules || {})

export function matchAccount(d: Data, s: Settings, f: Fact) {
  const all = liabilities(d).concat(d.accounts.filter(a => a.status !== 'Active' && a.status !== 'Closed' && liabilities(d).includes(a)))
  const named = all.filter(a => nameHit(f.payee, a.name) || nameHit(f.payee, a.institution) || (f.merchant && nameHit(f.merchant, a.name)))
  const rule = rules(s)[key(f.payee)]; if (rule?.account && !f.last4) { const a = all.find(x => x.id === rule.account); if (a) return { a, sure: true, how: 'remembered' } }
  if (f.last4) { const x = named.find(a => String(a.last4 || '').slice(-4) === f.last4) || (DEBT_KINDS.has(f.ptype) && !named.length ? all.find(a => String(a.last4 || '').slice(-4) === f.last4) : null)
    if (x) return { a: x, sure: true, how: 'account ··' + f.last4 }; if (named.length && DEBT_KINDS.has(f.ptype)) return { a: null, newAcct: true, how: `no ${f.payee} account ending ${f.last4} yet` } }
  if (rule?.account) { const a = all.find(x => x.id === rule.account); if (a) return { a, sure: true, how: 'remembered' } }
  if (named.length === 1) return { a: named[0], sure: true, how: 'name' }
  if (named.length > 1) { const byDue = f.dueDate && named.find(a => (a.due_date || '').slice(0, 10) === f.dueDate); if (byDue) return { a: byDue, sure: true, how: 'due date' }
    const amt = f.amount ?? f.stmtBal; const byAmt = amt != null && named.find(a => close(amt, a.minimum_payment) || close(amt, a.statement_balance) || close(amt, a.planned_payment)); if (byAmt) return { a: byAmt, sure: false, how: 'amount' }
    return { a: named[0], sure: false, ambiguous: true, how: 'several accounts — check' } }
  return null
}
export function matchRecurring(d: Data, s: Settings, f: Fact) {
  const rule = rules(s)[key(f.payee)]; if (rule?.recurring) { const r = d.recurring.find(x => x.id === rule.recurring && x.status !== 'Cancelled'); if (r) return { r, how: 'remembered' } }
  const cands = d.recurring.filter(r => r.status !== 'Cancelled' && (f.kind === 'income' ? r.kind === 'income' : r.kind !== 'income') && (nameHit(f.payee, r.name) || nameHit(f.payee, r.payee) || (f.merchant && nameHit(f.merchant, r.name))))
  if (cands.length === 1) return { r: cands[0], how: 'name' }
  if (cands.length > 1) { const amt = f.amount ?? f.stmtBal; const byAmt = amt != null && cands.find(r => close(amt, r.amount, 0.1)); return { r: byAmt || cands[0], how: byAmt ? 'amount' : 'name' } }
  return null
}
export function matchCategory(d: Data, s: Settings, f: Fact) {
  const inc = f.kind === 'income'; const cats = d.categories.filter(c => !c.archived && (inc ? c.kind === 'income' : c.kind === 'expense'))
  const rule = rules(s)[key(f.payee)]; if (rule?.none) return { none: true, how: 'remembered: not in the budget' }
  if (rule?.category) { const c = cats.find(x => x.id === rule.category); if (c) return { c, how: 'remembered' } }
  const pick = (re: RegExp) => cats.find(c => re.test(c.name) || re.test(c.group || ''))
  if (inc) { if (f.ptype === 'payroll') return pick(/paycheck|salary|wage|payroll/i) ? { c: pick(/paycheck|salary|wage|payroll/i)!, how: 'paycheck' } : null; if (f.ptype === 'benefit') return pick(/benefit|unemploy/i) ? { c: pick(/benefit|unemploy/i)!, how: 'benefits' } : null; if (f.ptype === 'refund') return pick(/refund|tax|other income/i) ? { c: pick(/refund|tax|other income/i)!, how: 'refund' } : null; return pick(/other income|side/i) ? { c: pick(/other income|side/i)!, how: 'other income' } : null }
  const byName = cats.find(c => nameHit(f.payee, c.name) || (f.merchant && nameHit(f.merchant, c.name))); if (byName) return { c: byName, how: 'name' }
  const re = LINE_HINT[f.ptype]; if (re) { const c = cats.find(x => re.test(x.name)); if (c) return { c, how: 'category' } }
  if (f.receipt || f.ptype === 'other') { const c = pick(/shopping|misc/i); if (c) return { c, how: 'suggested' } }
  return null
}
export function existing(d: Data, f: FactG) { return d.emailItems.find(x => (x.evidence || []).some(e => f.ev.some(y => y.msg_id === e.msg_id))) || d.emailItems.find(x => x.kind === f.kind && key(x.payee || '') === key(f.payee) && ((x.amount == null && f.amount == null) || close(x.amount, f.amount)) && String(x.due_date || '') === String(f.dueDate || '') && Math.abs(diffDays(String(x.txn_date || x.created_at || today()).slice(0, 10), when(f))) <= 5) }
/** The same fact sent twice (reminders) becomes one item with every email as evidence; payments settle scheduled notices and open bills. */
export function group(facts: Array<(Fact | Skip) & { ev: Evidence[] }>): { groups: FactG[]; info: Array<Skip & { ev: Evidence[] }> } {
  const info = facts.filter(f => 'skip' in f) as Array<Skip & { ev: Evidence[] }>; const real = facts.filter(f => !('skip' in f)) as FactG[]
  const groups: FactG[] = []
  for (const f of real.sort((a, b) => a.date.localeCompare(b.date))) {
    const g = groups.find(x => key(x.payee) === key(f.payee) && x.kind === f.kind && (x.last4 || '') === (f.last4 || '') && ((x.amount == null && f.amount == null) || close(x.amount, f.amount)) && (x.dueDate || '') === (f.dueDate || '') && (['bill', 'pastdue', 'declined'].includes(f.kind) || Math.abs(diffDays(when(x), when(f))) <= 3))
    if (g) { g.ev.push(...f.ev); const gr = g as unknown as Record<string, unknown>; (Object.keys(f) as Array<keyof Fact>).forEach(k => { if (gr[k] == null && f[k] != null) gr[k] = f[k] }); g.date = f.date } else groups.push({ ...f, ev: [...f.ev] })
  }
  const paid = groups.filter(g => g.kind === 'paid'); const same = (a: FactG, b: FactG) => key(a.payee) === key(b.payee) || (!!a.last4 && a.last4 === b.last4)
  for (const g of groups) {
    if (g.kind === 'scheduled') { const p = paid.find(x => same(x, g) && close(x.amount, g.amount ?? x.amount) && Math.abs(diffDays(when(x), when(g))) <= 5); if (p) { g.settled = p; p.ev.push(...g.ev) } }
    if (g.kind === 'declined' || g.kind === 'pastdue') { const p = paid.find(x => same(x, g) && when(x) >= g.date); if (p) g.resolvedBy = p }
    if (g.kind === 'bill') { const p = paid.find(x => same(x, g) && when(x) >= addDays(g.stmtDate || g.date, -3) && when(x) <= addDays(g.dueDate || g.date, 10) && (g.amount == null || close(x.amount, g.amount) || close(x.amount, g.minDue) || DEBT_KINDS.has(g.ptype))); if (p) { g.paidBy = p; p.bill = g } }
  }
  return { groups, info }
}
export function propose(d: Data, s: Settings, facts: Array<(Fact | Skip) & { ev: Evidence[] }>): Proposal[] {
  const { groups, info } = group(facts); const out: Proposal[] = []
  for (const g of groups) { if (g.settled) continue; out.push(proposal(d, s, g)) }
  info.forEach(f => { if (f.msgId) out.push({ kind: 'info', f, checked: false, changes: [], target: 'none', how: '', dup: false, auto: false, why: f.skip }) })
  return out
}
export function proposal(d: Data, s: Settings, f: FactG): Proposal {
  const P: Proposal = { kind: 'item', f, checked: true, changes: [], target: 'none', how: '', dup: false, auto: false }
  const ex = existing(d, f); if (ex) { P.kind = 'current'; P.ex = ex; P.checked = false; P.changes.push('already recorded (' + (ex.ref || 'email item') + ')'); return P }
  const m = DEBT_KINDS.has(f.ptype) || liabilities(d).some(a => nameHit(f.payee, a.name)) ? matchAccount(d, s, f) : null
  const rm = f.kind !== 'income' ? matchRecurring(d, s, f) : null; const cm = matchCategory(d, s, f)
  if (m?.a) { P.target = `account:${m.a.id}`; P.account = m.a; P.how = m.how; if (!m.sure) P.checked = false }
  else if ((m && 'newAcct' in m && m.newAcct) || (!m && DEBT_KINDS.has(f.ptype) && ['bill', 'balance'].includes(f.kind) && (!cm || !('c' in cm) || (['card', 'bnpl', 'loc', 'collection', 'loan', 'auto', 'student'].includes(f.ptype) && cm.how !== 'remembered')))) { P.target = 'new-account'; P.how = (m && m.how) || 'new account'; P.checked = f.kind === 'bill' && (!!f.last4 || f.stmtBal != null) && f.conf === 'high' && f.ptype !== 'collection' }
  else if (rm?.r) { P.target = `recurring:${rm.r.id}`; P.recurring = rm.r; P.how = rm.how; P.category = d.categories.find(c => c.id === rm.r.category_id) || null }
  else if (cm && 'c' in cm && cm.c) { P.target = `category:${cm.c.id}`; P.category = cm.c; P.how = cm.how }
  else if (cm && 'none' in cm) { P.target = 'none'; P.how = cm.how }
  else if (['paid', 'scheduled', 'bill'].includes(f.kind)) { P.target = NEW_CAT[f.ptype] ? 'new-category' : 'none'; P.how = 'no matching category yet'; P.checked = !!NEW_CAT[f.ptype] }
  else if (f.kind === 'income') { P.target = 'new-category'; P.how = 'no income category yet' }
  if (f.conf === 'low') P.checked = false
  const a = P.account; const t = today()
  if (f.kind === 'paid' || f.kind === 'income') {
    if (a) { const dup = d.transactions.find(x => x.kind === 'transfer' && x.to_account_id === a.id && close(x.amount, f.amount) && Math.abs(diffDays(x.date, when(f))) <= 3); if (dup) { P.dup = true; P.changes.push(`already recorded (${dup.ref || 'payment'} ${fmtD(dup.date)})`) }
      else { P.changes.push(`payment ${fm2(f.amount)} on ${fmtD(when(f))} → ${acctLabel(a, d.accounts)}`); P.changes.push(`balance ${fm2(debtBal(a))} → ${fm2(Math.max(0, debtBal(a) - (+f.amount! || 0)))}`) }
      if (f.nextDate && f.nextDate !== (a.due_date || '').slice(0, 10)) P.changes.push(`next due ${fmtD(f.nextDate)}${f.nextAmt != null ? ' · ' + fm2(f.nextAmt) : ''}`) }
    else { const dup = d.transactions.find(x => x.kind === (f.kind === 'income' ? 'income' : 'expense') && close(x.amount, f.amount) && Math.abs(diffDays(x.date, when(f))) <= 4 && (nameHit(x.payee, f.payee) || x.category_id === P.category?.id))
      if (dup) { P.dup = true; P.changes.push(`already logged (${fmtD(dup.date)}${dup.payee ? ' · ' + dup.payee : ''})`) }
      else P.changes.push(`${f.kind === 'income' ? 'income' : 'expense'} ${fm2(f.amount)} on ${fmtD(when(f))}${P.category ? ' → ' + P.category.name : P.target === 'new-category' ? ' → new category “' + f.payee + '”' : ''}`) }
    if (f.bill) P.changes.push(`settles the ${f.payee} bill${f.bill.dueDate ? ' due ' + fmtD(f.bill.dueDate) : ''}`)
    if (P.recurring) P.changes.push(`marks ${P.recurring.name} paid`)
    if (P.dup) { P.checked = false; P.kind = 'current' }
  } else if (f.kind === 'bill' || f.kind === 'balance') {
    if (a) { const newer = !a.statement_date || (f.stmtDate || f.date) > a.statement_date.slice(0, 10) || (!!f.dueDate && f.dueDate > (a.due_date || '').slice(0, 10)); const sd = f.stmtDate || (f.kind === 'bill' && (f.stmtBal != null || f.minDue != null) ? f.date : null); const ch: string[] = []
      if (f.stmtBal != null && !close(f.stmtBal, a.statement_balance)) ch.push(`statement balance ${fm2(a.statement_balance)} → ${fm2(f.stmtBal)}`); if (f.minDue != null && !close(f.minDue, a.minimum_payment)) ch.push(`minimum ${fm2(a.minimum_payment)} → ${fm2(f.minDue)}`)
      if (f.dueDate && f.dueDate !== (a.due_date || '').slice(0, 10)) ch.push(`due ${a.due_date ? fmtD(a.due_date) : '—'} → ${fmtD(f.dueDate)}`); if (f.balance != null && !close(f.balance, a.balance)) ch.push(`balance → ${fm2(f.balance)}`); if (sd && sd !== (a.statement_date || '').slice(0, 10) && f.stmtBal != null) ch.push(`statement date → ${fmtD(sd)}`)
      if (!ch.length || !newer) { P.kind = 'current'; P.checked = false; P.changes.push(ch.length ? 'older than the statement you have' : 'matches what you have') } else P.changes.push(...ch) }
    else if (P.target === 'new-account') P.changes.push(`new ${f.ptype === 'bnpl' ? 'buy-now-pay-later' : f.ptype === 'loc' ? 'line of credit' : f.ptype === 'collection' ? 'collection' : f.ptype === 'auto' ? 'auto loan' : f.ptype === 'student' ? 'student loan' : 'card'} account ${f.payee}${f.last4 ? ' ··' + f.last4 : ''}${f.stmtBal != null ? ' · balance ' + fm2(f.stmtBal) : ''}${f.minDue != null ? ' · minimum ' + fm2(f.minDue) : ''}${f.dueDate ? ' · due ' + fmtD(f.dueDate) : ''}`)
    else { P.changes.push(`bill ${f.amount != null ? fm2(f.amount) : ''}${f.dueDate ? ' due ' + fmtD(f.dueDate) : ''}${f.autopay ? ' · autopay' : ''}${P.recurring ? ' → ' + P.recurring.name : P.target === 'new-category' || !P.recurring ? ' → new recurring bill' : ''}`); if (f.paidBy) P.changes.push(`paid ${fmtD(when(f.paidBy))}`) }
  } else if (f.kind === 'scheduled') { P.changes.push(`${f.autopay ? 'autopay' : 'payment'} ${f.amount != null ? fm2(f.amount) : ''}${f.txnDate ? ' on ' + fmtD(f.txnDate) : ''}${f.fromLast4 ? ' from ··' + f.fromLast4 : ''}`); if (a && !a.autopay && f.autopay) P.changes.push(`${acctLabel(a, d.accounts)}: autopay on`); if (f.txnDate && f.txnDate < t) P.changes.push('date has passed — no confirmation email found yet') }
  else { if (f.resolvedBy) P.changes.push(`resolved — paid ${fmtD(when(f.resolvedBy))}`); else P.changes.push(f.kind === 'alert' ? `balance ${f.balance != null ? fm2(f.balance) : 'below zero'}${f.fee ? ` · fee ${fm2(f.fee)}` : ''}` : `${f.amount != null ? fm2(f.amount) : 'amount not stated'}${f.dueDate ? ' · was due ' + fmtD(f.dueDate) : ''}${f.balance != null && f.kind === 'declined' ? ' · balance ' + fm2(f.balance) : ''}`) }
  P.auto = P.checked && !P.dup && f.conf === 'high' && (P.target.startsWith('account:') || P.target.startsWith('category:') || P.target.startsWith('recurring:')) && P.how !== 'several accounts — check'
  return P
}
export const sortForApply = (list: Proposal[]) => { const order: Record<string, number> = { bill: 0, balance: 0, scheduled: 1, paid: 2, income: 2, pastdue: 3, declined: 3, alert: 3 }; return list.map((p, i) => [i, p] as const).sort((a, b) => String(eventDate(a[1].f as Fact)).localeCompare(String(eventDate(b[1].f as Fact))) || (order[(a[1].f as Fact).kind] ?? 5) - (order[(b[1].f as Fact).kind] ?? 5)) }
