// Budget math. Actuals are ALWAYS derived from transactions; a budget line only holds the plan.
import type { Account, BudgetPeriod, Category, Data, Settings, Transaction } from '../app/data/types'
import { LIABILITY_KINDS, REVOLVING_KINDS } from '../app/data/types'
import { addDays, curMonth, diffDays, fmtD, mAdd, mShort, monthEnd, monthStart, today, weekStart, daysInMonth } from './dates'
import { round2, sum } from './money'
import { elapsed, daysIn } from './periods'
import { expectedIncome } from './paySchedule'
import { liabilities, debtPlanned, debtPaidInRange } from './accounts'
import { categoryLines } from './splits'
import { monthlyCommitments, recActive } from './recurring'

export const inRange = (t: Transaction, from: string, to: string) => t.date >= from && t.date <= to && t.status !== 'void'
export const budgetable = (t: Transaction) => !t.exclude_from_budget

// ---------------- what counts where (0.25.1) ----------------
/** How one transaction counts — the single rule behind income, spending, kept and the savings rate on every page (Dashboard, Budget,
 *  Trends, Spending Intelligence, Reports, Income):
 *   income  money in from outside — but never a credit on a card or loan;
 *   spend   purchases and bills (expenses), on any account: a purchase on a card IS the spending;
 *   refund  a credit on a card or loan (a return, a refund, a statement credit — or a payment whose money did not leave a tracked account):
 *           it takes spending down, it is not income;
 *   card    a payment to a credit card, store card, line of credit or buy-now-pay-later: moving money — the purchases were the spending;
 *   loan    a payment to a mortgage, auto, student or personal loan (or medical, collection or other debt): money leaving the household;
 *   save    a transfer into savings, investment or retirement: saving, not spending;
 *   move    any other transfer between your own accounts. */
export type Flow = 'income' | 'spend' | 'refund' | 'card' | 'loan' | 'save' | 'move'
const SAVING_KINDS = ['savings', 'investment', 'retirement']
type Lookup = (id?: string | null) => Account | undefined
export const accountLookup = (d: Pick<Data, 'accounts'>): Lookup => { const m = new Map(d.accounts.map(a => [a.id, a])); return id => (id ? m.get(id) : undefined) }
export function flowOf(t: Pick<Transaction, 'kind' | 'account_id' | 'to_account_id'>, acct: Lookup): Flow {
  if (t.kind === 'income') { const a = acct(t.account_id); return a && LIABILITY_KINDS.includes(a.kind) ? 'refund' : 'income' }
  if (t.kind === 'expense') return 'spend'
  const to = acct(t.to_account_id)
  if (to && LIABILITY_KINDS.includes(to.kind)) return REVOLVING_KINDS.includes(to.kind) ? 'card' : 'loan'
  if (to && SAVING_KINDS.includes(to.kind)) return 'save'
  return 'move'
}
/** Lines that count against expense categories: expenses, less refunds (split transactions by slice). */
function spendLines(d: Data, txns: Transaction[], acct: Lookup) {
  return [...categoryLines(d, txns.filter(t => flowOf(t, acct) === 'spend')), ...categoryLines(d, txns.filter(t => flowOf(t, acct) === 'refund')).map(l => ({ ...l, amount: -l.amount }))]
}
const splitTouches = (d: Data, t: Transaction) => d.splits.some(s => s.transaction_id === t.id)
export function uncategorized(d: Data, from: string, to: string) { return d.transactions.filter(t => !t.category_id && t.kind !== 'transfer' && inRange(t, from, to) && !splitTouches(d, t)) }

// ---------------- months on file (0.25.1) ----------------
/** The first day with a transaction on file (void rows aside), or null. */
export const firstOnFile = (d: Pick<Data, 'transactions'>) => d.transactions.filter(t => t.status !== 'void').reduce<string | null>((a, t) => (!a || t.date < a ? t.date.slice(0, 10) : a), null)
/** How much of month `m` counts toward a monthly average — the one rule for every "per month" figure (the same idea as the forecast's
 *  months seen): 0 for a month that is not over yet or ends before the first transaction on file, the share of its days from that first
 *  transaction for the month it falls in, else 1. */
