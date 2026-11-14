// "Try Cresari" (0.29.0): the public page an invitation links to — /#/try, with ?t=<invite code>. No sign-in needed. Three ways in: the
// offline demo, an account of your own (then Start here walks through setup), and installing it on the phone; plus what to try, how to
// send feedback, and a plain word on privacy. The invite code is kept on the device (lib/invite.ts) and goes with sign-up and feedback.
import { useEffect } from 'react'
import { useStore } from '../app/store'
import { APP_NAME, APP_VERSION } from '../app/config'
import { Logo } from '../components/Logo'
import { Btn } from '../components/ui'
import { FeedbackButton } from '../components/Feedback'
import { InstallSteps } from '../components/Install'
import { codeFromHash, rememberCode } from '../lib/invite'
import { LegalLinks } from './About'

const go = (hash: string) => { location.hash = hash }
export const AUTH_MODE_KEY = 'cresari.auth.mode'

export function TryPage() {
  const { enterDemo, exitDemo, mode, user } = useStore()
  useEffect(() => { rememberCode(codeFromHash(location.hash)); const t = document.title; document.title = `Try ${APP_NAME}`; return () => { document.title = t } }, [])
  const signedIn = !!mode || !!user
  const demo = async () => { await enterDemo(); go('#/start') }
  const hasAccount = mode === 'db' || !!user   // someone in the demo can still go on to create an account (the demo's data stays on this device)
  const account = (signup: boolean) => { try { sessionStorage.setItem(AUTH_MODE_KEY, signup ? 'signup' : 'signin') } catch { /* private mode */ } if (mode === 'demo') exitDemo(); go('#/') }
  return <div className="try" data-testid="try-page">
    <header className="try-hero">
      <div className="brand" style={{ padding: 0 }}><span className="mark"><Logo size={36} /></span><div><b>{APP_NAME}</b><small>Budget · bills · savings · planning</small></div></div>
      <h1>You are invited to test {APP_NAME}</h1>
      <p className="lead">A personal finance app for your budget, bills, savings, debts and the plan that ties them together. It is in testing — your honest feedback decides what gets fixed and built next.</p>
      {signedIn && <div className="msg info">You are already {mode === 'demo' ? 'in the demo' : 'signed in'}. <Btn sm primary onClick={() => go('#/')}>Go to {APP_NAME}</Btn></div>}
    </header>

    <section className="try-ways" aria-label="Three ways to try it">
      <div className="try-way"><span className="try-n">1</span><h2>Look around the demo</h2>
        <p>A sample household with accounts, bills, a budget and a year of spending. No account, nothing to type, and it stays on this device. The quickest way to see what Cresari does.</p>
        <Btn primary block onClick={() => void demo()} disabled={mode === 'db'}>Open the demo</Btn></div>
      <div className="try-way"><span className="try-n">2</span><h2>Set up your own</h2>
        <p>Create a free account and set up your own budget. <b>Start here</b> walks you through it step by step — accounts, income, bills, budget, spending, savings and debts — in about an hour, at your own pace.</p>
        <Btn primary block onClick={() => account(true)} disabled={hasAccount}>Create my account</Btn>
        <button type="button" className="linkbtn" onClick={() => account(false)} disabled={hasAccount}>I already have an account — sign in</button></div>
      <div className="try-way"><span className="try-n">3</span><h2>Put it on your phone</h2><InstallSteps /></div>
    </section>

    <section className="try-cols">
      <div className="try-box"><h2>What to try</h2>
        <ul>
          <li>Set up from scratch with <b>Start here</b> — did any step lose you?</li>
          <li>Add your bills and paydays, then look at <b>Cash Flow Forecast</b> and <b>Safe to spend</b> on the Dashboard. Do the numbers make sense?</li>
          <li>Build a budget for this month and sort a few purchases into it.</li>
          <li>Set up an emergency-fund goal and see when you would reach it.</li>
          <li>Use it on your phone for a week. What did you reach for and not find?</li>
        </ul></div>
      <div className="try-box"><h2>Tell us what you think</h2>
        <p>Tap <b>✉ Feedback</b> at the top of any screen — in the demo too. Something broke, something confused you, an idea, or just what you liked: a sentence is plenty. Leave your email if you would like a reply.</p>
        <FeedbackButton pageTitle="Try Cresari" />
        <h2 style={{ marginTop: 18 }}>Your privacy</h2>
        <ul className="note" style={{ margin: 0 }}>
          <li>Rather not use real numbers? Use the demo, or make up rough ones — the app works the same.</li>
          <li>Your account is private to you: other testers never see it. Cresari never moves money and never asks for full account numbers.</li>
          <li>Feedback sends only what you type and, if you leave it ticked, the page and device it came from — never your money data.</li>
          <li>You can delete your account and everything in it at any time (Settings → Security).</li>
        </ul></div>
    </section>
    <footer className="try-foot"><LegalLinks short /><div className="note" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>v{APP_VERSION}</div></footer>
  </div>
}
