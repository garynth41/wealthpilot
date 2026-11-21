// 0.36.0 — a default account kept on this device (someone who cannot save to the household) is one value for the whole page:
// every place that shows it changes together, the device's choice comes before the household's entry, and clearing it stays cleared.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
vi.mock('./supabase', () => ({ hasSupabase: () => false, sb: () => { throw new Error('no server in this test') } }))
import { useStore } from './store'
import { useDefaultAccount } from './hooks'
import { MemoryRepo } from './data/memoryRepo'
import { demoSeed } from './data/demoSeed'
import { setToday } from '../lib/dates'
import { localKey } from '../lib/defaultAccount'

beforeAll(() => setToday('2026-11-10')); afterAll(() => setToday(null)); beforeEach(() => localStorage.clear())
const open = (who: string, over: Record<string, unknown> = {}) => { const seed = demoSeed(); const repo = new MemoryRepo(seed)
  useStore.setState({ mode: 'db', repo, user: { id: who } as never, household: seed.household, data: structuredClone(seed.data), role: 'viewer', readOnly: false, modules: null, offlineAt: null, ...over }); return seed }

describe('a default account kept on this device', () => {
  it('is shared by every place that shows it, at once', async () => {
    const seed = open('v1'); const [a, b] = seed.data.accounts.filter(x => x.status === 'Active' && !x.excluded)
    const one = renderHook(() => useDefaultAccount()), two = renderHook(() => useDefaultAccount())
    expect(one.result.current.id).toBeNull(); expect(two.result.current.id).toBeNull()
    await act(async () => { await one.result.current.set(a.id, a.name) })
    expect(one.result.current.id).toBe(a.id); expect(two.result.current.id).toBe(a.id)            // the other row's star follows
    await act(async () => { await two.result.current.set(b.id, b.name) })
    expect(one.result.current.id).toBe(b.id); expect(one.result.current.isDefault(a.id)).toBe(false)   // …and only one is ever marked
    expect(localStorage.getItem(localKey(seed.household.id, 'v1'))).toBe(b.id)
    expect(useStore.getState().settings().defaultAccounts?.v1).toBeUndefined()                     // nothing was saved with the household
  })
  it('comes before the household\'s entry for that person, and clearing it stays cleared', async () => {
    const seed = open('v2'); const [a, b] = seed.data.accounts.filter(x => x.status === 'Active' && !x.excluded)
    useStore.setState({ household: { ...seed.household, settings: { ...(seed.household.settings || {}), defaultAccounts: { v2: a.id } } } as never })
    const h = renderHook(() => useDefaultAccount()), other = renderHook(() => useDefaultAccount())
    expect(h.result.current.id).toBe(a.id)                                                          // nothing chosen here yet: the household's entry
    await act(async () => { await h.result.current.set(b.id, b.name) }); expect(h.result.current.id).toBe(b.id); expect(other.result.current.id).toBe(b.id)
    await act(async () => { await h.result.current.set(null) }); expect(h.result.current.id).toBeNull(); expect(other.result.current.id).toBeNull()
    expect(renderHook(() => useDefaultAccount()).result.current.id).toBeNull()                      // a page opened later sees it cleared too
  })
  it('each person and household has their own', async () => {
    const seed = open('v3'); const [a] = seed.data.accounts.filter(x => x.status === 'Active' && !x.excluded)
    const h = renderHook(() => useDefaultAccount()); await act(async () => { await h.result.current.set(a.id) }); expect(h.result.current.id).toBe(a.id)
    act(() => { useStore.setState({ user: { id: 'v4' } as never }) }); expect(h.result.current.id).toBeNull()
    act(() => { useStore.setState({ user: { id: 'v3' } as never }) }); expect(h.result.current.id).toBe(a.id)
  })
})