export function monthOnFile(d: Pick<Data, 'transactions'>, m: string, asOf = today(), first = firstOnFile(d)): number {
  if (!first || monthEnd(m) >= asOf || monthEnd(m) < first) return 0
  return first > monthStart(m) ? (diffDays(monthEnd(m), first) + 1) / daysInMonth(m) : 1
}
/** How many months a monthly average over the calendar months `ms` stands on: the completed months on file (see monthOnFile), never less
 *  than one once there is any — a first few weeks are not stretched into a bigger month — and 0 when no completed month has data. */
export const monthsOnFile = (d: Pick<Data, 'transactions'>, ms: string[], asOf = today()) => { const first = firstOnFile(d); const n = sum(ms.map(m => monthOnFile(d, m, asOf, first))); return n > 0 ? Math.max(1, n) : 0 }

export interface LineStat { cat: Category; planned: number; rollover: number; available: number; actual: number; left: number; pct: number | null; state: 'good' | 'warn' | 'crit' | 'idle'; lineId?: string; notes?: string | null
  /** 0.25.1: the part of `actual` moved into savings or investments (saving, not spending), and card payments carrying this line (not counted) */
  saved: number; cardPaid: number }
export interface PeriodStat { period: BudgetPeriod; lines: LineStat[]; income: LineStat[]; incB: number; incA: number; spB: number
  /** spent against the plan: every line's actual less what was moved into savings (0.25.1) */
  spA: number
  /** moved into savings or investments on budget lines this period */
  saved: number
  left: number
  /** net (kept) and savings rate for the period's dates, by the one rule every page uses (rangeStat) */
  net: number; rate: number | null
  /** card payments that carry a budget line: shown on Insights, never counted (the purchases on the card are) */
  cardOnLines: Array<{ name: string; amount: number }>
  ess: number; imp: number; disc: number; fixed: number; variable: number; elapsed: number; pace: number | null; uncat: number; expectedPay: number; days: number }
/** Per budget line over a date range, in one pass (split transactions by slice): what the line received (expenses less refunds, plus loan
 *  payments and savings or other transfers that carry it), the part of that moved into savings, card payments that carry it (not counted),
 *  and income received on income lines. */
function lineActuals(d: Data, from: string, to: string) {
  const acct = accountLookup(d); const tx = d.transactions.filter(t => inRange(t, from, to) && budgetable(t))
  const actual = new Map<string, number>(), saved = new Map<string, number>(), card = new Map<string, number>(), income = new Map<string, number>()
  const add = (m: Map<string, number>, k: string | null, v: number) => { if (k) m.set(k, (m.get(k) || 0) + v) }
  for (const l of categoryLines(d, tx)) {
    const f = flowOf(l.txn, acct)
    if (f === 'income') add(income, l.category_id, l.amount)
    else if (f === 'spend') add(actual, l.category_id, l.amount)
    else if (f === 'refund') add(actual, l.category_id, -l.amount)
    else if (f === 'card') add(card, l.category_id, l.amount)
    else { add(actual, l.category_id, l.amount); if (f === 'save') add(saved, l.category_id, l.amount) }
  }
  return { actual, saved, card, income }
}
/** What a budget line has received over a date range: expenses in the category less refunds in it, plus transfers that carry the category
 *  (a loan payment or a savings transfer budgeted as a line) — except card payments: paying a card is moving money, and the purchases on the
 *  card already count against their own lines (0.25.1). */
