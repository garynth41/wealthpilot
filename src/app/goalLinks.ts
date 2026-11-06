// A payee rule can mark transactions toward a goal (0.21.0). After any write that may have set goal_id, log the matching goal
// contributions once (lib/rules.ts goalLinks skips transactions that already have one), so goal progress follows the ledger.
import { useStore } from './store'
import { goalLinks } from '../lib/rules'
import type { Transaction } from './data/types'

export async function logGoalLinks(ids: string[] | Transaction[]): Promise<number> {
  const s = useStore.getState(); const want = new Set(ids.map(x => (typeof x === 'string' ? x : x.id)))
  const rows = s.data.transactions.filter(t => want.has(t.id))
  const c = goalLinks(s.data, rows); if (!c.length) return 0
  await s.insertMany('contributions', c); return c.length
}
