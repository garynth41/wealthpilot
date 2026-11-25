// 0.37.0 — making two rows one transfer is both writes or neither: a failure half-way leaves the two counted rows as they were.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
vi.mock('./supabase', () => ({ hasSupabase: () => false, sb: () => { throw new Error('no server in this test') } }))
import { useStore, toView as toViewForTest } from './store'
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

// 0.39.2 — a merged copy gives its money back. Two typed copies of one entry were each posted to the stored balance; hiding one took it
// out of every total but left its posting on the balance. On an account with no bank balance behind it, nothing ever corrected that.
describe('merging two typed copies of one entry', () => {
  const setup = (opts: { bank?: number | null; keeper?: Partial<Transaction>; copy?: Partial<Transaction> } = {}) => {
    const seed = demoSeed(); const repo = new MemoryRepo(seed); const acct = seed.data.accounts.find(a => a.name === 'Huntington Checking')!
    acct.bank_balance = opts.bank ?? null; acct.balance = 1000 - 77 - 77   // both copies were posted when they were typed
    const base = seed.data.transactions.find(t => t.kind === 'expense')!
    const mk = (id: string, p: Partial<Transaction>) => ({ ...base, id, ref: null, date: '2026-11-09', kind: 'expense', amount: 77, account_id: acct.id, to_account_id: null, category_id: null, payee: 'Hardware store', tags: [], status: 'cleared', source: 'manual', external_id: null, recurring_id: null, duplicate_of: null, dedupe_ok: false, unposted: false, ...p }) as Transaction
    seed.data.transactions.push(mk('t-keep', opts.keeper || {}), mk('t-copy', opts.copy || {}))
    useStore.setState({ mode: 'db', repo, household: seed.household, data: structuredClone(seed.data), role: 'owner', readOnly: false, modules: null, offlineAt: null, undo: [] })
    return { repo, id: acct.id } }
  const bal = (id: string) => +useStore.getState().data.accounts.find(a => a.id === id)!.balance
  const hidden = () => useStore.getState().data.duplicates.find(t => t.id === 't-copy')

  it('on an account with no bank balance, the hidden copy gives back what it took — and Restore takes it again', async () => {
    const { repo, id } = setup(); await useStore.getState().mergeDuplicates('t-keep', ['t-copy'])
    expect(bal(id)).toBe(923); expect(hidden()).toMatchObject({ duplicate_of: 't-keep', unposted: true })
    expect((await repo.loadAll()).data.accounts.find(a => a.id === id)!.balance).toBe(923)
    await useStore.getState().restoreDuplicate('t-copy')
    expect(bal(id)).toBe(846); expect(row('t-copy')).toMatchObject({ duplicate_of: null, unposted: false })
  })
  it('a payment recorded twice from a bill is the same case', async () => {
    const { id } = setup({ keeper: { source: 'recurring' }, copy: { source: 'recurring' } }); await useStore.getState().mergeDuplicates('t-keep', ['t-copy'])
    expect(bal(id)).toBe(923); expect(hidden()?.unposted).toBe(true)
  })
  it('an account with a bank balance is left alone — the bank\'s figure sets it', async () => {
    const { id } = setup({ bank: 1000 }); await useStore.getState().mergeDuplicates('t-keep', ['t-copy'])
    expect(bal(id)).toBe(846); expect(hidden()).toMatchObject({ duplicate_of: 't-keep', unposted: false })
    await useStore.getState().restoreDuplicate('t-copy'); expect(bal(id)).toBe(846)
  })
  it('a typed row merged into the bank\'s row, a statement file\'s or an emailed one moves no balance', async () => {
    for (const keeper of [{ source: 'import', external_id: 'sfin:ACT-1:TRN-1' }, { source: 'import', external_id: 'ofx:20261109:77' }, { source: 'email' }] as Array<Partial<Transaction>>) {
      const { id } = setup({ keeper }); await useStore.getState().mergeDuplicates('t-keep', ['t-copy'])
      expect(bal(id)).toBe(846); expect(hidden()?.unposted).toBe(false) }
  })
  it('a merge that turns the kept row into a transfer moves no balance: the two rows were two halves, not two copies', async () => {
    const seedSav = demoSeed().data.accounts.find(a => a.name === 'Ally Savings')!
    const { id } = setup({ copy: { kind: 'income', account_id: seedSav.id } }); await useStore.getState().mergeDuplicates('t-keep', ['t-copy'], { kind: 'transfer', to_account_id: seedSav.id })
    expect(bal(id)).toBe(846); expect(hidden()?.unposted).toBe(false)
  })
  it('a copy merged before 0.39.2 carries no mark, and restoring it changes no balance', async () => {
    const { repo, id } = setup({ copy: { duplicate_of: 't-keep' } }); useStore.setState({ data: toViewForTest((await repo.loadAll()).data) })
    await useStore.getState().restoreDuplicate('t-copy'); expect(bal(id)).toBe(846); expect(row('t-copy')?.duplicate_of).toBeNull()
  })
  it('if hiding the copy fails, its posting goes back on — the two rows are again two counted rows', async () => {
    const { repo, id } = setup(); const real = repo.update.bind(repo)
    repo.update = (async (coll: never, rid: string, patch: never) => { if (rid === 't-copy') throw new Error('the connection dropped'); return real(coll, rid, patch) }) as typeof repo.update
    await expect(useStore.getState().mergeDuplicates('t-keep', ['t-copy'])).rejects.toThrow('the connection dropped')
    expect(bal(id)).toBe(846); expect(row('t-copy')).toMatchObject({ duplicate_of: null })
  })
})

// 0.39.2 — a due date is claimed before its payment is recorded (the offline demo follows the same rule as the database function)
describe('claiming a bill\'s due date', () => {
  it('is taken once, refused while the claim is fresh, free again after two minutes, and refused once paid', async () => {
    const seed = demoSeed(); const repo = new MemoryRepo(seed); const rec = seed.data.recurring[0]
    const occ = await repo.insert('occurrences', { recurring_id: rec.id, due_date: '2026-12-01', amount: 50, status: 'due' })
    expect((await repo.claimOccurrence(occ.id))?.claimed_at).toBeTruthy()
    expect(await repo.claimOccurrence(occ.id)).toBeNull()
    await repo.update('occurrences', occ.id, { claimed_at: new Date(Date.now() - 121000).toISOString() })
    expect(await repo.claimOccurrence(occ.id)).not.toBeNull()
    await repo.update('occurrences', occ.id, { status: 'paid', claimed_at: null })
    expect(await repo.claimOccurrence(occ.id)).toBeNull(); expect(await repo.claimOccurrence('no-such-row')).toBeNull()
  })
})
