import { describe, expect, it } from 'vitest'
import { withMemberNotify } from './memberNotify'
import { NOTIFY_DEFAULTS } from './notify'

describe('withMemberNotify (0.25.1)', () => {
  it('changes only that member, on what was stored — no screen defaults are written', () => {
    const stored = { email: true, members: { a: { push: false }, b: { email: true, email_to: 'b@x.test' } } }
    const next = withMemberNotify(stored, 'b', { digest: false })
    expect(next).toEqual({ email: true, members: { a: { push: false }, b: { email: true, email_to: 'b@x.test', digest: false } } })
    for (const k of Object.keys(NOTIFY_DEFAULTS)) expect(k in next).toBe(false)
    expect(stored.members.b).toEqual({ email: true, email_to: 'b@x.test' })   // not mutated
  })
  it('starts from nothing when nothing was stored', () => {
    expect(withMemberNotify(undefined, 'u', { email: true })).toEqual({ members: { u: { email: true } } })
    expect(withMemberNotify(null, 'u', { push: true })).toEqual({ members: { u: { push: true } } })
  })
  it('null puts the member back on the household default', () => {
    expect(withMemberNotify({ large: 250, members: { u: { email: true }, v: {} } }, 'u', null)).toEqual({ large: 250, members: { v: {} } })
    expect(withMemberNotify({ large: 250 }, 'u', null)).toEqual({ large: 250, members: {} })
  })
  it('the household-level part compares equal before and after (what the database checks for anyone but an owner)', () => {
    const stored = { push: true, quiet_from: 21, members: { x: { push: true } } }
    const { members: _a, ...before } = stored; const { members: _b, ...after } = withMemberNotify(stored, 'y', { email: true, email_to: null })
    expect(after).toEqual(before)
  })
})