export function spentIn(d: Data, catId: string, from: string, to: string) { return lineActuals(d, from, to).actual.get(catId) || 0 }
/** The part of spentIn that is money moved into savings, investment or retirement accounts — saving, not spending. */
export function savedIn(d: Data, catId: string, from: string, to: string) { return lineActuals(d, from, to).saved.get(catId) || 0 }
export function receivedIn(d: Data, catId: string, from: string, to: string) { return lineActuals(d, from, to).income.get(catId) || 0 }
/** Everything the Budget screen needs for one period. */
export function periodStat(d: Data, s: Settings, p: BudgetPeriod): PeriodStat {
  const from = p.start_date, to = p.end_date, cats = d.categories.filter(c => !c.archived); const la = lineActuals(d, from, to)
  const lineOf = (c: Category) => d.lines.find(l => l.period_id === p.id && l.category_id === c.id)
  const mk = (c: Category): LineStat => { const l = lineOf(c); const planned = +(l?.planned ?? 0), rollover = +(l?.rollover_in ?? 0), available = planned + rollover
    const inc = c.kind === 'income'; const actual = round2((inc ? la.income : la.actual).get(c.id) || 0); const left = available - actual
    const pct = available > 0 ? actual / available : null
    const state: LineStat['state'] = inc ? (actual >= available && available > 0 ? 'good' : actual > 0 ? 'warn' : 'idle') : !available && !actual ? 'idle' : actual > available * (1 + s.budgetCritPct / 100) ? 'crit' : actual > available ? 'warn' : 'good'
    return { cat: c, planned, rollover, available, actual, left, pct, state, lineId: l?.id, notes: l?.notes, saved: inc ? 0 : round2(la.saved.get(c.id) || 0), cardPaid: inc ? 0 : round2(la.card.get(c.id) || 0) } }
  const shown = (x: LineStat) => x.available > 0 || Math.abs(x.actual) > 0.005 || !!x.lineId
  const lines = cats.filter(c => c.kind === 'expense').map(mk).filter(shown), income = cats.filter(c => c.kind === 'income').map(mk).filter(shown)
  const spent = (x: LineStat) => x.actual - x.saved   // saving is not spending
  const spB = sum(lines.map(x => x.available)), spA = round2(sum(lines.map(spent))), saved = round2(sum(lines.map(x => x.saved))), incB = Math.max(sum(income.map(x => x.available)), +p.expected_income || 0), incA = sum(income.map(x => x.actual))
  const by = (pr: string) => sum(lines.filter(x => x.cat.priority === pr).map(spent)), byT = (ct: string) => lines.filter(x => x.cat.cost_type === ct)
  const el = elapsed(p); const varB = sum(byT('Variable').map(x => x.available)), varA = sum(byT('Variable').map(spent))
  const pace = p.start_date <= today() && p.end_date >= today() && varB ? varA / (varB * Math.max(0.05, el)) : null
  const cf = rangeStat(d, from, to)
  const cardOnLines = [...la.card.entries()].filter(([, v]) => v > 0.005).map(([id, v]) => ({ name: d.categories.find(c => c.id === id)?.name || 'a budget line', amount: round2(v) }))
  return { period: p, lines, income, incB, incA, spB, spA, saved, left: spB - spA - saved, net: cf.net, rate: cf.rate, cardOnLines, ess: by('Essential'), imp: by('Important'), disc: by('Discretionary'), fixed: sum(byT('Fixed').map(spent)), variable: varA, elapsed: el, pace, uncat: sum(uncategorized(d, from, to).map(t => t.amount)), expectedPay: expectedIncome(d.paySchedules, from, to), days: daysIn(p) }
}
/** Totals for any date range — the one definition of income, spending, kept and the savings rate (0.25.1; see Flow):
 *   income   money in from outside (never a credit on a card or loan)
 *   spend    purchases and bills less refunds — a purchase on a card is spending when it is made
 *   loans    payments to mortgages and auto, student, personal or other loans: money leaving the household
 *   cards    payments to cards, lines of credit and buy-now-pay-later: moving money, not counted again
 *   debt     loans + cards, everything paid toward debt (for information)
 *   saved    moved into savings, investment and retirement accounts: saving, not spending
 *   onDebt   the part of spend bought on cards and loans (less refunds) — it leaves cash only when the card is paid
 *   net      kept = income − spend − loans;  rate = net ÷ income (null with no income);  out = spend + loans
 *  byCat / byGroup / ess / imp / disc split spending (refunds taken off their own category). */
