// Transaction de-duplication — one rulebook for every way a transaction arrives (bank sync, statement file, email capture, typed by hand).
// NO imports: this exact file is copied next to the bank-sync edge function (supabase/functions/sync-simplefin/dedupe.ts); a unit test fails if the two differ.
//
// Nothing is deleted. A duplicate gets `duplicate_of = <keeper id>` and drops out of every total; the keeper inherits anything the duplicate
// had and it lacked (category, bill, goal, pay schedule, email link, account). "Restore" clears it and marks the row dedupe_ok so it is
// never merged again.
//
// Two rows are compared only when they have the same direction (kind) and the same amount to the cent, within MAX_GAP_DAYS of each other.
//   certain  same day, same (or blank) payee, same or missing account, at least one side not straight from the bank feed
//   likely   within 4 days, payee words overlap ≥ 50 %, same or missing account — e.g. an email payment and the bank line that posts 1–3 days later,
//            or a statement-file row and the bank-sync row for the same purchase
//   possible anything else that looks alike (two identical bank charges on one day, matches across two different accounts) — shown for review,
//            never merged automatically, because those are often real
// Automatic merging also requires the match to be unambiguous: a group that would contain two different bank-feed rows (or two statement-file
// rows), or rows more than MAX_GAP_DAYS from the kept copy, is sent to review instead.

export interface DTxn {
  id: string; date: string; kind: string; amount: number
  account_id?: string | null; to_account_id?: string | null; payee?: string | null; memo?: string | null
  source?: string | null; external_id?: string | null; status?: string | null; category_id?: string | null
  recurring_id?: string | null; goal_id?: string | null; pay_schedule_id?: string | null; email_item_id?: string | null
  duplicate_of?: string | null; dedupe_ok?: boolean | null; created_at?: string | null; check_number?: string | null
}
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
  for (const t of live) { const k = `${t.kind}|${Math.round(Number(t.amount) * 100)}`; const b = buckets.get(k); if (b) b.push(t); else buckets.set(k, [t]) }
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

/** Find duplicates among live rows (not void, not already merged, not marked "not a duplicate"). Merges are applied pass by pass, so a pile-up
 *  (an email filed twice plus the bank line) collapses onto the bank row in one plan. */
export function planDedupe(rows: DTxn[]): DedupePlan {
  const orig = new Map(rows.map(t => [t.id, t])); let work = rows.map(t => ({ ...t }))
  const into = new Map<string, string>(), why = new Map<string, DupPair[]>(); let review: DupPair[] = []
  for (let pass = 0; pass < 6; pass++) {
    const r = onePass(work); review = r.review; if (!r.auto.length) break
    for (const g of r.auto) for (const d of g.dups) { into.set(d, g.keeper); why.set(d, g.pairs) }
    work = work.map(t => into.has(t.id) && !t.duplicate_of ? { ...t, duplicate_of: into.get(t.id)! } : t)
  }
  const root = (id: string): string => into.has(id) ? root(into.get(id)!) : id
  const groups = new Map<string, string[]>()
  for (const d of into.keys()) { const k = root(d); groups.set(k, [...(groups.get(k) || []), d]) }
  const auto: DupGroup[] = [...groups.entries()].map(([keeper, dups]) => {
    const ps = dups.flatMap(d => why.get(d) || [])
    return { keeper, dups, confidence: ps.every(p => p.confidence === 'certain') ? 'certain' : 'likely', reason: [...new Set(ps.map(p => p.reason))].join('; '), patch: keeperPatch(orig.get(keeper)!, dups.map(d => orig.get(d)!)) }
  })
  const seen = new Set<string>(); const settled = (p: DupPair) => root(p.a) === root(p.b) && (into.has(p.a) || into.has(p.b))
  review = review.filter(p => !settled(p) && !into.has(p.a) && !into.has(p.b)).filter(p => { const k = [p.a, p.b].sort().join('|'); if (seen.has(k)) return false; seen.add(k); return true })
  return { auto, review }
}

/** Is an incoming row (not yet saved) already present? Used before inserting so obvious repeats never land at all. */
export function alreadyPresent(row: Omit<DTxn, 'id'>, existing: DTxn[]): DTxn | null {
  const amt = Math.round(Number(row.amount) * 100)
  if (row.external_id) { const hit = existing.find(t => t.external_id === row.external_id); if (hit) return hit }
  const cands = existing.filter(t => !t.duplicate_of && t.status !== 'void' && t.kind === row.kind && Math.round(Number(t.amount) * 100) === amt)
  for (const t of cands) { const p = classify({ ...row, id: '__new__' } as DTxn, t); if (p && p.confidence === 'certain') return t }
  return null
}
