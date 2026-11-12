// The same account listed more than once (0.28.0): find the copies, and plan how to fold them into one.
//
// How copies happen: several emails about one creditor approved in one go each made their own account (fixed in lib/email/apply.ts — a new
// account is now made once and reused), a statement file imported into a fresh account that already existed, or a card added by hand and
// then again from the bank. Every account picker then offers the same name several times, and payments land on whichever copy was picked.
//
// Two accounts are copies when they have the same name, type and institution, their last-four digits do not disagree, and at most one of
// them has a bank figure (two accounts the bank reports separately are two real accounts, whatever they are called). Property and vehicles
// are never compared. Nothing is merged without the owner pressing Merge.
//
// Merging keeps one account — the one with a bank figure, else one with reconciliations, else the most transactions, else an active one,
// else the oldest —
// and moves everything that points at the others onto it: transactions (both sides of a transfer), bills, statements, goals, holdings,
// income deposits, email items, creditor outreach, autopay and loan links, remembered email matches and the bank feed's match. Completed
// reconciliations cannot be moved, so the copy that has them is the one kept (two reconciled copies are never offered). What is owed now
// (balance, statement, minimum, due date, autopay) comes from the freshest copy — an active one whose balance was set most recently —
// because the copies describe one debt, not several to add up; blanks on the kept account (last four, limit, APR) are filled from the
// others. The other copies are then deleted. Their own balance history goes with them; the kept account's history is untouched.
import type { Account, Data, Transaction } from '../app/data/types'

const norm = (s?: string | null) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const isProperty = (a: Account) => a.kind === 'other_asset' || !!a.asset_type
/** the names a row gets from the + buttons before it is filled in: two new rows are not copies of each other */
const PLACEHOLDER = new Set(['new card', 'new account'])
export interface Twins { key: string; name: string; keeper: Account; others: Account[]; /** live transactions on each copy, by account id */ counts: Record<string, number> }

/** Live transactions that touch each account. */
function txnCounts(d: Pick<Data, 'transactions'>): Map<string, number> {
  const m = new Map<string, number>(); const bump = (id?: string | null) => { if (id) m.set(id, (m.get(id) || 0) + 1) }
  for (const t of d.transactions) { bump(t.account_id); if (t.to_account_id !== t.account_id) bump(t.to_account_id) }
  return m
}
/** How current a copy's figures are: an active copy first, then the one whose balance was set last (its date, then when the row last changed) —
 *  a later due date alone says nothing about which balance is newer. */
const fresh = (a: Account) => `${a.status === 'Active' ? 1 : 0}|${(a.balance_as_of || '').slice(0, 10)}|${a.updated_at || ''}|${(a.due_date || '').slice(0, 10)}|${(a.statement_date || '').slice(0, 10)}`

