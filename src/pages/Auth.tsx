import { useState, type FormEvent } from 'react'
import { useStore } from '../app/store'
import { APP_NAME, APP_VERSION } from '../app/config'
import { hasSupabase } from '../app/supabase'
import { Btn } from '../components/ui'
import { Logo } from '../components/Logo'

type Mode = 'signin' | 'signup' | 'forgot' | 'recover' | 'mfa'
export function AuthPage({ recover }: { recover?: boolean }) {
  const { signIn, signUp, resetPassword, updatePassword, enterDemo, verifyMfa, mfaPending, signOut } = useStore()
  const [mode, setMode] = useState<Mode>(recover ? 'recover' : 'signin'); const [code, setCode] = useState(''); const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [msg, setMsg] = useState<{ cls: string; text: string } | null>(null); const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, okMsg?: string) => { setBusy(true); setMsg(null); try { const r = await fn(); if (okMsg) setMsg({ cls: 'good', text: okMsg }); if (r === 'confirm') setMsg({ cls: 'info', text: 'Check your email for a confirmation link, then sign in.' }) } catch (e) { setMsg({ cls: 'crit', text: (e as Error).message }) } finally { setBusy(false) } }
  const submit = (e: FormEvent) => { e.preventDefault(); if (mode === 'signin') run(() => signIn(email, pw)); else if (mode === 'signup') run(() => signUp(email, pw)); else if (mode === 'forgot') run(() => resetPassword(email), 'Reset link sent — check your email.'); else if (mode === 'recover') run(() => updatePassword(pw).then(() => setMode('signin')), 'Password updated. Sign in with it.') }
  return <div className="auth"><div className="box">
    <div className="brand" style={{ padding: 0, color: 'var(--ink)' }}><span className="mark"><Logo /></span><div><b style={{ fontSize: 18 }}>{APP_NAME}</b><small style={{ color: 'var(--ink-3)' }}>Budget · savings · planning</small></div></div>
    <h2>{mfaPending ? 'Two-factor code' : { signin: 'Sign in', signup: 'Create account', forgot: 'Reset password', recover: 'Choose a new password', mfa: 'Two-factor code' }[mode]}</h2>
    {mfaPending ? <form onSubmit={e => { e.preventDefault(); run(() => verifyMfa(code)) }}>
      <div className="field"><label htmlFor="code">6-digit code from your authenticator app</label><input id="code" className="inp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus value={code} onChange={e => setCode(e.target.value)} /></div>
      <Btn type="submit" primary block disabled={busy}>Verify</Btn>
      {msg && <div className={`msg ${msg.cls}`}>{msg.text}</div>}
      <div className="links"><button type="button" onClick={() => signOut()}>← Cancel and sign out</button></div>
    </form> : hasSupabase() ? <form onSubmit={submit}>
      {mode !== 'recover' && <div className="field"><label htmlFor="email">Email</label><input id="email" className="inp" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></div>}
      {mode !== 'forgot' && <div className="field"><label htmlFor="pw">{mode === 'recover' ? 'New password' : 'Password'}{mode !== 'signin' && <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> (8+ characters)</span>}</label><input id="pw" className="inp" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={mode === 'signin' ? undefined : 8} required value={pw} onChange={e => setPw(e.target.value)} /></div>}
      <Btn type="submit" primary block disabled={busy}>{{ signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link', recover: 'Update password', mfa: 'Verify' }[mode]}</Btn>
      {msg && <div className={`msg ${msg.cls}`}>{msg.text}</div>}
      <div className="links">{mode === 'signin' ? <><button type="button" onClick={() => setMode('signup')}>Create an account</button><button type="button" onClick={() => setMode('forgot')}>Forgot password?</button></> : <button type="button" onClick={() => setMode('signin')}>← Back to sign in</button>}</div>
    </form> : <div className="msg crit">Supabase is not configured — copy <code>.env.example</code> to <code>.env</code>.</div>}
    <div style={{ borderTop: '1px solid var(--line)', marginTop: 18, paddingTop: 14, textAlign: 'center' }}><div className="note" style={{ marginTop: 0, marginBottom: 8 }}>No account? Try everything with sample data first.</div><Btn onClick={() => enterDemo()} block>Open the offline demo</Btn></div>
    <div className="note" style={{ textAlign: 'center', marginTop: 14, fontFamily: 'var(--mono)', fontSize: 11 }}>v{APP_VERSION}</div>
  </div></div>
}
export function Onboarding() {
  const { createHousehold, user, signOut, households, openHousehold } = useStore(); const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  return <div className="auth"><div className="box"><h2 style={{ marginTop: 0 }}>Welcome{user?.email ? `, ${user.email}` : ''}</h2>
    {households.length > 0 && <div style={{ marginBottom: 14 }}><div className="note" style={{ marginTop: 0 }}>Your households</div>{households.map(h => <Btn key={h.id} block onClick={() => openHousehold(h.id)}>{h.name} · {h.role}</Btn>)}</div>}
    <p className="note" style={{ marginTop: 0 }}>A household holds your accounts, budget and transactions. You can invite a partner later from Settings.</p>
    <div className="field"><label>Household name</label><input className="inp" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Thomas household" /></div>
    <Btn primary block disabled={busy} onClick={async () => { setBusy(true); setErr(''); try { await createHousehold(name || 'My household') } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }}>Create household</Btn>
    {err && <div className="msg crit">{err}</div>}
    <div className="links"><button onClick={() => signOut()}>Sign out</button></div>
  </div></div>
}
