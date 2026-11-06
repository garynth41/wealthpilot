// Read-only offline copy (0.25.0): after every load the signed-in household is kept in this browser's IndexedDB, so the app can open
// with no connection — read-only, with a banner saying how old the copy is. Cleared at sign-out; a per-device switch turns it off
// (Settings → This device). Only this device's browser holds it; nothing new leaves the device.
import type { Data, Household, Role } from '../app/data/types'

export interface OfflineSnapshot { key: string; userId: string; householdId: string; savedAt: string; household: Household; data: Data; role: Role; readOnly: boolean; modules: string[] | null; version: string }
/** A tiny key-value store, so the rules below can be tested without a browser. */
export interface Kv { get(key: string): Promise<OfflineSnapshot | undefined>; put(v: OfflineSnapshot): Promise<void>; all(): Promise<OfflineSnapshot[]>; clear(): Promise<void> }

const FLAG = 'wealthpilot.offlineCopy'
export const offlineCopyOn = () => { try { return localStorage.getItem(FLAG) !== 'off' } catch { return false } }
export function setOfflineCopy(on: boolean) { try { localStorage.setItem(FLAG, on ? 'on' : 'off') } catch { /* private mode */ } if (!on) void clearOffline() }

const keyOf = (userId: string, householdId: string) => `${userId}:${householdId}`
/** Everything the pages read, as loaded. */
export function makeSnapshot(userId: string, r: { household: Household; data: Data; role: Role; readOnly: boolean; modules: string[] | null }, version: string, at = new Date()): OfflineSnapshot {
  return { key: keyOf(userId, r.household.id), userId, householdId: r.household.id, savedAt: at.toISOString(), household: r.household, data: r.data, role: r.role, readOnly: r.readOnly, modules: r.modules, version }
}
/** The copy to open: this user's household they last used, else their most recent copy. */
export function pickSnapshot(all: OfflineSnapshot[], userId: string, preferHousehold: string | null): OfflineSnapshot | null {
  const mine = all.filter(s => s.userId === userId).sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  return mine.find(s => s.householdId === preferHousehold) || mine[0] || null
}

// IndexedDB behind the Kv interface
const DB = 'wealthpilot-offline', STORE = 'snapshots'
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => { if (typeof indexedDB === 'undefined') { rej(new Error('no IndexedDB')); return }
    const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'key' }) }
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
}
const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> => {
  const db = await idb()
  return await new Promise<T | undefined>((res, rej) => { const t = db.transaction(STORE, mode); const req = fn(t.objectStore(STORE)); let out: T | undefined
    if (req) req.onsuccess = () => { out = req.result }
    t.oncomplete = () => { db.close(); res(out) }; t.onerror = () => { db.close(); rej(t.error) }; t.onabort = () => { db.close(); rej(t.error) } })
}
export const browserKv: Kv = {
  get: key => tx<OfflineSnapshot>('readonly', s => s.get(key) as IDBRequest<OfflineSnapshot>),
  put: async v => { await tx('readwrite', s => { s.put(v) }) },
  all: async () => (await tx<OfflineSnapshot[]>('readonly', s => s.getAll() as IDBRequest<OfflineSnapshot[]>)) || [],
  clear: async () => { await tx('readwrite', s => { s.clear() }) },
}

export async function saveOffline(snap: OfflineSnapshot, kv: Kv = browserKv) { if (!offlineCopyOn()) return; try { await kv.put(snap) } catch { /* storage full or blocked — the copy is a convenience */ } }
export async function loadOffline(userId: string, preferHousehold: string | null, kv: Kv = browserKv) { if (!offlineCopyOn()) return null; try { return pickSnapshot(await kv.all(), userId, preferHousehold) } catch { return null } }
export async function clearOffline(kv: Kv = browserKv) { try { await kv.clear() } catch { /* nothing kept */ } }
/** A failure that means "no connection" rather than "the server said no". */
export const isNetworkError = (e: unknown) => (typeof navigator !== 'undefined' && navigator.onLine === false) || /failed to fetch|networkerror|network request failed|load failed|fetch failed|ERR_INTERNET|ERR_NETWORK/i.test(String((e as Error)?.message || e))
