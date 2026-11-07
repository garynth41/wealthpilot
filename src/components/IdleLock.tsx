// Idle lock (0.20.0): after N minutes without a tap, click or key press the app hides every figure behind a lock screen; unlock with the
// password (plus the authenticator code when two-factor is on) or a passkey — in the phone apps (0.25.1) with Face ID, Touch ID or the
// fingerprint instead, offered as soon as the lock appears (the password still works). The setting is per device — a shared computer can lock after
// 5 minutes while your own phone stays open — and the lock survives a reload, so closing and reopening the tab does not get around it.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useStore } from '../app/store'
import { LS } from '../app/config'
import { Btn, PasswordInput, useModal } from './ui'
import { Logo } from './Logo'
import { passkeysAvailable, biometryAvailable, verifyBiometry } from '../app/native'

export const IDLE_CHOICES: Array<[number, string]> = [[0, 'Never'], [5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [240, '4 hours']]
const read = (k: string) => { try { return localStorage.getItem(LS(k)) } catch { return null } }
const write = (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(LS(k)); else localStorage.setItem(LS(k), v) } catch { /* private mode */ } }
/** Minutes of inactivity before the lock on this device; the offline demo defaults to never, a signed-in household to 15. */
export function idleMinutes(mode: 'db' | 'demo' | null): number { const v = read('idleLock'); if (v != null && v !== '' && isFinite(+v)) return Math.max(0, +v); return mode === 'demo' ? 0 : 15 }
export function setIdleMinutes(n: number) { write('idleLock', String(n)); window.dispatchEvent(new Event('wp-idle-changed')) }
export const lockNow = () => window.dispatchEvent(new Event('wp-lock'))

export function IdleLock({ children }: { children: ReactNode }) {
  const mode = useStore(s => s.mode); const { closeAll: close } = useModal()   // locking closes every open dialog
  const [mins, setMins] = useState(() => idleMinutes(mode))
  const last = useRef<number>(Date.now())
  const [locked, setLocked] = useState(() => { if (read('locked') === '1') return true; const m = idleMinutes(mode); const la = +(read('lastActive') || 0); return m > 0 && la > 0 && Date.now() - la > m * 60000 })
  const lock = () => { write('locked', '1'); setLocked(true); close() }
  useEffect(() => { if (locked) { write('locked', '1'); close() } }, [locked, close])
  useEffect(() => {
    let lastWrite = 0
    const touch = () => { const n = Date.now(); last.current = n; if (n - lastWrite > 10000) { lastWrite = n; write('lastActive', String(n)) } }
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const
    let moveAt = 0; const move = () => { const n = Date.now(); if (n - moveAt > 5000) { moveAt = n; touch() } }
    evs.forEach(e => window.addEventListener(e, touch, { passive: true })); window.addEventListener('mousemove', move, { passive: true })
    const check = () => { if (locked || mins <= 0) return; const shared = +(read('lastActive') || 0); const idle = Date.now() - Math.max(last.current, shared); if (idle > mins * 60000) lock() }
    const iv = window.setInterval(check, 15000); const vis = () => { if (document.visibilityState === 'visible') check() }
    const onLock = () => lock(); const onChange = () => setMins(idleMinutes(mode))
    const onStorage = (e: StorageEvent) => { if (e.key === LS('locked')) setLocked(e.newValue === '1'); if (e.key === LS('idleLock')) onChange() }   // other tabs lock and unlock together
    document.addEventListener('visibilitychange', vis); window.addEventListener('wp-lock', onLock); window.addEventListener('wp-idle-changed', onChange); window.addEventListener('storage', onStorage)
    touch()
    return () => { evs.forEach(e => window.removeEventListener(e, touch)); window.removeEventListener('mousemove', move); window.clearInterval(iv); document.removeEventListener('visibilitychange', vis); window.removeEventListener('wp-lock', onLock); window.removeEventListener('wp-idle-changed', onChange); window.removeEventListener('storage', onStorage) }
  }, [mins, locked, mode])   // eslint-disable-line react-hooks/exhaustive-deps
  const unlock = () => { write('locked', null); write('lastActive', String(Date.now())); last.current = Date.now(); setLocked(false) }
  if (!locked) return <>{children}</>
  return <LockScreen onUnlock={unlock} minutes={mins} />
}

