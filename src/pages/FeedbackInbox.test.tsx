// 0.29.0 — the Feedback dialog sends what the tester typed through submit_feedback; Feedback & testers shows the operator everything
// and saves triage. The Supabase client is replaced with a stand-in that records every call.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

const calls: Array<{ op: string; table?: string; args?: unknown }> = []
let statsFail = false
let pending: Promise<void> | null = null
const rows = [
  { id: 'f1', created_at: '2026-11-13T15:00:00Z', kind: 'bug', rating: 2, message: 'Budget total is off after a split', page: '/budget', app_version: '0.29.0', platform: 'web', device: 'Mac · Safari', screen: '1440×900', look: 'graphite light', demo: false, user_id: 'u1', email: 'tester@x.test', tester: 'church', status: 'new', admin_note: null, issue_url: null },
  { id: 'f2', created_at: '2026-11-12T09:00:00Z', kind: 'praise', rating: 5, message: 'Love the forecast', page: '/forecast', app_version: '0.29.0', platform: 'installed', device: 'iPhone · Safari', screen: '390×844', look: 'terminal dark', demo: true, user_id: null, email: null, tester: null, status: 'fixed', admin_note: null, issue_url: null },
]
const chain = (table: string) => {
  const q: Record<string, unknown> = {}
  const done = (data: unknown) => Promise.resolve({ data, error: null })
  q.select = () => q; q.order = () => q; q.eq = (_c: string, v: unknown) => { calls.push({ op: 'eq', table, args: v }); return q }
  q.limit = () => done(table === 'feedback' ? rows : [])
  q.update = (p: unknown) => { calls.push({ op: 'update', table, args: p }); return { eq: () => done(null) } }
  q.delete = () => ({ eq: () => done(null) })
  q.then = (res: (v: unknown) => unknown) => done([]).then(res)
  return q
}
vi.mock('../app/supabase', () => ({
  hasSupabase: () => true,
  sb: () => ({ from: (t: string) => chain(t), rpc: (name: string, args: unknown) => { calls.push({ op: 'rpc', args: { name, ...(args as object) } })
    if (name === 'feedback_inbox') { const q: Record<string, unknown> = {}; q.order = () => q; q.range = (a: number) => { calls.push({ op: 'range', args: a }); return Promise.resolve({ data: a === 0 ? rows : [], error: null }) }; return q }
    if (name === 'submit_feedback' && pending) return pending.then(() => ({ data: 'new-id', error: null }))
    return Promise.resolve(name === 'tester_stats' && statsFail ? { data: null, error: { message: 'timeout' } } : { data: name === 'tester_stats' ? [{ tester: 'church', signed_up: 3, active_7d: 2, households: 2, feedback: 1 }] : 'new-id', error: null }) } }),
}))

import { useStore } from '../app/store'
import { ModalHost } from '../components/ui'
import { FeedbackInboxPage } from './FeedbackInbox'
import { FeedbackDialog } from '../components/Feedback'

beforeEach(() => { calls.length = 0; statsFail = false; pending = null; localStorage.clear() })

