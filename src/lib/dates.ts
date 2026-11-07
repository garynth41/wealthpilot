// Date helpers. Every date in the app is an ISO 'YYYY-MM-DD' string in local time; months are 'YYYY-MM'.
import { resolvedLocale } from './display'
export const DAY = 86400000
export const pad = (n: number) => String(n).padStart(2, '0')
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parse = (s: string | Date | null | undefined): Date => {
  if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate())
  if (!s) return new Date(NaN)
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}
let _today: string | null = null
/** Freeze "today" (tests, demo). Pass null to unfreeze. */
export const setToday = (s: string | null) => { _today = s }
export const today = (): string => _today ?? iso(new Date())
export const T = today
export const addDays = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d) }
export const diffDays = (a: string, b: string) => Math.round((parse(a).getTime() - parse(b).getTime()) / DAY)
export const monthKey = (s: string) => String(s).slice(0, 7)
export const curMonth = () => today().slice(0, 7)
export const mAdd = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }
export const monthStart = (m: string) => m + '-01'
export const monthEnd = (m: string) => { const [y, mo] = m.split('-').map(Number); return iso(new Date(y, mo, 0)) }
export const daysInMonth = (m: string) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate() }
/** Same day of month `k` months later, clamped to the month's last day (Jan 31 + 1 → Feb 28/29). */
export const addMonthsClamp = (d0: string, k: number, day?: number) => { const x = parse(d0); const y = x.getFullYear(), m = x.getMonth() + k; const last = new Date(y, m + 1, 0).getDate(); return iso(new Date(y, m, Math.min(day || x.getDate(), last))) }
export const weekStart = (s: string) => { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d) }   // Monday
export const weekEndingSat = (s: string) => { const d = parse(s); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7)); return iso(d) }
export const clamp = (d: string, from: string, to: string) => (d < from ? from : d > to ? to : d)
export const maxD = (a: string, b: string) => (a > b ? a : b)
export const minD = (a: string, b: string) => (a < b ? a : b)

export const fmtD = (s?: string | null) => (s ? parse(s).toLocaleDateString(resolvedLocale(), { month: 'short', day: 'numeric' }) : '—')
export const fmtDY = (s?: string | null) => (s ? parse(s).toLocaleDateString(resolvedLocale(), { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
export const fmtDow = (s: string) => parse(s).toLocaleDateString(resolvedLocale(), { weekday: 'short' })
export const mLabel = (m: string) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString(resolvedLocale(), { month: 'long', year: 'numeric' }) }
export const mShort = (m: string) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString(resolvedLocale(), { month: 'short', year: 'numeric' }) }
/** How long ago, in words. A date-only value ('2026-11-07') is a local calendar day — today, yesterday, 3d ago — counted like every other
 *  date in the app; reading it as UTC midnight made a balance dated today say "16h ago" and a value from 104 days ago say "105d ago" (0.25.1).
 *  A timestamp keeps minutes and hours. */
export const ago = (ts: string | number | Date) => {
  if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ts.trim())) { const d = diffDays(today(), ts.trim()); return d === 0 ? 'today' : d === 1 ? 'yesterday' : d < 0 ? `in ${-d}d` : d + 'd ago' }
  const s = (Date.now() - new Date(ts).getTime()) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago' }
/** Next date on or after today that falls on `day` of the month. */
export const nextMonthDay = (day: number, from = today()) => { const t = parse(from); let y = t.getFullYear(), m = t.getMonth(); if (day < t.getDate()) { m++; if (m > 11) { m = 0; y++ } } const last = new Date(y, m + 1, 0).getDate(); return iso(new Date(y, m, Math.min(day, last))) }
/** Every `day`-of-month date in [from, to]. */
export const monthDays = (day: number, from: string, to: string) => { const out: string[] = []; if (!day) return out; const a = parse(from); for (let m = 0; m < 40; m++) { const y = a.getFullYear(), mo = a.getMonth() + m; const last = new Date(y, mo + 1, 0).getDate(); const d = iso(new Date(y, mo, Math.min(day, last))); if (d > to) break; if (d >= from) out.push(d) } return out }
export const isoRange = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out }
/** A timestamp as date + time in the reader's locale (0.23.0). */
export const fmtDT = (iso?: string | null) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(+d) ? '—' : d.toLocaleString(resolvedLocale(), { dateStyle: 'medium', timeStyle: 'short' }) }
export const fmtTime = (iso?: string | null) => { if (!iso) return ''; const d = new Date(iso); return isNaN(+d) ? '' : d.toLocaleTimeString(resolvedLocale(), { hour: 'numeric', minute: '2-digit' }) }
