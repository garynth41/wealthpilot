// The bank-sync limit (0.25.0): "Sync now" and "Load history" at most once every 15 minutes and 12 times in any 24 hours, per
// household. The database enforces it (claim_sync_slot, migration 0018) in one locked step; this mirror lets the page show when
// the next sync is available, and words the message the same way in the app and in the sync function
// (supabase/functions/sync-simplefin/syncLimit.ts is a byte-for-byte copy kept by scripts/sync-engines.mjs). NO imports.
export const SYNC_GAP_MINUTES = 15
export const SYNC_DAILY = 12
export interface SyncSlot { ok: boolean; reason?: 'gap' | 'daily'; retryAt?: string; used: number; limit: number }

/** Whether a manual sync may start now, given the times (ISO) of the household's recent manual syncs. */
export function syncSlot(times: string[], now = new Date(), gap = SYNC_GAP_MINUTES, daily = SYNC_DAILY): SyncSlot {
  const t = now.getTime(), dayAgo = t - 86400000
  const recent = times.map(s => Date.parse(s)).filter(x => !isNaN(x) && x > dayAgo && x <= t + 60000).sort((a, b) => a - b)
  const last = recent[recent.length - 1]
  if (last != null && last > t - gap * 60000) return { ok: false, reason: 'gap', retryAt: new Date(last + gap * 60000).toISOString(), used: recent.length, limit: daily }
  if (recent.length >= daily) return { ok: false, reason: 'daily', retryAt: new Date(recent[recent.length - daily] + 86400000).toISOString(), used: recent.length, limit: daily }
  return { ok: true, used: recent.length, limit: daily }
}

const clock = (iso: string, now: Date) => {
  const d = new Date(iso); const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }
  const sameDay = d.toLocaleDateString('en-US', { timeZone: 'America/New_York' }) === now.toLocaleDateString('en-US', { timeZone: 'America/New_York' })
  return (sameDay ? '' : d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' }) + ' ') + d.toLocaleTimeString('en-US', opts)
}
/** The sentence shown when a sync is not allowed yet (Eastern time, like the rest of the app's schedules). */
export function syncLimitMessage(s: SyncSlot, now = new Date()): string {
  if (s.ok || !s.retryAt) return ''
  const at = clock(s.retryAt, now)
  return s.reason === 'gap' ? `Synced in the last ${SYNC_GAP_MINUTES} minutes — you can sync again at ${at}.` : `That is ${s.limit} syncs in 24 hours, the most allowed — the next one is available at ${at}. The nightly sync still runs.`
}
