// Estate & beneficiaries checklist (0.22.0). A template of the documents and decisions most households need; each line records
// whether it is done, when, and where the original is kept (a place, never the document itself). Beneficiary gaps come from the
// accounts and life policies. Not legal advice — the checklist says what to ask an attorney about.
import type { Account, Data, EstateItem } from '../app/data/types'
import { addDays, today } from './dates'

export interface EstateTemplate { key: string; area: 'documents' | 'beneficiaries' | 'family'; label: string; why: string; when?: (ctx: { dependents: number }) => boolean }
const hasKids = (ctx: { dependents: number }) => ctx.dependents > 0
export const ESTATE_TEMPLATE: EstateTemplate[] = [
  { key: 'will', area: 'documents', label: 'Will', why: 'says who gets what and who is in charge (the executor); without one, state law decides' },
  { key: 'poa_financial', area: 'documents', label: 'Durable power of attorney for finances', why: 'lets someone you trust pay bills and manage accounts if you cannot' },
  { key: 'poa_health', area: 'documents', label: 'Health-care power of attorney', why: 'names who makes medical decisions when you cannot speak for yourself' },
  { key: 'directive', area: 'documents', label: 'Living will / advance directive', why: 'records the care you want, so family does not have to guess' },
  { key: 'guardian', area: 'family', label: 'Guardian named for minor children', why: 'chosen in the will; otherwise a court picks', when: hasKids },
  { key: 'trust', area: 'documents', label: 'Trust — set up, or decided it is not needed', why: 'can avoid probate and control how money reaches children; ask an attorney if you own property in more than one state' },
  { key: 'benef_retirement', area: 'beneficiaries', label: 'Beneficiaries on every retirement account', why: 'beneficiary forms override the will' },
  { key: 'benef_life', area: 'beneficiaries', label: 'Beneficiaries on every life policy', why: 'name a primary and a contingent beneficiary' },
  { key: 'pod_tod', area: 'beneficiaries', label: 'Payable-on-death / transfer-on-death on bank and brokerage accounts', why: 'passes the account straight to the person named, outside probate' },
  { key: 'executor_told', area: 'family', label: 'Executor and agents know they were named', why: 'and know where the documents are' },
  { key: 'letter', area: 'family', label: 'Letter of instruction', why: 'who to call, which accounts exist, wishes that do not belong in a will' },
  { key: 'digital', area: 'family', label: 'Digital accounts and password-manager emergency access', why: 'set up a legacy contact (Apple, Google) and emergency access in your password manager' },
  { key: 'originals', area: 'family', label: 'Someone knows where the originals are kept', why: 'a will that cannot be found is no help' },
]
export const AREA_LABEL: Record<EstateTemplate['area'], string> = { documents: 'Documents', beneficiaries: 'Beneficiaries', family: 'Family & logistics' }
/** Review a finished document every few years, and after a marriage, divorce, birth, death or move. */
export const REVIEW_YEARS = 3
export const BENEFICIARY_KINDS: Account['kind'][] = ['retirement', 'investment']

/** The template rows to insert for a household starting the checklist (skips keys it already has). */
export function templateRows(d: Data, dependents = 0): Array<Pick<EstateItem, 'key' | 'label' | 'area' | 'status' | 'sort_order'>> {
  const have = new Set((d.estate || []).map(e => e.key).filter(Boolean))
  return ESTATE_TEMPLATE.filter(t => !have.has(t.key) && (!t.when || t.when({ dependents }))).map((t, i) => ({ key: t.key, label: t.label, area: t.area, status: 'todo' as const, sort_order: (d.estate || []).length + i + 1 }))
}
export const templateFor = (key?: string | null) => ESTATE_TEMPLATE.find(t => t.key === key) || null
/** When a finished item is due for a look again: its own review date, else a few years after it was done. */
export const reviewDue = (e: EstateItem) => e.status !== 'done' ? null : e.review_on || (e.done_on ? addDays(e.done_on, Math.round(REVIEW_YEARS * 365.25)) : null)

export function estateStatus(d: Data, asOf = today()) {
  const items = (d.estate || []).slice().sort((a, b) => a.sort_order - b.sort_order)
  const counted = items.filter(e => e.status !== 'na'); const done = counted.filter(e => e.status === 'done').length
  const overdue = items.filter(e => { const r = reviewDue(e); return r != null && r <= asOf })
  const accountGaps = d.accounts.filter(a => a.status === 'Active' && BENEFICIARY_KINDS.includes(a.kind) && !String(a.beneficiary || '').trim())
  const policyGaps = (d.insurance || []).filter(p => p.status === 'Active' && (p.kind === 'life' || p.kind === 'term_life') && !String(p.beneficiary || '').trim())
  const staleBeneficiaries = d.accounts.filter(a => a.status === 'Active' && String(a.beneficiary || '').trim() && (!a.beneficiary_reviewed_on || a.beneficiary_reviewed_on <= addDays(asOf, -Math.round(REVIEW_YEARS * 365.25))))
  return { items, done, total: counted.length, pct: counted.length ? done / counted.length : 0, started: items.length > 0, overdue, accountGaps, policyGaps, staleBeneficiaries }
}
