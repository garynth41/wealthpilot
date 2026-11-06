import { isChunkError, reloadForNewVersion } from './chunks'
// Error monitoring (0.19.0): every uncaught browser error, unhandled promise rejection and React error-boundary catch is written to
// app_errors (migration 0009) with the app version and page, so a stack trace maps to a build. Settings → Security → Errors lists them.
// Rules: never more than 20 reports per session, the same message at most once a minute, nothing from the offline demo (console only),
// and never any transaction data — only the error's own message, stack, page URL and user agent.
import { APP_VERSION, APP_BUILD } from '../app/config'

export interface ErrorReport { message: string; stack?: string; source: 'browser'; context?: Record<string, unknown> }
type Sink = (r: ErrorReport & { url: string; user_agent: string; version: string }) => Promise<void>
let sink: Sink | null = null; let sent = 0; const recent = new Map<string, number>(); const MAX = 20
const PENDING = 'wealthpilot.errors.pending'

export function setErrorSink(s: Sink | null) { sink = s; if (s) void flushPending() }
async function flushPending() {
  let rows: Array<ErrorReport & { url: string; user_agent: string; version: string }> = []
  try { rows = JSON.parse(localStorage.getItem(PENDING) || '[]'); localStorage.removeItem(PENDING) } catch { /* */ }
  for (const r of rows.slice(0, 5)) { try { await sink?.(r) } catch { /* */ } }
}
/** Report an error. Returns false when it was throttled or deduplicated. */
export function captureError(e: unknown, context: Record<string, unknown> = {}): boolean {
  const err = e instanceof Error ? e : new Error(typeof e === 'string' ? e : (() => { try { return JSON.stringify(e) } catch { return String(e) } })())
  const message = (err.message || 'Unknown error').slice(0, 2000); const key = message.slice(0, 200); const now = Date.now()
  if (sent >= MAX || (recent.get(key) || 0) > now - 60000) return false
  recent.set(key, now); sent++
  const row = { message, stack: (err.stack || '').slice(0, 20000), source: 'browser' as const, context: { ...context, build: APP_BUILD, page: location.hash }, url: location.href.slice(0, 500), user_agent: navigator.userAgent.slice(0, 300), version: APP_VERSION }
  if (sink) { sink(row).catch(() => queue(row)) } else queue(row)
  return true
}
function queue(row: ErrorReport & { url: string; user_agent: string; version: string }) {
  try { const rows = JSON.parse(localStorage.getItem(PENDING) || '[]'); rows.push(row); localStorage.setItem(PENDING, JSON.stringify(rows.slice(-10))) } catch { /* */ }
}
/** Hook the global handlers once. Errors from browser extensions and cross-origin scripts ("Script error.") are ignored. */
export function installErrorCapture() {
  window.addEventListener('error', ev => { if (!ev.message || ev.message === 'Script error.' || /extension:\/\//.test(ev.filename || '')) return; captureError(ev.error || ev.message, { kind: 'error', file: ev.filename, line: ev.lineno }) })
  window.addEventListener('unhandledrejection', ev => { const r = ev.reason; if (r && typeof r === 'object' && 'name' in r && (r as { name: string }).name === 'AbortError') return; if (isChunkError(r)) { reloadForNewVersion(); return } captureError(r, { kind: 'unhandledrejection' }) })
}
/** Testable throttle state (unit tests). */
export const _errorState = { reset() { sent = 0; recent.clear() }, get sent() { return sent } }