/** Groups of accounts that are the same account listed more than once, each with the copy to keep. */
export function accountTwins(d: Pick<Data, 'accounts' | 'transactions'> & { reconciliations?: Data['reconciliations'] }): Twins[] {
  const n = txnCounts(d); const reconciled = new Set((d.reconciliations || []).map(r => r.account_id)); const groups = new Map<string, Account[]>()
  for (const a of d.accounts) { if (isProperty(a) || a.excluded || !norm(a.name) || PLACEHOLDER.has(norm(a.name))) continue; const k = `${norm(a.name)}|${a.kind}|${norm(a.institution)}`; groups.set(k, [...(groups.get(k) || []), a]) }
  const out: Twins[] = []
  for (const [key, g] of groups) {
    if (g.length < 2) continue
    const last4 = new Set(g.map(a => String(a.last4 || '').slice(-4)).filter(Boolean)); if (last4.size > 1) continue   // different card numbers: different accounts
    if (g.filter(a => a.bank_balance != null).length > 1) continue                                                    // the bank reports them separately
    if (g.filter(a => reconciled.has(a.id)).length > 1) continue                                                      // completed reconciliations cannot be moved: two reconciled copies stay two accounts
    const rank = (a: Account) => [a.bank_balance != null ? 1 : 0, reconciled.has(a.id) ? 1 : 0, n.get(a.id) || 0, a.status === 'Active' ? 1 : 0]
    const sorted = g.slice().sort((x, y) => { const X = rank(x), Y = rank(y); for (let i = 0; i < X.length; i++) if (X[i] !== Y[i]) return Y[i] - X[i]; return String(x.created_at || '').localeCompare(String(y.created_at || '')) || x.sort_order - y.sort_order || x.id.localeCompare(y.id) })
    out.push({ key, name: sorted[0].name, keeper: sorted[0], others: sorted.slice(1), counts: Object.fromEntries(g.map(a => [a.id, n.get(a.id) || 0])) })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

type Coll = 'transactions' | 'recurring' | 'statements' | 'goals' | 'holdings' | 'paySchedules' | 'emailItems' | 'hardship' | 'accounts'
export interface Move { coll: Coll; id: string; patch: Record<string, unknown> }
export interface MergePlan { keeper: Account; others: Account[]; moves: Move[]; keeperPatch: Partial<Account>; rules: Record<string, { account?: string; category?: string; recurring?: string; none?: boolean }> | null; moved: { transactions: number; bills: number; statements: number; other: number } }

/** Fields that say what is owed now: taken from the freshest copy, never added up. */
const CURRENT: Array<keyof Account> = ['balance', 'balance_as_of', 'statement_date', 'statement_balance', 'minimum_payment', 'due_date', 'planned_payment', 'last_paid_due', 'autopay', 'autopay_account_id']
/** Fields worth keeping from any copy when the kept account has none. */
const FILL: Array<keyof Account> = ['last4', 'institution', 'credit_limit', 'apr', 'promo_apr', 'promo_until', 'beneficiary', 'color', 'icon']

/** Everything that has to change to fold `others` into `keeper`. Nothing is written here — the store applies it. Completed reconciliations
 *  are immutable and are not moved: accountTwins keeps the copy that has them, and a copy with reconciliations is refused as one to remove. */
export function planAccountMerge(d: Data, keeper: Account, others: Account[], finmailRules?: MergePlan['rules']): MergePlan {
  const locked = others.find(o => d.reconciliations.some(r => r.account_id === o.id)); if (locked) throw new Error(`${locked.name} has completed reconciliations, which cannot be moved — keep that copy instead`)
  const gone = new Set(others.map(a => a.id)); const to = keeper.id; const moves: Move[] = []
  const swap = (id?: string | null) => (id && gone.has(id) ? to : id)
  const moved = { transactions: 0, bills: 0, statements: 0, other: 0 }
  for (const t of [...d.transactions, ...(d.duplicates || [])] as Transaction[]) {
    const a = swap(t.account_id), b = swap(t.to_account_id); if (a === t.account_id && b === t.to_account_id) continue
    if (a && a === b) continue   // a transfer between two copies would become a transfer to itself: left alone (the link empties when the copy goes)
    const patch: Record<string, unknown> = {}; if (a !== t.account_id) patch.account_id = a; if (b !== t.to_account_id) patch.to_account_id = b
    moves.push({ coll: 'transactions', id: t.id, patch }); moved.transactions++
  }
  for (const r of d.recurring) { const patch: Record<string, unknown> = {}; if (r.account_id && gone.has(r.account_id)) patch.account_id = to; if (r.liability_account_id && gone.has(r.liability_account_id)) patch.liability_account_id = to; if (Object.keys(patch).length) { moves.push({ coll: 'recurring', id: r.id, patch }); moved.bills++ } }
  // a statement for a date the kept account already has one for stays behind (and goes with its copy): the same statement, not a second one
  const have = new Set(d.statements.filter(s => s.account_id === to).map(s => s.statement_date.slice(0, 10)))
  for (const s of d.statements) if (gone.has(s.account_id) && !have.has(s.statement_date.slice(0, 10))) { have.add(s.statement_date.slice(0, 10)); moves.push({ coll: 'statements', id: s.id, patch: { account_id: to } }); moved.statements++ }
  const simple: Array<[Coll, Array<{ id: string }>, string]> = [['goals', d.goals, 'account_id'], ['holdings', d.holdings, 'account_id'], ['paySchedules', d.paySchedules, 'deposit_account_id'], ['emailItems', d.emailItems, 'account_id'], ['hardship', d.hardship, 'account_id'], ['accounts', d.accounts.filter(a => !gone.has(a.id)), 'autopay_account_id'], ['accounts', d.accounts.filter(a => !gone.has(a.id)), 'linked_account_id']]
  for (const [coll, rows, col] of simple) for (const r of rows) { const v = (r as unknown as Record<string, string | null | undefined>)[col]; if (v && gone.has(v)) { moves.push({ coll, id: r.id, patch: { [col]: to } }); moved.other++ } }
  // what is owed now comes from the freshest copy; blanks on the kept account are filled from the others
  const all = [keeper, ...others]; const newest = all.slice().sort((x, y) => fresh(y).localeCompare(fresh(x)))[0]
  const keeperPatch: Record<string, unknown> = {}
  if (newest.id !== keeper.id) for (const k of CURRENT) { const v = newest[k]; if (k === 'autopay_account_id' && v && gone.has(v as string)) continue; if (v !== undefined && v !== keeper[k]) keeperPatch[k] = v ?? null }
  for (const k of FILL) { const mine = keeper[k]; if (mine != null && mine !== '' && !(k === 'apr' && !+mine)) continue; const v = others.map(o => o[k]).find(x => x != null && x !== '' && !(k === 'apr' && !+x)); if (v != null) keeperPatch[k] = v }
  if (keeper.status !== 'Active' && all.some(a => a.status === 'Active')) keeperPatch.status = 'Active'
  let rules: MergePlan['rules'] = null
  if (finmailRules && Object.values(finmailRules).some(r => r.account && gone.has(r.account))) rules = Object.fromEntries(Object.entries(finmailRules).map(([k, r]) => [k, r.account && gone.has(r.account) ? { ...r, account: to } : r]))
  return { keeper, others, moves, keeperPatch: keeperPatch as Partial<Account>, rules, moved }
}

/** Is there already an account a new one would be a copy of? Used before anything creates an account on its own (email capture). With a
 *  last four: the account with those digits, else one on file without any (the same card, not yet numbered) when it is the only such one.
 *  Without: the match only when the candidates do not name different cards. Never a guess between two. */
export function accountLike(accounts: Account[], row: Pick<Account, 'name' | 'kind'> & { institution?: string | null; last4?: string | null }): Account | null {
  const want = String(row.last4 || '').slice(-4); const l4 = (a: Account) => String(a.last4 || '').slice(-4)
  const named = accounts.filter(a => !isProperty(a) && a.kind === row.kind && norm(a.name) === norm(row.name) && (!norm(row.institution) || !norm(a.institution) || norm(a.institution) === norm(row.institution)))
  const best = (list: Account[]) => list.slice().sort((x, y) => (y.status === 'Active' ? 1 : 0) - (x.status === 'Active' ? 1 : 0) || String(x.created_at || '').localeCompare(String(y.created_at || '')))[0] || null
  if (want) { const exact = named.filter(a => l4(a) === want); if (exact.length) return best(exact); const blank = named.filter(a => !l4(a)); return blank.length === 1 ? blank[0] : null }
  return new Set(named.map(l4).filter(Boolean)).size > 1 ? null : best(named)
}
