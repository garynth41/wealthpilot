import { useState, type FormEvent } from 'react'
import { passkeysAvailable } from '../app/native'
import { useStore } from '../app/store'
import { APP_NAME, APP_VERSION } from '../app/config'
import { hasSupabase } from '../app/supabase'
import { Btn, PasswordInput } from '../components/ui'
import { Logo } from '../components/Logo'
import { passwordProblems } from '../lib/access'
import { LegalLinks } from './About'
import { DeleteAccountCard } from './DeleteAccount'

type Mode = 'signin' | 'signup' | 'forgot' | 'recover' | 'mfa'
export function AuthPage({ recover }: { recover?: boolean }) {
  const { signIn, signUp, resetPassword, updatePassword, enterDemo, verifyMfa, verifyRecoveryCode, signInWithPasskey, mfaPending, signOut } = useStore(); const [useRecovery, setUseRecovery] = useState(false)
  const [mode, setMode] = useState<Mode>(() => { if (recover) return 'recover'; try { const m = sessionStorage.getItem('cresari.auth.mode'); sessionStorage.removeItem('cresari.auth.mode'); return m === 'signup' ? 'signup' : 'signin' } catch { return 'signin' } }); const [code, setCode] = useState(''); const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [msg, setMsg] = useState<{ cls: string; text: string } | null>(null); const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, okMsg?: string) => { setBusy(true); setMsg(null); try { const r = await fn(); if (okMsg) setMsg({ cls: 'good', text: okMsg }); if (r === 'confirm') setMsg({ cls: 'info', text: 'Check your email for a confirmation link, then sign in.' }) } catch (e) { setMsg({ cls: 'crit', text: (e as Error).message }) } finally { setBusy(false) } }
  const submit = (e: FormEvent) => { e.preventDefault(); if (mode === 'signin') run(() => signIn(email, pw)); else if (mode === 'signup') run(() => signUp(email, pw)); else if (mode === 'forgot') run(() => resetPassword(email), 'Reset link sent — check your email.'); else if (mode === 'recover') run(() => updatePassword(pw).then(() => setMode('signin')), 'Password updated. Sign in with it.') }
  return <div className="auth"><div className="box">
    <div className="brand" style={{ padding: 0, color: 'var(--ink)' }}><span className="mark"><Logo /></span><div><b style={{ fontSize: 18 }}>{APP_NAME}</b><small style={{ color: 'var(--ink-3)' }}>Budget · savings · planning</small></div></div>
    <h2>{mfaPending ? 'Two-factor code' : { signin: 'Sign in', signup: 'Create account', forgot: 'Reset password', recover: 'Choose a new password', mfa: 'Two-factor code' }[mode]}</h2>
    {mfaPending ? <form onSubmit={e => { e.preventDefault(); run(() => useRecovery ? verifyRecoveryCode(code) : verifyMfa(code)) }}>
      {useRecovery ? <div className="field"><label htmlFor="code">One of your recovery codes</label><input id="code" key="rc" className="inp" autoComplete="off" autoCapitalize="characters" spellCheck={false} required autoFocus value={code} onChange={e => setCode(e.target.value)} placeholder="xxxx-xxxx" /></div>
        : <div className="field"><label htmlFor="code">6-digit code from your authenticator app</label><input id="code" key="totp" className="inp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus value={code} onChange={e => setCode(e.target.value)} /></div>}
      <Btn type="submit" primary block disabled={busy}>Verify</Btn>
      {msg && <div className={`msg ${msg.cls}`}>{msg.text}</div>}
      <div className="links"><button type="button" onClick={() => { setUseRecovery(x => !x); setCode(''); setMsg(null) }}>{useRecovery ? 'Use the authenticator app instead' : 'Lost your phone? Use a recovery code'}</button><button type="button" onClick={() => signOut()}>← Cancel and sign out</button></div>
    </form> : hasSupabase() ? <form onSubmit={submit}>
      {mode !== 'recover' && <div className="field"><label htmlFor="email">Email</label><input id="email" className="inp" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></div>}
      {mode !== 'forgot' && <div className="field"><label htmlFor="pw">{mode === 'recover' ? 'New password' : 'Password'}{mode !== 'signin' && <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> (8+ characters)</span>}</label><PasswordInput id="pw" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={mode === 'signin' ? undefined : 8} required value={pw} onChange={e => setPw(e.target.value)} /></div>}
      <Btn type="submit" primary block disabled={busy}>{{ signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link', recover: 'Update password', mfa: 'Verify' }[mode]}</Btn>
      {mode === 'signin' && passkeysAvailable() && <div style={{ marginTop: 8 }}><Btn block disabled={busy} onClick={() => run(() => signInWithPasskey())}><span aria-hidden>🔑</span> Sign in with a passkey</Btn></div>}
      {msg && <div className={`msg ${msg.cls}`}>{msg.text}</div>}
      <div className="links">{mode === 'signin' ? <><button type="button" onClick={() => setMode('signup')}>Create an account</button><button type="button" onClick={() => setMode('forgot')}>Forgot password?</button></> : <button type="button" onClick={() => setMode('signin')}>← Back to sign in</button>}</div>
    </form> : <div className="msg crit">Supabase is not configured — copy <code>.env.example</code> to <code>.env</code>.</div>}
    <div style={{ borderTop: '1px solid var(--line)', marginTop: 18, paddingTop: 14, textAlign: 'center' }}><div className="note" style={{ marginTop: 0, marginBottom: 8 }}>No account? Try everything with sample data first.</div><Btn onClick={() => enterDemo()} block>Open the offline demo</Btn><div className="note" style={{ marginTop: 8, marginBottom: 0 }}><a href="#/try">New here? See the ways to try Cresari →</a></div></div>
    <LegalLinks short />
    <div className="note" style={{ textAlign: 'center', marginTop: 6, fontFamily: 'var(--mono)', fontSize: 11 }}>v{APP_VERSION}</div>
  </div></div>
}
export function Onboarding() {
  const { createHousehold, user, signOut, households, openHousehold } = useStore(); const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [del, setDel] = useState(false)
  return <div className="auth"><div className="box"><h2 style={{ marginTop: 0 }}>Welcome{user?.email ? `, ${user.email}` : ''}</h2>
    {households.length > 0 && <div style={{ marginBottom: 14 }}><div className="note" style={{ marginTop: 0 }}>Your households</div>{households.map(h => <Btn key={h.id} block onClick={() => openHousehold(h.id)}>{h.name} · {h.role}</Btn>)}</div>}
    <p className="note" style={{ marginTop: 0 }}>A household holds your accounts, budget and transactions. You can invite a partner later from Settings.</p>
    <div className="field"><label>Household name</label><input className="inp" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. The Rivera household" /></div>
    <Btn primary block disabled={busy} onClick={async () => { setBusy(true); setErr(''); try { await createHousehold(name || 'My household'); location.hash = '#/start' } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }}>Create household</Btn>
    {err && <div className="msg crit">{err}</div>}
    {/* 0.25.1: deleting the account is reachable before any household exists too (both app stores require it inside the app) */}
    <div className="links"><button type="button" onClick={() => signOut()}>Sign out</button><button type="button" aria-expanded={del} onClick={() => setDel(v => !v)}>Delete my account</button></div>
    {del && <div style={{ marginTop: 14 }}><DeleteAccountCard startOpen /></div>}
  </div></div>
}

/** Shown to anyone whose account was created with a temporary password: they must choose their own before seeing any data. */
export function FirstSignIn() {
  const { user, updatePassword, signOut } = useStore(); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const problems = passwordProblems(pw, { email: user?.email || '', confirm: pw2 })
  const submit = async (e: FormEvent) => { e.preventDefault(); if (problems.length) return; setBusy(true); setErr(''); try { await updatePassword(pw) } catch (x) { setErr((x as Error).message) } finally { setBusy(false) } }
  return <div className="auth"><div className="box">
    <div className="brand" style={{ padding: 0, color: 'var(--ink)' }}><span className="mark"><Logo /></span><div><b style={{ fontSize: 18 }}>{APP_NAME}</b><small style={{ color: 'var(--ink-3)' }}>Welcome{user?.email ? `, ${user.email}` : ''}</small></div></div>
    <h2>Choose your password</h2>
    <p className="note" style={{ marginTop: 0 }}>You signed in with a temporary password. Pick your own now — it replaces the temporary one and is the only password that will work from here on.</p>
    <form onSubmit={submit}>
      <div className="field"><label htmlFor="npw">New password</label><PasswordInput id="npw" autoComplete="new-password" required autoFocus value={pw} onChange={e => setPw(e.target.value)} /></div>
      <div className="field"><label htmlFor="npw2">Type it again</label><PasswordInput id="npw2" autoComplete="new-password" required value={pw2} onChange={e => setPw2(e.target.value)} /></div>
      <ul className="note" style={{ margin: '0 0 10px', paddingLeft: 18 }}>{['at least 10 characters', 'upper- and lower-case letters', 'a number', 'the two entries must match'].map(r => <li key={r} style={{ color: pw && !problems.includes(r) ? 'var(--good)' : undefined }}>{r}</li>)}{problems.filter(p => !['at least 10 characters', 'upper- and lower-case letters', 'a number', 'the two entries must match'].includes(p)).map(p => <li key={p} style={{ color: 'var(--crit)' }}>{p}</li>)}</ul>
      <Btn type="submit" primary block disabled={busy || problems.length > 0}>Save password and continue</Btn>
      {err && <div className="msg crit">{err}</div>}
      <div className="links"><button type="button" onClick={() => signOut()}>Sign out</button></div>
    </form>
  </div></div>
}

/** Where a password-reset email link lands: the person is signed in by the link but must choose a new password before anything else. */
export function ResetPassword() {
  const { user, finishRecovery, signOut } = useStore(); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const problems = passwordProblems(pw, { email: user?.email || '', confirm: pw2 })
  const basics = ['at least 10 characters', 'upper- and lower-case letters', 'a number', 'the two entries must match']
  const submit = async (e: FormEvent) => { e.preventDefault(); if (problems.length) return; setBusy(true); setErr(''); try { await finishRecovery(pw) } catch (x) { setErr((x as Error).message) } finally { setBusy(false) } }
  if (!user) return <div className="auth"><div className="box"><div className="msg warn">This reset link has expired or was already used. Go back and choose “Forgot password?” to get a fresh one.</div><div className="links"><button type="button" onClick={() => { useStore.setState({ recovering: false }); signOut() }}>← Back to sign in</button></div></div></div>
  return <div className="auth"><div className="box">
    <div className="brand" style={{ padding: 0, color: 'var(--ink)' }}><span className="mark"><Logo /></span><div><b style={{ fontSize: 18 }}>{APP_NAME}</b><small style={{ color: 'var(--ink-3)' }}>{user.email}</small></div></div>
    <h2>Choose a new password</h2>
    <form onSubmit={submit}>
      <div className="field"><label htmlFor="rpw">New password</label><PasswordInput id="rpw" autoComplete="new-password" required autoFocus value={pw} onChange={e => setPw(e.target.value)} /></div>
      <div className="field"><label htmlFor="rpw2">Type it again</label><PasswordInput id="rpw2" autoComplete="new-password" required value={pw2} onChange={e => setPw2(e.target.value)} /></div>
      <ul className="note" style={{ margin: '0 0 10px', paddingLeft: 18 }}>{basics.map(r => <li key={r} style={{ color: pw && !problems.includes(r) ? 'var(--good)' : undefined }}>{r}</li>)}{problems.filter(p => !basics.includes(p)).map(p => <li key={p} style={{ color: 'var(--crit)' }}>{p}</li>)}</ul>
      <Btn type="submit" primary block disabled={busy || problems.length > 0}>Save new password</Btn>
      {err && <div className="msg crit">{err}</div>}
      <div className="links"><button type="button" onClick={() => { useStore.setState({ recovering: false }); signOut() }}>Cancel</button></div>
    </form>
  </div></div>
}