describe('Feedback & testers', () => {
  it('is closed to everyone but the operator', () => {
    useStore.setState({ mode: 'db', appAdmin: false, user: { id: 'u9', email: 'someone@x.test' } as never })
    render(<ModalHost><FeedbackInboxPage /></ModalHost>)
    expect(screen.getByText(/Only the person who runs Cresari/)).toBeTruthy()
  })
  it('shows the operator every note, the numbers and the invite link, and saves triage', async () => {
    useStore.setState({ mode: 'db', appAdmin: true, user: { id: 'op', email: 'gary@x.test' } as never })
    render(<ModalHost><FeedbackInboxPage /></ModalHost>)
    await screen.findByText('Budget total is off after a split')
    expect(screen.queryByText('Love the forecast')).toBeNull()   // the Open view hides fixed notes
    fireEvent.click(screen.getByRole('button', { name: 'All' })); expect(screen.getByText('Love the forecast')).toBeTruthy()
    expect(screen.getByText('church', { selector: 'td' })).toBeTruthy()
    expect(screen.getByTestId('invite-link').textContent).toMatch(/#\/try\?t=beta$/)
    const item = screen.getAllByTestId('fb-item')[0]
    expect(within(item).getByRole('link', { name: 'Reply by email' }).getAttribute('href')).toMatch(/^mailto:tester%40x\.test/)
    expect(within(item).getByRole('link', { name: /Make GitHub issue/ }).getAttribute('href')).toMatch(/^https:\/\/github\.com\/garynth41\/wealthpilot\/issues\/new\?/)
    fireEvent.change(within(item).getByLabelText('Status'), { target: { value: 'planned' } })
    await waitFor(() => expect(calls).toContainEqual({ op: 'update', table: 'feedback', args: { status: 'planned' } }))
    expect(calls.some(c => c.op === 'rpc' && (c.args as { name: string }).name === 'feedback_inbox')).toBe(true)   // full rows (with the private note) come only through the operator's inbox function
  })
  it('waits for the operator check instead of turning the operator away, and says when the tester numbers fail', async () => {
    useStore.setState({ mode: 'db', appAdmin: null, user: { id: 'op', email: 'gary@x.test' } as never })
    const { unmount } = render(<ModalHost><FeedbackInboxPage /></ModalHost>)
    expect(screen.getByText(/Checking that this is your page/)).toBeTruthy(); unmount()
    statsFail = true; useStore.setState({ appAdmin: true })
    render(<ModalHost><FeedbackInboxPage /></ModalHost>)
    expect((await screen.findByText(/Could not load the numbers: timeout/)).textContent).toMatch(/Refresh/)
    expect(screen.getByText('Budget total is off after a split')).toBeTruthy()
  })
})

describe('the Feedback dialog', () => {
  it('sends what was typed, with the page and device unless unticked, and keeps a draft until sent', async () => {
    useStore.setState({ mode: 'demo', user: null })
    localStorage.setItem('cresari.tester', 'church')
    render(<ModalHost><FeedbackDialog pageTitle="Budget" /></ModalHost>)
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/few words/)
    fireEvent.click(screen.getByLabelText('Idea')); fireEvent.change(screen.getByLabelText('Your note'), { target: { value: 'A yearly view of bills' } })
    fireEvent.click(screen.getByRole('button', { name: '4 stars' }))
    expect(JSON.parse(localStorage.getItem('cresari.feedback.draft')!)).toMatchObject({ kind: 'idea', message: 'A yearly view of bills', rating: 4 })
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    await screen.findByText('Thank you!')
    const sent = calls.find(c => c.op === 'rpc')!.args as Record<string, unknown>
    expect(sent).toMatchObject({ name: 'submit_feedback', p_kind: 'idea', p_message: 'A yearly view of bills', p_rating: 4, p_email: null, p_tester: 'church', p_demo: true, p_app_version: expect.any(String) })
    expect(localStorage.getItem('cresari.feedback.draft')).toBeNull()
  })
  it('keeps a newer draft when an earlier note finishes sending after the dialog was closed', async () => {
    useStore.setState({ mode: 'demo', user: null }); let release = () => {}; pending = new Promise<void>(r => { release = r })
    const { unmount } = render(<ModalHost><FeedbackDialog /></ModalHost>)
    fireEvent.change(screen.getByLabelText('Your note'), { target: { value: 'The first note' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect((screen.getByLabelText('Your note') as HTMLTextAreaElement).readOnly).toBe(true)   // nothing can be typed while it sends
    unmount(); localStorage.setItem('cresari.feedback.draft', JSON.stringify({ kind: 'idea', message: 'A second note', rating: null }))
    release(); await waitFor(() => expect(calls.some(c => c.op === 'rpc')).toBe(true)); await new Promise(r => setTimeout(r, 10))
    expect(JSON.parse(localStorage.getItem('cresari.feedback.draft')!).message).toBe('A second note')
  })
  it('sends only the note when the page and device are unticked', async () => {
    useStore.setState({ mode: 'demo', user: null })
    render(<ModalHost><FeedbackDialog /></ModalHost>)
    fireEvent.change(screen.getByLabelText('Your note'), { target: { value: 'Too many menus' } })
    fireEvent.click(screen.getByLabelText(/Include the page and device/))
    expect(screen.getByText(/Only what you typed will be sent/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    await screen.findByText('Thank you!')
    expect(calls.find(c => c.op === 'rpc')!.args).toMatchObject({ p_kind: 'bug', p_page: null, p_device: null, p_screen: null, p_demo: false })
  })
})
