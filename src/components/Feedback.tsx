// The Feedback button and its dialog (0.29.0): on every screen (top bar, phone bar and menu) and on the public Try page. Sends through
// submit_feedback() (lib/feedback.ts says what goes with a note). Works in the offline demo too — it is the one thing the demo sends.
// A draft is kept on this device until it is sent; a signed-in tester also sees what became of their earlier notes.
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../app/store'
import { sb, hasSupabase } from '../app/supabase'
import { APP_VERSION } from '../app/config'
import { platform } from '../app/native'
import { KINDS, feedbackArgs, feedbackProblem, contextLine, deviceName, platformName, kindLabel, statusForTester, whenSent, type FeedbackContext, type FeedbackKind } from '../lib/feedback'
import { testerCode } from '../lib/invite'
import { isInstalled } from '../lib/install'
import { Btn, MBody, MFoot, MHead, useModal } from './ui'

const DRAFT = 'cresari.feedback.draft'
type Draft = { kind: FeedbackKind; message: string; rating: number | null }
const loadDraft = (): Draft | null => { try { const d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); return d && typeof d.message === 'string' ? d : null } catch { return null } }
const saveDraft = (d: Draft | null) => { try { if (d && d.message.trim()) localStorage.setItem(DRAFT, JSON.stringify(d)); else localStorage.removeItem(DRAFT) } catch { /* private mode */ } }