export function rangeStat(d: Data, from: string, to: string) {
  const acct = accountLookup(d); const all = d.transactions.filter(t => inRange(t, from, to)); const tx = all.filter(budgetable); const cat = (id?: string | null) => d.categories.find(c => c.id === id)
  let income = 0, purchases = 0, refunds = 0, loans = 0, cards = 0, saved = 0, onDebt = 0
  const onLiability = (t: Transaction) => { const a = acct(t.account_id); return !!a && LIABILITY_KINDS.includes(a.kind) }
  for (const t of tx) { const f = flowOf(t, acct); if (f === 'income') income += t.amount; else if (f === 'spend') { purchases += t.amount; if (onLiability(t)) onDebt += t.amount } else if (f === 'refund') { refunds += t.amount; onDebt -= t.amount } }
  for (const t of all) { const f = flowOf(t, acct); if (f === 'loan') loans += t.amount; else if (f === 'card') cards += t.amount; else if (f === 'save') saved += t.amount }
  const lines = spendLines(d, tx, acct)   // split transactions count each slice against its own category
  const byCat: Record<string, number> = {}; lines.forEach(l => { const k = cat(l.category_id)?.name || 'Uncategorized'; byCat[k] = (byCat[k] || 0) + l.amount })
  const byGroup: Record<string, number> = {}; lines.forEach(l => { const k = cat(l.category_id)?.group || 'Other'; byGroup[k] = (byGroup[k] || 0) + l.amount })
  const pr = (p: string) => sum(lines.filter(l => cat(l.category_id)?.priority === p).map(l => l.amount))
  const spend = round2(purchases - refunds), net = round2(income - spend - loans)
  return { income: round2(income), spend, refunds: round2(refunds), onDebt: round2(onDebt), loans: round2(loans), cards: round2(cards), debt: round2(loans + cards), saved: round2(saved), out: round2(spend + loans), net, rate: income > 0.005 ? net / income : null, byCat, byGroup, ess: pr('Essential'), imp: pr('Important'), disc: pr('Discretionary'), count: tx.length }
}
export type RangeStat = ReturnType<typeof rangeStat>
/** Monthly averages over the calendar months `ms` by the months-on-file rule (0.25.1): only completed months count, none from before the
 *  first transaction on file, the first one by the share of it that is on file, and never fewer than one month in all — a new household's
 *  empty months and the month still running never pull an average down. `months` = how many months the averages stand on (0 = none yet). */
