// 0.29.0 — feedback, tester invites, installing the web app, and Start here.
import { describe, expect, it, beforeEach } from 'vitest'
import { deviceName, platformName, feedbackProblem, feedbackArgs, contextLine, issueLink, replyLink, feedbackCsv, feedbackSummary, statusForTester, type Feedback } from './feedback'
import { cleanCode, codeFromHash, rememberCode, testerCode, inviteLink, inviteMessage, mailtoLink, smsLink } from './invite'
import { howToInstall } from './install'
import { START_STEPS, startState, startProgress } from './startGuide'
import { emptyData, type Data, type Settings } from '../app/data/types'

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S921U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0 Mobile Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
}

describe('feedback', () => {
  it('names the device without version numbers', () => {
    expect(deviceName(UA.iphoneSafari)).toBe('iPhone · Safari'); expect(deviceName(UA.iphoneChrome)).toBe('iPhone · Chrome')
    expect(deviceName(UA.android)).toBe('Android · Chrome'); expect(deviceName(UA.samsung)).toBe('Android · Samsung Internet')
    expect(deviceName(UA.winEdge)).toBe('Windows · Edge'); expect(deviceName(UA.macSafari)).toBe('Mac · Safari'); expect(deviceName(UA.firefox)).toBe('Windows · Firefox')
    expect(deviceName('')).toBe('Unknown device')
  })
  it('says where the app runs', () => { expect(platformName('ios', false)).toBe('ios'); expect(platformName('web', true)).toBe('installed'); expect(platformName('web', false)).toBe('web') })
  it('checks a note the way the database does', () => {
    expect(feedbackProblem('rant', 'hello', null, '')).toMatch(/kind/)
    expect(feedbackProblem('bug', ' a ', null, '')).toMatch(/few words/)
    expect(feedbackProblem('bug', 'x'.repeat(4001), null, '')).toMatch(/4,000/)
    expect(feedbackProblem('bug', 'it broke', 6, '')).toMatch(/1 to 5/)
    expect(feedbackProblem('bug', 'it broke', null, 'nope')).toMatch(/email/)
    expect(feedbackProblem('bug', 'it broke', 3, 'a@b.co')).toBeNull()
  })
  it('sends only what was typed when the page and device are unticked', () => {
    const ctx = { page: '/budget', app_version: '0.29.0', platform: 'web', device: 'iPhone · Safari', screen: '390×844', look: 'terminal dark', demo: true }
    expect(feedbackArgs('idea', '  more charts ', 5, ' ', 'church', ctx)).toMatchObject({ p_kind: 'idea', p_message: 'more charts', p_rating: 5, p_email: null, p_tester: 'church', p_page: '/budget', p_demo: true })
    expect(feedbackArgs('idea', 'more charts', null, '', null, null)).toMatchObject({ p_page: null, p_device: null, p_screen: null, p_look: null, p_app_version: null, p_demo: false })
    expect(contextLine(ctx, 'Budget')).toBe('Budget · v0.29.0 · iPhone · Safari · 390×844 · terminal dark · offline demo')
  })
  const f: Feedback = { id: '1', created_at: '2026-11-13T18:02:00Z', kind: 'bug', rating: 2, message: 'The budget total is off by $20\nafter I split a receipt', page: '/budget', app_version: '0.29.0',
    platform: 'web', device: 'Mac · Safari', screen: '1440×900', look: 'graphite light', demo: false, user_id: 'u', email: 'tester@x.test', tester: 'church', status: 'new', admin_note: null, issue_url: null }
  it('turns feedback into a GitHub issue without the tester\'s address or invite code', () => {
    const u = new URL(issueLink('garynth41/wealthpilot', f)); const p = u.searchParams
    expect(u.origin + u.pathname).toBe('https://github.com/garynth41/wealthpilot/issues/new')
    expect(p.get('title')).toBe('Something broke: The budget total is off by $20'); expect(p.get('labels')).toBe('bug')
    expect(p.get('body')).toContain('> The budget total is off by $20\n> after I split a receipt'); expect(p.get('body')).toContain('rated 2/5')
    expect(p.get('body')).not.toContain('tester@x.test'); expect(p.get('body')).not.toContain('church'); expect(p.get('body')).toMatch(/public/)
  })
  it('replies by email only to someone who left an address', () => {
    expect(replyLink({ ...f, email: null })).toBeNull()
    const r = replyLink(f)!; expect(r.startsWith('mailto:tester%40x.test?')).toBe(true); expect(decodeURIComponent(r)).toContain('Re: your Cresari feedback — something broke')
  })
  it('exports a spreadsheet that never runs a formula', () => {
    const csv = feedbackCsv([{ ...f, message: '=HYPERLINK("x")' }]).split('\r\n')
    expect(csv[0]).toMatch(/^Date,Kind,Rating,Message,Status/); expect(csv[1]).toContain(`"'=HYPERLINK(""x"")"`)
  })
  it('sums up the inbox', () => {
    const now = new Date('2026-11-13T20:00:00Z')
    const s = feedbackSummary([f, { ...f, rating: 5, status: 'fixed', created_at: '2026-10-01T00:00:00Z' }, { ...f, kind: 'idea', rating: null, status: 'seen' }], now)
    expect(s).toEqual({ total: 3, open: 1, week: 2, bugs: 1, rating: 3.5, rated: 2 })
    expect(feedbackSummary([], now).rating).toBeNull()
  })
  it('tells testers what became of their note in plain words', () => { expect(statusForTester('wontfix')).toBe('Not planned'); expect(statusForTester('duplicate')).toBe('Already reported') })
})