/** Where the note is being written from: the page (the hash route), version, platform, device, window size, look, demo or not. */
export function currentContext(demo: boolean): FeedbackContext {
  const page = (location.hash.replace(/^#/, '').split('?')[0] || '/').slice(0, 200)
  const root = document.documentElement
  return { page, app_version: APP_VERSION, platform: platformName(platform(), isInstalled()), device: deviceName(navigator.userAgent),
    screen: `${window.innerWidth}×${window.innerHeight}`, look: [root.dataset.style, root.dataset.theme].filter(Boolean).join(' '), demo }
}

/** The button: `variant` picks how it looks where it sits. */
export function FeedbackButton({ variant = 'btn', pageTitle = '' }: { variant?: 'btn' | 'icon' | 'nav'; pageTitle?: string }) {
  const { open } = useModal()
  const go = () => open(<FeedbackDialog pageTitle={pageTitle} />, { wide: true })
  if (variant === 'icon') return <button type="button" onClick={go} aria-label="Send feedback" title="Send feedback" data-testid="feedback-icon">✉</button>
  if (variant === 'nav') return <button type="button" className="fb-nav" onClick={go} data-testid="feedback-nav"><span aria-hidden="true">✉</span><span className="t">Send feedback</span></button>
  return <button type="button" className="btn fbbtn" onClick={go} title="Tell us what broke, what confused you, or what you would like" style={{ padding: '6px 10px' }} data-testid="feedback-btn"><span aria-hidden="true">✉ </span>Feedback</button>
}

export function FeedbackDialog({ pageTitle = '' }: { pageTitle?: string }) {
  const { close } = useModal(); const { mode, user } = useStore()
  const d0 = useMemo(loadDraft, [])
  const [kind, setKind] = useState<FeedbackKind>(d0?.kind || 'bug'); const [message, setMessage] = useState(d0?.message || ''); const [rating, setRating] = useState<number | null>(d0?.rating ?? null)
  const [email, setEmail] = useState(user?.email || ''); const [withCtx, setWithCtx] = useState(true)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [sent, setSent] = useState(false)
  const ctx = useMemo(() => currentContext(mode === 'demo'), [mode])
  useEffect(() => { saveDraft({ kind, message, rating }) }, [kind, message, rating])
  const hint = KINDS.find(k => k[0] === kind)?.[2] || ''
  const send = async () => {
    const p = feedbackProblem(kind, message, rating, email); if (p) { setErr(p); return }
    if (!hasSupabase()) { setErr('Feedback cannot be sent from this copy of the app.'); return }
    setBusy(true); setErr(null)
    try {
      const { error } = await sb().rpc('submit_feedback', feedbackArgs(kind, message, rating, email, testerCode(), withCtx ? ctx : null))
      if (error) throw new Error(/fetch|network|Failed/i.test(error.message) ? 'Could not reach Cresari — check your connection. Your note is kept here.' : error.message)
      saveDraft(null); setSent(true)
    } catch (e) { setErr(/fetch|network|Failed/i.test((e as Error).message) ? 'Could not reach Cresari — check your connection. Your note is kept here.' : (e as Error).message) }
    finally { setBusy(false) }
  }
  if (sent) return <><MHead title="Thank you!" /><MBody>
    <p style={{ marginTop: 0 }}>Your note is on its way to the person building Cresari. {email.trim() ? 'If there is a question, the reply comes to ' + email.trim() + '.' : 'Leave an email address next time if you would like a reply.'}</p>
    {mode === 'db' && user && <MyFeedback userId={user.id} />}
  </MBody><MFoot><Btn onClick={() => { setSent(false); setMessage(''); setRating(null) }}>Send another</Btn><Btn primary autoFocusHere onClick={close}>Done</Btn></MFoot></>
  return <><MHead title="Send feedback" /><MBody>
    <p className="note" style={{ marginTop: 0 }}>Tell us what broke, what confused you, or what you would like. A sentence is plenty — it goes straight to the person building Cresari.</p>
    <fieldset className="fb-kinds"><legend>What kind of note?</legend>{KINDS.map(([k, l]) => <label key={k} className={kind === k ? 'on' : ''}><input type="radio" name="fb-kind" value={k} checked={kind === k} onChange={() => setKind(k)} disabled={busy} />{l}</label>)}</fieldset>
    <div className="field"><label htmlFor="fb-msg">Your note</label><textarea id="fb-msg" className="inp" rows={6} maxLength={4000} value={message} onChange={e => { setMessage(e.target.value); setErr(null) }} placeholder={hint} autoFocus readOnly={busy} /><div className="note" style={{ textAlign: 'right', margin: '2px 0 0' }}>{message.trim().length} / 4,000</div></div>
    <fieldset className="fb-stars"><legend>How is Cresari working for you so far? <span className="note" style={{ display: 'inline' }}>(optional)</span></legend>
      {[1, 2, 3, 4, 5].map(n => <button key={n} type="button" className={rating != null && n <= rating ? 'on' : ''} aria-pressed={rating === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => setRating(rating === n ? null : n)} disabled={busy}>★</button>)}
      {rating != null && <span className="note" style={{ display: 'inline', marginLeft: 8 }}>{['', 'Not working for me', 'Needs work', 'OK', 'Good', 'Love it'][rating]}</span>}</fieldset>
    <div className="field"><label htmlFor="fb-mail">Your email, for a reply <span className="note" style={{ display: 'inline' }}>(optional)</span></label><input id="fb-mail" className="inp" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} readOnly={busy} placeholder="you@example.com" /></div>
    <label className="fb-ctx"><input type="checkbox" checked={withCtx} onChange={e => setWithCtx(e.target.checked)} disabled={busy} /> Include the page and device it came from<span className="note" style={{ display: 'block', margin: '2px 0 0 22px' }}>{withCtx ? contextLine(ctx, pageTitle) : 'Only what you typed will be sent.'} · never any of your money data</span></label>
    {err && <div className="msg crit" role="alert">{err}</div>}
    {mode === 'db' && user && <MyFeedback userId={user.id} collapsed />}
  </MBody><MFoot><Btn onClick={close}>Cancel</Btn><Btn primary disabled={busy} onClick={() => void send()}>{busy ? 'Sending…' : 'Send feedback'}</Btn></MFoot></>
}

/** A signed-in tester's earlier notes and what became of each. */
function MyFeedback({ userId, collapsed }: { userId: string; collapsed?: boolean }) {
  const [rows, setRows] = useState<Array<{ id: string; created_at: string; kind: string; message: string; status: string }> | null>(null)
  const [failed, setFailed] = useState(false); const [tries, setTries] = useState(0)
  useEffect(() => { let on = true; setFailed(false); void sb().from('feedback').select('id, created_at, kind, message, status').eq('user_id', userId).order('created_at', { ascending: false }).limit(20)
    .then(({ data, error }) => { if (!on) return; if (error) setFailed(true); else setRows(data || []) }, () => { if (on) setFailed(true) }); return () => { on = false } }, [userId, tries])
  if (failed) return <p className="note" role="status" style={{ marginBottom: 0 }}>Your earlier feedback could not be loaded. <button type="button" className="linkbtn" onClick={() => setTries(n => n + 1)}>Try again</button></p>
  if (!rows?.length) return null
  const list = <ul className="fb-mine">{rows.map(r => <li key={r.id}><span className={`pill ${r.status === 'fixed' ? 'good' : r.status === 'planned' ? 'info' : r.status === 'new' ? '' : 'warn'}`}>{statusForTester(r.status)}</span> <b>{kindLabel(r.kind)}</b> · {whenSent(r.created_at, false)} — {r.message.length > 90 ? r.message.slice(0, 87) + '…' : r.message}</li>)}</ul>
  return collapsed ? <details className="fb-earlier"><summary>Your earlier feedback ({rows.length})</summary>{list}</details> : <div style={{ marginTop: 12 }}><div className="note">Your feedback so far</div>{list}</div>
}
