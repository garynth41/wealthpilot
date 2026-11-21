// 0.32.0 — the "include my recent transactions" switch. The Ask panel and Settings → This device both set it through setAskDetail,
// so switching it off in either place starts the conversation over: earlier answers may quote transactions and would be sent as history.
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('../app/supabase', () => ({ hasSupabase: () => false, sb: () => { throw new Error('no server in this test') } }))
import { setAskDetail } from './AskCresari'
import { askSession } from '../lib/askSession'
import { useStore } from '../app/store'

describe('the transactions switch and the conversation', () => {
  beforeEach(() => { askSession.reset(); askSession.claim('u1:h1') })
  it('switching it off clears the conversation; switching it on does not', () => {
    const t = askSession.begin('What did I spend at the grocery store?')!; askSession.answer(t, 'On Nov 3 you spent 84.20 at kroger.')
    expect(setAskDetail(true)).toBe(false); expect(askSession.turns()).toHaveLength(2)
    expect(setAskDetail(false)).toBe(true); expect(askSession.turns()).toEqual([])
    expect(setAskDetail(false)).toBe(false)   // nothing to clear the second time
  })
  it('a question still out when it is switched off is dropped when its answer comes back', () => {
    const t = askSession.begin('List my last five purchases')!; setAskDetail(false)
    expect(askSession.answer(t, 'Nov 3 kroger 84.20 …')).toBe(false); expect(askSession.turns()).toEqual([]); expect(askSession.busy()).toBe(false)
  })
  it('signing out clears the conversation at once', async () => {
    const t = askSession.begin('Q')!; askSession.answer(t, 'A'); const was = askSession.signIn()
    await useStore.getState().signOut().catch(() => {})   // no server here: the local part still runs
    expect(askSession.turns()).toEqual([]); expect(askSession.signIn()).toBe(was + 1)
  })
})
