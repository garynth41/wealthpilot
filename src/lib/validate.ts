// Input rules shared by the store, the table cells and the forms (0.25.1): what may never be left empty, what must be positive, and a
// plain-language message for each. The database has the same rules (NOT NULL columns, transactions.amount >= 0); checking them here
// first means a change the database would refuse is never shown on screen — and the offline demo, which has no database, refuses it too.
import type { Collection } from '../app/data/types'
import { parseNum } from './money'

/** A change the user can fix (an empty date, a negative amount). Shown as a message; never logged as an app error. */
export class InputError extends Error { constructor(message: string) { super(message); this.name = 'InputError' } }
export const isInputError = (e: unknown): e is InputError => e instanceof InputError || (!!e && typeof e === 'object' && (e as { name?: string }).name === 'InputError')

/** What one row of each collection is called in a sentence. */
const NOUN: Partial<Record<Collection, string>> = {
  transactions: 'A transaction', paySchedules: 'An income source', planned: 'A planned item', accounts: 'An account', statements: 'A statement', categories: 'A category',
  recurring: 'A bill or subscription', occurrences: 'A bill payment', goals: 'A goal', contributions: 'A contribution', snapshots: 'A snapshot', periods: 'A budget period',
  lines: 'A budget line', holdings: 'A holding', lots: 'A tax lot', insurance: 'A policy', estate: 'A checklist item', balances: 'A balance history point',
  scores: 'A credit score', splits: 'A split line', comments: 'A comment', hardship: 'A creditor', scenarios: 'A scenario', emailItems: 'An email record',
}
/** Fields that can never be empty (the database's NOT NULL columns people can edit), with how the message names them. */
export const REQUIRED: Partial<Record<Collection, Record<string, string>>> = {
  transactions: { date: 'a date', amount: 'an amount', kind: 'a type', status: 'a status' },
  paySchedules: { anchor_date: 'a known pay date', frequency: 'how often it pays', name: 'a name', kind: 'a kind', net_amount: 'a take-home amount', status: 'a status' },
  planned: { date: 'a date', label: 'a description', category: 'a category', amount: 'an amount', status: 'a status' },
  accounts: { name: 'a name', kind: 'a type', balance: 'a balance', apr: 'a rate (0 if none)', minimum_payment: 'a minimum payment (0 if none)', status: 'a status' },
  statements: { statement_date: 'a statement date', statement_balance: 'a balance', minimum_payment: 'a minimum payment' },
  categories: { name: 'a name', kind: 'a kind', priority: 'a priority', cost_type: 'a cost type', default_budget: 'a default budget (0 if none)', budget_cadence: 'a cadence' },
  recurring: { name: 'a name', kind: 'a kind', amount: 'an amount (0 if it varies)', frequency: 'how often it repeats', reminder_days: 'a reminder (0 for the due day)', status: 'a status' },
  occurrences: { due_date: 'a due date', amount: 'an amount' },
  goals: { name: 'a name', kind: 'a kind', starting_amount: 'a starting amount (0 if none)', monthly_contribution: 'a monthly amount (0 if none)', priority: 'a priority', status: 'a status' },
  contributions: { date: 'a date', amount: 'an amount' },
  snapshots: { date: 'a date' },
  periods: { start_date: 'a start date', end_date: 'an end date' },
  lines: { planned: 'a planned amount (0 if none)' },
  holdings: { name: 'a name', asset_class: 'an asset class', risk: 'a risk level', quantity: 'a quantity (0 if none)', price: 'a price (0 if unknown)', cost_basis: 'a cost basis (0 if unknown)' },
  lots: { acquired_on: 'a purchase date', quantity: 'a quantity', cost: 'a cost' },
  insurance: { name: 'a name', kind: 'a type', premium: 'a premium (0 if none)', status: 'a status' },
  estate: { label: 'a name', status: 'a status' },
  balances: { as_of: 'a date' },
  scores: { person: 'a person', date: 'a date', score: 'a score' },
  splits: { amount: 'an amount' },
  comments: { body: 'some text' },
  hardship: { entity: 'a name', status: 'a status' },
  scenarios: { name: 'a name' },
  emailItems: { kind: 'a type' },
}
/** Numbers the database refuses below zero (amounts are always positive; the type gives the direction). */
const NON_NEGATIVE: Partial<Record<Collection, Record<string, string>>> = {
  transactions: { amount: 'Amounts are always positive — the type (expense, income or transfer) gives the direction' },
  splits: { amount: 'A split line cannot be negative' },
  lots: { quantity: 'A lot needs a quantity above zero', cost: 'A lot\'s cost cannot be negative' },
}
const blank = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '') || (typeof v === 'number' && !isFinite(v))
/** Why this patch cannot be saved, or null when it can. Only the keys in the patch are checked. */
export function patchProblem(coll: Collection, patch: Record<string, unknown>): string | null {
  const req = REQUIRED[coll] || {}, nn = NON_NEGATIVE[coll] || {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue   // not part of the change
    if (k in req && blank(v)) return `${NOUN[coll] || 'This row'} needs ${req[k]} — the change was not saved.`
    if (k in nn && typeof v === 'number' && (v < 0 || (coll === 'lots' && k === 'quantity' && v === 0))) return `${nn[k]}. The change was not saved.`
  }
  return null
}

