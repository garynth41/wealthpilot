// 0.32.0 — the Ask Cresari conversation: replies that come back late must not land in a different conversation.
import { describe, it, expect, beforeEach } from 'vitest'
import { askSession as s } from './askSession'

describe('the Ask Cresari conversation', () => {
  beforeEach(() => { s.reset(); s.claim('u1:h1') })
  it('a question and its answer', () => {
    const t = s.begin('How am I doing?')!; expect(s.busy()).toBe(true); expect(s.begin('Another?')).toBeNull()
    expect(s.answer(t, 'Fine.')).toBe(true); expect(s.busy()).toBe(false); expect(s.turns().map(x => x.role)).toEqual(['user', 'assistant'])
  })
  it('a failed question is taken back', () => { const t = s.begin('Q')!; expect(s.fail(t)).toBe(true); expect(s.turns()).toEqual([]); expect(s.busy()).toBe(false) })
  it('a reply that arrives after starting over is dropped — and a late failure does not remove the new question', () => {
    const old = s.begin('Old question')!; s.restart(); expect(s.busy()).toBe(false)
    const fresh = s.begin('New question')!
    expect(s.fail(old)).toBe(false); expect(s.answer(old, 'Old answer')).toBe(false); expect(s.turns()).toEqual([{ role: 'user', content: 'New question' }]); expect(s.busy()).toBe(true)
    expect(s.answer(fresh, 'New answer')).toBe(true); expect(s.turns()).toHaveLength(2)
  })
  it('signing out, then in again as the same person, starts clean — the reply still on its way is dropped', () => {
    const t = s.begin('Private question')!; s.reset(); s.claim('u1:h1')
    expect(s.turns()).toEqual([]); expect(s.busy()).toBe(false); expect(s.answer(t, 'Late')).toBe(false); expect(s.turns()).toEqual([])
  })
  it('each sign-out is a new sign-in: a reply from before it can be told apart, even for the same account', () => { const was = s.signIn(); s.restart(); expect(s.signIn()).toBe(was); s.reset(); expect(s.signIn()).toBe(was + 1) })
  it('another household is another conversation; the same one is kept when the panel is opened again', () => {
    const t = s.begin('Q')!; s.answer(t, 'A'); s.claim('u1:h1'); expect(s.turns()).toHaveLength(2); s.claim('u1:h2'); expect(s.turns()).toEqual([])
  })
  it('a question still out is known to a panel opened again, and listeners hear the reply', () => {
    let heard = 0; const off = s.subscribe(() => { heard++ }); const t = s.begin('Q')!; s.claim('u1:h1'); expect(s.busy()).toBe(true)
    s.answer(t, 'A'); expect(heard).toBe(2); off(); s.restart(); expect(heard).toBe(2)
  })
})
