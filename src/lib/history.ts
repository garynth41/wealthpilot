// Balance history (0.24.0): every balance change is kept per account per day (database trigger record_balance_history), so the
// balance on any past date can be read back — from the history when there is a row on or before that date, otherwise worked out
// from today's balance by undoing the transactions dated after it (the same posting rules as lib/ledger.ts).
import type { Account, BalancePoint, Data } from '../app/data/types'
import { effects } from './ledger'
import { round2 } from './money'
import { today } from './dates'

export const historyFor = (d: Pick<Data, 'balances'>, accountId: string): BalancePoint[] => (d.balances || []).filter(b => b.account_id === accountId).sort((a, b) => a.as_of.localeCompare(b.as_of))

export interface BalanceOn { date: string; balance: number | null; bank: number | null; from: 'history' | 'ledger' | 'none'; recordedOn: string | null }
const moves = (d: Data, a: Account, after: string, upTo: string) => d.transactions.filter(t => t.status !== 'void' && t.date > after && t.date <= upTo && effects(d, t).some(e => e.id === a.id))
/** The account's balance at the end of `date`: the recorded day when nothing moved the account since, otherwise the next recorded day
 *  (or today's balance) with the transactions dated after `date` undone. Property and vehicles keep their last typed value. */
export function balanceOn(d: Data, a: Account, date: string, asOf = today()): BalanceOn {
  if (date >= asOf) return { date, balance: +a.balance || 0, bank: a.bank_balance ?? null, from: 'history', recordedOn: asOf }
  const hist = historyFor(d, a.id); const h = hist.filter(p => p.as_of <= date).pop()
  if (a.kind === 'other_asset' || a.asset_type) return h ? { date, balance: h.balance, bank: null, from: 'history', recordedOn: h.as_of } : { date, balance: null, bank: null, from: 'none', recordedOn: null }
  if (h && h.balance != null && !moves(d, a, h.as_of, date).length) return { date, balance: h.balance, bank: h.bank_balance, from: 'history', recordedOn: h.as_of }
  // roll back from the next anchor: a recorded day after `date`, else today's balance
  const next = hist.find(p => p.as_of > date && p.as_of < asOf && p.balance != null)
  let bal = next ? +next.balance! : +a.balance || 0
  for (const t of moves(d, a, date, next ? next.as_of : '9999-12-31')) for (const e of effects(d, t)) if (e.id === a.id) bal -= e.delta
  return { date, balance: round2(bal), bank: null, from: 'ledger', recordedOn: next?.as_of ?? null }
}
/** Recorded points plus today's live figure, for a chart. */
export function historySeries(d: Data, a: Account, asOf = today()) {
  const pts = historyFor(d, a.id).filter(p => p.as_of < asOf).map(p => ({ date: p.as_of, balance: p.balance, bank: p.bank_balance, source: p.source }))
  pts.push({ date: asOf, balance: +a.balance || 0, bank: a.bank_balance ?? null, source: a.bank_balance != null ? 'bank' : a.kind === 'other_asset' ? 'value' : 'book' })
  return pts
}
