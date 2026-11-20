// Ask Cresari (0.32.0): what the advisor is told about the household. Built on the person's own device, then sent with the question.
// The rule: a summary of money, never of people. No member names, no email addresses, no account names or numbers (accounts are
// "Checking 1", "Credit card 2"), no institution names, no notes or memos. Category, bill and goal names are kept — they are labels of
// things — but any member's name inside them is taken out. Transactions are sent only when the person has switched that on in
// Settings, and then a payee is sent only as the business name the built-in merchant list recognizes with confidence; anyone else is
// "a payee not listed". What the person types as their question is theirs: it is sent as typed (minus emails and long numbers).
// Pure functions. The server scrubs the text again before it leaves (supabase/functions/ask-cresari/core.ts scrub).
import type { Account, Data, Settings } from '../app/data/types'
import { ACCOUNT_KIND_LABEL } from '../app/data/types'
import { rangeStat, periodStat, uncategorized } from './budget'
import { activeAccounts, isLiability, isRevolving, debtBal, debtPlanned, netWorth, cashOnHand, utilization } from './accounts'
import { balanceOf } from './accounts'
import { recActive, recMonthly } from './recurring'
import { monthlyEquivalent } from './paySchedule'
import { goalProgress } from './goals'
import { portfolio } from './portfolio'
import { liquidity } from './planning'
import { currentPeriod } from './periods'
import { libraryMatch } from './merchants'
import { scrub } from '../../supabase/functions/ask-cresari/core'
import { today, monthStart, monthEnd } from './dates'
import { round2 } from './money'

