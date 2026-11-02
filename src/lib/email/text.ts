// Text, money and date extraction from email bodies. Ported from CareerShift's money capture (v1.24) and interview date parser.
import { addDays, diffDays, iso, parse } from '../dates'

export interface Msg { id: string; threadId?: string; date: Date; from: { name: string; email: string }; to?: string; subject: string; body: string; html?: string; sent: boolean; url?: string }

export function htmlToText(h: string) {
  try {
    const d = new DOMParser().parseFromString(String(h).replace(/<\/t[dh]>/gi, ' $&').replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)[^>]*>/gi, '$&\n'), 'text/html')
    d.querySelectorAll('style,script,head').forEach(x => x.remove())
    return (d.body ? d.body.textContent || '' : '').replace(/[ \t ​͏‌]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n')
  } catch { return '' }
}
const ZW = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁤　ㅤ﻿ﾠ]/g
export function cleanText(m: Msg) {
  let b = String(m.body || ''); if (/<(?:!doctype|html|table|div|td)\b/i.test(b.slice(0, 3000))) b = htmlToText(b)
  if (b.length < 40 && m.html) b = htmlToText(m.html)
  const clean = (s: string) => String(s || '').replace(ZW, '').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\[\]\([^)]*\)?/g, ' ').replace(/<?https?:\/\/[^\s>)\]]+>?/g, ' ').replace(/\(\s*\)/g, ' ').replace(/[|*#_~=]+/g, ' ').replace(/-{3,}/g, ' ').replace(/[ \t\r\n ]+/g, ' ').trim()
  return { subject: clean(m.subject), body: clean(b).slice(0, 9000) }
}
export interface Money { v: number; i: number; j: number; raw: string; label?: string }
const MONEY = /(-\s?)?(?:US\$|USD\s?\$?|\$)\s?(-\s?)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?!\d)|\b(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})\s?USD\b/gi
export function moneyIn(t: string): Money[] { const out: Money[] = []; let m: RegExpExecArray | null; MONEY.lastIndex = 0
  while ((m = MONEY.exec(t))) { const whole = m[3] || m[5], cents = m[3] != null ? m[4] : m[6]; const v = +(String(whole).replace(/,/g, '') + '.' + (cents || '0').padEnd(2, '0')); if (!isFinite(v) || v > 10000000) continue; out.push({ v: m[1] || m[2] ? -v : v, i: m.index, j: m.index + m[0].length, raw: m[0] }) }
  return out }
/** First amount within `gap` chars after a label match ("Minimum Payment Due $36.64"). */
export function moneyAfter(t: string, re: RegExp, gap = 40, list?: Money[]): Money | null { list = list || moneyIn(t); const g = re.global ? re : new RegExp(re.source, re.flags + 'g'); g.lastIndex = 0; let m: RegExpExecArray | null
  while ((m = g.exec(t))) { const end = m.index + m[0].length; const x = list.find(a => a.i >= end && a.i - end <= gap && !/[.!?]\s/.test(t.slice(end, a.i))); if (x) return { ...x, label: m[0] }; if (m[0] === '') g.lastIndex++ }
  return null }

const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?'
const DOW = '(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|rsday|urday)?\\.?'
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
export interface DateHit { i: number; j: number; date: string; raw: string; strong: boolean }
/** Every explicit date written in the text ("Nov 5, 2026", "11/05/2026", "2026-11-05", "5 November"), year inferred near `ref` when missing. */
export function datesIn(text: string, ref: string): DateHit[] {
  const out: DateHit[] = []; const ry = parse(ref).getFullYear()
  const yr = (mo: number, d: number, y: number | null) => { if (y) return y < 100 ? 2000 + y : y; let best = ry, bd = Infinity; for (const Y of [ry - 1, ry, ry + 1]) { const df = diffDays(iso(new Date(Y, mo, d)), ref); if (df < -45) continue; if (Math.abs(df) < bd) { bd = Math.abs(df); best = Y } } return best }
  const push = (i: number, j: number, y: number, mo: number, d: number, raw: string, strong: boolean) => { if (mo < 0 || mo > 11 || d < 1 || d > 31) return; const dt = new Date(y, mo, d); if (dt.getMonth() !== mo) return; out.push({ i, j, date: iso(dt), raw, strong }) }
  let m: RegExpExecArray | null
  const re1 = new RegExp(`(?:\\b${DOW},?\\s*)?\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4}))?`, 'gi')
  while ((m = re1.exec(text))) { const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()); push(m.index, m.index + m[0].length, yr(mo, +m[2], m[3] ? +m[3] : null), mo, +m[2], m[0], true) }
  const re1b = new RegExp(`(?:\\b${DOW},?\\s*)?\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON}(?:,?\\s*(\\d{4}))?`, 'gi')
  while ((m = re1b.exec(text))) { const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()); if (out.some(o => o.i <= m!.index && o.j >= m!.index + 2)) continue; push(m.index, m.index + m[0].length, yr(mo, +m[1], m[3] ? +m[3] : null), mo, +m[1], m[0], true) }
  const re2 = new RegExp(`(?:\\b(${DOW}),?\\s*)?\\(?\\b(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?\\b\\)?(?:,?\\s*(${DOW}))?`, 'gi')
  while ((m = re2.exec(text))) { const pre = text.slice(Math.max(0, m.index - 12), m.index), post = text.slice(m.index + m[0].length, m.index + m[0].length + 8); if (/[\d$]\s*$|\bid\b|#\s*$|\bno\.?\s*$/i.test(pre) || /^\s*(?:-\s*)?(?:hours?|hrs?|mins?|minutes?|days?|weeks?|months?|years?)\b/i.test(post)) continue; const mo = +m[2] - 1, d = +m[3], y = m[4] ? +m[4] : null; push(m.index, m.index + m[0].length, yr(mo, d, y), mo, d, m[0], !!(m[1] || m[5] || y)) }
  const re3 = /\b(20\d{2})-(\d{2})-(\d{2})\b/g; while ((m = re3.exec(text))) push(m.index, m.index + m[0].length, +m[1], +m[2] - 1, +m[3], m[0], true)
  const re4 = /\b(today|tomorrow)\b/gi; while ((m = re4.exec(text))) out.push({ i: m.index, j: m.index + m[0].length, date: m[1].toLowerCase() === 'tomorrow' ? addDays(ref, 1) : ref, raw: m[0], strong: false })
  return out.sort((a, b) => a.i - b.i)
}
export function dateAfter(t: string, re: RegExp, ref: string, gap = 30, list?: DateHit[]): string | null { list = list || datesIn(t, ref); const g = re.global ? re : new RegExp(re.source, re.flags + 'g'); g.lastIndex = 0; let m: RegExpExecArray | null
  while ((m = g.exec(t))) { const end = m.index + m[0].length; const x = list.find(d => d.i >= end && d.i - end <= gap); if (x) return x.date; if (m[0] === '') g.lastIndex++ }
  return null }
export const titleCase = (s: string) => s.replace(/\s+/g, ' ').trim().split(' ').map(w => w.length <= 3 && /^[A-Z&]+$/.test(w) ? w : w[0] ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ')
export function orgFromDomain(email: string) { const d = (String(email).split('@')[1] || '').toLowerCase().replace(/^(mail|email|e|notifications?|alerts?|billing|no-?reply|info|service|support)\./, ''); const base = d.split('.').slice(-2, -1)[0] || d; return base ? base.charAt(0).toUpperCase() + base.slice(1) : '' }
