// Property and vehicles (0.24.0): asset accounts whose value is typed from an estimate (Zillow, an appraisal, Kelley Blue Book),
// with the loan against each for equity, a reminder each quarter to update the value, and a depreciation guide for vehicles.
import type { Account, Data } from '../app/data/types'
import { diffDays, today } from './dates'
import { round2 } from './money'
import { debtBal } from './accounts'

export const REVALUE_DAYS = 90
/** Typical yearly change used to pre-fill a new asset's guide (positive = loses value). */
export const DEFAULT_DEPRECIATION: Record<string, number> = { vehicle: 15, boat: 10, home: -3, rental: -3, land: -2, collectible: 0, business: 0, other: 0 }
export const isValuedAsset = (a: Account) => a.status === 'Active' && (a.kind === 'other_asset' || !!a.asset_type)

/** The guide's estimate today: the last typed value moved by the yearly rate for the time since. */
export function estimateNow(a: Account, asOf = today()): number | null {
  const pct = a.depreciation_pct; if (pct == null || !a.balance_as_of || !(+a.balance > 0)) return null
  const yrs = Math.max(0, diffDays(asOf, a.balance_as_of.slice(0, 10))) / 365.25
  return round2((+a.balance || 0) * Math.pow(1 - pct / 100, yrs))
}
export interface AssetRow { a: Account; value: number; asOf: string | null; age: number | null; stale: boolean; loan: Account | null; owed: number; equity: number; ltv: number | null; estimate: number | null }
export function assetRows(d: Data, asOf = today()): AssetRow[] {
  return d.accounts.filter(isValuedAsset).map(a => {
    const loan = a.linked_account_id ? d.accounts.find(x => x.id === a.linked_account_id && x.status === 'Active') || null : d.accounts.find(x => x.status === 'Active' && x.linked_account_id === a.id) || null
    const value = +a.balance || 0, owed = loan ? debtBal(loan, d) : 0, at = a.balance_as_of ? a.balance_as_of.slice(0, 10) : null, age = at ? diffDays(asOf, at) : null
    return { a, value, asOf: at, age, stale: age == null || age >= REVALUE_DAYS, loan, owed: round2(owed), equity: round2(value - owed), ltv: value > 0 && loan ? round2(owed / value) : null, estimate: estimateNow(a, asOf) }
  }).sort((x, y) => y.value - x.value)
}
/** Assets whose value is a quarter or more old (or never dated). */
export const revalueDue = (d: Data, asOf = today()) => assetRows(d, asOf).filter(r => r.stale)
