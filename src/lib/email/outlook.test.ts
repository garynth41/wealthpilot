import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { setToday } from '../dates'
import { isMoneyMail, graphQs, olRun, type MailStats } from './mail'
import { isSkip } from './extract'
import type { Settings } from '../../app/data/types'

beforeAll(() => setToday('2026-11-02'))
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear() })

describe('money-mail filter used for Outlook', () => {
  it('keeps bills, payments, deposits and alerts', () => {
    for (const subject of ['Your statement is ready', 'Payment received — thank you', 'Your AutoPay is scheduled', 'Direct deposit posted', 'Your account is past due', 'Receipt for your order', 'Your bill is available']) expect(isMoneyMail({ subject }), subject).toBe(true)
    expect(isMoneyMail({ subject: 'Hello', text: 'Your minimum payment of $35.00 is due 11/20.' })).toBe(true)
  })
  it('drops ordinary mail and newsletter senders', () => {
    for (const subject of ['Lunch on Friday?', 'Weekly team update', 'Your photos are ready']) expect(isMoneyMail({ subject }), subject).toBe(false)
    expect(isMoneyMail({ subject: 'Your statement is ready', fromEmail: 'news@mail.creditkarma.com' })).toBe(false)
    expect(isMoneyMail({ subject: 'Statements and receipts', fromEmail: 'x@substack.com' })).toBe(false)
  })
  it('encodes Graph query strings with %20, never +', () => {
    const q = graphQs({ $filter: 'receivedDateTime ge 2026-09-03T00:00:00Z', $top: '50' })
    expect(q).toBe('$filter=receivedDateTime%20ge%202026-09-03T00%3A00%3A00Z&$top=50'); expect(q).not.toContain('+')
  })
})

describe('Outlook run (simulated Microsoft Graph)', () => {
  const settings = { outlook: { clientId: 'app-id', tenant: 'consumers', account: '' }, finmail: { since: '2026-09-03' } } as unknown as Settings
  const body = (html: string) => ({ contentType: 'html', content: html })
  const msgs = [
    { id: 'm1', conversationId: 'c1', subject: 'Your AEP Ohio bill is ready', from: { emailAddress: { name: 'AEP Ohio', address: 'billing@aep.com' } }, receivedDateTime: '2026-10-20T13:00:00Z', parentFolderId: 'INBOX', webLink: 'https://outlook.live.com/x/1', body: body('<p>Your bill of <b>$142.18</b> is due on November 12, 2026.</p>') },
    { id: 'm2', conversationId: 'c2', subject: 'Lunch?', from: { emailAddress: { name: 'Pat', address: 'pat@example.com' } }, receivedDateTime: '2026-10-19T13:00:00Z', parentFolderId: 'INBOX', body: body('<p>Tacos at noon?</p>') },
    { id: 'm3', conversationId: 'c3', subject: 'Payment received', from: { emailAddress: { name: 'Me', address: 'gary@outlook.com' } }, receivedDateTime: '2026-10-18T13:00:00Z', parentFolderId: 'SENT', body: body('<p>Payment received $10.00</p>') },
  ]
  const page2 = [{ id: 'm4', conversationId: 'c4', subject: 'Thank you for your payment', from: { emailAddress: { name: 'Chase', address: 'no-reply@chase.com' } }, receivedDateTime: '2026-10-05T13:00:00Z', parentFolderId: 'INBOX', webLink: 'https://outlook.live.com/x/4', body: body('<p>We received your payment of $250.00 on October 5, 2026 for your card ending in 4821.</p>') }]
  it('signs in with the saved token, lists by date (not $search), skips sent/ordinary mail and extracts money facts', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url); const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200 })
      if (url.includes('/oauth2/v2.0/token')) return ok({ access_token: 'tok', expires_in: 3600, refresh_token: 'rt2' })
      if (url.includes('/v1.0/me?')) return ok({ mail: null, userPrincipalName: 'gary@outlook.com' })
      if (url.includes('mailFolders/sentitems')) return ok({ id: 'SENT' })
      if (url.includes('mailFolders/')) return ok({ id: 'F-' + url.split('mailFolders/')[1].split('?')[0] })
      if (url.includes('page=2')) return ok({ value: page2 })
      if (url.includes('/v1.0/me/messages?')) return ok({ value: msgs, '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?page=2' })
      return new Response('{}', { status: 404 })
    }))
    sessionStorage.setItem('wealthpilot.olrt', 'rt1')
    const stats: MailStats = { scanned: 0, matched: 0 }
    const facts = await olRun(settings, new Set(), undefined, stats)
    const list = urls.find(u => u.includes('/v1.0/me/messages?$filter'))!
    expect(list).toContain('receivedDateTime%20ge%202026-09-03T00%3A00%3A00Z'); expect(list).not.toContain('$search'); expect(list).toContain('$orderby=receivedDateTime%20desc')
    expect(stats).toEqual({ scanned: 4, matched: 2 })
    const real = facts.filter(f => !isSkip(f))
    expect(real.map(f => f.ev[0].msg_id).sort()).toEqual(['m1', 'm4'])
    expect(real.every(f => f.ev[0].src === 'outlook')).toBe(true)
  })
})
