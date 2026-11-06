// Device display preferences (0.23.0): the locale numbers and dates are written in, and privacy mode (amounts hidden on screen).
// Both are per device (localStorage), like the theme: a shared computer can hide amounts while your phone does not.
// NO imports — money.ts and dates.ts read from here, and they are used by the edge-function engines' tests.
const KEY = { locale: 'wealthpilot.locale', privacy: 'wealthpilot.privacy' }
const read = (k: string) => { try { return typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
let localePref = read(KEY.locale) || 'auto'
let privacy = read(KEY.privacy) === '1'
let unmaskDepth = 0
const subs = new Set<() => void>()
let version = 0
const notify = () => { version++; subs.forEach(f => f()) }

/** The choices offered in Settings, with a sample of how each writes numbers. */
export const LOCALES: Array<[string, string]> = [
  ['auto', 'Same as this browser'], ['en-US', 'English (US) — 1,234.56 · Nov 6, 2026'], ['en-GB', 'English (UK) — 1,234.56 · 6 Nov 2026'], ['en-CA', 'English (Canada)'], ['en-IN', 'English (India) — 1,23,456.78'],
  ['es-US', 'Español (EE. UU.)'], ['es-MX', 'Español (México)'], ['es-ES', 'Español (España) — 1.234,56'], ['fr-CA', 'Français (Canada) — 1 234,56'], ['fr-FR', 'Français (France)'], ['de-DE', 'Deutsch — 1.234,56'], ['it-IT', 'Italiano'], ['pt-BR', 'Português (Brasil)'], ['nl-NL', 'Nederlands'],
]
export const localePreference = () => localePref
export function resolvedLocale(): string {
  if (localePref !== 'auto') return localePref
  try { return (typeof navigator !== 'undefined' && navigator.language) || 'en-US' } catch { return 'en-US' }
}
export function setLocale(l: string) { localePref = l || 'auto'; write(KEY.locale, localePref); seps = null; nf.clear(); notify() }

const nf = new Map<string, Intl.NumberFormat>()
/** A cached number formatter for the current locale. */
export function numberFormat(opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const loc = resolvedLocale(); const k = loc + JSON.stringify(opts); let f = nf.get(k)
  if (!f) { try { f = new Intl.NumberFormat(loc, opts) } catch { f = new Intl.NumberFormat('en-US', opts) } nf.set(k, f) }
  return f
}
let seps: { group: string; decimal: string } | null = null
/** The locale's grouping and decimal characters (for parsing what people type, and for Plotly's `separators`). */
export function separators(): { group: string; decimal: string } {
  if (seps) return seps
  const parts = numberFormat({ useGrouping: true, minimumFractionDigits: 1 }).formatToParts(12345.6)
  seps = { group: parts.find(p => p.type === 'group')?.value || ',', decimal: parts.find(p => p.type === 'decimal')?.value || '.' }
  return seps
}

/** Privacy mode hides every formatted amount until it is turned off (keyboard: H). Exports run `unmasked` so files keep real figures. */
export const isPrivate = () => privacy && unmaskDepth === 0
export const privacyOn = () => privacy
export function setPrivacy(on: boolean) { privacy = on; write(KEY.privacy, on ? '1' : '0'); if (typeof document !== 'undefined') document.documentElement.classList.toggle('privacy', on); notify() }
export const togglePrivacy = () => setPrivacy(!privacy)
export function unmasked<T>(fn: () => T): T { unmaskDepth++; try { return fn() } finally { unmaskDepth-- } }
export const MASK = '•••'

/** For useSyncExternalStore: re-render (re-mount the page) when the locale or privacy changes. */
export const subscribeDisplay = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb) } }
export const displayVersion = () => version
/** Apply the stored privacy class at boot. */
export function initDisplay() { if (typeof document !== 'undefined') document.documentElement.classList.toggle('privacy', privacy) }
