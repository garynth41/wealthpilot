// Inviting testers (0.29.0). The operator shares a link to the public "Try Cresari" page (pages/Try.tsx): /#/try, with ?t=<code> to tell
// one group of testers from another ("church", "linkedin", a person's first name). The code is kept on the tester's device, sent with
// their feedback and saved in their sign-up details, so Feedback & testers can count sign-ups and feedback per code. Codes are labels,
// not passwords: anyone with the plain link can try the app too.

const KEY = 'cresari.tester'
/** A code as the database accepts it: letters, digits, - and _, at most 40. Anything else becomes null. */
export const cleanCode = (s: string | null | undefined) => { const c = String(s || '').trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40); return c || null }
/** The invite code in a /#/try?t=… address, if there is one. */
export function codeFromHash(hash: string): string | null { const q = hash.split('?')[1]; if (!q) return null; return cleanCode(new URLSearchParams(q).get('t')) }
export function rememberCode(code: string | null) { if (!code) return; try { localStorage.setItem(KEY, code) } catch { /* private mode */ } }
export function testerCode(): string | null { try { return cleanCode(localStorage.getItem(KEY)) } catch { return null } }

/** The link to share. `base` is the app's public address (ends with /). */
export const inviteLink = (base: string, code: string | null) => `${base}#/try${code ? `?t=${encodeURIComponent(code)}` : ''}`

/** A ready-to-send invitation in plain words, for email, text or a post. `from` signs it. */
export function inviteMessage(link: string, from: string): { subject: string; body: string } {
  const subject = 'Would you help me test Cresari, my budgeting app?'
  const body = [
    'Hi,',
    '',
    'I am building Cresari, an app for budgeting, bills, savings and planning, and I would love your honest feedback before it goes into the app stores.',
    '',
    `Open this link on your phone or computer: ${link}`,
    '',
    'From there you can:',
    '1. Try the demo — sample data, no account, nothing to type. The quickest way to look around.',
    '2. Create your own account and set up your own budget — the "Start here" guide walks you through it step by step.',
    '3. Add it to your home screen so it opens like any other app (the page shows you how on your phone).',
    '',
    'Whenever something breaks, confuses you or gives you an idea, tap Feedback at the top of any screen. A sentence is plenty.',
    '',
    'Thank you!',
    from,
  ].join('\n')
  return { subject, body }
}
export const mailtoLink = (m: { subject: string; body: string }) => 'mailto:?' + new URLSearchParams(m).toString().replace(/\+/g, '%20')
/** sms: — iPhone and Android both read ?&body= (the & keeps older iPhones happy). */
export const smsLink = (text: string) => `sms:?&body=${encodeURIComponent(text)}`
