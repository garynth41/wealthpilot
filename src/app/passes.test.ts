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
    // the same bill filed twice by hand: a pair the merge pass joins on its own
    const twin = { ...base, payee: 'AT&T', amount: 298.62, date: '2026-10-31', account_id: null, external_id: null, source: 'manual', created_at: at, updated_at: at }
    seed.data.transactions.push({ ...twin, id: 'twin-a' } as typeof base, { ...twin, id: 'twin-b' } as typeof base)
    const repo = new MemoryRepo(seed); const events: string[] = []
    const update = repo.update.bind(repo)
    repo.update = (async (...a: Parameters<typeof update>) => { events.push('filing write starts'); await new Promise(r => setTimeout(r, 40)); const out = await update(...a); events.push('filing write done'); return out }) as typeof repo.update
    useStore.setState({ mode: 'demo', repo, household: seed.household, data: seed.data, role: 'owner', readOnly: false, offlineAt: null })
    const filing = useStore.getState().autoCategorize(true)
    await new Promise(r => setTimeout(r, 5))
    const merging = useStore.getState().autoDedupe(true).then(n => { events.push('merge pass done'); return n })
    const mergingToo = useStore.getState().autoDedupe(true)   // asked twice while waiting: one pass, and both are told what it merged
    const again = useStore.getState().autoCategorize(true)   // asked for a second time while the first is still running: queued, not lost
    // …and something for that second pass to do arrives meanwhile
    const late = await repo.insert('transactions', { ...base, id: 'arrival-2', payee: 'HULU', amount: 9.99, category_id: null })
    useStore.setState(st => (st.data.transactions.some(t => t.id === late.id) ? st : { data: { ...st.data, transactions: [...st.data.transactions, late] } }))
    expect(await filing).toBe(1)
    // asked once more while the merge is running: told what that pass merged too, not 0
    await new Promise(r => setTimeout(r, 5)); const during = useStore.getState().autoDedupe(true)
    expect(await merging).toBe(1); expect(await mergingToo).toBe(1); expect(await during).toBe(1); expect(await again).toBe(1)
    expect(useStore.getState().data.transactions.find(t => t.id === 'arrival-2')!.category_id).toBe(seed.data.categories.find(c => c.name === 'Subscriptions & streaming')!.id)
    const left = useStore.getState().data.transactions.filter(t => t.id.startsWith('twin-')), gone = useStore.getState().data.duplicates.filter(t => t.id.startsWith('twin-'))
    expect(left).toHaveLength(1); expect(gone).toHaveLength(1)
    // asked twice while one is still waiting for its turn: both get that one pass's answer, and it runs once
    const first = useStore.getState().autoCategorize(true); const a = useStore.getState().autoDedupe(true), b = useStore.getState().autoDedupe(true)
    await first; expect(await a).toBe(0); expect(await b).toBe(0)
    // the merge's own writes come only after the filing write has landed, and the merge finishes last
    expect(events.slice(0, 2)).toEqual(['filing write starts', 'filing write done']); expect(events.indexOf('merge pass done')).toBeGreaterThan(1)
    expect(useStore.getState().data.transactions.find(t => t.id === 'arrival-1')!.category_id).toBe(seed.data.categories.find(c => c.name === 'Subscriptions & streaming')!.id)
  })
})