export function monthlyAverages(d: Data, ms: string[], asOf = today()) {
  const first = firstOnFile(d); const use = ms.map(m => ({ m, w: monthOnFile(d, m, asOf, first) })).filter(x => x.w > 0)
  const months = monthsOnFile(d, ms, asOf); const st = use.map(x => rangeStat(d, monthStart(x.m), monthEnd(x.m)))
  const avg = (f: (r: RangeStat) => number) => (months > 0 ? sum(st.map(f)) / months : 0)
  const income = avg(r => r.income), spend = avg(r => r.spend), loans = avg(r => r.loans), net = avg(r => r.net)
  const byCat: Record<string, number> = {}, byGroup: Record<string, number> = {}
  if (months > 0) for (const r of st) { for (const [k, v] of Object.entries(r.byCat)) byCat[k] = (byCat[k] || 0) + v / months; for (const [k, v] of Object.entries(r.byGroup)) byGroup[k] = (byGroup[k] || 0) + v / months }
  return { months, used: use.map(x => x.m), income, spend, loans, cards: avg(r => r.cards), out: spend + loans, net, rate: income > 0.005 ? net / income : null, ess: avg(r => r.ess), disc: avg(r => r.disc), byCat, byGroup }
}
/** Series for trends: week / month / year buckets from the first transaction to now. */
export function trendSeries(d: Data, gran: 'week' | 'month' | 'year') {
  const dates = d.transactions.filter(t => t.status !== 'void').map(t => t.date).sort(); if (!dates.length) return []
  const first = dates[0], t = today(), out: Array<{ key: string; label: string; from: string; to: string; income: number; spend: number; debt: number; loans: number; cards: number; net: number; rate: number | null; planned: number | null }> = []
  const row = (key: string, label: string, from: string, to: string, planned: number | null) => { const r = rangeStat(d, from, to); return { key, label, from, to, income: r.income, spend: r.spend, debt: r.debt, loans: r.loans, cards: r.cards, net: r.net, rate: r.rate, planned } }
  if (gran === 'week') { for (let w = weekStart(first); w <= t; w = addDays(w, 7)) out.push(row(w, 'Wk of ' + fmtD(w), w, addDays(w, 6), null)); return out.slice(-26) }
  if (gran === 'month') { for (let m = first.slice(0, 7); m <= curMonth(); m = mAdd(m, 1)) { const per = d.periods.filter(p => p.period_type === 'month' && p.start_date.slice(0, 7) === m)[0]; const planned = per ? sum(d.lines.filter(l => l.period_id === per.id && d.categories.find(c => c.id === l.category_id)?.kind === 'expense').map(l => +l.planned + +l.rollover_in)) : null; out.push(row(m, mShort(m), monthStart(m), monthEnd(m), planned)) } return out.slice(-24) }
  const ys = [...new Set(d.transactions.map(x => x.date.slice(0, 4)))].sort(); return ys.map(y => row(y, y + (y === t.slice(0, 4) ? ' (YTD)' : ''), y + '-01-01', y + '-12-31', null))
}
/** Insights for a period: over-runs, slack, pace, uncategorized, debt share. */
export function insights(s: Settings, ps: PeriodStat) {
  const out: Array<{ c: 'good' | 'warn' | 'crit' | 'info' | 'idle'; t: string; m: string; save?: number }> = []
  const over = ps.lines.filter(l => l.state !== 'good' && l.state !== 'idle').sort((a, b) => (b.actual - b.available) - (a.actual - a.available))
  over.slice(0, 4).forEach(l => out.push({ c: l.state === 'crit' ? 'crit' : 'warn', t: `${l.cat.name} is over budget`, m: `${round2(l.actual)} spent of ${l.available} planned`, save: l.actual - l.available }))
  if (ps.pace != null && ps.pace > 1.1) out.push({ c: 'warn', t: 'Variable spending is ahead of pace', m: `${Math.round(ps.pace * 100)}% of the pro-rated budget with ${Math.round(ps.elapsed * 100)}% of the period gone` })
  if (ps.pace != null && ps.pace <= 0.9) out.push({ c: 'good', t: 'Variable spending is under pace', m: `${Math.round(ps.pace * 100)}% of the pro-rated budget so far` })
  if (ps.uncat > 0) out.push({ c: 'info', t: 'Uncategorized transactions', m: `${round2(ps.uncat)} is not counted against any budget line — categorize it on the Transactions page` })
  const disc = ps.lines.filter(l => l.cat.priority === 'Discretionary' && l.actual > 0).sort((a, b) => b.actual - a.actual)
  if (disc.length) out.push({ c: 'info', t: `Discretionary spend is ${Math.round(ps.disc / Math.max(1, ps.spA) * 100)}% of spending`, m: `largest: ${disc.slice(0, 3).map(l => `${l.cat.name} ${round2(l.actual)}`).join(', ')}`, save: ps.disc })
  if (ps.rate != null) out.push({ c: ps.rate >= s.savingsTargetPct / 100 ? 'good' : ps.rate >= 0 ? 'warn' : 'crit', t: `Savings rate ${Math.round(ps.rate * 100)}%`, m: `target ${s.savingsTargetPct}% · net ${round2(ps.net)} this period` })
  if (ps.cardOnLines.length) out.push({ c: 'info', t: 'Card payments are not counted as spending', m: `${round2(sum(ps.cardOnLines.map(x => x.amount)))} paid to cards carries ${ps.cardOnLines.map(x => x.name).join(', ')}. The purchases on the cards already count in their own lines, so paying the card is moving money — a plan on that line is money that will not be spent.` })
  if (!out.length) out.push({ c: 'idle', t: 'Nothing to flag', m: 'Every line is within plan so far.' })
  return out
}
/** Monthly loan commitment for the burn rate: planned payments on loans (or what was paid in the month if more). Cards, lines of credit
 *  and buy-now-pay-later are left out (0.25.1): what is bought on them is already counted as spending, so counting the payment as well would
 *  count it twice. */
export function monthlyDebt(d: Data, m = curMonth()) { return sum(liabilities(d).filter(a => !REVOLVING_KINDS.includes(a.kind)).map(a => Math.max(debtPlanned(a), debtPaidInRange(d, a, monthStart(m), monthEnd(m))))) }
/** Card payments planned this month (shown beside the burn rate, not counted in it). */
export function monthlyCardPayments(d: Data, m = curMonth()) { return sum(liabilities(d).filter(a => REVOLVING_KINDS.includes(a.kind)).map(a => Math.max(debtPlanned(a), debtPaidInRange(d, a, monthStart(m), monthEnd(m))))) }
/** What the household must cover in an average month (0.25.1): the recurring bills, subscriptions, savings transfers and card or loan
 *  payment items, plus every card or loan that has no recurring payment item but a planned (or minimum) payment — the same monthly debt
 *  figure the Debts and Accounts pages show. */
