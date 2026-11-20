// 0.32.0 — the two automatic passes take turns. Merging duplicates and filing new arrivals both write a transaction's category; if a merge
// could start while a filing write was still on its way, the late write could replace the category the merge had just copied onto the row.
import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabase', () => ({ hasSupabase: () => false, sb: () => { throw new Error('no server in this test') } }))
import { useStore } from './store'
import { MemoryRepo } from './data/memoryRepo'
import { demoSeed } from './data/demoSeed'

describe('duplicate merging and filing on arrival', () => {
  it('a merge asked for while a filing write is on its way waits for it; neither pass is dropped', async () => {
    const seed = demoSeed(); const at = '2026-11-10T12:00:00.000Z'
    const base = seed.data.transactions.find(t => t.kind === 'expense')!
    seed.data.transactions.push({ ...base, id: 'arrival-1', payee: 'NETFLIX.COM', amount: 15.49, category_id: null, created_at: at, updated_at: at })
    const repo = new MemoryRepo(seed); const events: string[] = []
    const update = repo.update.bind(repo)
    repo.update = (async (...a: Parameters<typeof update>) => { events.push('filing write starts'); await new Promise(r => setTimeout(r, 40)); const out = await update(...a); events.push('filing write done'); return out }) as typeof repo.update
    useStore.setState({ mode: 'demo', repo, household: seed.household, data: seed.data, role: 'owner', readOnly: false, offlineAt: null })
    const filing = useStore.getState().autoCategorize(true)
    await new Promise(r => setTimeout(r, 5))
    const merging = useStore.getState().autoDedupe(true).then(n => { events.push('merge pass done'); return n })
    const again = useStore.getState().autoCategorize(true)   // asked for a second time while the first is still running: queued, not lost
    expect(await filing).toBe(1); await merging; expect(await again).toBe(0)
    expect(events).toEqual(['filing write starts', 'filing write done', 'merge pass done'])
    expect(useStore.getState().data.transactions.find(t => t.id === 'arrival-1')!.category_id).toBe(seed.data.categories.find(c => c.name === 'Subscriptions & streaming')!.id)
  })
})
