// 0.29.0 — Feedback & testers after an account switch: someone who is not the operator is signed out in another tab (or their session is
// revoked), then the operator signs in on #/feedback in the same tab. The operator flag must start again from "checking" (null), so the
// page waits for the check instead of sending the operator to the Dashboard with the previous person's "no".
import { describe, it, expect, vi } from 'vitest'

let onAuth: ((event: string, session: unknown) => void) | null = null
vi.mock('./supabase', () => ({
  hasSupabase: () => true,
  sb: () => ({ auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: (cb: typeof onAuth) => { onAuth = cb; return { data: { subscription: { unsubscribe() {} } } } } } }),
}))
vi.mock('../lib/offlineCache', async orig => ({ ...(await orig<typeof import('../lib/offlineCache')>()), clearOffline: () => Promise.resolve() }))

import { useStore } from './store'
import { routeBlocked } from '../lib/access'
import { VIEWS } from '../components/Layout'

const known = VIEWS.map(v => v.path), notOperator = known.filter(p => p !== '/feedback')

describe('Feedback & testers across an account switch', () => {
  it('a sign-out elsewhere resets the operator flag, so the next operator on #/feedback is not sent away', async () => {
    await useStore.getState().boot(); expect(onAuth).toBeTypeOf('function')
    useStore.setState({ mode: 'db', user: { id: 'tester' } as never, appAdmin: false })   // a tester was signed in: not the operator
    expect(routeBlocked('/feedback', known, notOperator, useStore.getState().appAdmin)).toBe(true)
    onAuth!('SIGNED_OUT', null)                                                              // signed out in another tab / session revoked
    expect(useStore.getState()).toMatchObject({ mode: null, user: null, appAdmin: null })
    // the operator signs in on #/feedback: while the check is out the page waits; a yes opens it, a no still sends them to the Dashboard
    expect(routeBlocked('/feedback', known, notOperator, useStore.getState().appAdmin)).toBe(false)
    expect(routeBlocked('/feedback', known, known, true)).toBe(false)
    expect(routeBlocked('/feedback', known, notOperator, false)).toBe(true)
  })
  it('signing out here resets it too', async () => {
    useStore.setState({ mode: 'db', user: { id: 'tester' } as never, appAdmin: false })
    await useStore.getState().signOut().catch(() => {})
    expect(useStore.getState().appAdmin).toBeNull()
  })
  it('only the operator page waits for the check; any other hidden page still goes to the Dashboard', () => {
    expect(routeBlocked('/tax', known, known.filter(p => p !== '/tax'), null)).toBe(true)
    expect(routeBlocked('/not-a-page', known, notOperator, false)).toBe(false)   // unknown addresses are the router's catch-all, not this
  })
})
