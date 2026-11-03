// SimpleFIN Bridge (https://www.simplefin.org/protocol.html) — the pure parts of automatic bank sync: setup-token decoding, response normalisation,
// matching a bank's accounts to WealthPilot accounts, mapping transactions, and de-duplication.
// NO imports: this exact file is copied next to the edge function (supabase/functions/sync-simplefin/simplefin.ts) and a unit test fails if the two differ.
// Nothing here talks to the network or the database.

export interface SfinTxn { id: string; posted: number; amount: string; description: string; pending?: boolean }
export interface SfinOrg { name?: string; domain?: string; id?: string; 'sfin-url'?: string }
export interface SfinAccountRaw { id: string; name: string; org?: SfinOrg; currency?: string; balance: string; 'available-balance'?: string; 'balance-date'?: number; transactions?: SfinTxn[] }
export interface SfinResponse { errors?: string[]; accounts?: SfinAccountRaw[] }

export interface SfinAccount { id: string; name: string; org: string; last4: string | null; balance: number; available: number | null; balanceDate: string; currency: string; txns: Array<{ id: string; date: string; amount: number; description: string; pending: boolean }> }
export interface Local { id: string; name: string; institution?: string | null; last4?: string | null; kind: string }
export interface NewTxn { date: string; kind: 'expense' | 'income'; amount: number; payee: string; status: 'cleared' | 'pending'; source: 'import'; external_id: string }

export const LIABILITY = ['credit_card', 'store_card', 'loan', 'auto_loan', 'student_loan', 'mortgage', 'bnpl', 'line_of_credit', 'medical', 'collection', 'other_liability']
export const isLiabilityKind = (k: string) => LIABILITY.includes(k)

const num = (v: unknown) => { const n = Number(String(v ?? '').replace(/[, $]/g, '')); return Number.isFinite(n) ? n : 0 }
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
export const unixToDate = (u: number) => new Date(u * 1000).toISOString().slice(0, 10)

/** A setup token is a base64 (sometimes URL-safe) string that decodes to the https URL to POST to once to claim the access URL. */
export function claimUrlFromToken(token: string): string {
  const t = String(token || '').trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!t) throw new Error('Paste the SimpleFIN setup token')
  let url = ''
  try { url = atob(t.padEnd(Math.ceil(t.length / 4) * 4, '=')) } catch { throw new Error('That is not a SimpleFIN setup token (it should be a long run of letters and numbers)') }
  let u: URL
  try { u = new URL(url) } catch { throw new Error('That token did not decode to a web address — copy the whole token from SimpleFIN') }
  if (u.protocol !== 'https:') throw new Error('The setup token must point to an https address')
  if (u.username || u.password) throw new Error('A setup token should not contain a password')
  return u.toString()
}
/** The claim step returns an access URL with the credentials inside: https://user:pass@host/simplefin. Split it so the secret goes in a header, not a log line. */
export function splitAccessUrl(accessUrl: string): { base: string; authorization: string } {
  const u = new URL(accessUrl.trim())
  if (u.protocol !== 'https:') throw new Error('Access URL must be https')
  const user = decodeURIComponent(u.username), pass = decodeURIComponent(u.password)
  if (!user || !pass) throw new Error('Access URL has no credentials')
  u.username = ''; u.password = ''
  return { base: u.toString().replace(/\/$/, ''), authorization: 'Basic ' + btoa(`${user}:${pass}`) }
}
export const redactUrl = (s: string) => s.replace(/\/\/[^/@\s]+:[^/@\s]+@/g, '//***:***@')

/** SimpleFIN recommends at most 45 days per request ("Requested date range exceeds recommended range of 45 days" otherwise, and may cap it).
 *  Return windows of at most 44 days, oldest first, covering from a few days before the last sync — or `firstDays` back on the first sync — up to now. */
export const MAX_WINDOW_DAYS = 44
export function syncWindows(lastSyncUnix: number | null, nowUnix: number, overlapDays = 5, firstDays = 88): Array<{ start: number; end: number }> {
  const end = Math.floor(nowUnix), earliest = end - firstDays * 86400
  let start = Math.floor(lastSyncUnix ? Math.max(earliest, lastSyncUnix - overlapDays * 86400) : earliest)
  if (start >= end) start = end - 86400
  const out: Array<{ start: number; end: number }> = []
  while (start < end) { const e = Math.min(end, start + MAX_WINDOW_DAYS * 86400); out.push({ start, end: e }); start = e }
  return out
}
/** Combine the replies for several windows: one entry per account, the newest balance, every transaction once, each bank note once. */
export function mergeResponses(resps: SfinResponse[]): SfinResponse {
  const acc = new Map<string, SfinAccountRaw>(); const errors: string[] = []
  for (const r of resps) {
    for (const e of r.errors || []) if (!errors.includes(e)) errors.push(e)
    for (const a of r.accounts || []) {
      const prev = acc.get(a.id); const txns = new Map<string, SfinTxn>()
      for (const t of [...(prev?.transactions || []), ...(a.transactions || [])]) txns.set(String(t.id), t)
      acc.set(a.id, { ...(prev || {}), ...a, transactions: [...txns.values()] })
    }
  }
  return { errors, accounts: [...acc.values()] }
}

