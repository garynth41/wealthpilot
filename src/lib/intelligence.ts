// Spending intelligence: merchants, subscriptions, waste detection and financial-health scores.
// Pure functions over Data — every number here is derived from transactions (never stored). Pages only format.
import type { Data, Settings, Transaction } from '../app/data/types'
import { addDays, diffDays, monthEnd, monthStart, mAdd, today } from './dates'
import { round2, sum } from './money'
import { recActive, recMonthly } from './recurring'
import { cashOnHand } from './accounts'
import { inRange } from './budget'
import { categoryLines } from './splits'

/** Normalised merchant key: lower-case, punctuation and trailing store numbers / card suffixes removed. "KROGER #1234 COLUMBUS OH" → "kroger" */
export function merchantKey(payee?: string | null) {
  let s = (payee || '').toLowerCase().replace(/[*#].*$/, '').replace(/\b(pos|debit|purchase|payment|autopay|ach|online|www\.|\.com)\b/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b\d{2,}\b/g, ' ').replace(/\s+/g, ' ').trim()
  return s || 'unknown'
}
const spendTx = (d: Data) => d.transactions.filter(t => t.kind === 'expense' && t.status !== 'void')
const med = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const mean = (a: number[]) => (a.length ? sum(a) / a.length : 0)
const sd = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(sum(a.map(x => (x - m) ** 2)) / (a.length - 1)) }

// ---------------- merchants ----------------
export interface Merchant { key: string; name: string; count: number; total: number; avg: number; last: string; prior: number; change: number | null; categories: string[]; txns: Transaction[] }
/** Spend per merchant in [from,to], with the change vs the same-length window before it. */
export function merchantAnalysis(d: Data, from: string, to: string): Merchant[] {
  const len = diffDays(to, from) + 1; const pFrom = addDays(from, -len), pTo = addDays(from, -1)
  const m = new Map<string, Merchant>()
  for (const t of spendTx(d)) {
    const inCur = inRange(t, from, to), inPrior = inRange(t, pFrom, pTo); if (!inCur && !inPrior) continue
    const k = merchantKey(t.payee); let r = m.get(k)
    if (!r) { r = { key: k, name: (t.payee || 'Unknown').trim(), count: 0, total: 0, avg: 0, last: '', prior: 0, change: null, categories: [], txns: [] }; m.set(k, r) }
    if (inCur) { r.count++; r.total = round2(r.total + t.amount); r.txns.push(t); if (t.date > r.last) { r.last = t.date; r.name = (t.payee || r.name).trim() }; const c = d.categories.find(c => c.id === t.category_id)?.name; if (c && !r.categories.includes(c)) r.categories.push(c) }
    else r.prior = round2(r.prior + t.amount)
  }
  const out = [...m.values()].filter(r => r.count > 0)
  for (const r of out) { r.avg = round2(r.total / r.count); r.change = r.prior > 0 ? round2((r.total - r.prior) / r.prior) : null }
  return out.sort((a, b) => b.total - a.total)
}

// ---------------- subscriptions & recurring charges ----------------
export interface DetectedRecurring { key: string; name: string; amount: number; everyDays: number; cadence: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly' | 'other'; count: number; last: string; next: string; annual: number; known: boolean; rising: boolean; firstAmount: number; lastAmount: number }
const cadenceOf = (days: number): DetectedRecurring['cadence'] => (Math.abs(days - 7) <= 1 ? 'weekly' : Math.abs(days - 14) <= 2 ? 'biweekly' : Math.abs(days - 30.4) <= 4 ? 'monthly' : Math.abs(days - 91) <= 8 ? 'quarterly' : Math.abs(days - 365) <= 15 ? 'yearly' : 'other')
const perYear = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, yearly: 1, other: 0 }
/** Charges that repeat at a steady interval with a steady amount (±15%), whether or not a Recurring row exists for them. */
export function detectRecurring(d: Data, asOf = today(), lookbackDays = 400): DetectedRecurring[] {
  const from = addDays(asOf, -lookbackDays); const by = new Map<string, Transaction[]>()
  for (const t of spendTx(d).filter(t => t.date >= from && t.date <= asOf)) { const k = merchantKey(t.payee); if (k === 'unknown') continue; const a = by.get(k) || []; a.push(t); by.set(k, a) }
  const known = new Set(recActive(d).map(r => merchantKey(r.payee || r.name)))
  const out: DetectedRecurring[] = []
  for (const [key, txs] of by) {
    if (txs.length < 3) continue
    const s = txs.slice().sort((a, b) => a.date.localeCompare(b.date)); const gaps = s.slice(1).map((t, i) => diffDays(t.date, s[i].date)); const g = med(gaps)
    if (g < 6 || gaps.some(x => Math.abs(x - g) > Math.max(4, g * 0.25))) continue
    const amts = s.map(t => t.amount); const a = med(amts); if (amts.some(x => Math.abs(x - a) > a * 0.15)) continue
    const cadence = cadenceOf(g); const last = s[s.length - 1]
    out.push({ key, name: (last.payee || key).trim(), amount: round2(a), everyDays: Math.round(g), cadence, count: s.length, last: last.date, next: addDays(last.date, Math.round(g)), annual: round2(cadence === 'other' ? a * 365 / g : a * perYear[cadence]), known: known.has(key), rising: s[s.length - 1].amount > s[0].amount * 1.05, firstAmount: s[0].amount, lastAmount: last.amount })
  }
  return out.sort((a, b) => b.annual - a.annual)
}
export interface SubscriptionSummary { monthly: number; annual: number; count: number; detectedUnknown: DetectedRecurring[]; items: Array<{ name: string; monthly: number; annual: number; source: 'recurring' | 'detected'; lastCharged?: string | null; rising?: boolean }> }
export function subscriptionAnalysis(d: Data, asOf = today()): SubscriptionSummary {
  const subs = recActive(d).filter(r => r.kind === 'subscription'); const det = detectRecurring(d, asOf)
  const lastSeen = (key: string) => spendTx(d).filter(t => merchantKey(t.payee) === key && t.date <= asOf).map(t => t.date).sort().pop() || null
  const items: SubscriptionSummary['items'] = subs.map(r => { const key = merchantKey(r.payee || r.name); const m = det.find(x => x.key === key); const seen = lastSeen(key); return { name: r.name, monthly: round2(recMonthly(r)), annual: round2(recMonthly(r) * 12), source: 'recurring' as const, lastCharged: [r.last_paid_on, seen].filter(Boolean).sort().pop() || null, rising: m?.rising } })
  const unknown = det.filter(x => !x.known && x.cadence !== 'other')
  unknown.forEach(x => items.push({ name: x.name, monthly: round2(x.annual / 12), annual: x.annual, source: 'detected', lastCharged: x.last, rising: x.rising }))
  items.sort((a, b) => b.annual - a.annual)
  return { monthly: round2(sum(items.map(i => i.monthly))), annual: round2(sum(items.map(i => i.annual))), count: items.length, detectedUnknown: unknown, items }
}

// ---------------- waste detection ----------------
export type WasteKind = 'duplicate' | 'rising_subscription' | 'bank_fee' | 'late_fee' | 'unused_subscription' | 'spike' | 'outlier'
export interface WasteFinding { kind: WasteKind; title: string; detail: string; amount: number; date: string; txnIds: string[]; severity: 'crit' | 'warn' | 'info' }
const FEE_RX = /\b(fee|overdraft|nsf|insufficient|interest charge|finance charge|service charge|maintenance|atm fee|foreign transaction)\b/i
const LATE_RX = /\b(late fee|late payment|late charge|penalty|past due fee|returned payment)\b/i
/** Everything that looks like money leaking: duplicates, fees, rising or dormant subscriptions, spikes and outliers. */
export function wasteDetection(d: Data, asOf = today(), lookbackDays = 90): WasteFinding[] {
  const from = addDays(asOf, -lookbackDays); const tx = spendTx(d).filter(t => t.date >= from && t.date <= asOf).sort((a, b) => a.date.localeCompare(b.date)); const out: WasteFinding[] = []
  // duplicates: same merchant, same amount, within 3 days, different transactions
  for (let i = 0; i < tx.length; i++) for (let j = i + 1; j < tx.length; j++) {
    const a = tx[i], b = tx[j]; if (diffDays(b.date, a.date) > 3) break
    if (Math.abs(a.amount - b.amount) < 0.005 && merchantKey(a.payee) === merchantKey(b.payee) && a.amount >= 1) out.push({ kind: 'duplicate', title: `Possible duplicate: ${(a.payee || 'Unknown').trim()}`, detail: `${a.date} and ${b.date}, both ${a.amount.toFixed(2)}`, amount: a.amount, date: b.date, txnIds: [a.id, b.id], severity: 'warn' })
  }
  // fees
  for (const t of tx) { const text = `${t.payee || ''} ${t.memo || ''} ${d.categories.find(c => c.id === t.category_id)?.name || ''}`
    if (LATE_RX.test(text)) out.push({ kind: 'late_fee', title: `Late fee: ${(t.payee || 'Unknown').trim()}`, detail: `${t.date} · ${t.amount.toFixed(2)} — a reminder or autopay would avoid this`, amount: t.amount, date: t.date, txnIds: [t.id], severity: 'crit' })
    else if (FEE_RX.test(text)) out.push({ kind: 'bank_fee', title: `Bank or card fee: ${(t.payee || 'Unknown').trim()}`, detail: `${t.date} · ${t.amount.toFixed(2)}`, amount: t.amount, date: t.date, txnIds: [t.id], severity: 'warn' }) }
  // subscriptions: rising, or dormant (a Recurring subscription with no charge seen in 2 cycles)
  const det = detectRecurring(d, asOf)
  for (const r of det.filter(x => x.rising)) out.push({ kind: 'rising_subscription', title: `${r.name} went up`, detail: `${r.firstAmount.toFixed(2)} → ${r.lastAmount.toFixed(2)} (${Math.round((r.lastAmount / r.firstAmount - 1) * 100)}%) · ${r.cadence}`, amount: round2((r.lastAmount - r.firstAmount) * (perYear[r.cadence] || 12)), date: r.last, txnIds: [], severity: 'info' })
  for (const r of recActive(d).filter(r => r.kind === 'subscription')) {
    const key = merchantKey(r.payee || r.name); const lastSeen = spendTx(d).filter(t => merchantKey(t.payee) === key).map(t => t.date).sort().pop() || r.last_paid_on || null
    const cycle = 365 / Math.max(1, (recMonthly(r) * 12) / Math.max(0.01, +r.amount || 0.01))
    if (lastSeen && diffDays(asOf, lastSeen) > cycle * 2 + 7) out.push({ kind: 'unused_subscription', title: `${r.name}: no charge in ${diffDays(asOf, lastSeen)} days`, detail: `still listed as an active subscription (${(+r.amount).toFixed(2)} ${r.frequency}) — cancelled, or paid from an account you do not track?`, amount: round2(recMonthly(r) * 12), date: lastSeen, txnIds: [], severity: 'info' })
  }
  // spikes: a week more than 2× the median weekly VARIABLE spend (needs 6+ weeks) — Fixed-cost categories (rent, insurance, …) land in one week every month by design and are not waste
  const fixedCats = new Set(d.categories.filter(c => c.cost_type === 'Fixed').map(c => c.id)); const varTx = tx.filter(t => !t.category_id || !fixedCats.has(t.category_id))
  const weeks = new Map<string, number>(); for (const t of varTx) { const w = addDays(t.date, -((new Date(t.date + 'T12:00').getDay() + 6) % 7)); weeks.set(w, (weeks.get(w) || 0) + t.amount) }
  const wk = [...weeks.entries()].sort(); if (wk.length >= 6) { const m = med(wk.map(x => x[1])); for (const [w, v] of wk) if (m > 0 && v > m * 2 && v - m > 150) out.push({ kind: 'spike', title: `Spending spike week of ${w}`, detail: `${v.toFixed(0)} vs a typical ${m.toFixed(0)}`, amount: round2(v - m), date: w, txnIds: varTx.filter(t => t.date >= w && t.date <= addDays(w, 6)).map(t => t.id), severity: 'warn' }) }
  // outliers: a transaction far above its category's usual size (category needs 5+ transactions in the window)
  const byCat = new Map<string, Transaction[]>(); for (const t of tx) if (t.category_id) { const a = byCat.get(t.category_id) || []; a.push(t); byCat.set(t.category_id, a) }
  for (const [cid, list] of byCat) { if (list.length < 5) continue; const amts = list.map(t => t.amount); const m = mean(amts), s = sd(amts), md = med(amts)
    for (const t of list) if (t.amount > m + 2.5 * s && t.amount > md * 3 && t.amount >= 50) out.push({ kind: 'outlier', title: `Unusually large: ${(t.payee || 'Unknown').trim()}`, detail: `${t.amount.toFixed(2)} in ${d.categories.find(c => c.id === cid)?.name || 'category'} (usual ${md.toFixed(0)})`, amount: round2(t.amount - md), date: t.date, txnIds: [t.id], severity: 'info' }) }
  const rank = { crit: 0, warn: 1, info: 2 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.amount - a.amount)
}

// ---------------- financial health ----------------
export interface Health { burnRate: number; income: number; savingsRate: number | null; expenseRatio: number | null; essentialShare: number | null; discretionaryShare: number | null; monthsCovered: number | null; cashFlowScore: number; efficiencyScore: number; months: number; notes: string[] }
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
/** Scores over the last `months` full months (default 3). Burn rate = average monthly spending + debt payments. */
export function healthIndicators(d: Data, s: Settings, months = 3, asOf = today()): Health {
  const m0 = asOf.slice(0, 7); const keys = [...Array(months)].map((_, i) => mAdd(m0, -(i + 1)))
  const from = monthStart(keys[keys.length - 1]), to = monthEnd(keys[0])
  const tx = d.transactions.filter(t => inRange(t, from, to) && !t.exclude_from_budget)
  const spend = sum(tx.filter(t => t.kind === 'expense').map(t => t.amount)), income = sum(tx.filter(t => t.kind === 'income').map(t => t.amount))
  const debt = sum(tx.filter(t => t.kind === 'transfer' && t.to_account_id && d.accounts.some(a => a.id === t.to_account_id && ['credit_card', 'store_card', 'loan', 'auto_loan', 'student_loan', 'mortgage', 'bnpl', 'line_of_credit', 'medical', 'collection', 'other_liability'].includes(a.kind))).map(t => t.amount))
  const pri = (p: string) => sum(categoryLines(d, tx.filter(t => t.kind === 'expense')).filter(l => d.categories.find(c => c.id === l.category_id)?.priority === p).map(l => l.amount))
  const burn = round2((spend + debt) / months), inc = round2(income / months)
  const savingsRate = inc > 0 ? round2((inc - burn) / inc) : null, expenseRatio = inc > 0 ? round2(burn / inc) : null
  const ess = spend > 0 ? round2(pri('Essential') / spend) : null, disc = spend > 0 ? round2(pri('Discretionary') / spend) : null
  const cash = cashOnHand(d, s); const monthsCovered = burn > 0 ? round2(cash / burn) : null
  // cash-flow score: 60% savings rate vs target, 40% months of cover vs the green runway threshold
  const cfs = Math.round(100 * (0.6 * clamp01((savingsRate ?? 0) / Math.max(0.01, s.savingsTargetPct / 100)) + 0.4 * clamp01((monthsCovered ?? 0) / Math.max(1, s.runwayGreen))))
  // efficiency score: low discretionary share, essentials covered by income, no fees
  const fees = sum(tx.filter(t => t.kind === 'expense' && FEE_RX.test(`${t.payee || ''} ${t.memo || ''}`)).map(t => t.amount))
  const eff = Math.round(100 * (0.5 * clamp01(1 - (disc ?? 0) / 0.4) + 0.35 * clamp01(inc > 0 ? 1 - pri('Essential') / months / inc : 0) + 0.15 * clamp01(1 - fees / Math.max(1, spend) * 20)))
  const notes: string[] = []
  if (savingsRate != null && savingsRate < s.savingsTargetPct / 100) notes.push(`Savings rate ${Math.round(savingsRate * 100)}% is below your ${s.savingsTargetPct}% target`)
  if (monthsCovered != null && monthsCovered < s.runwayYellow) notes.push(`Cash covers ${monthsCovered.toFixed(1)} months of spending — under the ${s.runwayYellow}-month floor`)
  if (disc != null && disc > 0.3) notes.push(`Discretionary is ${Math.round(disc * 100)}% of spending`)
  if (fees > 0) notes.push(`${fees.toFixed(2)} went to fees and interest charges`)
  return { burnRate: burn, income: inc, savingsRate, expenseRatio, essentialShare: ess, discretionaryShare: disc, monthsCovered, cashFlowScore: cfs, efficiencyScore: eff, months, notes }
}