export function commitments(d: Data) {
  const c = monthlyCommitments(d); const rec = recActive(d)
  const extra = round2(sum(liabilities(d).filter(a => !rec.some(r => r.liability_account_id === a.id)).map(debtPlanned)))
  return { ...c, debt: round2(c.debt + extra), total: round2(c.total + extra), accountPayments: extra }
}

// ---------------- budgeting modes (0.22.0) ----------------
export type BudgetMode = 'standard' | 'zero' | 'envelope'
export const BUDGET_MODE_LABEL: Record<BudgetMode, string> = { standard: 'Standard', zero: 'Zero-based', envelope: 'Envelopes' }
/** Zero-based: the period's expected income (budgeted income lines or the pay schedules, whichever is larger) minus everything planned
 *  on spending lines is what is still to assign. The aim is exactly $0 — every dollar has a job. */
export function assignment(ps: PeriodStat) {
  const income = round2(Math.max(ps.incB, ps.expectedPay)); const assigned = round2(sum(ps.lines.map(l => l.planned)))
  const toAssign = round2(income - assigned)
  return { income, assigned, toAssign, state: Math.abs(toAssign) < 0.5 ? 'good' as const : toAssign > 0 ? 'warn' as const : 'crit' as const }
}
export interface LinePatch { lineId?: string; category_id: string; planned: number }
/** Envelopes: move money from one line's leftover to another. Never takes more than the source line has left. */
export function moveMoney(ps: PeriodStat, fromCat: string, toCat: string, amount: number): { patches: LinePatch[]; moved: number } {
  const from = ps.lines.find(l => l.cat.id === fromCat), to = ps.lines.find(l => l.cat.id === toCat) || null
  if (!from || fromCat === toCat || !(amount > 0)) return { patches: [], moved: 0 }
  const moved = round2(Math.min(amount, Math.max(0, from.left))); if (moved <= 0) return { patches: [], moved: 0 }
  return { moved, patches: [{ lineId: from.lineId, category_id: fromCat, planned: round2(from.planned - moved) }, { lineId: to?.lineId, category_id: toCat, planned: round2((to?.planned || 0) + moved) }] }
}
/** Envelopes: where to cover an overspent line from — the line with the most left, discretionary lines first. */
export function coverFrom(ps: PeriodStat, catId: string): { from: LineStat | null; amount: number; short: number } {
  const l = ps.lines.find(x => x.cat.id === catId); const short = l ? round2(Math.max(0, -l.left)) : 0; if (!short) return { from: null, amount: 0, short: 0 }
  const rank = { Discretionary: 0, Important: 1, Essential: 2 } as Record<string, number>
  const from = ps.lines.filter(x => x.cat.id !== catId && x.left > 0.005).sort((a, b) => (rank[a.cat.priority] ?? 1) - (rank[b.cat.priority] ?? 1) || b.left - a.left)[0] || null
  return { from, amount: from ? round2(Math.min(short, from.left)) : 0, short }
}
/** Envelopes: every spending line carries its whole balance into the next period — unspent money stays in the envelope, an overspent
 *  envelope starts the next period owing. Returns the lines of `next` whose carry-in should change (or be created). */
export function envelopeCarry(d: Data, s: Settings, prev: BudgetPeriod, next: BudgetPeriod): Array<{ lineId?: string; category_id: string; rollover_in: number; planned?: number }> {
  const ps = periodStat(d, s, prev); const out: Array<{ lineId?: string; category_id: string; rollover_in: number; planned?: number }> = []
  for (const l of ps.lines) {
    const carry = round2(l.left); const nl = d.lines.find(x => x.period_id === next.id && x.category_id === l.cat.id)
    if (nl) { if (Math.abs(+nl.rollover_in - carry) > 0.005) out.push({ lineId: nl.id, category_id: l.cat.id, rollover_in: carry }) }
    else if (Math.abs(carry) > 0.005) out.push({ category_id: l.cat.id, rollover_in: carry, planned: 0 })
  }
  return out
}
/** The period right before this one, if it was started. */
export const previousPeriod = (d: Data, p: BudgetPeriod) => d.periods.filter(x => x.id !== p.id && x.start_date < p.start_date).sort((a, b) => b.start_date.localeCompare(a.start_date))[0] || null
