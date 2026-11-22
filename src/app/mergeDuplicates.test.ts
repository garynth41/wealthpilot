// 0.37.0 — making two rows one transfer is both writes or neither: a failure half-way leaves the two counted rows as they were.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
vi.mock('./supabase', () => ({ hasSupabase: () => false, sb: () => { throw new Error('no server in this test') } }))
import { useStore } from './store'
import { MemoryRepo } from './data/memoryRepo'
import { demoSeed } from './data/demoSeed'
import { setToday } from '../lib/dates'
import type { Transaction } from './data/types'

beforeAll(() => setToday('2026-11-10')); afterAll(() => setToday(null))
const open = () => { const seed = demoSeed(); const repo = new MemoryRepo(seed); const chk = seed.data.accounts.find(a => a.name === 'Huntington Checking')!, sav = seed.data.accounts.find(a => a.name === 'Ally Savings')!
  const base = seed.data.transactions.find(t => t.kind === 'expense')!; const mk = (id: string, p: Partial<Transaction>) => ({ ...base, id, ref: null, date: '2026-11-09', amount: 77, category_id: null, to_account_id: null, tags: [], duplicate_of: null, dedupe_ok: false, ...p }) as Transaction
  const out = mk('m-out', { kind: 'expense', account_id: chk.id, payee: 'ONLINE TRANSFER TO SAVINGS' }), inn = mk('m-in', { kind: 'income', account_id: sav.id, payee: 'ONLINE TRANSFER FROM CHECKING' })
  seed.data.transactions.push(out, inn)
  useStore.setState({ mode: 'db', repo, household: seed.household, data: structuredClone(seed.data), role: 'owner', readOnly: false, modules: null, offlineAt: null, undo: [] }); return { repo, sav } }
const row = (id: string) => useStore.getState().data.transactions.find(t => t.id === id)

describe('merging two rows into one transfer', () => {
  it('changes the kept row and hides the other', async () => {
    const { sav } = open(); await useStore.getState().mergeDuplicates('m-out', ['m-in'], { kind: 'transfer', to_account_id: sav.id })
    expect(row('m-out')).toMatchObject({ kind: 'transfer', to_account_id: sav.id }); expect(row('m-in')).toBeUndefined(); expect(useStore.getState().data.duplicates.find(t => t.id === 'm-in')?.duplicate_of).toBe('m-out')
  })
  it('if hiding the other row fails, the kept row goes back to what it was — and the merge can be tried again', async () => {
    const { repo, sav } = open(); const real = repo.update.bind(repo); let fail = true
    repo.update = (async (coll: never, id: string, patch: never) => { if (fail && id === 'm-in') throw new Error('the connection dropped'); return real(coll, id, patch) }) as typeof repo.update
    await expect(useStore.getState().mergeDuplicates('m-out', ['m-in'], { kind: 'transfer', to_account_id: sav.id })).rejects.toThrow('the connection dropped')
    expect(row('m-out')).toMatchObject({ kind: 'expense', to_account_id: null }); expect(row('m-in')).toMatchObject({ kind: 'income', duplicate_of: null })
    expect((await repo.loadAll()).data.transactions.find(t => t.id === 'm-out')).toMatchObject({ kind: 'expense', to_account_id: null })
    fail = false; await useStore.getState().mergeDuplicates('m-out', ['m-in'], { kind: 'transfer', to_account_id: sav.id })
    expect(row('m-out')?.kind).toBe('transfer'); expect(row('m-in')).toBeUndefined()
  })
})
