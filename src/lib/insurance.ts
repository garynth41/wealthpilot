// Insurance register (0.22.0): premiums per year, renewals coming up, and coverage gaps against simple rules of thumb.
// The gap rules are prompts to look, not advice: the life-insurance need is a DIME-style rough estimate (debts + years of income
// − liquid assets), the disability target is the usual 60% of pay.
import type { Data, InsuranceKind, InsurancePolicy, Settings } from '../app/data/types'
import { addDays, diffDays, today } from './dates'
import { round2, sum } from './money'
import { liabilities, debtBal, balanceOf, netWorth } from './accounts'
import { PER_YEAR } from './paySchedule'
import { rangeStat } from './budget'

export const PREMIUM_PER_YEAR: Record<InsurancePolicy['premium_frequency'], number> = { monthly: 12, quarterly: 4, semiannual: 2, yearly: 1 }
export const annualPremium = (p: Pick<InsurancePolicy, 'premium' | 'premium_frequency'>) => round2((+p.premium || 0) * (PREMIUM_PER_YEAR[p.premium_frequency] || 12))
const LIFE: InsuranceKind[] = ['life', 'term_life']
export const active = (d: Pick<Data, 'insurance'>) => (d.insurance || []).filter(p => p.status === 'Active')
export const hasKind = (d: Pick<Data, 'insurance'>, ...k: InsuranceKind[]) => active(d).some(p => k.includes(p.kind))

/** Yearly gross income from active pay schedules (take-home when gross is not set). */
export function annualIncome(d: Data) { return round2(sum(d.paySchedules.filter(p => p.status === 'Active').map(p => (p.gross_amount != null && +p.gross_amount > 0 ? +p.gross_amount : +p.net_amount || 0) * (PER_YEAR[p.frequency] || 0)))) }
export const earnedIncome = (d: Data) => round2(sum(d.paySchedules.filter(p => p.status === 'Active' && (p.kind === 'salary' || p.kind === 'hourly' || p.kind === 'side')).map(p => (p.gross_amount != null && +p.gross_amount > 0 ? +p.gross_amount : +p.net_amount || 0) * (PER_YEAR[p.frequency] || 0))))

export interface LifeNeed { debts: number; income: number; years: number; liquid: number; need: number; have: number; gap: number }
/** Rough life-insurance need: what is owed plus `years` of income, less what is already saved outside retirement accounts. */
export function lifeNeed(d: Data, years = 10): LifeNeed {
  const debts = round2(sum(liabilities(d).map(a => debtBal(a, d)))), income = annualIncome(d)
  const liquid = round2(sum(d.accounts.filter(a => a.status === 'Active' && ['checking', 'savings', 'cash', 'investment'].includes(a.kind)).map(a => balanceOf(a, d))))
  const need = round2(Math.max(0, debts + income * years - liquid)), have = round2(sum(active(d).filter(p => LIFE.includes(p.kind)).map(p => Number(p.coverage) || 0)))
  return { debts, income, years, liquid, need, have, gap: round2(Math.max(0, need - have)) }
}