/** "…1234", "x1234", "ending in 1234", "(1234)", "*1234" or a trailing 4 digits. Never returns more than 4 digits. */
export function guessLast4(name: string): string | null {
  const s = String(name || '')
  const m = s.match(/(?:x{1,}|\*{1,}|…|\.{2,}|#|ending in\s*|\()\s*(\d{4})\b/i) || s.match(/\b(\d{4})\s*\)?\s*$/)
  return m ? m[1] : null
}

export function normaliseResponse(resp: SfinResponse): { accounts: SfinAccount[]; errors: string[] } {
  const accounts = (resp.accounts || []).map(a => ({
    id: String(a.id), name: String(a.name || 'Account'), org: String(a.org?.name || a.org?.domain || ''), last4: guessLast4(a.name),
    balance: r2(num(a.balance)), available: a['available-balance'] != null && a['available-balance'] !== '' ? r2(num(a['available-balance'])) : null,
    balanceDate: unixToDate(a['balance-date'] || Math.floor(Date.now() / 1000)), currency: String(a.currency || 'USD'),
    txns: (a.transactions || []).map(t => ({ id: String(t.id), date: unixToDate(t.posted), amount: r2(num(t.amount)), description: String(t.description || '').replace(/\s+/g, ' ').trim(), pending: !!t.pending })),
  }))
  return { accounts, errors: (resp.errors || []).map(e => redactUrl(String(e))) }
}

const words = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 2 && !['the', 'bank', 'account', 'and', 'inc', 'corp', 'national', 'association'].includes(w))
const overlap = (a: string, b: string) => { const x = new Set(words(a)); const y = words(b); return y.length ? y.filter(w => x.has(w)).length / Math.min(x.size || 1, y.length) : 0 }
/** Best local account for a bank account: same last 4 at a similar institution, else same last 4 alone when unique, else strongly similar name + institution. Each local account is used once. */
export function autoMatch(sf: SfinAccount[], locals: Local[]): Record<string, string> {
  const used = new Set<string>(), out: Record<string, string> = {}
  const score = (s: SfinAccount, l: Local) => {
    let p = 0
    if (s.last4 && l.last4 && s.last4 === l.last4) p += 3
    const inst = overlap(`${l.institution || ''} ${l.name}`, `${s.org} ${s.name}`); p += inst * 2
    if (overlap(l.name, s.name) >= 0.5) p += 1
    return p
  }
  const pairs = sf.flatMap(s => locals.map(l => ({ s, l, p: score(s, l) }))).filter(x => x.p >= 3).sort((a, b) => b.p - a.p)
  for (const { s, l } of pairs) { if (out[s.id] || used.has(l.id)) continue; out[s.id] = l.id; used.add(l.id) }
  return out
}

/** A reasonable WealthPilot account type for a bank account that has no match yet, from its name — the owner can change it afterwards. */
export function guessKind(name: string, balance = 0): string {
  const n = String(name || '').toLowerCase()
  if (/mortgage/.test(n)) return 'mortgage'
  if (/auto|car loan|vehicle/.test(n) && /loan|financ/.test(n)) return 'auto_loan'
  if (/student/.test(n)) return 'student_loan'
  if (/line of credit|heloc/.test(n)) return 'line_of_credit'
  if (/\bloan\b/.test(n)) return 'loan'
  if (/credit|card|visa|mastercard|amex|discover|freedom|sapphire|platinum|rewards|cash\+?/.test(n) && !/saving|checking/.test(n)) return 'credit_card'
  if (/401|403|ira\b|roth|retire|pension/.test(n)) return 'retirement'
  if (/brokerage|invest|trading|stock|etf/.test(n)) return 'investment'
  if (/sav|money market|\bmm\b|high.?yield|\bcd\b/.test(n)) return 'savings'
  if (/check|chk|spending|everyday|debit|total/.test(n)) return 'checking'
  return balance < 0 ? 'credit_card' : 'checking'
}

/** What WealthPilot stores as the balance: assets as reported; liabilities as the positive amount owed (SimpleFIN reports debt as a negative balance; a positive card balance is a credit, owed 0). */
export function balanceFor(sf: Pick<SfinAccount, 'balance'>, kind: string): number {
  return isLiabilityKind(kind) ? r2(Math.max(0, -sf.balance)) : sf.balance
}

/** Posted items only (pending ones change id when they post, which would create duplicates). Money in is income, money out is expense — on a card a payment shows as income, the same convention as statement import. */
export function toNewTxns(sf: SfinAccount, _local: Pick<Local, 'id' | 'kind'>, cleanPayee: (s: string) => string = s => s): NewTxn[] {
  return sf.txns.filter(t => !t.pending && t.amount !== 0).map(t => ({
    date: t.date, kind: t.amount < 0 ? 'expense' as const : 'income' as const, amount: Math.abs(t.amount), payee: cleanPayee(t.description).slice(0, 120),
    status: 'cleared' as const, source: 'import' as const, external_id: `sfin:${sf.id}:${t.id}`,
  }))
}

export interface Existing { account_id: string | null; date: string; kind: string; amount: number; external_id?: string | null }
/** Drop what is already there: the same external id, or — for items first entered by hand or from a statement file — the same account, day, direction and amount (each existing row cancels at most one new one). */
export function dropKnown<T extends { date: string; kind: string; amount: number; external_id: string }>(incoming: T[], accountId: string, existing: Existing[]): { fresh: T[]; skipped: number } {
  const ids = new Set(existing.map(e => e.external_id).filter(Boolean) as string[])
  const pool = new Map<string, number>()
  for (const e of existing) if (e.account_id === accountId && !e.external_id) { const k = `${e.date}|${e.kind}|${Math.round(e.amount * 100)}`; pool.set(k, (pool.get(k) || 0) + 1) }
  const fresh: T[] = []; let skipped = 0
  for (const t of incoming) {
    if (ids.has(t.external_id)) { skipped++; continue }
    const k = `${t.date}|${t.kind}|${Math.round(t.amount * 100)}`; const n = pool.get(k) || 0
    if (n > 0) { pool.set(k, n - 1); skipped++; continue }
    fresh.push(t)
  }
  return { fresh, skipped }
}
