// 0.35.0 — this month's forecast is saved once, by someone who sees and may edit the whole household, and a failed save loses nothing.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
vi.mock('./supabase', () => ({ hasSupabase: () => false, sb: () => { throw new Error('no server in this test') } }))
import { useStore } from './store'
import { MemoryRepo } from './data/memoryRepo'
import { demoSeed } from './data/demoSeed'
import { setToday, monthEnd } from '../lib/dates'

beforeAll(() => setToday('2026-11-10')); afterAll(() => setToday(null))
const open = (over: Record<string, unknown> = {}) => { const seed = demoSeed(); const repo = new MemoryRepo(seed)
  // the store gets its own copy of the rows, as it does in the app (the sample repo would otherwise write into the same lists)
  useStore.setState({ mode: 'db', repo, household: seed.household, data: structuredClone(seed.data), role: 'owner', readOnly: false, modules: null, offlineAt: null, ...over }); return { seed, repo } }
const mine = () => useStore.getState().data.forecasts.filter(f => f.through === monthEnd('2026-11'))

describe('saving this month\'s forecast', () => {
  it('saves one, once — asked twice at the same moment, or again later, there is still one', async () => {
    const { repo } = open(); const before = useStore.getState().data.forecasts.length
    const [a, b] = await Promise.all([useStore.getState().saveForecast(), useStore.getState().saveForecast()])
    expect(a).toBe(true); expect(b).toBe(true); expect(mine()).toHaveLength(1); expect(useStore.getState().data.forecasts).toHaveLength(before + 1)
    expect(await useStore.getState().saveForecast()).toBe(false); expect(mine()).toHaveLength(1)
    const row = mine()[0]; expect(row).toMatchObject({ taken_on: '2026-11-10' }); expect(row.expected_end).toBeCloseTo(row.start_cash + row.expected_in - row.expected_out, 2)
    expect((await repo.loadAll()).data.forecasts.filter(f => f.through === monthEnd('2026-11'))).toHaveLength(1)
  })
  it('not by a viewer, a read-only member, or a member who sees only some sections', async () => {
    open({ role: 'viewer' }); expect(await useStore.getState().saveForecast()).toBe(false); expect(mine()).toHaveLength(0)
    open({ role: 'editor', readOnly: true }); expect(await useStore.getState().saveForecast()).toBe(false)
    open({ role: 'editor', modules: ['budget'] }); expect(await useStore.getState().saveForecast()).toBe(false); expect(mine()).toHaveLength(0)
    open({ role: 'editor' }); expect(await useStore.getState().saveForecast()).toBe(true)
  })
  it('a save the server refuses (the table not there yet, another device got there first, offline) is not an error and is tried again next time', async () => {
    const { repo } = open(); const insert = repo.insert.bind(repo); let fail = true
    repo.insert = (async (...a: Parameters<typeof insert>) => { if (fail && a[0] === 'forecasts') throw new Error('relation "forecast_snapshots" does not exist'); return insert(...a) }) as typeof repo.insert
    expect(await useStore.getState().saveForecast()).toBe(false); expect(mine()).toHaveLength(0)
    fail = false; expect(await useStore.getState().saveForecast()).toBe(true); expect(mine()).toHaveLength(1)
  })
  it('a save that lands after another household was opened is not shown in that other household', async () => {
    const { repo } = open(); const insert = repo.insert.bind(repo); let release = () => {}
    repo.insert = (async (...a: Parameters<typeof insert>) => { await new Promise<void>(r => { release = r }); return insert(...a) }) as typeof repo.insert
    const saving = useStore.getState().saveForecast(); await new Promise(r => setTimeout(r, 5))
    const other = demoSeed(); const repoB = new MemoryRepo(other); useStore.setState({ repo: repoB, data: structuredClone(other.data) }); const before = useStore.getState().data.forecasts.length
    release(); expect(await saving).toBe(true)
    expect(useStore.getState().data.forecasts).toHaveLength(before)                                                  // household B's screen is untouched
    expect((await repo.loadAll()).data.forecasts.filter(f => f.through === monthEnd('2026-11'))).toHaveLength(1)     // …and A's forecast is saved where it belongs
  })
  it('nothing is saved in the last days of a month — and that answer is not kept: the next month, in the same session, is saved', async () => {
    setToday('2026-11-28'); open(); expect(await useStore.getState().saveForecast()).toBe(false); expect(await useStore.getState().saveForecast()).toBe(false)
    setToday('2026-12-01'); expect(await useStore.getState().saveForecast()).toBe(true); expect(useStore.getState().data.forecasts.filter(f => f.through === monthEnd('2026-12'))).toHaveLength(1)
    setToday('2026-11-10')
  })
})