export interface Gap { key: string; severity: 'crit' | 'warn' | 'info'; title: string; detail: string; kind?: InsuranceKind; policyId?: string }
export function coverageGaps(d: Data, s: Settings, asOf = today()): Gap[] {
  const out: Gap[] = []; const income = annualIncome(d), earned = earnedIncome(d); const dependents = (s.tax?.dependentsUnder17 || 0) + (s.tax?.otherDependents || 0)
  const spend = rangeStat(d, addDays(asOf, -90), asOf); const catSpend = (re: RegExp) => sum(Object.entries(spend.byCat).filter(([k]) => re.test(k)).map(([, v]) => v))
  if (!hasKind(d, 'health')) out.push({ key: 'health', severity: 'crit', kind: 'health', title: 'No health insurance on file', detail: 'one hospital stay can cost more than a year of premiums — add the plan you have (employer, marketplace or Medicare) or note why there is none' })
  if (income > 0) { const ln = lifeNeed(d)
    if (!hasKind(d, ...LIFE)) out.push({ key: 'life', severity: dependents > 0 ? 'crit' : 'warn', kind: 'term_life', title: 'No life insurance on file', detail: `a rough need is about $${Math.round(ln.need).toLocaleString('en-US')} (debts $${Math.round(ln.debts).toLocaleString('en-US')} + ${ln.years} years of income − $${Math.round(ln.liquid).toLocaleString('en-US')} saved)${dependents ? ' — you list dependents' : ''}; term life is the inexpensive way to cover it` })
    else if (ln.gap > Math.max(25000, ln.need * 0.2)) out.push({ key: 'life-gap', severity: 'warn', kind: 'term_life', title: `Life coverage may be short by about $${Math.round(ln.gap).toLocaleString('en-US')}`, detail: `coverage $${Math.round(ln.have).toLocaleString('en-US')} against a rough need of $${Math.round(ln.need).toLocaleString('en-US')}` }) }
  if (earned > 0 && !hasKind(d, 'disability')) out.push({ key: 'disability', severity: 'warn', kind: 'disability', title: 'No disability insurance on file', detail: `your income is your biggest asset; the usual target replaces about 60% of pay — $${Math.round(earned * 0.6 / 12).toLocaleString('en-US')}/mo (check whether your employer provides it)` })
  const cars = d.accounts.some(a => a.status === 'Active' && a.kind === 'auto_loan') || catSpend(/fuel|gas station|auto|car/i) > 0
  if (cars && !hasKind(d, 'auto')) out.push({ key: 'auto', severity: 'crit', kind: 'auto', title: 'No auto insurance on file', detail: 'you have a car loan or fuel spending; liability coverage is required in every state' })
  const mortgage = d.accounts.some(a => a.status === 'Active' && a.kind === 'mortgage')
  if (mortgage && !hasKind(d, 'home')) out.push({ key: 'home', severity: 'crit', kind: 'home', title: 'No homeowners insurance on file', detail: 'your lender requires it, and it protects the largest asset you own' })
  else if (!mortgage && catSpend(/^rent|rent \/ mortgage|^rent$/i) > 0 && !hasKind(d, 'renters', 'home')) out.push({ key: 'renters', severity: 'warn', kind: 'renters', title: 'No renters insurance on file', detail: 'your landlord\'s policy does not cover your belongings or your liability; it is usually $15–30 a month' })
  const nw = netWorth(d).net
  if (nw >= 500000 && !hasKind(d, 'umbrella')) out.push({ key: 'umbrella', severity: 'warn', kind: 'umbrella', title: 'Consider an umbrella liability policy', detail: `net worth is about $${Math.round(nw).toLocaleString('en-US')}; a $1M umbrella usually costs a few hundred dollars a year and sits over auto and home liability` })
  const age = s.retirement?.currentAge || 0
  if (age >= 50 && !hasKind(d, 'long_term_care')) out.push({ key: 'ltc', severity: 'info', kind: 'long_term_care', title: 'Long-term care: worth a decision', detail: 'premiums rise with age; the 50s are when most people decide to buy coverage, self-insure or use a hybrid life policy' })
  for (const p of active(d)) {
    if (LIFE.includes(p.kind) && !String(p.beneficiary || '').trim()) out.push({ key: 'benef-' + p.id, severity: 'warn', policyId: p.id, title: `${p.name}: no beneficiary recorded`, detail: 'without a named beneficiary the payout can go through probate' })
    if (p.renews_on) { const dd = diffDays(p.renews_on, asOf); if (dd >= 0 && dd <= 45) out.push({ key: 'renew-' + p.id, severity: 'info', policyId: p.id, title: `${p.name} renews ${dd === 0 ? 'today' : `in ${dd} day${dd === 1 ? '' : 's'}`}`, detail: 'a good moment to compare quotes and check the coverage still fits' }) }
    if (!p.through_employer && !p.recurring_id && +p.premium > 0) out.push({ key: 'bill-' + p.id, severity: 'info', policyId: p.id, title: `${p.name}: premium is not on the Bills page`, detail: `$${annualPremium(p).toLocaleString('en-US')} a year — add it so the forecast and budget count it` })
  }
  const rank = { crit: 0, warn: 1, info: 2 }; return out.sort((a, b) => rank[a.severity] - rank[b.severity])
}

export function insuranceSummary(d: Data, s: Settings, asOf = today()) {
  const act = active(d); const annual = round2(sum(act.map(annualPremium)))
  const renewals = act.filter(p => p.renews_on && p.renews_on >= asOf && p.renews_on <= addDays(asOf, 60)).sort((a, b) => a.renews_on!.localeCompare(b.renews_on!))
  const byKind = new Map<InsuranceKind, number>(); for (const p of act) byKind.set(p.kind, round2((byKind.get(p.kind) || 0) + annualPremium(p)))
  return { active: act, annual, monthly: round2(annual / 12), renewals, byKind: [...byKind.entries()].sort((a, b) => b[1] - a[1]), gaps: coverageGaps(d, s, asOf), life: lifeNeed(d), shareOfIncome: annualIncome(d) > 0 ? round2(annual / annualIncome(d)) : null }
}
/** The Bills row a policy's premium becomes (Bills → recurring). */
export function premiumBill(p: InsurancePolicy, accountId: string | null, categoryId: string | null) {
  const freq = ({ monthly: 'monthly', quarterly: 'quarterly', semiannual: 'every_6_months', yearly: 'yearly' } as const)[p.premium_frequency]
  const due = p.renews_on || today()
  return { name: `${p.name} premium`, payee: p.carrier || p.name, kind: 'bill' as const, amount: +p.premium || 0, amount_varies: false, frequency: freq, day_of_month: +due.slice(8, 10), next_due: due, account_id: accountId, category_id: categoryId, autopay: false, reminder_days: 3, status: 'Active' as const, sort_order: 999, notes: 'Added from the insurance register' }
}
