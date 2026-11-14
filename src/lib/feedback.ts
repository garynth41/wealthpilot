// Feedback from testers (0.29.0). The Feedback button (components/Feedback.tsx) sends through the database's submit_feedback() — the one
// way in, which checks every field and limits sending (migration 0021). What goes with a note, only while "Include the page and device" is
// ticked: the page, the app version, the platform, a short device name, the screen size and the look. Never a balance, a payee or a name.
// The operator reads it all in Feedback & testers (pages/FeedbackInbox.tsx). Plain functions here, so they are tested without a browser.

export type FeedbackKind = 'bug' | 'confusing' | 'idea' | 'praise' | 'other'
export type FeedbackStatus = 'new' | 'seen' | 'planned' | 'fixed' | 'wontfix' | 'duplicate'
export const KINDS: Array<[FeedbackKind, string, string]> = [
  ['bug', 'Something broke', 'What did you do, what did you expect, and what happened instead?'],
  ['confusing', 'Confusing', 'Which screen or word was unclear, and what did you think it meant?'],
  ['idea', 'Idea', 'What would you like Cresari to do, and what would it help you with?'],
  ['praise', 'I like this', 'What worked well for you?'],
  ['other', 'Other', 'Anything else on your mind.'],
]
export const kindLabel = (k: string) => KINDS.find(x => x[0] === k)?.[1] || k
export const STATUSES: Array<[FeedbackStatus, string]> = [['new', 'New'], ['seen', 'Seen'], ['planned', 'Planned'], ['fixed', 'Fixed'], ['wontfix', 'Won’t do'], ['duplicate', 'Duplicate']]
export const statusLabel = (s: string) => STATUSES.find(x => x[0] === s)?.[1] || s
/** What a tester sees about their own note: plain words, not the operator's shorthand. */
export const statusForTester = (s: string) => ({ new: 'Received', seen: 'Read', planned: 'Planned', fixed: 'Fixed', wontfix: 'Not planned', duplicate: 'Already reported' } as Record<string, string>)[s] || s

export interface Feedback {
  id: string; created_at: string; kind: FeedbackKind; rating: number | null; message: string; page: string | null; app_version: string | null
  platform: string | null; device: string | null; screen: string | null; look: string | null; demo: boolean; user_id: string | null; email: string | null
  tester: string | null; status: FeedbackStatus; admin_note: string | null; issue_url: string | null
}
export interface FeedbackContext { page: string; app_version: string; platform: string; device: string; screen: string; look: string; demo: boolean }

/** A short, human device name from the browser's user agent: "iPhone · Safari", "Android · Chrome", "Windows · Edge". No version numbers. */
export function deviceName(ua: string): string {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua)) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'Unknown device'
  const br = /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser\//.test(ua) ? 'Samsung Internet' : /(OPR|Opera)\//.test(ua) ? 'Opera' : /FxiOS|Firefox\//.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ''
  return br ? `${os} · ${br}` : os
}
/** Where the app is running: the iPhone or Android app, installed to the home screen or desktop ("installed"), or a browser tab ("web"). */
export function platformName(native: 'ios' | 'android' | 'web', standalone: boolean): string { return native !== 'web' ? native : standalone ? 'installed' : 'web' }