describe('invites', () => {
  beforeEach(() => localStorage.clear())
  it('keeps only codes the database accepts', () => {
    expect(cleanCode(' Church Group! ')).toBe('Church-Group'); expect(cleanCode('a'.repeat(50))).toHaveLength(40); expect(cleanCode('!!!')).toBeNull(); expect(cleanCode(null)).toBeNull()
  })
  it('reads the code from the invitation address and keeps it on the device', () => {
    expect(codeFromHash('#/try?t=linkedin')).toBe('linkedin'); expect(codeFromHash('#/try')).toBeNull(); expect(codeFromHash('#/try?x=1')).toBeNull()
    rememberCode('family'); expect(testerCode()).toBe('family'); rememberCode(null); expect(testerCode()).toBe('family')
  })
  it('builds the link and a message that carries it', () => {
    const link = inviteLink('https://garynth41.github.io/wealthpilot/', 'church'); expect(link).toBe('https://garynth41.github.io/wealthpilot/#/try?t=church')
    expect(inviteLink('https://x.test/', null)).toBe('https://x.test/#/try')
    const m = inviteMessage(link, 'Gary'); expect(m.body).toContain(link); expect(m.body.trim().endsWith('Gary')).toBe(true); expect(m.body).toMatch(/demo/); expect(m.body).toMatch(/Start here/)
    expect(mailtoLink(m)).toMatch(/^mailto:\?subject=Would%20you%20help/); expect(decodeURIComponent(smsLink(m.body))).toContain(link)
  })
})

describe('installing the web app', () => {
  it('gives the steps for the phone or computer in use', () => {
    expect(howToInstall(UA.iphoneSafari).device).toBe('iPhone'); expect(howToInstall(UA.iphoneSafari).steps.join(' ')).toMatch(/Add to Home Screen/)
    expect(howToInstall(UA.iphoneChrome).note).toMatch(/Safari/)
    expect(howToInstall(UA.ipadDesktop, 5).device).toBe('iPad')
    expect(howToInstall(UA.android).steps[0]).toMatch(/Install app/); expect(howToInstall(UA.samsung).steps.join(' ')).toMatch(/Home screen/)
    expect(howToInstall(UA.winEdge).steps[0]).toMatch(/Install/); expect(howToInstall(UA.winChrome).device).toBe('computer')
    expect(howToInstall(UA.macSafari).steps[0]).toMatch(/Add to Dock/); expect(howToInstall(UA.firefox).note).toMatch(/Firefox/)
  })
})

describe('Start here', () => {
  const S = {} as Settings
  const acct = (o: Record<string, unknown>) => ({ id: String(o.id), name: 'x', kind: 'checking', status: 'Active', balance: 100, balance_as_of: '2026-11-01', include_in_cash: true, include_in_net_worth: true, minimum_payment: 0, ...o })
  it('every step names a page, at least two instructions and a reason', () => {
    for (const s of START_STEPS) { expect(s.to.startsWith('/'), s.key).toBe(true); expect(s.steps.length, s.key).toBeGreaterThanOrEqual(2); expect(s.why.length, s.key).toBeGreaterThan(20) }
    expect(new Set(START_STEPS.map(s => s.key)).size).toBe(START_STEPS.length)
  })
  it('a new household starts at the first step', () => {
    const st = startState(emptyData(), S); const pr = startProgress(st)
    expect(pr.done).toBe(0); expect(pr.next?.key).toBe('accounts'); expect(st.debts.done).toBe(true); expect(st.routine.done).toBeNull()
  })
  it('steps tick themselves off from the data', () => {
    const d: Data = { ...emptyData(), accounts: [acct({ id: 'a' }), acct({ id: 'c', kind: 'credit_card', balance: 500, planned_payment: 0 })] as unknown as Data['accounts'] }
    const st = startState(d, S); expect(st.accounts.done).toBe(true); expect(st.accounts.detail).toBe('2 accounts added'); expect(st.balances.done).toBe(true)
    expect(st.debts.done).toBe(false); expect(st.debts.detail).toBe('planned payment set on 0 of 1 card or loan')
    expect(startProgress(st).next?.key).toBe('income')
  })
})
