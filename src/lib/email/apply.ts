// Apply approved proposals: write transactions, statements, accounts, recurring items and email_items through the store.
import type { Account, Category, Collection, Data, EmailItem, Recurring, RowOf, Settings } from '../../app/data/types'
import { addDays, today } from '../dates'
import { debtDueState } from '../accounts'
import { statementUpdate } from '../statements'
import { post } from '../ledger'
import { maskDigits, when, type Fact } from './extract'
import { key, NEW_CAT, sortForApply, type Evidence, type FactG, type Proposal, type Target } from './propose'

export interface Ctx {
  data: () => Data; settings: () => Settings
  insert: <C extends Collection>(coll: C, row: Partial<RowOf<C>>) => Promise<RowOf<C>>
  update: <C extends Collection>(coll: C, id: string, patch: Partial<RowOf<C>>) => Promise<RowOf<C>>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  ledger: (rows: Array<{ message_id: string; src: string; decision: 'applied' | 'ignored'; subject?: string; message_at?: string | null }>) => Promise<void>
  /** 0.21.0: file the message's PDF (statement or receipt) on the row just written; absent when the household has it off */
  attachPdf?: (ev: Evidence, target: { statement_id?: string; transaction_id?: string }) => Promise<number>
}
/** Attach the first PDF any of the item's messages carries. Never fails the apply: a missing file is not worth losing the item. */
const filePdf = async (ctx: Ctx, f: FactG, target: { statement_id?: string; transaction_id?: string }) => { const e = ctx.attachPdf && f.ev.find(x => x.pdf); if (!e) return; try { await ctx.attachPdf!(e, target) } catch (err) { console.warn('pdf', err) } }
export interface ApplyInput { amount?: number | null; date?: string | null; target?: Target; name?: string; accountId?: string | null }
const ACCT_KIND: Record<string, Account['kind']> = { bnpl: 'bnpl', loc: 'line_of_credit', auto: 'auto_loan', student: 'student_loan', collection: 'collection', loan: 'loan', card: 'credit_card' }

