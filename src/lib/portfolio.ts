// Portfolio engine (0.6.0): holdings → value, gain/loss, allocation by asset class / sector / risk, concentration. Pure functions.
import type { Data, Holding, AssetClass } from '../app/data/types'
import { round2, sum } from './money'

export const holdingValue = (h: Holding) => round2((+h.quantity || 0) * (+h.price || 0))
export const holdingGain = (h: Holding) => round2(holdingValue(h) - (+h.cost_basis || 0))
export interface Slice { key: string; label: string; value: number; pct: number; count: number }
const slice = (rows: Holding[], keyOf: (h: Holding) => string, labelOf: (k: string) => string): Slice[] => {
  const total = sum(rows.map(holdingValue)); const m = new Map<string, { value: number; count: number }>()
  for (const h of rows) { const k = keyOf(h); const e = m.get(k) || { value: 0, count: 0 }; e.value = round2(e.value + holdingValue(h)); e.count++; m.set(k, e) }
  return [...m.entries()].map(([key, e]) => ({ key, label: labelOf(key), value: e.value, pct: total > 0 ? round2(e.value / total) : 0, count: e.count })).sort((a, b) => b.value - a.value)
}
const CLASS_LABEL: Record<string, string> = { stock: 'Stocks', etf: 'ETFs', mutual_fund: 'Mutual funds', bond: 'Bonds', real_estate: 'Real estate', cash: 'Cash', crypto: 'Crypto', alternative: 'Alternatives', other: 'Other' }
const RISK_LABEL: Record<string, string> = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' }
/** A rough "equity-like" share for the risk mix: stocks/ETFs/crypto/alternatives count as growth, bonds/cash as defensive, real estate in between. */
const GROWTH: Record<AssetClass, number> = { stock: 1, etf: 0.9, mutual_fund: 0.7, bond: 0, real_estate: 0.5, cash: 0, crypto: 1, alternative: 0.8, other: 0.5 }
export interface Portfolio { holdings: Holding[]; value: number; cost: number; gain: number; gainPct: number | null; byClass: Slice[]; bySector: Slice[]; byRisk: Slice[]; byAccount: Slice[]; growthShare: number | null; top: Array<{ h: Holding; pct: number }>; concentrationWarning: string | null; weightedExpense: number | null; estYield: number | null }
export function portfolio(d: Data, accountId?: string | null): Portfolio {
  const rows = d.holdings.filter(h => !accountId || h.account_id === accountId)
  const value = round2(sum(rows.map(holdingValue))), cost = round2(sum(rows.map(h => +h.cost_basis || 0))), gain = round2(value - cost)
  const byClass = slice(rows, h => h.asset_class, k => CLASS_LABEL[k] || k), bySector = slice(rows, h => h.sector || 'Unclassified', k => k), byRisk = slice(rows, h => h.risk, k => RISK_LABEL[k] || k)
  const byAccount = slice(rows, h => h.account_id || '', k => d.accounts.find(a => a.id === k)?.name || 'No account')
  const growthShare = value > 0 ? round2(sum(rows.map(h => holdingValue(h) * GROWTH[h.asset_class])) / value) : null
  const top = rows.map(h => ({ h, pct: value > 0 ? round2(holdingValue(h) / value) : 0 })).sort((a, b) => b.pct - a.pct).slice(0, 5)
  const single = top.find(t => t.h.asset_class !== 'cash' && !['Diversified', 'Fixed income'].includes(t.h.sector || '') && t.pct > 0.2)
  const concentrationWarning = single ? `${single.h.symbol || single.h.name} is ${Math.round(single.pct * 100)}% of the portfolio — more than 20% in one position` : null
  const withEr = rows.filter(h => h.expense_ratio != null); const weightedExpense = withEr.length && value > 0 ? round2(sum(withEr.map(h => holdingValue(h) * (+h.expense_ratio! || 0))) / sum(withEr.map(holdingValue)) * 100) / 100 : null
  const withY = rows.filter(h => h.yield_pct != null); const estYield = withY.length ? round2(sum(withY.map(h => holdingValue(h) * (+h.yield_pct! || 0) / 100))) : null
  return { holdings: rows, value, cost, gain, gainPct: cost > 0 ? round2(gain / cost) : null, byClass, bySector, byRisk, byAccount, growthShare, top, concentrationWarning, weightedExpense, estYield }
}
/** Retirement-tagged value: holdings in retirement accounts plus retirement accounts without itemised holdings. */
export function retirementAssets(d: Data) {
  const ret = d.accounts.filter(a => a.status === 'Active' && a.kind === 'retirement'); const inv = d.accounts.filter(a => a.status === 'Active' && a.kind === 'investment')
  const held = (ids: string[]) => round2(sum(d.holdings.filter(h => h.account_id && ids.includes(h.account_id)).map(holdingValue)))
  const bal = (list: typeof ret) => round2(sum(list.map(a => +a.balance || 0)))
  return { retirement: Math.max(bal(ret), held(ret.map(a => a.id))), taxable: Math.max(bal(inv), held(inv.map(a => a.id))), total: Math.max(bal(ret), held(ret.map(a => a.id))) + Math.max(bal(inv), held(inv.map(a => a.id))) }
}
