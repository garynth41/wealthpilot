// 0.25.0 — engineering: the bank-sync limit, the read-only offline copy, deleting a household with a grace period, and the alert
// that goes with it.
import { describe, it, expect, beforeEach } from 'vitest'
import { syncSlot, syncLimitMessage, SYNC_GAP_MINUTES, SYNC_DAILY } from './syncLimit'
import { makeSnapshot, pickSnapshot, saveOffline, loadOffline, clearOffline, setOfflineCopy, offlineCopyOn, isNetworkError, type Kv, type OfflineSnapshot } from './offlineCache'
import { computeAlerts, recipientsFor, type NInput } from './notify'
import { MemoryRepo } from '../app/data/memoryRepo'
import { emptyData, type Household } from '../app/data/types'
import { useStore } from '../app/store'

const at = (iso: string) => new Date(iso)
describe('the bank-sync limit', () => {
  const now = at('2026-11-06T15:00:00Z')
  it('allows a sync when nothing ran recently, counting only the last 24 hours', () => {
    expect(syncSlot([], now)).toEqual({ ok: true, used: 0, limit: SYNC_DAILY })
    expect(syncSlot(['2026-11-05T14:00:00Z', 'not a date'], now)).toMatchObject({ ok: true, used: 0 })
  })
  it('waits 15 minutes after the last on-demand sync', () => {
    const s = syncSlot(['2026-11-06T14:50:00Z'], now); expect(s).toMatchObject({ ok: false, reason: 'gap', retryAt: '2026-11-06T15:05:00.000Z', used: 1 })
    expect(syncLimitMessage(s, now)).toBe(`Synced in the last ${SYNC_GAP_MINUTES} minutes — you can sync again at 10:05 AM.`)
    expect(syncSlot(['2026-11-06T14:44:00Z'], now).ok).toBe(true)
  })
  it('allows 12 in any 24 hours; the next frees up a day after the oldest of the twelve', () => {
    const times = Array.from({ length: 12 }, (_, i) => new Date(Date.parse('2026-11-05T16:00:00Z') + i * 3600000).toISOString())
    const s = syncSlot(times, now); expect(s).toMatchObject({ ok: false, reason: 'daily', used: 12, retryAt: '2026-11-06T16:00:00.000Z' })
    expect(syncLimitMessage(s, now)).toMatch(/^That is 12 syncs in 24 hours, the most allowed — the next one is available at 11:00 AM\. The nightly sync still runs\.$/)
    expect(syncSlot(times.slice(1), now).ok).toBe(true)
    expect(syncLimitMessage({ ok: true, used: 0, limit: 12 })).toBe('')
  })
  it('names the day when the wait runs past midnight Eastern', () => {
    const late = at('2026-11-07T04:50:00Z')   // 11:50 PM Eastern on Friday
    expect(syncLimitMessage(syncSlot(['2026-11-07T04:45:00Z'], late), late)).toMatch(/at Sat 12:00 AM\.$/)
  })
  it('the demo simulates the limit only when asked to', async () => {
    localStorage.setItem('wealthpilot.simSync', '1'); const r = new MemoryRepo(); await r.syncConnect(); await r.syncSetMap({ S1: r['data'].accounts[0].id })
    await r.syncNow(); await r.syncNow()   // no limit by default
    localStorage.setItem('wealthpilot.simSyncLimit', '1'); await r.syncNow(); await expect(r.syncNow()).rejects.toThrow(/you can sync again at/)
    expect((await r.syncStatus()).requests).toHaveLength(1)
    localStorage.removeItem('wealthpilot.simSync'); localStorage.removeItem('wealthpilot.simSyncLimit')
  })
})

