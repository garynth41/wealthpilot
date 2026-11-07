// Transaction de-duplication — one rulebook for every way a transaction arrives (bank sync, statement file, email capture, typed by hand).
// Imports only ./simplefin.ts (itself import-free): this exact file is copied next to the bank-sync edge function
// (supabase/functions/sync-simplefin/dedupe.ts, beside its simplefin.ts); a unit test fails if the two differ.
//
// Nothing is deleted. A duplicate gets `duplicate_of = <keeper id>` and drops out of every total; the keeper inherits anything the duplicate
// had and it lacked (category, bill, goal, pay schedule, email link, account). "Restore" clears it and marks the row dedupe_ok so it is
// never merged again.
//
// Card and loan payments (0.25.1): the bank feed and statement files bring one payment as two rows — money out of checking or savings (an
// expense there) and the same amount arriving on the card or loan (a payment into it with no source account, or a credit on it). When the
// household's accounts are passed in, those two rows become one transfer: the checking or savings row is kept as a transfer into the card
// or loan, the other row is merged into it (see paymentPairs), and an emailed or typed copy of the payment then merges into that transfer
// by the rules below. Restoring the card-side row puts the kept row back as the expense it was (unpairPatch).
//
// Two rows are compared only when they have the same direction (kind; a payment into a card or loan with no source account counts as money
// in, like a credit on it) and the same amount to the cent, within MAX_GAP_DAYS of each other.
//   certain  same day, same (or blank) payee, same or missing account, at least one side not straight from the bank feed
//   likely   within 4 days, payee words overlap ≥ 50 %, same or missing account — e.g. an email payment and the bank line that posts 1–3 days later,
//            or a statement-file row and the bank-sync row for the same purchase
//   possible anything else that looks alike (two identical bank charges on one day, matches across two different accounts) — shown for review,
//            never merged automatically, because those are often real
// Automatic merging also requires the match to be unambiguous: a group that would contain two different bank-feed rows (or two statement-file
// rows), or rows more than MAX_GAP_DAYS from the kept copy, is sent to review instead.

import { cardCredit } from './simplefin.ts'

export interface DTxn {
  id: string; date: string; kind: string; amount: number
  account_id?: string | null; to_account_id?: string | null; payee?: string | null; memo?: string | null
  source?: string | null; external_id?: string | null; status?: string | null; category_id?: string | null
  recurring_id?: string | null; goal_id?: string | null; pay_schedule_id?: string | null; email_item_id?: string | null
  duplicate_of?: string | null; dedupe_ok?: boolean | null; created_at?: string | null; check_number?: string | null
}
/** The household's accounts, as far as the payment pairing needs them. */
export interface DAccount { id: string; kind: string; name?: string | null; institution?: string | null }
export type DupConfidence = 'certain' | 'likely' | 'possible'
export interface DupPair { a: string; b: string; confidence: DupConfidence; reason: string; days: number; sim: number | null }
export interface DupGroup { keeper: string; dups: string[]; confidence: DupConfidence; reason: string; patch: Partial<DTxn> }
export interface DedupePlan { auto: DupGroup[]; review: DupPair[] }

export const MAX_GAP_DAYS = 4
const STOP = new Set(['pay', 'payment', 'payments', 'pmt', 'bill', 'billing', 'billpay', 'ach', 'online', 'autopay', 'auto', 'purchase', 'debit', 'credit', 'card', 'pos',
  'the', 'inc', 'llc', 'ltd', 'co', 'corp', 'company', 'services', 'service', 'svc', 'com', 'www', 'recurring', 'transfer', 'from', 'to', 'of', 'and', 'for', 'ref',
  'mobile', 'web', 'checkcard', 'visa', 'mastercard', 'des', 'indn', 'id', 'conf', 'confirmation', 'sq', 'tst', 'paypal', 'thank', 'you', 'your', 'us', 'usa', 'na'])

