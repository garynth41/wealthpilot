// Gmail (Google Identity Services token) and Outlook / Microsoft Graph (PKCE popup) — read-only mail search for money emails.
import type { Settings } from '../../app/data/types'
import { addDays, iso, parse } from '../dates'
import { extract, type Fact, type Skip } from './extract'
import { htmlToText, type Msg } from './text'
import type { Evidence } from './propose'

export const FLOOR = '2025-01-01'
export const sinceDate = (s: Settings) => { const d = (s.finmail?.since || addDays(iso(new Date()), -60)).slice(0, 10); return d < FLOOR ? FLOOR : d }
declare global { interface Window { google?: { accounts: { oauth2: { initTokenClient: (o: Record<string, unknown>) => { requestAccessToken: (o: { prompt: string }) => void } } } } } }

/* ---------------- Gmail ---------------- */
const GM_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const GM = { token: null as string | null, exp: 0 }
const GM_EXCL = '-category:promotions -category:social -from:creditkarma.com -from:substack.com -from:beehiiv.com -from:medium.com -from:linkedin.com -in:sent'
export const GM_QUERIES = [
  '(statement OR "your bill" OR "bill is ready" OR "new bill" OR "new invoice" OR "amount due" OR "balance due" OR "minimum payment" OR "payment due" OR "payment is due" OR "due date")',
  '("payment received" OR "payment processed" OR "payment confirmation" OR "thank you for your payment" OR "thanks for your payment" OR "we received your payment" OR "payment posted" OR "payment was successful" OR "payment successful" OR "recurring payment" OR "scheduled payment")',
  '(autopay OR "auto pay" OR "automatic payment" OR "upcoming payment" OR "payment reminder" OR "will be charged" OR "will be processed")',
  '("direct deposit" OR "deposit posted" OR "was credited" OR "has been deposited" OR "sent you" OR "you received" OR "refund issued" OR "refund processed" OR "benefit payment" OR "payment issued" OR "pay stub" OR paystub)',
  '("past due" OR "missed payment" OR overdue OR "payment declined" OR "payment failed" OR "insufficient funds" OR overdraft OR "returned payment" OR "transaction was declined" OR "low balance")',
  '(subject:receipt OR subject:"order receipt" OR subject:renewed OR subject:"payment confirmation" OR "your receipt from")',
]
function loadGIS() { return new Promise<void>((res, rej) => { if (window.google?.accounts?.oauth2) return res(); const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = () => res(); s.onerror = () => rej(new Error('Could not load Google sign-in (connection or ad blocker)')); document.head.appendChild(s) }) }
export async function gmToken(clientId: string, hint?: string) {
  if (GM.token && Date.now() < GM.exp - 60000) return GM.token
  if (!clientId) throw new Error('Gmail is not set up yet — add the OAuth client ID in Settings → General → Email capture')
  await loadGIS()
  return new Promise<string>((res, rej) => { const c = window.google!.accounts.oauth2.initTokenClient({ client_id: clientId, scope: GM_SCOPE, hint: hint || undefined, callback: (r: { error?: string; error_description?: string; access_token?: string; expires_in?: number }) => { if (!r || r.error || !r.access_token) return rej(new Error((r && (r.error_description || r.error)) || 'Google sign-in failed')); GM.token = r.access_token; GM.exp = Date.now() + (+(r.expires_in || 3600)) * 1000; res(GM.token) }, error_callback: (e: { type?: string; message?: string }) => rej(new Error(e?.type === 'popup_closed' ? 'Google sign-in window was closed' : e?.message || e?.type || 'Google sign-in failed')) }); c.requestAccessToken({ prompt: '' }) })
}
export async function gmApi(clientId: string, path: string, params?: Record<string, string>, hint?: string) {
  const tok = await gmToken(clientId, hint); const qs = params ? '?' + new URLSearchParams(params).toString() : ''
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + path + qs, { headers: { Authorization: 'Bearer ' + tok } })
  if (r.status === 401) { GM.token = null; throw new Error('Google sign-in expired — click Sync again') }
  if (!r.ok) { let m = ''; try { m = (await r.json()).error.message } catch { /* */ } throw new Error('Gmail API ' + r.status + (m ? ': ' + m : '')) }
  return r.json()
}
const b64 = (s: string) => { try { const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder('utf-8').decode(Uint8Array.from(bin, c => c.charCodeAt(0))) } catch { return '' } }
interface GPart { mimeType?: string; filename?: string; body?: { data?: string; attachmentId?: string; size?: number }; parts?: GPart[] }
interface GMessage { id: string; threadId?: string; internalDate?: string; labelIds?: string[]; payload?: GPart & { headers?: Array<{ name: string; value: string }> } }
function walk(p: GPart | undefined, acc: { text: string; html: string }) { if (!p) return acc; if (!p.filename && p.body?.data) { if (p.mimeType === 'text/plain') acc.text += b64(p.body.data) + '\n'; else if (p.mimeType === 'text/html') acc.html += b64(p.body.data) } (p.parts || []).forEach(x => walk(x, acc)); return acc }
const parseAddr = (v: string) => { const m = String(v || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/); return m ? { name: m[1].trim(), email: m[2].trim().toLowerCase() } : { name: '', email: String(v || '').trim().toLowerCase() } }
export function gmMsg(m: GMessage, me: string, account: string): Msg {
  const h = (n: string) => (m.payload?.headers || []).find(y => y.name.toLowerCase() === n)?.value || ''
  const acc = walk(m.payload, { text: '', html: '' }); const full = acc.text || htmlToText(acc.html); const from = parseAddr(h('from'))
  const sent = (m.labelIds || []).includes('SENT') || from.email === me
  return { id: m.id, threadId: m.threadId, date: new Date(+(m.internalDate || 0) || Date.parse(h('date'))), from, to: h('to'), subject: h('subject'), body: full.slice(0, 12000), html: acc.html.slice(0, 60000), sent, url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/${m.threadId || m.id}` }
}
const gmDate = (d: string) => { const x = parse(addDays(d, -1)); return `${x.getFullYear()}/${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}` }
export type FactEv = (Fact | Skip) & { ev: Evidence[] }
/** Search Gmail for money mail since `since`, read each thread, return facts (one per message). `seen` = message ids already reviewed. */
export async function gmRun(s: Settings, seen: Set<string>, progress?: (t: string) => void, stats?: MailStats): Promise<FactEv[]> {
  const clientId = s.gmail?.clientId || ''; const account = s.gmail?.account || ''; const since = sinceDate(s)
  const me = (await gmApi(clientId, 'profile', undefined, account)).emailAddress?.toLowerCase() || account
  const ids = new Set<string>()
  for (let i = 0; i < GM_QUERIES.length; i++) { progress?.(`Looking for bills, payments and deposits (${i + 1}/${GM_QUERIES.length})…`); let page: string | undefined, n = 0
    do { const r = await gmApi(clientId, 'threads', { q: `after:${gmDate(since)} ${GM_QUERIES[i]} ${GM_EXCL}`, maxResults: '100', ...(page ? { pageToken: page } : {}) }, account); (r.threads || []).forEach((t: { id: string }) => ids.add(t.id)); page = r.nextPageToken; n++ } while (page && n < 3) }
  const list = [...ids].slice(0, 500); const facts: FactEv[] = []; let done = 0; if (stats) { stats.scanned += ids.size; stats.matched += list.length }
  const worker = async () => { while (list.length) { const id = list.shift()!; try { const th = await gmApi(clientId, 'threads/' + id, { format: 'full' }, account); for (const raw of (th.messages || []) as GMessage[]) { const m = gmMsg(raw, me, account); if (m.sent || seen.has(m.id) || iso(m.date) < since) continue; const f = extract(m); if (!f) continue; facts.push({ ...f, ev: [{ msg_id: m.id, thread_id: th.id, src: 'gmail', url: m.url, subject: m.subject || '', date: iso(m.date), pdf: gmPdfParts(raw.payload).length > 0 }] }) } } catch (e) { if (/expired|sign-in/i.test((e as Error).message)) throw e; console.warn('money thread', e) } done++; progress?.(`Reading money emails — ${done} of ${done + list.length}…`) } }
  await Promise.all([worker(), worker(), worker(), worker()])
  return facts
}

/* ---------------- Outlook / Microsoft Graph ---------------- */
const OL = { token: null as string | null, exp: 0 }
const OL_SCOPE = 'openid offline_access User.Read Mail.Read'
const OL_SEL = 'id,conversationId,subject,from,receivedDateTime,sentDateTime,body,webLink,parentFolderId,hasAttachments'
/** The same money vocabulary the Gmail searches use, applied locally to each Outlook message (Microsoft's $search is unreliable on personal Outlook.com mailboxes). */
export const MONEY_RE = new RegExp([
  'statement', 'your bill', 'bill is (?:ready|available)', 'new bill', 'invoice', 'amount due', 'balance due', 'minimum payment', 'payment (?:is )?due', 'due date',
  'payment (?:received|processed|confirmation|posted|was successful|successful|scheduled|reminder|issued|declined|failed)', 'thanks? (?:you )?for your payment', 'received your payment', 'recurring payment', 'scheduled payment',
  'auto ?pay', 'automatic payment', 'upcoming payment', 'will be (?:charged|processed|debited)',
  'direct deposit', 'deposit (?:posted|received)', 'was credited', 'has been deposited', 'sent you', 'you received', 'refund (?:issued|processed)', 'benefit payment', 'pay ?stub',
  'past due', 'missed payment', 'overdue', 'insufficient funds', 'overdraft', 'returned payment', 'transaction was declined', 'low balance',
  'receipt', 'renewed', 'order confirmation', 'subscription (?:renewal|confirmation)',
].map(t => '\\b' + t + '\\b').join('|'), 'i')
const NOT_MONEY_SENDER = /(?:^|[@.])(?:creditkarma\.com|substack\.com|beehiiv\.com|medium\.com|linkedin\.com)$/i
/** Does this look like a bill, payment, deposit or account alert? (subject, sender name and the start of the body) */
export function isMoneyMail(m: { subject?: string; fromName?: string; fromEmail?: string; text?: string }): boolean {
  if (m.fromEmail && NOT_MONEY_SENDER.test(m.fromEmail)) return false
  return MONEY_RE.test(`${m.subject || ''} \n ${m.fromName || ''} \n ${(m.text || '').slice(0, 6000)}`)
}
/** Build a Graph query string with %20 for spaces (some Microsoft endpoints read "+" literally). */
export const graphQs = (p: Record<string, string>) => Object.entries(p).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
export interface MailStats { scanned: number; matched: number }
const b64u = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const olBase = (tenant: string) => `https://login.microsoftonline.com/${encodeURIComponent(tenant || 'consumers')}/oauth2/v2.0/`
const redirect = () => location.origin + location.pathname
async function olTokenReq(s: Settings, params: Record<string, string>) {
  const r = await fetch(olBase(s.outlook?.tenant || 'consumers') + 'token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: s.outlook?.clientId || '', scope: OL_SCOPE, ...params }).toString() })
  const j = await r.json().catch(() => ({})); if (!r.ok || !j.access_token) throw new Error('Microsoft sign-in failed' + (j.error_description ? ': ' + String(j.error_description).split('\r\n')[0] : ''))
  OL.token = j.access_token; OL.exp = Date.now() + (+j.expires_in || 3600) * 1000; if (j.refresh_token) { try { sessionStorage.setItem('wealthpilot.olrt', j.refresh_token) } catch { /* */ } } return OL.token!
}
export async function olToken(s: Settings, interactive = true) {
  if (OL.token && Date.now() < OL.exp - 60000) return OL.token
  let rt: string | null = null; try { rt = sessionStorage.getItem('wealthpilot.olrt') } catch { /* */ }
  if (rt) { try { return await olTokenReq(s, { grant_type: 'refresh_token', refresh_token: rt }) } catch { try { sessionStorage.removeItem('wealthpilot.olrt') } catch { /* */ } } }
  if (!interactive) return null; if (!s.outlook?.clientId) throw new Error('Outlook is not set up yet — add the application (client) ID in Settings → General → Email capture')
  const verifier = b64u(crypto.getRandomValues(new Uint8Array(32))), challenge = b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))), state = 'pl-ol-' + b64u(crypto.getRandomValues(new Uint8Array(12)))
  const url = olBase(s.outlook.tenant || 'consumers') + 'authorize?' + new URLSearchParams({ client_id: s.outlook.clientId, response_type: 'code', redirect_uri: redirect(), response_mode: 'query', scope: OL_SCOPE, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account', login_hint: s.outlook.account || '' }).toString()
  const w = window.open(url, 'pl-outlook', 'width=520,height=680'); if (!w) throw new Error('Allow pop-ups for this site, then click Sync again')
  const code = await new Promise<string>((res, rej) => { const done = (fn: (v: never) => void, v: unknown) => { window.removeEventListener('message', on); clearInterval(poll); (fn as (v: unknown) => void)(v) }
    const on = (ev: MessageEvent) => { if (ev.origin !== location.origin || !ev.data || ev.data.type !== 'pl-ol') return; if (ev.data.state !== state) return done(rej as never, new Error('Sign-in response did not match — try again')); if (ev.data.error) return done(rej as never, new Error(ev.data.error)); done(res as never, ev.data.code) }
    window.addEventListener('message', on); const poll = setInterval(() => { if (w.closed) done(rej as never, new Error('Microsoft sign-in window was closed')) }, 700) })
  return olTokenReq(s, { grant_type: 'authorization_code', code, redirect_uri: redirect(), code_verifier: verifier })
}
/** The popup lands back on the app with ?code=…&state=pl-ol-…: hand it to the opener and close. Call once at boot. */
export function olPopupRelay() { try { const p = new URLSearchParams(location.search); const st = p.get('state') || ''; if (window.opener && st.startsWith('pl-ol-') && (p.get('code') || p.get('error'))) { window.opener.postMessage({ type: 'pl-ol', state: st, code: p.get('code'), error: p.get('error_description') || p.get('error') }, location.origin); window.close(); return true } } catch { /* */ } return false }
export async function olApi(s: Settings, pathOrUrl: string, params?: Record<string, string> | null, interactive = true) {
  const tok = await olToken(s, interactive); if (!tok) throw new Error('Outlook sign-in needed')
  const url = /^https:/.test(pathOrUrl) ? pathOrUrl : 'https://graph.microsoft.com/v1.0/' + pathOrUrl + (params ? '?' + graphQs(params) : '')
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tok, Prefer: 'outlook.body-content-type="html"' } })
  if (r.status === 401) { OL.token = null; throw new Error('Microsoft sign-in expired — click Sync again') }
  if (!r.ok) { let m = ''; try { m = (await r.json()).error.message } catch { /* */ } throw new Error('Outlook ' + r.status + (m ? ': ' + m : '')) } return r.json()
}
interface OMsg { id: string; hasAttachments?: boolean; conversationId?: string; subject?: string; from?: { emailAddress?: { name?: string; address?: string } }; receivedDateTime?: string; sentDateTime?: string; body?: { contentType?: string; content?: string }; webLink?: string; parentFolderId?: string }
/** List every message received since `since` (newest first, up to 2,000), skip sent / deleted / junk / drafts, keep the ones that read like money mail, extract facts. */
export async function olRun(s: Settings, seen: Set<string>, progress?: (t: string) => void, stats?: MailStats): Promise<FactEv[]> {
  const since = sinceDate(s); const meJ = await olApi(s, 'me', { $select: 'mail,userPrincipalName' }); const me = String(meJ.mail || meJ.userPrincipalName || '').toLowerCase()
  const skipFolders = new Set<string>()
  for (const f of ['sentitems', 'deleteditems', 'junkemail', 'drafts', 'outbox']) { try { const id = (await olApi(s, 'me/mailFolders/' + f, { $select: 'id' })).id; if (id) skipFolders.add(id) } catch { /* folder may not exist */ } }
  const facts: FactEv[] = []; const st: MailStats = stats || { scanned: 0, matched: 0 }; const done = new Set<string>()
  const take = (list: OMsg[]) => { for (const m of list || []) {
    if (done.has(m.id)) continue; done.add(m.id); st.scanned++
    const when = (m.receivedDateTime || m.sentDateTime || '').slice(0, 10); if (!when || when < since || seen.has(m.id) || (m.parentFolderId && skipFolders.has(m.parentFolderId))) continue
    const fromAddr = (m.from?.emailAddress?.address || '').toLowerCase(); if (fromAddr && fromAddr === me) continue
    const html = m.body?.contentType === 'html' ? m.body?.content || '' : ''; const text = m.body?.contentType === 'text' ? m.body?.content || '' : htmlToText(html)
    if (!isMoneyMail({ subject: m.subject, fromName: m.from?.emailAddress?.name, fromEmail: fromAddr, text })) continue
    st.matched++
    const msg: Msg = { id: m.id, threadId: m.conversationId, date: new Date(m.receivedDateTime || m.sentDateTime || Date.now()), from: { name: m.from?.emailAddress?.name || '', email: fromAddr }, subject: m.subject || '', body: text.slice(0, 12000), html: html ? html.slice(0, 60000) : undefined, sent: false, url: m.webLink }
    const f = extract(msg); if (!f) continue; facts.push({ ...f, ev: [{ msg_id: m.id, thread_id: 'ol:' + (m.conversationId || m.id), src: 'outlook', url: m.webLink || '', subject: m.subject || '', date: when, pdf: !!m.hasAttachments }] } as FactEv) } }
  progress?.('Reading Outlook messages…')
  let j = await olApi(s, 'me/messages', { $filter: `receivedDateTime ge ${since}T00:00:00Z`, $orderby: 'receivedDateTime desc', $select: OL_SEL, $top: '50' }); take(j.value); let pages = 1
  while (j['@odata.nextLink'] && pages < 40) { progress?.(`Reading Outlook — ${st.scanned} messages checked, ${st.matched} look like bills or payments…`); j = await olApi(s, j['@odata.nextLink'], null); take(j.value); pages++ }
  return facts
}
/* ---------------- PDF attachments (0.21.0) ---------------- */
// Statement and receipt PDFs are fetched only when an applied item asks for them (and the household turned the option on), straight
// from the mailbox to private storage. The email body is never stored; the file name has long digit runs masked.
export const PDF_MAX = 15 * 1024 * 1024
export interface MailPdf { name: string; bytes: Uint8Array }
/** A stored file name keeps at most the last four digits of any long number (account numbers), but leaves dates like 2026-10-31 readable. */
export const maskFileName = (n: string) => String(n || '').replace(/\d[\d -]{4,}\d/g, m => /^\d{4}-\d{2}-\d{2}$/.test(m) ? m : '••' + m.replace(/\D/g, '').slice(-4))
const isPdf = (mime?: string, name?: string) => mime === 'application/pdf' || /\.pdf$/i.test(name || '')
function gmPdfParts(p: GPart | undefined, acc: GPart[] = []): GPart[] { if (!p) return acc; if (p.filename && p.body?.attachmentId && isPdf(p.mimeType, p.filename) && (p.body.size || 0) <= PDF_MAX) acc.push(p); (p.parts || []).forEach(x => gmPdfParts(x, acc)); return acc }
const fromB64 = (s: string) => { const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(bin, c => c.charCodeAt(0)) }
/** The PDF attachments of one message (at most `max`, each up to 15 MB). */
export async function fetchPdfs(s: Settings, ev: Pick<Evidence, 'msg_id' | 'src'>, max = 2): Promise<MailPdf[]> {
  const out: MailPdf[] = []
  if (ev.src === 'gmail') {
    const clientId = s.gmail?.clientId || '', account = s.gmail?.account || ''
    const m = await gmApi(clientId, 'messages/' + ev.msg_id, { format: 'full' }, account) as GMessage
    for (const p of gmPdfParts(m.payload).slice(0, max)) { const a = await gmApi(clientId, `messages/${ev.msg_id}/attachments/${p.body!.attachmentId}`, undefined, account); if (a?.data) out.push({ name: p.filename || 'statement.pdf', bytes: fromB64(a.data) }) }
  } else if (ev.src === 'outlook') {
    const list = await olApi(s, `me/messages/${ev.msg_id}/attachments`, { $select: 'id,name,contentType,size' })
    for (const a of ((list.value || []) as Array<{ id: string; name?: string; contentType?: string; size?: number }>).filter(a => isPdf(a.contentType, a.name) && (a.size || 0) <= PDF_MAX).slice(0, max)) { const f = await olApi(s, `me/messages/${ev.msg_id}/attachments/${a.id}`); if (f?.contentBytes) out.push({ name: a.name || 'statement.pdf', bytes: fromB64(f.contentBytes) }) }
  }
  return out
}
export const mailLink = (e: { src?: string; url?: string; thread_id?: string }) => e.url || (e.src === 'outlook' ? 'https://outlook.live.com/mail/' : `https://mail.google.com/mail/#all/${e.thread_id || ''}`)