/** Why a typed amount cannot be saved as a positive amount, or null when it can. `negative` replaces the default message for a minus sign. */
export function amountProblem(raw: string | null | undefined, opts: { allowZero?: boolean; negative?: string } = {}): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return 'Enter the amount.'
  const n = parseNum(s)
  if (n == null) return `“${s.slice(0, 20)}” is not an amount — type it like 42.50.`
  if (n < 0) return opts.negative || 'The amount cannot be negative.'
  if (n === 0 && !opts.allowZero) return 'The amount must be more than $0.00.'
  return null
}

/** Why a number is outside a cell's allowed range, or null. `label` is the column heading. */
export function rangeProblem(label: string, n: number, min?: number, max?: number): string | null {
  const okMin = min == null || n >= min, okMax = max == null || n <= max
  if (okMin && okMax) return null
  if (min != null && max != null) return `${label} must be between ${min} and ${max}.`
  if (min != null) return min === 0 ? `${label} cannot be negative.` : `${label} must be at least ${min}.`
  return `${label} cannot be more than ${max}.`
}

/** Settings → Planning thresholds, as typed. Every field keeps 0 where 0 makes sense and refuses it (with a reason) where it does not. */
export type ThresholdKey = 'reserveFloor' | 'savingsTargetPct' | 'runwayGreen' | 'runwayYellow' | 'budgetCritPct' | 'dueSoonDays'
export type Thresholds = Record<ThresholdKey, number>
export function checkThresholds(raw: Record<ThresholdKey, string>): { value: Thresholds | null; errors: Partial<Record<ThresholdKey, string>> } {
  const errors: Partial<Record<ThresholdKey, string>> = {}; const v = {} as Thresholds
  const num = (k: ThresholdKey, what: string, min: number, max: number, opts: { whole?: boolean; belowMin?: string } = {}) => {
    const s = String(raw[k] ?? '').trim(); const n = s === '' ? null : parseNum(s)
    if (n == null) { errors[k] = s === '' ? `Enter ${what}.` : `“${s.slice(0, 20)}” is not a number.`; return }
    if (opts.whole && !Number.isInteger(n)) { errors[k] = 'Use a whole number of days.'; return }
    if (n < min) { errors[k] = opts.belowMin || (min === 0 ? 'This cannot be negative.' : `Use at least ${min}.`); return }
    if (n > max) { errors[k] = `Use ${max.toLocaleString('en-US')} or less.`; return }
    v[k] = n
  }
  num('reserveFloor', 'a reserve floor (0 for none)', 0, 100_000_000)
  num('savingsTargetPct', 'a savings target (0 for none)', 0, 100)
  num('runwayGreen', 'the months for green', 1, 120, { belowMin: 'Green needs at least 1 month — at 0 every runway would show green.' })
  num('runwayYellow', 'the months for yellow (0 means never red)', 0, 120)
  num('budgetCritPct', 'a percentage (0 means any overspending is red)', 0, 1000)
  num('dueSoonDays', 'a number of days (0 means only on the due day)', 0, 60, { whole: true })
  if (errors.runwayGreen == null && errors.runwayYellow == null && v.runwayYellow >= v.runwayGreen) errors.runwayYellow = `Yellow must be below green (${v.runwayGreen} months).`
  return { value: Object.keys(errors).length ? null : v, errors }
}