export async function applyOne(ctx: Ctx, p: Proposal, inp: ApplyInput = {}): Promise<EmailItem> {
  const f = { ...(p.f as FactG) }; const d = ctx.data()
  if (inp.amount != null && inp.amount !== ('' as unknown)) f.amount = +inp.amount
  if (inp.date) { if (f.kind === 'bill' || f.kind === 'pastdue') f.dueDate = inp.date; else f.txnDate = inp.date }
  const tgt: Target = inp.target || p.target
  let account: Account | null = tgt.startsWith('account:') ? d.accounts.find(a => a.id === tgt.slice(8)) || null : null
  let recurring: Recurring | null = tgt.startsWith('recurring:') ? d.recurring.find(r => r.id === tgt.slice(10)) || null : null
  let category: Category | null = tgt.startsWith('category:') ? d.categories.find(c => c.id === tgt.slice(9)) || null : recurring ? d.categories.find(c => c.id === recurring!.category_id) || null : null
  const payFrom = inp.accountId || d.accounts.find(a => a.kind === 'checking' && a.status === 'Active')?.id || null
  const rec: Partial<EmailItem> = { kind: f.kind, payee: f.payee, last4: f.last4 || null, amount: f.amount ?? null, min_due: f.minDue ?? null, balance: f.balance ?? f.stmtBal ?? null, fee: f.fee ?? null, due_date: f.dueDate || null, txn_date: f.kind === 'bill' ? f.stmtDate || f.date : f.txnDate || f.date, status: '', autopay: !!f.autopay, src: f.ev[0]?.src || 'gmail', evidence: f.ev.map(e => ({ msg_id: e.msg_id, thread_id: e.thread_id, src: e.src, url: e.url || '', subject: maskDigits(e.subject).slice(0, 160), date: e.date })), notes: '' }
  if (tgt === 'new-account' && ['bill', 'balance', 'declined', 'pastdue'].includes(f.kind)) {
    const sd = f.stmtDate || f.date
    account = await ctx.insert('accounts', { name: inp.name || f.payee, kind: ACCT_KIND[f.ptype] || 'credit_card', institution: f.payee, last4: f.last4 || null, apr: 0, balance: +(f.balance ?? f.stmtBal ?? 0) || 0, balance_as_of: sd, statement_date: sd, statement_balance: +(f.stmtBal ?? f.balance ?? 0) || 0, minimum_payment: +(f.minDue ?? 0) || 0, due_date: f.dueDate || null, planned_payment: +(f.minDue ?? 0) || 0, autopay: !!f.autopay, include_in_cash: false, include_in_net_worth: true, status: 'Active', sort_order: d.accounts.length + 1, notes: 'Added from email' + (f.ptype === 'collection' ? ' — collection account' : '') })
    category = d.categories.find(c => /credit card payment|loan payment/i.test(c.name) && (ACCT_KIND[f.ptype] === 'credit_card' ? /card/i.test(c.name) : /loan/i.test(c.name))) || null
  }
  if (tgt === 'new-category') { const [cost, pri, grp] = NEW_CAT[f.ptype] || ['Variable', 'Important', f.kind === 'income' ? 'Income' : 'Other']; category = await ctx.insert('categories', { name: inp.name || f.payee, group: grp, kind: f.kind === 'income' ? 'income' : 'expense', priority: pri, cost_type: cost, default_budget: f.amount ?? 0, budget_cadence: 'period', rollover: false, sort_order: d.categories.length + 1, archived: false, notes: 'Added from email' }) }
  if (tgt === 'new-recurring' || (f.kind === 'bill' && !account && !recurring && category && f.dueDate)) {
    recurring = await ctx.insert('recurring', { name: inp.name || f.payee, payee: f.payee, kind: f.ptype === 'sub' ? 'subscription' : 'bill', amount: +(f.amount ?? f.stmtBal ?? 0) || 0, amount_varies: ['electric', 'gasutil', 'water'].includes(f.ptype), frequency: 'monthly', day_of_month: f.dueDate ? +f.dueDate.slice(8) : null, next_due: f.dueDate || null, account_id: payFrom, category_id: category?.id || null, autopay: !!f.autopay, reminder_days: 3, status: 'Active', sort_order: d.recurring.length + 1, notes: 'Added from email' })
  }
  if (account) rec.account_id = account.id; if (category) rec.category_id = category.id; if (recurring) rec.recurring_id = recurring.id
  const date = f.txnDate || f.date
  if ((f.kind === 'paid' || f.kind === 'income') && !p.dup) {
    if (account) {
      const tx = await ctx.insert('transactions', { date, kind: 'transfer', amount: +f.amount! || 0, account_id: payFrom, to_account_id: account.id, category_id: (category?.id ?? d.categories.find(c => /credit card payment|loan payment/i.test(c.name))?.id) ?? null, payee: f.payee, memo: 'From email: ' + maskDigits(f.subject).slice(0, 80), tags: [], status: 'cleared', source: 'email', recurring_id: recurring?.id || null, exclude_from_budget: false })
      rec.transaction_id = tx.id
      const before = account.statement_date && date < account.statement_date.slice(0, 10)
      if (!before) await post(ctx.data(), (id, patch) => ctx.update('accounts', id, patch), tx, 1, date)
      const patch: Partial<Account> = {}
      if (account.due_date && (+f.amount! || 0) >= (+account.minimum_payment || 0) - 0.005 && date <= addDays(account.due_date.slice(0, 10), 3)) patch.last_paid_due = account.due_date.slice(0, 10)
      if (f.nextDate && f.nextDate > (account.due_date || '').slice(0, 10)) { patch.due_date = f.nextDate; if (f.nextAmt != null) patch.minimum_payment = f.nextAmt; patch.last_paid_due = null }
      if (Object.keys(patch).length) await ctx.update('accounts', account.id, patch)
      const st = d.statements.filter(s => s.account_id === account!.id && !s.paid_on).sort((a, b) => b.statement_date.localeCompare(a.statement_date))[0]; if (st) await ctx.update('statements', st.id, { paid_on: date, paid_amount: +f.amount! || 0 })
    } else {
      const tx = await ctx.insert('transactions', { date, kind: f.kind === 'income' ? 'income' : 'expense', amount: +f.amount! || 0, account_id: payFrom, category_id: category?.id || null, payee: f.payee + (f.merchant && f.merchant !== f.payee ? ' · ' + f.merchant : ''), memo: f.kind === 'income' && f.bank ? 'Deposit via ' + f.bank : 'From email', tags: [], status: 'cleared', source: 'email', recurring_id: recurring?.id || null, exclude_from_budget: false })
      rec.transaction_id = tx.id; await post(ctx.data(), (id, patch) => ctx.update('accounts', id, patch), tx, 1, date)
      await filePdf(ctx, f, { transaction_id: tx.id })
    }
    if (recurring) { await ctx.update('recurring', recurring.id, { last_paid_on: date, last_paid_amount: +f.amount! || 0 }); const occ = d.occurrences.find(o => o.recurring_id === recurring!.id && !['paid', 'skipped'].includes(o.status) && Math.abs(new Date(o.due_date).getTime() - new Date(date).getTime()) < 15 * 86400000); if (occ) await ctx.update('occurrences', occ.id, { status: 'paid', paid_on: date, transaction_id: rec.transaction_id }) }
    rec.status = f.kind === 'income' ? 'Received' : 'Paid'
  } else if ((f.kind === 'bill' || f.kind === 'balance') && account && tgt !== 'new-account') {
    const sd = f.stmtDate || (f.stmtBal != null || f.minDue != null ? f.date : null); const patch: Partial<Account> = {}
    if (f.stmtBal != null && sd && sd !== (account.statement_date || '').slice(0, 10)) { const st = await ctx.insert('statements', { account_id: account.id, statement_date: sd, statement_balance: f.stmtBal, minimum_payment: f.minDue ?? (+account.minimum_payment || 0), due_date: f.dueDate || null, source: 'email' }); rec.statement_id = st.id; await filePdf(ctx, f, { statement_id: st.id })
      // a statement is a snapshot as of its date: it moves the current balance only when nothing newer (a later balance or the bank feed) is on file
      const su = statementUpdate(account, { statement_date: sd, statement_balance: f.stmtBal, minimum_payment: f.minDue ?? (+account.minimum_payment || 0), due_date: f.dueDate || null })
      if (su.newest) { patch.statement_date = sd; patch.statement_balance = f.stmtBal; patch.last_paid_due = null }
      if (su.balanceMoved) { patch.balance = f.balance ?? f.stmtBal; patch.balance_as_of = sd } }
    if (f.minDue != null) patch.minimum_payment = f.minDue; if (f.dueDate && f.dueDate !== (account.due_date || '').slice(0, 10)) { patch.due_date = f.dueDate; if (!patch.statement_date && f.dueDate > (account.due_date || '').slice(0, 10)) patch.last_paid_due = null }
    if (f.balance != null && f.kind === 'balance') { patch.balance = f.balance; patch.balance_as_of = f.date } if (f.autopay && !account.autopay && f.kind === 'bill') patch.autopay = true
    if (Object.keys(patch).length) await ctx.update('accounts', account.id, patch); rec.status = f.kind === 'balance' ? 'Updated' : f.paidBy ? 'Paid' : 'Due'
  } else if (f.kind === 'bill') {
    if (recurring && f.dueDate) { const occ = d.occurrences.find(o => o.recurring_id === recurring!.id && o.due_date === f.dueDate); if (!occ) { const o = await ctx.insert('occurrences', { recurring_id: recurring.id, due_date: f.dueDate, amount: +(f.amount ?? recurring.amount) || 0, status: f.paidBy ? 'paid' : 'due', paid_on: f.paidBy ? when(f.paidBy) : null, notes: 'From email' }); rec.recurring_id = recurring.id; void o } else if (f.amount != null && !close2(f.amount, occ.amount)) await ctx.update('occurrences', occ.id, { amount: f.amount }) }
    if (recurring && f.amount != null && !recurring.amount_varies && !close2(f.amount, recurring.amount)) await ctx.update('recurring', recurring.id, { amount: f.amount, next_due: f.dueDate || recurring.next_due })
    rec.status = f.paidBy ? 'Paid' : 'Due'
  } else if (f.kind === 'scheduled') {
    if (account && f.autopay && !account.autopay) await ctx.update('accounts', account.id, { autopay: true })
    if (recurring && f.txnDate) { const occ = d.occurrences.find(o => o.recurring_id === recurring!.id && Math.abs(new Date(o.due_date).getTime() - new Date(f.txnDate!).getTime()) < 10 * 86400000); if (!occ) await ctx.insert('occurrences', { recurring_id: recurring.id, due_date: f.txnDate, amount: +(f.amount ?? recurring.amount) || 0, status: 'scheduled', notes: 'Scheduled per email' }); else if (occ.status === 'due') await ctx.update('occurrences', occ.id, { status: 'scheduled' }) }
    rec.status = 'Scheduled'
  } else { rec.status = f.resolvedBy ? 'Resolved' : f.kind === 'declined' ? 'Declined' : f.kind === 'alert' ? 'Alert' : 'Overdue' }
  const row = await ctx.insert('emailItems', rec)
  // a payment settles the open email bill for the same payee
  if (f.kind === 'paid') { const bill = ctx.data().emailItems.filter(x => x.id !== row.id && ['bill', 'scheduled'].includes(x.kind) && !['Paid', 'Resolved'].includes(x.status || '') && (key(x.payee || '') === key(f.payee) || (x.account_id && x.account_id === rec.account_id)) && (!x.due_date || x.due_date.slice(0, 10) >= addDays(date, -35))).sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')))[0]
    if (bill) { await ctx.update('emailItems', bill.id, { status: 'Paid', bill_item_id: row.id }); await ctx.update('emailItems', row.id, { bill_item_id: bill.id }) } }
  // remember where this payee goes
  const rk = key(f.payee); if (rk) { const rules = { ...(ctx.settings().finmail?.rules || {}) }; const prev = rules[rk] || {}; const next = account ? { account: account.id } : recurring ? { recurring: recurring.id, category: category?.id } : category ? { category: category.id } : tgt === 'none' && ['paid', 'income', 'bill'].includes(f.kind) ? { none: true } : prev
    if (JSON.stringify(prev) !== JSON.stringify(next)) { rules[rk] = next; await ctx.saveSettings({ finmail: { ...(ctx.settings().finmail || {}), rules } }) } }
  return row
}
const close2 = (a: number, b: number) => Math.abs(+a - +b) <= Math.max(1, Math.abs(+b) * 0.02)
/** A payment or deposit needs an amount the email actually gave (or you typed): never file one at $0 (0.25.0). */
export function missingAmounts(list: Proposal[], inputs: ApplyInput[] = []): string[] {
  return list.flatMap((p, i) => { const f = p.f as FactG; const inp = inputs[i] || {}; if (!(f.kind === 'paid' || f.kind === 'income') || p.dup) return []
    const typed = inp.amount != null && (inp.amount as unknown) !== '' ? +inp.amount : null; const amt = typed ?? (f.amount != null ? +f.amount : null)
    return amt != null && amt > 0 ? [] : [f.payee || 'an item'] })
}
export async function applyMany(ctx: Ctx, list: Proposal[], inputs: ApplyInput[] = []) {
  const missing = missingAmounts(list, inputs)
  if (missing.length) throw new Error(`Type the amount for ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''} — the email did not show one, and nothing was filed`)
  const done: Proposal[] = []
  for (const [i, p] of sortForApply(list)) { await applyOne(ctx, p, inputs[i] || {}); done.push(p) }
  await ctx.ledger(dedupe(list.flatMap(p => ((p.f as FactG).ev || []).map(e => ({ message_id: e.msg_id, src: e.src, decision: 'applied' as const, subject: maskDigits(e.subject).slice(0, 200), message_at: e.date ? new Date(e.date + 'T12:00:00').toISOString() : null })))))
  return done
}
export async function ignoreMany(ctx: Ctx, list: Proposal[]) {
  await ctx.ledger(dedupe(list.flatMap(p => { const f = p.f as FactG; const ev = f.ev && f.ev.length ? f.ev : [{ msg_id: f.msgId, src: 'gmail', subject: f.subject, date: f.date }]; return ev.map(e => ({ message_id: e.msg_id, src: e.src || 'gmail', decision: 'ignored' as const, subject: maskDigits(e.subject || '').slice(0, 200), message_at: e.date ? new Date(e.date + 'T12:00:00').toISOString() : null })) })))
}
const dedupe = <T extends { message_id: string }>(rows: T[]) => [...new Map(rows.map(r => [r.message_id, r])).values()]
export const statusOf = (x: EmailItem, t = today()) => {
  const due = x.due_date?.slice(0, 10) || null, on = x.txn_date?.slice(0, 10) || null
  if (['Paid', 'Received', 'Resolved'].includes(x.status || '')) return { label: x.status!, cls: 'good' }
  if (x.status === 'Updated') return { label: 'Balance updated', cls: 'idle' }
  if (x.kind === 'bill' && +(x.amount || 0) === 0 && !(+(x.min_due || 0) > 0)) return { label: 'Nothing due', cls: 'good' }
  if (x.status === 'Scheduled') return on && on < t ? { label: 'Scheduled · not confirmed', cls: 'warn' } : { label: on === t ? 'Scheduled today' : 'Scheduled', cls: 'wait' }
  if (x.status === 'Declined') return { label: 'Declined', cls: 'crit' }; if (x.status === 'Alert') return { label: 'Bank alert', cls: 'crit' }
  if (x.status === 'Overdue' || (due && due < t)) return { label: 'Overdue', cls: 'crit' }
  if (due === t) return { label: 'Due today', cls: 'soon' }; if (due) return { label: x.autopay ? 'Autopay' : 'Due', cls: x.autopay ? 'wait' : 'info' }
  return { label: x.status || '—', cls: 'idle' }
}
export const isOpenItem = (x: EmailItem) => ['bill', 'scheduled', 'pastdue', 'declined'].includes(x.kind) && !['Paid', 'Resolved', 'Received', 'Updated'].includes(x.status || '') && !(x.kind === 'bill' && +(x.amount || 0) === 0 && !(+(x.min_due || 0) > 0))
export type { Fact }
export const stateOf = debtDueState
