// 0.29.1 — the welcome screen during sign-in. Signing in takes a few seconds (invites are accepted, then the household list is read);
// for that time the app used to show "Welcome — Create household", and one click there made a second, empty household and opened it in
// place of the real one (Nov 14). The screen now waits for the list. The Supabase client is a stand-in that records every call.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const calls: string[] = []
let gate: Promise<void> = Promise.resolve()
let lists: Array<{ data: unknown; error: { message: string } | null }> = []
const USER = { id: 'u-gary', email: 'gary@cresari.test' }
vi.mock('../app/supabase', () => ({
  hasSupabase: () => true,
  sb: () => ({
    auth: {
      signInWithPassword: () => Promise.resolve({ error: null }),
      getUser: () => Promise.resolve({ data: { user: USER } }),
      signOut: () => Promise.resolve({ error: null }),
      mfa: { getAuthenticatorAssuranceLevel: () => Promise.resolve({ data: { currentLevel: 'aal1', nextLevel: 'aal1', currentAuthenticationMethods: [] } }) },
    },
    rpc: (name: string) => { calls.push('rpc ' + name); return name === 'accept_invites' ? gate.then(() => ({ data: 0, error: null })) : Promise.resolve({ data: 'new-household', error: null }) },
    from: (t: string) => ({ select: () => ({ eq: () => { calls.push('read ' + t); return Promise.resolve(lists.shift() || { data: [], error: null }) } }) }),
  }),
}))
vi.mock('../lib/offlineCache', async orig => ({ ...(await orig<typeof import('../lib/offlineCache')>()), clearOffline: () => Promise.resolve() }))

import { useStore } from '../app/store'
import { Onboarding } from './Auth'

const opened: string[] = []
beforeEach(() => {
  calls.length = 0; opened.length = 0; lists = []; gate = Promise.resolve(); localStorage.clear()
  useStore.setState({ user: null, mode: null, households: [], householdsFor: null, householdsError: null, openHousehold: async (id: string) => { opened.push(id); useStore.setState({ mode: 'db' }) } })
})
const slowInvites = () => { let open!: () => void; gate = new Promise<void>(r => { open = r }); return () => open() }
const createButton = () => screen.queryByRole('button', { name: /create/i })

describe('the welcome screen while signing in', () => {
  it('shows only "Opening your household…" until the list is read — nothing to click that makes a household — then opens it', async () => {
    const release = slowInvites(); lists = [{ data: [{ household_id: 'hh-thomas', role: 'owner', households: { name: 'GaryThomas' } }], error: null }]
    useStore.setState({ user: USER as never })   // what the sign-in event does at once, before the household list is read
    render(<Onboarding />)
    const signingIn = useStore.getState().signIn(USER.email, 'test-fixture-only')
    await waitFor(() => expect(calls).toContain('rpc accept_invites'))
    expect(screen.getByRole('status').textContent).toMatch(/Opening your household/)
    expect(createButton()).toBeNull()
    expect(screen.queryByText(/Welcome/)).toBeNull()
    release(); await signingIn
    expect(opened).toEqual(['hh-thomas'])
    expect(calls).not.toContain('rpc create_household')
  })
  it('someone with no household yet gets the create form once the list says so', async () => {
    useStore.setState({ user: USER as never }); render(<Onboarding />)
    await useStore.getState().signIn(USER.email, 'test-fixture-only')
    expect(await screen.findByRole('button', { name: 'Create household' })).toBeTruthy()
    expect(opened).toEqual([])
  })
  it('a list that cannot be read says so with Try again — never the create form — and Try again opens the household', async () => {
    lists = [{ data: null, error: { message: 'the server took too long' } }, { data: [{ household_id: 'hh-thomas', role: 'owner', households: { name: 'GaryThomas' } }], error: null }]
    useStore.setState({ user: USER as never }); render(<Onboarding />)
    await useStore.getState().signIn(USER.email, 'test-fixture-only').catch(() => {})
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not load your households — the server took too long/)
    expect(screen.queryByRole('button', { name: /create/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(opened).toEqual(['hh-thomas']))
  })
  it('with a household already there, it is offered first and a new one is a separate, deliberate step', async () => {
    useStore.setState({ user: USER as never, householdsFor: USER.id, households: [{ id: 'hh-thomas', name: 'GaryThomas', role: 'owner' }] })
    render(<Onboarding />)
    expect(screen.getByRole('button', { name: 'Open GaryThomas · owner' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create household' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Create another household' }))
    const make = screen.getByRole('button', { name: 'Create this household' }) as HTMLButtonElement
    expect(make.disabled).toBe(true)   // a name first, so it is never made by a stray click
    fireEvent.change(screen.getByLabelText('New household name'), { target: { value: 'Rental property' } })
    expect(make.disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Open GaryThomas · owner' }))
    await waitFor(() => expect(opened).toEqual(['hh-thomas']))
  })
  it('a sign-in that is still reading the list when the person signs out opens nothing afterwards', async () => {
    const release = slowInvites(); lists = [{ data: [{ household_id: 'hh-thomas', role: 'owner', households: { name: 'GaryThomas' } }], error: null }]
    useStore.setState({ user: USER as never })
    const signingIn = useStore.getState().signIn(USER.email, 'test-fixture-only')
    await waitFor(() => expect(calls).toContain('rpc accept_invites'))
    await useStore.getState().signOut().catch(() => {})
    release(); await signingIn
    expect(opened).toEqual([])
    expect(useStore.getState()).toMatchObject({ householdsFor: null, mode: null })
  })
  it('a household load that finishes after another household was opened is dropped, success or failure', async () => {
    let finishA!: (v: unknown) => void, failA!: (e: Error) => void
    const repoA = { mode: 'db', loadAll: () => new Promise((res, rej) => { finishA = res; failA = rej }) }, repoB = { mode: 'db', loadAll: () => new Promise(() => {}) }
    useStore.setState({ repo: repoA as never, household: null, loadError: null })
    const a = useStore.getState().refresh()
    useStore.setState({ repo: repoB as never })   // the person opened another household meanwhile
    finishA({ household: { id: 'hh-a', name: 'A', settings: {} }, data: {}, role: 'owner', readOnly: false, modules: null }); await a
    expect(useStore.getState().household).toBeNull()
    useStore.setState({ repo: repoA as never }); const again = useStore.getState().refresh(); useStore.setState({ repo: repoB as never })
    failA(new Error('A could not load')); await again
    expect(useStore.getState().loadError).toBeNull()
  })
  it('signing out forgets whose list was read, so the next person waits for their own', async () => {
    useStore.setState({ user: USER as never, householdsFor: USER.id, householdsError: 'old' })
    await useStore.getState().signOut().catch(() => {})
    expect(useStore.getState()).toMatchObject({ householdsFor: null, householdsError: null })
  })
})