export interface ContextOptions { /** include individual transactions (the Settings switch) */ detail?: boolean; /** names to take out wherever they appear: members, the household, the signed-in person */ names?: string[]; asOf?: string }
export const DETAIL_DAYS = 90, DETAIL_MAX = 300

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A function that removes people's names (whole words, any case), email addresses and long numbers from a label. */
export function nameScrubber(names: string[] = []) {
  // any script (José, Émile, Мария, 李明), two letters and up (Al, Jo, Li). Everyday words that also turn up in household names are left alone.
  const words = [...new Set(names.flatMap(n => String(n || '').split('@')[0].split(/[^\p{L}\p{M}'’]+/u)).map(w => w.replace(/['’]s$/i, '').replace(/^['’]+|['’]+$/g, '').toLowerCase()).filter(w => [...w].length >= 2 && !COMMON.has(w)))]
    .sort((a, b) => b.length - a.length)
  // a name counts only as a whole word: not preceded or followed by another letter or digit, in any script
  const re = words.length ? new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}])(?:${words.map(esc).join('|')})(?:['’]s)?(?![\\p{L}\\p{M}\\p{N}])`, 'giu') : null
  return (s: unknown) => { let t = scrub(s); if (re) { let prev = ''; while (prev !== t) { prev = t; t = t.replace(re, '$1') } t = t.replace(/\s{2,}/g, ' ').replace(/^[\s'’:–-]+|[\s:–-]+$/g, '') } return t.trim().slice(0, 60) || 'unnamed' }
}
/** Words that are often part of a household's name but are not anybody's name. */
const COMMON = new Set('the|and|family|household|home|house|budget|money|our|my|main|joint|personal|finance|finances|account|accounts|test|demo|sample|an|as|at|be|by|do|go|if|in|is|it|me|no|of|on|or|so|to|up|us|we|for|new|old|car|pay|tax|gas|pet|fun'.split('|'))

const monthsBack = (asOf: string, n: number) => { const [y, m] = asOf.slice(0, 7).split('-').map(Number); return Array.from({ length: n }, (_, i) => { const d = new Date(y, m - 1 - (n - 1 - i), 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }) }
const r0 = (n: number) => Math.round(n)

/** The summary sent with a question. Plain data, small enough to read in full (see ContextOptions for what detail adds). */
export function buildContext(d: Data, s: Settings, o: ContextOptions = {}) {
  const asOf = o.asOf || today()
  // people's names, and the names of the household's banks and lenders (a bill is often named after the card it pays)
  const clean = nameScrubber([...(o.names || []), ...d.accounts.map(x => x.institution || '')])
  const months = monthsBack(asOf, 6); const cur = months[months.length - 1]
  const stats = months.map(m => ({ m, st: rangeStat(d, monthStart(m), m === cur ? asOf : monthEnd(m)) }))
  const full = stats.filter(x => x.m !== cur && x.st.count > 0).slice(-3)
  const avg = (f: (st: ReturnType<typeof rangeStat>) => number) => full.length ? r0(full.reduce((n, x) => n + f(x.st), 0) / full.length) : null
  // spending by category: the average of the last full months on file, and this month so far
  const cats = new Map<string, { avg: number; now: number }>()
  for (const x of full) for (const [k, v] of Object.entries(x.st.byCat)) { const e = cats.get(k) || { avg: 0, now: 0 }; e.avg += v / full.length; cats.set(k, e) }
  for (const [k, v] of Object.entries(stats[stats.length - 1].st.byCat)) { const e = cats.get(k) || { avg: 0, now: 0 }; e.now = v; cats.set(k, e) }
  const byCategory = [...cats.entries()].map(([k, v]) => ({ category: clean(k), monthlyAverage: r0(v.avg), thisMonthSoFar: r0(v.now) })).sort((a, b) => b.monthlyAverage + b.thisMonthSoFar - a.monthlyAverage - a.thisMonthSoFar).slice(0, 30)

  // accounts by type and number — never by name
  const seen: Record<string, number> = {}; const label = new Map<string, string>()
  const accts = activeAccounts(d).filter(a => !a.excluded).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  for (const a of accts) { seen[a.kind] = (seen[a.kind] || 0) + 1; label.set(a.id, `${ACCOUNT_KIND_LABEL[a.kind] || a.kind} ${seen[a.kind]}`) }
  const account = (a: Account) => isLiability(a)
    ? { account: label.get(a.id), type: a.kind, owed: r0(debtBal(a, d)), aprPercent: +a.apr || 0, ...(a.promo_apr != null && a.promo_until && a.promo_until >= asOf ? { promoAprPercent: +a.promo_apr, promoEnds: a.promo_until } : {}),
        minimumPayment: r0(+a.minimum_payment || 0), plannedPayment: r0(debtPlanned(a)), ...(isRevolving(a) && a.credit_limit ? { creditLimit: r0(+a.credit_limit), usedPercent: r0((utilization(a, d) || 0) * 100) } : {}), autopay: !!a.autopay }
    : { account: label.get(a.id), type: a.kind, balance: r0(balanceOf(a, d)), countsAsSpendableCash: !!a.include_in_cash }
  const nw = netWorth(d); const liq = liquidity(d, s, asOf); const pf = portfolio(d); const period = currentPeriod(d, s); const ps = period ? periodStat(d, s, period) : null
  const un = uncategorized(d, monthStart(months[0]), asOf)
  const ctx: Record<string, unknown> = {
    today: asOf, currency: 'USD',
    note: 'Summary built by the Cresari app. Accounts are labelled by type. No names, emails or account numbers are included.',
    monthly: stats.filter((x, i) => x.m === cur || stats.slice(0, i + 1).some(y => y.st.count > 0)).map(x => ({ month: x.m, ...(x.m === cur ? { partial: true } : {}), income: r0(x.st.income), spending: r0(x.st.spend), loanPayments: r0(x.st.loans), cardPayments: r0(x.st.cards), movedToSavings: r0(x.st.saved), leftOver: r0(x.st.net) })),
    averages: { basedOnMonths: full.map(x => x.m), income: avg(st => st.income), spending: avg(st => st.spend), essential: avg(st => st.ess), important: avg(st => st.imp), discretionary: avg(st => st.disc), loanPayments: avg(st => st.loans), leftOver: avg(st => st.net) },
    spendingByCategory: byCategory,
    totals: { spendableCash: r0(cashOnHand(d, s)), assets: r0(nw.assets), debts: r0(nw.liabilities), netWorth: r0(nw.net) },
    emergencyFund: { cash: r0(liq.cash), essentialSpendingPerMonth: r0(liq.essentialsPerMonth), monthsOfEssentialsCovered: liq.monthsEssentials == null ? null : round2(liq.monthsEssentials), targetMonths: liq.targetMonths },
    accounts: accts.map(account),
    income: d.paySchedules.filter(p => p.status === 'Active').map((p, i) => ({ source: `Income ${i + 1}`, type: p.kind, frequency: p.frequency, takeHomePerPaycheck: r0(+p.net_amount || 0), takeHomePerMonth: r0(monthlyEquivalent(+p.net_amount || 0, p.frequency)), ...(p.ends_on ? { endsOn: p.ends_on } : {}) })),
    billsAndSubscriptions: recActive(d).filter(x => x.kind !== 'income' && x.kind !== 'transfer').map(x => ({ name: clean(x.name), type: x.kind, amount: r0(+x.amount || 0), frequency: x.frequency, perMonth: r0(recMonthly(x)), autopay: !!x.autopay, ...(x.next_due ? { nextDue: x.next_due } : {}) })).sort((a, b) => b.perMonth - a.perMonth).slice(0, 40),
    goals: d.goals.filter(g => g.status === 'Active').map(g => { const p = goalProgress(d, g); return { name: clean(g.name), type: g.kind, target: r0(p.target), savedSoFar: r0(p.saved), monthlyContribution: r0(+g.monthly_contribution || 0), ...(g.target_date ? { targetDate: g.target_date } : {}) } }),
    ...(ps ? { budget: { period: `${period!.start_date} to ${period!.end_date}`, plannedIncome: r0(ps.incB), incomeSoFar: r0(ps.incA), plannedSpending: r0(ps.spB), spentSoFar: r0(ps.spA),
      lines: ps.lines.filter(l => l.planned > 0.005 || l.actual > 0.005).map(l => ({ category: clean(l.cat.name), group: clean(l.cat.group || 'Other'), priority: l.cat.priority, planned: r0(l.planned), spent: r0(l.actual), left: r0(l.left) })).slice(0, 60) } } : { budget: null }),
    ...(pf.value > 0 ? { investments: { total: r0(pf.value), costBasis: r0(pf.cost), byAssetClass: pf.byClass.map(c => ({ class: c.label, value: r0(c.value) })) } } : {}),
    ...(s.retirement ? { retirementPlan: { currentAge: s.retirement.currentAge, retireAge: s.retirement.retireAge, yearlyContribution: r0(s.retirement.annualContribution || 0), desiredYearlyIncomeInRetirement: r0(s.retirement.desiredIncome || 0), assumedReturnPercent: s.retirement.expectedReturn, assumedInflationPercent: s.retirement.inflation } } : {}),
    uncategorized: { transactions: un.length, amount: r0(un.reduce((n, t) => n + t.amount, 0)), since: monthStart(months[0]) },
  }
  if (o.detail) {
    const from = (() => { const x = new Date(asOf + 'T12:00:00'); x.setDate(x.getDate() - DETAIL_DAYS); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` })()
    const cat = (id?: string | null) => d.categories.find(c => c.id === id)?.name
    // only the business name the built-in list recognized with confidence ("kroger") — never the rest of the description, which can
    // carry a person's name ("DR JANE SMITH DENTAL" is "a payee not listed")
    const payee = (p: string | null | undefined, kind: 'expense' | 'income') => { const m = p ? libraryMatch(p, kind) : null; return m && m.confidence === 'high' ? clean(m.matched) : 'a payee not listed' }
    ctx.transactions = d.transactions.filter(t => t.status !== 'void' && t.date >= from && t.date <= asOf)
      .sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount).slice(0, DETAIL_MAX)
      .map(t => t.kind === 'transfer' ? { date: t.date, type: 'transfer', amount: round2(t.amount), from: label.get(t.account_id || '') || 'an account', to: (t.to_account_id && label.get(t.to_account_id)) || 'an account' }
        : { date: t.date, type: t.kind, amount: round2(t.amount), payee: payee(t.payee, t.kind), category: clean(cat(t.category_id) || 'Uncategorized'), account: label.get(t.account_id || '') || 'an account' })
    ctx.transactionsNote = `The ${DETAIL_MAX} most recent transactions of the last ${DETAIL_DAYS} days. A payee is named only when it is a well-known business.`
  }
  return ctx
}
/** The summary as the text that is sent — and shown to the person under "What is sent". */
export const contextText = (d: Data, s: Settings, o: ContextOptions = {}) => JSON.stringify(buildContext(d, s, o))

/** Questions to start from, picked from what the household's numbers show. */
export function starters(d: Data, s: Settings, asOf = today()): string[] {
  const out: string[] = []; const debts = activeAccounts(d).filter(a => isLiability(a) && debtBal(a, d) > 0)
  out.push('Where is my money going, and where could I cut back?')
  if (debts.length > 1) out.push('Which debt should I pay off first, and how long would it take?'); else if (debts.length === 1) out.push('How can I pay off my debt faster?')
  const liq = liquidity(d, s, asOf); if (liq.monthsEssentials == null || liq.monthsEssentials < (liq.targetMonths || 3)) out.push('How do I build an emergency fund from here?')
  out.push('Am I saving enough each month?')
  if (s.retirement || d.holdings.length) out.push('Am I on track for retirement?'); else out.push('How should I start saving for retirement?')
  if (d.goals.some(g => g.status === 'Active')) out.push('Am I on track for my goals?')
  return out.slice(0, 5)
}

// ---- showing an answer: a very small, safe formatter (paragraphs, lists, bold) — no HTML is ever taken from the answer ----
export type Block = { kind: 'p' | 'h'; text: string } | { kind: 'ul' | 'ol'; items: string[] }
export function answerBlocks(text: string): Block[] {
  const out: Block[] = []; let para: string[] = []
  const flush = () => { if (para.length) { out.push({ kind: 'p', text: para.join(' ') }); para = [] } }
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim()
    if (!line) { flush(); continue }
    const h = /^#{1,6}\s+(.*)$/.exec(line); if (h) { flush(); out.push({ kind: 'h', text: h[1].replace(/\*\*/g, '') }); continue }
    const ul = /^[-*•]\s+(.*)$/.exec(line), ol = /^\d{1,2}[.)]\s+(.*)$/.exec(line)
    if (ul || ol) { flush(); const kind = ul ? 'ul' : 'ol', item = (ul || ol)![1]; const last = out[out.length - 1]; if (last && last.kind === kind) last.items.push(item); else out.push({ kind, items: [item] }); continue }
    para.push(line)
  }
  flush(); return out
}
/** Split a line into plain and **bold** runs. */
export const boldRuns = (s: string): Array<{ text: string; bold: boolean }> => s.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(p => /^\*\*[^*]+\*\*$/.test(p) ? { text: p.slice(2, -2), bold: true } : { text: p, bold: false })
