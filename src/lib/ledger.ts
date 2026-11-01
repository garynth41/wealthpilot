// Posting rules: how a transaction moves account balances. Assets go up with income / down with spending; a transfer to a liability pays it down.
import type { Account, Data, Transaction } from '../app/data/types'
import { isLiability } from './accounts'
import { round2 } from './money'

export interface Delta { id: string; delta: number }
export function effects(data: Data, t: Partial<Transaction>): Delta[] {
  const out: Delta[] = []; const amt = +(t.amount || 0); if (!amt || t.status === 'void') return out
  const acc = (id?: string | null) => (id ? data.accounts.find(a => a.id === id) : undefined)
  const from = acc(t.account_id), to = acc(t.to_account_id)
  const sign = (a: Account, moneyIn: boolean) => (isLiability(a) ? (moneyIn ? -amt : amt) : moneyIn ? amt : -amt)   // paying into a liability reduces what is owed; spending on a card increases it
  if (t.kind === 'income') { if (from) out.push({ id: from.id, delta: sign(from, true) }) }
  else if (t.kind === 'expense') { if (from) out.push({ id: from.id, delta: sign(from, false) }) }
  else { if (from) out.push({ id: from.id, delta: sign(from, false) }); if (to) out.push({ id: to.id, delta: sign(to, true) }) }
  return out
}
/** Apply (dir = 1) or reverse (dir = -1) a transaction's effect on balances. */
export async function post(data: Data, update: (id: string, patch: Partial<Account>) => Promise<unknown>, t: Partial<Transaction>, dir: 1 | -1, asOf?: string) {
  for (const e of effects(data, t)) { const a = data.accounts.find(x => x.id === e.id); if (!a) continue; await update(a.id, { balance: round2((+a.balance || 0) + e.delta * dir), balance_as_of: asOf || a.balance_as_of || null }) }
}