/** Check a note before sending — the database checks the same again. Returns what is wrong, or null. */
export function feedbackProblem(kind: string, message: string, rating: number | null, email: string): string | null {
  if (!KINDS.some(k => k[0] === kind)) return 'Pick what kind of feedback this is'
  const m = message.trim(); if (m.length < 3) return 'Write a few words first'
  if (m.length > 4000) return 'Keep it under 4,000 characters — send the rest as a second note'
  if (rating != null && (rating < 1 || rating > 5)) return 'A rating is 1 to 5 stars'
  const e = email.trim(); if (e && (e.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) return 'That email address does not look right'
  return null
}

/** The arguments submit_feedback() takes. Without `ctx` (the tester unticked "Include the page and device") only what they typed goes. */
export function feedbackArgs(kind: FeedbackKind, message: string, rating: number | null, email: string, tester: string | null, ctx: FeedbackContext | null) {
  return { p_kind: kind, p_message: message.trim(), p_rating: rating, p_email: email.trim() || null, p_tester: tester,
    p_page: ctx?.page ?? null, p_app_version: ctx?.app_version ?? null, p_platform: ctx?.platform ?? null, p_device: ctx?.device ?? null,
    p_screen: ctx?.screen ?? null, p_look: ctx?.look ?? null, p_demo: ctx?.demo ?? false }
}
/** One line saying what goes with the note, shown under the tick box so nothing is sent unseen. */
export const contextLine = (c: FeedbackContext, pageTitle: string) => [pageTitle || c.page, 'v' + c.app_version, c.device, c.screen, c.look, c.demo ? 'offline demo' : ''].filter(Boolean).join(' · ')

/** A GitHub issue from a piece of feedback, as a link to GitHub's new-issue form (the operator edits it before saving). The repository is
 *  public, so the reply address and invite code are left out, and the body says so. */
export function issueLink(repo: string, f: Pick<Feedback, 'kind' | 'message' | 'page' | 'app_version' | 'platform' | 'device' | 'screen' | 'look' | 'demo' | 'rating' | 'created_at'>): string {
  const first = f.message.split('\n')[0].trim(); const title = `${kindLabel(f.kind)}: ${first.length > 70 ? first.slice(0, 67) + '…' : first}`
  const body = [`> ${f.message.trim().replace(/\n/g, '\n> ')}`, '', `- From tester feedback, ${f.created_at.slice(0, 10)}${f.rating ? ` · rated ${f.rating}/5` : ''}`,
    `- Page: ${f.page || '—'} · version ${f.app_version || '—'} · ${[f.platform, f.device, f.screen, f.look].filter(Boolean).join(' · ') || 'no device details'}${f.demo ? ' · offline demo' : ''}`,
    '', '_This repository is public — check the quote above holds nothing personal before saving._'].join('\n')
  const labels = f.kind === 'bug' ? 'bug' : f.kind === 'idea' ? 'enhancement' : ''
  return `https://github.com/${repo}/issues/new?` + new URLSearchParams({ title, body, ...(labels ? { labels } : {}) }).toString()
}
/** A reply by email to a tester who left an address. */
export function replyLink(f: Pick<Feedback, 'email' | 'kind' | 'message' | 'created_at'>): string | null {
  if (!f.email) return null
  const first = f.message.split('\n')[0].trim().slice(0, 60)
  return `mailto:${encodeURIComponent(f.email)}?` + new URLSearchParams({ subject: `Re: your Cresari feedback — ${kindLabel(f.kind).toLowerCase()}`, body: `Hi,\n\nThank you for your note on ${f.created_at.slice(0, 10)}:\n> ${first}${f.message.length > 60 ? '…' : ''}\n\n` }).toString().replace(/\+/g, '%20')
}

/** The inbox as a CSV file (spreadsheet-safe: a cell starting with = + - @ is prefixed so it is never run as a formula). */
export function feedbackCsv(rows: Feedback[]): string {
  const cols: Array<[string, (f: Feedback) => unknown]> = [['Date', f => f.created_at.slice(0, 16).replace('T', ' ')], ['Kind', f => kindLabel(f.kind)], ['Rating', f => f.rating ?? ''],
    ['Message', f => f.message], ['Status', f => statusLabel(f.status)], ['Note', f => f.admin_note || ''], ['Page', f => f.page || ''], ['Version', f => f.app_version || ''],
    ['Platform', f => f.platform || ''], ['Device', f => f.device || ''], ['Screen', f => f.screen || ''], ['Look', f => f.look || ''], ['Demo', f => (f.demo ? 'yes' : '')],
    ['Invite code', f => f.tester || ''], ['Reply to', f => f.email || ''], ['Issue', f => f.issue_url || '']]
  const cell = (v: unknown) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return [cols.map(c => c[0]).join(','), ...rows.map(r => cols.map(c => cell(c[1](r))).join(','))].join('\r\n')
}

/** Numbers across the top of the inbox. */
export function feedbackSummary(rows: Pick<Feedback, 'status' | 'rating' | 'created_at' | 'kind'>[], now = new Date()) {
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString()
  const rated = rows.filter(r => r.rating != null)
  return { total: rows.length, open: rows.filter(r => r.status === 'new').length, week: rows.filter(r => r.created_at >= weekAgo).length,
    bugs: rows.filter(r => r.kind === 'bug' && !['fixed', 'wontfix', 'duplicate'].includes(r.status)).length,
    rating: rated.length ? Math.round(rated.reduce((n, r) => n + (r.rating || 0), 0) / rated.length * 10) / 10 : null, rated: rated.length }
}

/** When a note came in, in the reader's own time zone ("Nov 13, 2026, 4:29 PM"); the database keeps UTC. */
export const whenSent = (iso: string, withTime = true) => { const d = new Date(iso); if (isNaN(+d)) return iso.slice(0, 10)
  return d.toLocaleString('en-US', withTime ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric' }) }