/** Words that identify a payee: bank boilerplate (DES:, ID:, INDN:, CO ID:), card numbers, dates and filler words removed. */
export function payeeTokens(s?: string | null): string[] {
  let x = String(s || '').toLowerCase()
  x = x.split(/\s(?:des|indn|co id|ppd id|web id|id|conf(?:irmation)?\s*#?)\s*:/)[0]
  x = x.replace(/&/g, '').replace(/['’]/g, '').replace(/x{2,}\w*/g, ' ').replace(/[^a-z0-9]+/g, ' ')
  return [...new Set(x.split(' ').filter(w => w.length >= 2 && !/^\d+$/.test(w) && !STOP.has(w)))]
}
/** Share of the shorter payee's words found in the other (a word also matches the start of a longer one, "amzn" ~ "amzn mktp"). null when either has no words. */
export function payeeSimilarity(a?: string | null, b?: string | null): number | null {
  const A = payeeTokens(a), B = payeeTokens(b); if (!A.length || !B.length) return null
  const [short, long] = A.length <= B.length ? [A, B] : [B, A]
  const hit = short.filter(w => long.some(v => v === w || (w.length >= 3 && v.length >= 3 && (v.startsWith(w) || w.startsWith(v))))).length
  return hit / short.length
}

const DAY = 86400000
const dayGap = (a: string, b: string) => Math.round(Math.abs(Date.parse(a.slice(0, 10) + 'T12:00:00Z') - Date.parse(b.slice(0, 10) + 'T12:00:00Z')) / DAY)
const acct = (t: DTxn) => t.account_id || t.to_account_id || null
/** The direction two rows must share to be compared: their kind, except that a payment into an account with no source account (a statement
 *  file's or the bank feed's card payment) is money in, the same as a credit on that account (0.25.1). */
export const direction = (t: Pick<DTxn, 'kind' | 'account_id' | 'to_account_id'>) => (t.kind === 'transfer' && !t.account_id && t.to_account_id ? 'income' : t.kind)
/** Where a row came from: the live bank feed, a statement file, or typed (email capture / manual / anything else without a bank id). */
export function origin(t: DTxn): 'bank' | 'file' | 'typed' {
  const e = t.external_id || ''
  if (e.startsWith('sfin:')) return 'bank'
  if (e.startsWith('mig:')) return 'typed'   // history moved in from another app (0.24.0) is what you typed there, not a bank record (0.25.0)
  if (e) return 'file'
  return 'typed'
}
const RANK = { bank: 0, file: 1, typed: 2 } as const
/** Which copy to keep: bank feed, then statement file, then email, then manual; then the one already categorised; then the oldest. */
export function keeperOrder(a: DTxn, b: DTxn): number {
  const r = RANK[origin(a)] - RANK[origin(b)]; if (r) return r
  const se = (t: DTxn) => t.source === 'email' ? 0 : 1; const s = se(a) - se(b); if (s && origin(a) === 'typed') return s
  const c = (b.category_id ? 1 : 0) - (a.category_id ? 1 : 0); if (c) return c
  return String(a.created_at || '').localeCompare(String(b.created_at || '')) || a.id.localeCompare(b.id)
}

/** Compare two rows already known to have the same kind and amount. */
export function classify(a: DTxn, b: DTxn): DupPair | null {
  const days = dayGap(a.date, b.date); if (days > MAX_GAP_DAYS) return null
  const sim = payeeSimilarity(a.payee, b.payee); const oa = origin(a), ob = origin(b)
  const A = acct(a), B = acct(b); const same = !!A && A === B, missing = !A || !B, diff = !!A && !!B && A !== B
  const out = (confidence: DupConfidence, reason: string): DupPair => ({ a: a.id, b: b.id, confidence, reason, days, sim })
  const payeeOk = sim === null || sim >= 0.5
  // two rows that each carry a different id from the same kind of feed: real repeats are common (two coffees, two transfers) — review only
  if (oa !== 'typed' && oa === ob) return same && days === 0 && (sim === null || sim === 1) ? out('possible', `two ${oa === 'bank' ? 'bank-feed' : 'statement-file'} rows: same day, amount and payee`) : null
  if (diff) return days <= 3 && sim !== null && sim >= 0.5 ? out('possible', 'same amount and payee in two different accounts') : null
  const where = same ? 'same account' : missing ? 'one has no account' : ''
  if (days === 0 && (sim === null || sim === 1)) return out('certain', `same day, amount and payee (${where})`)
  if (payeeOk && (sim !== null || days <= 1)) return out('likely', `same amount ${days} day${days === 1 ? '' : 's'} apart, payee ${sim === null ? 'blank on one side' : Math.round(sim * 100) + '% alike'} (${where})`)
  if (sim !== null && sim > 0) return out('possible', `same amount ${days} day${days === 1 ? '' : 's'} apart, payee partly alike`)
  return null
}

const LINKS: Array<keyof DTxn> = ['category_id', 'recurring_id', 'goal_id', 'pay_schedule_id', 'email_item_id', 'account_id', 'check_number']
/** What the keeper should take over from the duplicates it absorbs (only fields it is missing). */
export function keeperPatch(keeper: DTxn, dups: DTxn[]): Partial<DTxn> {
  const p: Record<string, unknown> = {}
  for (const k of LINKS) if (!keeper[k]) { const v = dups.map(d => d[k]).find(Boolean); if (v) p[k] = v }
  if (p.account_id && keeper.to_account_id) delete p.account_id
  return p as Partial<DTxn>
}

interface Pass { auto: Array<{ keeper: string; dups: string[]; pairs: DupPair[] }>; review: DupPair[] }
function onePass(rows: DTxn[]): Pass {
  const live = rows.filter(t => !t.duplicate_of && t.status !== 'void' && Number(t.amount) > 0)
  const byId = new Map(live.map(t => [t.id, t]))
  const buckets = new Map<string, DTxn[]>()
  for (const t of live) { const k = `${direction(t)}|${Math.round(Number(t.amount) * 100)}`; const b = buckets.get(k); if (b) b.push(t); else buckets.set(k, [t]) }
  const pairs: DupPair[] = []
  for (const b of buckets.values()) {
    if (b.length < 2) continue
    b.sort((x, y) => x.date.localeCompare(y.date))
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length && dayGap(b[i].date, b[j].date) <= MAX_GAP_DAYS; j++) { const p = classify(b[i], b[j]); if (p) pairs.push(p) }
  }
  const ok = (id: string) => !byId.get(id)!.dedupe_ok
  const lvl = (p: DupPair) => p.confidence === 'certain' ? 0 : p.confidence === 'likely' ? 1 : 2
  const strong = pairs.filter(p => lvl(p) < 2 && ok(p.a) && ok(p.b))
  const review: DupPair[] = pairs.filter(p => lvl(p) === 2 && !(byId.get(p.a)!.dedupe_ok && byId.get(p.b)!.dedupe_ok))
  const autoPairs: DupPair[] = strong, held: DupPair[] = []
  const parent = new Map<string, string>(); const find = (x: string): string => { const q = parent.get(x); if (!q || q === x) return x; const r = find(q); parent.set(x, r); return r }
  for (const p of autoPairs) parent.set(find(p.a), find(p.b))
  const comps = new Map<string, string[]>()
  for (const p of autoPairs) for (const id of [p.a, p.b]) { const r = find(id); const c = comps.get(r) || []; if (!c.includes(id)) c.push(id); comps.set(r, c) }
  const auto: Pass['auto'] = []
  for (const ids of comps.values()) {
    const ts = ids.map(id => byId.get(id)!).sort(keeperOrder); const inGroup = autoPairs.filter(p => ids.includes(p.a))
    // a group may hold at most one bank-feed row and one statement-file row (two would be two real transactions), all within MAX_GAP_DAYS of the keeper
    if (ts.filter(t => origin(t) === 'bank').length > 1 || ts.filter(t => origin(t) === 'file').length > 1 || ts.some(t => dayGap(t.date, ts[0].date) > MAX_GAP_DAYS)) { held.push(...inGroup); continue }
    auto.push({ keeper: ts[0].id, dups: ts.slice(1).map(t => t.id), pairs: inGroup })
  }
  review.push(...held.map(p => ({ ...p, confidence: 'possible' as const, reason: p.reason + ' — more than one possible match' })))
  return { auto, review }
}

// ---------------- card and loan payments (0.25.1) ----------------
const LIAB = new Set(['credit_card', 'store_card', 'loan', 'auto_loan', 'student_loan', 'mortgage', 'bnpl', 'line_of_credit', 'medical', 'collection', 'other_liability'])
const OWN_CASH = new Set(['checking', 'savings'])
export interface PaymentPair { out: string; into: string; to: string; days: number; reason: string }
/** The two rows of one card or loan payment: money out of the household's own checking or savings (an expense there, from the bank feed or a
 *  statement file) and the same amount to the cent arriving on a card or loan at most MAX_GAP_DAYS earlier or later — a payment into it with
 *  no source account, or a credit on it that does not read as a refund (cardCredit). Each row must be the other's only candidate; when a row
 *  has several, the ones whose payee names the card or loan (or its bank) are preferred, and if that does not leave exactly one, nothing is
 *  paired. Rows typed by hand or from email, merged, void or marked "not a duplicate" are left alone. */
export function paymentPairs(rows: DTxn[], accounts: DAccount[]): PaymentPair[] {
  const kindOf = new Map(accounts.map(a => [a.id, a.kind])), label = new Map(accounts.map(a => [a.id, `${a.name || ''} ${a.institution || ''}`]))
  const ok = (t: DTxn) => !t.duplicate_of && t.status !== 'void' && !t.dedupe_ok && Number(t.amount) > 0 && origin(t) !== 'typed'
  const into = (t: DTxn): string | null => {
    if (t.kind === 'transfer' && !t.account_id && t.to_account_id && LIAB.has(kindOf.get(t.to_account_id) || '')) return t.to_account_id
    if (t.kind === 'income' && t.account_id && LIAB.has(kindOf.get(t.account_id) || '') && cardCredit(`${t.payee || ''} ${t.memo || ''}`) !== 'refund') return t.account_id
    return null
  }
  const byId = new Map(rows.map(t => [t.id, t])); const toOf = new Map<string, string>()
  const outs = rows.filter(t => ok(t) && t.kind === 'expense' && !!t.account_id && OWN_CASH.has(kindOf.get(t.account_id) || ''))
  const ins = rows.filter(ok).filter(t => { const a = into(t); if (a) toOf.set(t.id, a); return !!a })
  const cents = (t: DTxn) => Math.round(Number(t.amount) * 100)
  const outsOf = new Map<string, string[]>(), insOf = new Map<string, string[]>()
  for (const i of ins) for (const o of outs) if (cents(o) === cents(i) && dayGap(o.date, i.date) <= MAX_GAP_DAYS) { outsOf.set(i.id, [...(outsOf.get(i.id) || []), o.id]); insOf.set(o.id, [...(insOf.get(o.id) || []), i.id]) }
  const named = (o: string, i: string) => (payeeSimilarity(byId.get(o)!.payee, label.get(toOf.get(i)!)) ?? 0) > 0
  const narrow = (cands: string[], keep: (id: string) => boolean) => { if (cands.length < 2) return cands; const k = cands.filter(keep); return k.length ? k : cands }
  const out: PaymentPair[] = []
  for (const i of ins) {
    const os = narrow(outsOf.get(i.id) || [], o => named(o, i.id)); if (os.length !== 1) continue
    const is = narrow(insOf.get(os[0]) || [], x => named(os[0], x)); if (is.length !== 1 || is[0] !== i.id) continue
    const days = dayGap(byId.get(os[0])!.date, i.date)
    out.push({ out: os[0], into: i.id, to: toOf.get(i.id)!, days, reason: `card or loan payment — left checking or savings and arrived on the account ${days === 0 ? 'the same day' : `${days} day${days === 1 ? '' : 's'} apart`}` })
  }
  return out
}
/** Restoring the card or loan side of a paired payment (0.25.1): the kept row goes back to the expense it arrived as, and is not paired
 *  again. Null when the restored row was an ordinary duplicate. */
export function unpairPatch(keeper: DTxn, restored: DTxn): Partial<DTxn> | null {
  if (keeper.kind !== 'transfer' || !keeper.account_id || !keeper.to_account_id || origin(keeper) === 'typed' || origin(restored) === 'typed') return null
  const into = restored.kind === 'income' ? restored.account_id : restored.kind === 'transfer' && !restored.account_id ? restored.to_account_id : null
  return into && into === keeper.to_account_id ? { kind: 'expense', to_account_id: null, dedupe_ok: true } : null
}

/** Find duplicates among live rows (not void, not already merged, not marked "not a duplicate"). Merges are applied pass by pass, so a pile-up
 *  (an email filed twice plus the bank line) collapses onto the bank row in one plan. With the household's accounts (0.25.1), the two rows of
 *  a card or loan payment become one transfer first (paymentPairs), and the kept row's patch turns it into that transfer. */
export function planDedupe(rows: DTxn[], accounts: DAccount[] = []): DedupePlan {
  const orig = new Map(rows.map(t => [t.id, t])); let work = rows.map(t => ({ ...t }))
  const into = new Map<string, string>(), why = new Map<string, DupPair[]>(), paid = new Map<string, Partial<DTxn>>(); let review: DupPair[] = []
  for (let pass = 0; pass < 8; pass++) {
    const r = onePass(work); review = r.review
    if (r.auto.length) { for (const g of r.auto) for (const d of g.dups) { into.set(d, g.keeper); why.set(d, g.pairs) } }
    else {
      const ps = accounts.length ? paymentPairs(work, accounts) : []; if (!ps.length) break
      for (const p of ps) { into.set(p.into, p.out); why.set(p.into, [{ a: p.out, b: p.into, confidence: 'likely', reason: p.reason, days: p.days, sim: null }]); paid.set(p.out, { kind: 'transfer', to_account_id: p.to }) }
    }
    work = work.map(t => { const x = paid.get(t.id); const w = x && t.kind === 'expense' ? { ...t, ...x } : t; return into.has(t.id) && !w.duplicate_of ? { ...w, duplicate_of: into.get(t.id)! } : w })
  }
  const root = (id: string): string => into.has(id) ? root(into.get(id)!) : id
  const groups = new Map<string, string[]>()
  for (const d of into.keys()) { const k = root(d); groups.set(k, [...(groups.get(k) || []), d]) }
  const auto: DupGroup[] = [...groups.entries()].map(([keeper, dups]) => {
    const ps = dups.flatMap(d => why.get(d) || [])
    return { keeper, dups, confidence: ps.every(p => p.confidence === 'certain') ? 'certain' : 'likely', reason: [...new Set(ps.map(p => p.reason))].join('; '), patch: { ...keeperPatch(orig.get(keeper)!, dups.map(d => orig.get(d)!)), ...(paid.get(keeper) || {}) } }
  })
  const seen = new Set<string>(); const settled = (p: DupPair) => root(p.a) === root(p.b) && (into.has(p.a) || into.has(p.b))
  review = review.filter(p => !settled(p) && !into.has(p.a) && !into.has(p.b)).filter(p => { const k = [p.a, p.b].sort().join('|'); if (seen.has(k)) return false; seen.add(k); return true })
  return { auto, review }
}

/** Is an incoming row (not yet saved) already present? Used before inserting so obvious repeats never land at all. */
export function alreadyPresent(row: Omit<DTxn, 'id'>, existing: DTxn[]): DTxn | null {
  const amt = Math.round(Number(row.amount) * 100)
  if (row.external_id) { const hit = existing.find(t => t.external_id === row.external_id); if (hit) return hit }
  const cands = existing.filter(t => !t.duplicate_of && t.status !== 'void' && direction(t) === direction(row) && Math.round(Number(t.amount) * 100) === amt)
  for (const t of cands) { const p = classify({ ...row, id: '__new__' } as DTxn, t); if (p && p.confidence === 'certain') return t }
  return null
}