describe('the offline copy', () => {
  const mem = (): Kv & { rows: Map<string, OfflineSnapshot> } => { const rows = new Map<string, OfflineSnapshot>(); return { rows, get: async k => rows.get(k), put: async v => { rows.set(v.key, v) }, all: async () => [...rows.values()], clear: async () => rows.clear() } }
  const hh = (id: string): Household => ({ id, name: 'H ' + id, currency: 'USD', settings: {} as never })
  beforeEach(() => localStorage.removeItem('wealthpilot.offlineCopy'))
  it('keeps one copy per user and household and opens the household last used, else the newest', () => {
    const a = makeSnapshot('u1', { household: hh('A'), data: emptyData(), role: 'owner', readOnly: false, modules: null }, '0.25.0', at('2026-11-06T10:00:00Z'))
    const b = makeSnapshot('u1', { household: hh('B'), data: emptyData(), role: 'viewer', readOnly: true, modules: ['budget'] }, '0.25.0', at('2026-11-06T12:00:00Z'))
    const c = makeSnapshot('u2', { household: hh('C'), data: emptyData(), role: 'owner', readOnly: false, modules: null }, '0.25.0', at('2026-11-06T13:00:00Z'))
    expect(a.key).toBe('u1:A'); expect(pickSnapshot([a, b, c], 'u1', 'A')?.householdId).toBe('A'); expect(pickSnapshot([a, b, c], 'u1', 'Z')?.householdId).toBe('B'); expect(pickSnapshot([a, b, c], 'u3', null)).toBeNull()
  })
  it('saves and loads through the store, is on by default, and turning it off saves nothing', async () => {
    const kv = mem(); const s = makeSnapshot('u1', { household: hh('A'), data: emptyData(), role: 'owner', readOnly: false, modules: null }, '0.25.0')
    expect(offlineCopyOn()).toBe(true); await saveOffline(s, kv); expect((await loadOffline('u1', 'A', kv))?.household.name).toBe('H A')
    setOfflineCopy(false); expect(offlineCopyOn()).toBe(false); await clearOffline(kv); await saveOffline(s, kv); expect(kv.rows.size).toBe(0); expect(await loadOffline('u1', 'A', kv)).toBeNull()
  })
  it('tells a dropped connection from a refusal', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true); expect(isNetworkError(new Error('NetworkError when attempting to fetch resource.'))).toBe(true)
    expect(isNetworkError(new Error('permission denied for table accounts'))).toBe(false)
  })
})

describe('deleting a household', () => {
  it('needs the exact name, schedules 7 days out, makes the household read-only, and can be cancelled', async () => {
    const r = new MemoryRepo(); useStore.setState({ mode: 'demo', repo: r, role: 'owner', readOnly: false, offlineAt: null }); await useStore.getState().refresh()
    expect(useStore.getState().canEdit()).toBe(true)
    await expect(useStore.getState().requestDeletion('wrong name')).rejects.toThrow(/name exactly/)
    const name = useStore.getState().household!.name; const when = await useStore.getState().requestDeletion('  ' + name.toUpperCase() + ' ')
    expect(Math.round((Date.parse(when) - Date.now()) / 86400000)).toBe(7)
    expect(useStore.getState().household?.deletion_scheduled_for).toBe(when); expect(useStore.getState().canEdit()).toBe(false)
    expect(await useStore.getState().requestDeletion('anything')).toBe(when)   // asking again keeps the first date
    await useStore.getState().cancelDeletion(); expect(useStore.getState().household?.deletion_scheduled_for).toBeNull(); expect(useStore.getState().canEdit()).toBe(true)
  })
  it('an offline copy is read-only too', () => { useStore.setState({ mode: 'demo', offlineAt: '2026-11-06T10:00:00Z' }); expect(useStore.getState().canEdit()).toBe(false); useStore.setState({ offlineAt: null }) })
  it('every member is told once when it is scheduled and once the day before, and nothing else is sent meanwhile', () => {
    const base: NInput = { today: '2026-11-06', accounts: [{ id: 'a', name: 'Checking', kind: 'checking', status: 'Active', balance: 10, include_in_cash: true }], recurring: [], occurrences: [], transactions: [], paySchedules: [], sync: { status: 'error', last_sync_at: null, last_error: 'x' }, reserveFloor: 500, prefs: {} }
    expect(computeAlerts(base).map(a => a.kind)).toEqual(expect.arrayContaining(['low_cash', 'sync']))
    const a = computeAlerts({ ...base, deletionScheduledFor: '2026-11-13T15:00:00Z' }); expect(a).toHaveLength(1); expect(a[0]).toMatchObject({ kind: 'deletion', key: 'deletion:2026-11-13:scheduled', severity: 'crit', url: '/settings' })
    expect(computeAlerts({ ...base, today: '2026-11-12', deletionScheduledFor: '2026-11-13T15:00:00Z' })[0]).toMatchObject({ key: 'deletion:2026-11-13:final', title: 'This household is permanently deleted tomorrow' })
    expect(recipientsFor({ members: { u2: { kinds: ['bill_due'] } } }, [{ user_id: 'u1' }, { user_id: 'u2' }], 'deletion').push).toEqual(['u1', 'u2'])
  })
})