function LockScreen({ onUnlock, minutes }: { onUnlock: () => void; minutes: number }) {
  const { user, mode, signIn, verifyMfa, verifyRecoveryCode, signInWithPasskey, signOut, exitDemo } = useStore()
  const [pw, setPw] = useState(''); const [code, setCode] = useState(''); const [step, setStep] = useState<'pw' | 'code' | 'recovery'>('pw'); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const email = user?.email || ''
  const [bio, setBio] = useState<{ ok: boolean; label: string }>({ ok: false, label: '' })
  const tryBio = async (label: string) => { if (await verifyBiometry(`Unlock with ${label}`)) onUnlock() }
  useEffect(() => { let live = true; if (mode === 'db') biometryAvailable().then(b => { if (!live) return; setBio(b); if (b.ok) void tryBio(b.label) }); return () => { live = false } }, [mode])   // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }
  const submit = (e: FormEvent) => { e.preventDefault()
    if (step === 'pw') run(async () => { await signIn(email, pw); setPw(''); if (useStore.getState().mfaPending) { setStep('code'); return } onUnlock() })
    else run(async () => { await (step === 'recovery' ? verifyRecoveryCode(code) : verifyMfa(code)); onUnlock() }) }
  const passkey = () => run(async () => { const before = user?.id; await signInWithPasskey(); const after = useStore.getState().user?.id; if (before && after !== before) { await signOut(); throw new Error('That passkey belongs to a different account — signed out.') } onUnlock() })
  return <div className="lockscreen" role="dialog" aria-modal="true" aria-labelledby="lock-h"><div className="box">
    <div className="brand" style={{ padding: 0, color: 'var(--ink)' }}><span className="mark"><Logo /></span><div><b style={{ fontSize: 16 }}>WealthPilot</b><small style={{ color: 'var(--ink-3)' }}>{email || 'offline demo'}</small></div></div>
    <h2 id="lock-h">Locked</h2>
    <p className="note">{minutes ? `Locked after ${minutes} minutes without activity, so nobody else can read your figures.` : 'Locked.'} {mode === 'demo' ? 'The offline demo has no password.' : 'Unlock to carry on where you were.'}</p>
    {mode === 'demo' ? <Btn primary block onClick={onUnlock}>Unlock</Btn> : <form onSubmit={submit}>
      {step === 'pw' ? <div className="field"><label htmlFor="lock-pw">Password</label><PasswordInput id="lock-pw" autoComplete="current-password" required autoFocus value={pw} onChange={e => setPw(e.target.value)} /></div>
        : <div className="field"><label htmlFor="lock-code">{step === 'recovery' ? 'A recovery code' : '6-digit code from your authenticator app'}</label><input id="lock-code" className="inp" inputMode={step === 'recovery' ? 'text' : 'numeric'} autoComplete="one-time-code" required autoFocus value={code} onChange={e => setCode(e.target.value)} /></div>}
      <Btn type="submit" primary block disabled={busy}>{step === 'pw' ? 'Unlock' : 'Verify'}</Btn>
      {step === 'pw' && bio.ok && <div style={{ marginTop: 8 }}><Btn block disabled={busy} onClick={() => void tryBio(bio.label)}>Unlock with {bio.label}</Btn></div>}
      {step === 'pw' && passkeysAvailable() && <div style={{ marginTop: 8 }}><Btn block disabled={busy} onClick={passkey}><span aria-hidden>🔑</span> Unlock with a passkey</Btn></div>}
      {err && <div className="msg crit" role="alert">{err}</div>}
      <div className="links">{step !== 'pw' && <button type="button" onClick={() => { setStep(step === 'code' ? 'recovery' : 'code'); setCode('') }}>{step === 'code' ? 'Use a recovery code' : 'Use the authenticator app'}</button>}<button type="button" onClick={() => { write('locked', null); signOut() }}>Sign out instead</button></div>
    </form>}
    {mode === 'demo' && <div className="links"><button type="button" onClick={() => { write('locked', null); exitDemo() }}>Leave the demo</button></div>}
  </div></div>
}
