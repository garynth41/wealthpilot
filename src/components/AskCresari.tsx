// Ask Cresari (0.32.0): the advisor. A money question, answered from the household's own numbers.
//   - What is sent is built on this device by lib/advisor.ts (a summary: no names, emails or account numbers) and shown in full under
//     "What is sent" before anything leaves. Individual transactions go only when the person switches that on here (saved on this device).
//   - The question goes to the ask-cresari function, which checks access and the daily limit and holds the key for the AI service.
//   - The conversation lives in memory only: it is gone when the app is closed, and nothing about it is stored on the server.
//   - Educational guidance, not licensed financial advice — said on the screen and in the instruction the AI is given.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../app/store'
import { useData } from '../app/hooks'
import { sb } from '../app/supabase'
import { LS } from '../app/config'
import { Btn, MBody, MFoot, MHead, Note, Pill, useModal } from './ui'
import { answerBlocks, boldRuns, buildContext, starters } from '../lib/advisor'
import { MAX_QUESTION, type Turn } from '../../supabase/functions/ask-cresari/core'

export interface AiStatus { allowed: boolean; limit: number; used: number }
const DETAIL_KEY = LS('askDetail'), CONSENT_KEY = LS('askConsent')
/** Agreement to send the summary to the AI service — asked once per account on each device, before the first question (the app stores require it). */
export const askConsented = (userId?: string | null) => { try { return !!userId && localStorage.getItem(CONSENT_KEY) === userId } catch { return false } }
const setAskConsent = (userId: string) => { try { localStorage.setItem(CONSENT_KEY, userId) } catch { /* asked again next time */ } }
export const askDetailOn = () => { try { return localStorage.getItem(DETAIL_KEY) === '1' } catch { return false } }
export const setAskDetail = (on: boolean) => { try { if (on) localStorage.setItem(DETAIL_KEY, '1'); else localStorage.removeItem(DETAIL_KEY) } catch { /* private mode: off */ } }

// the conversation: kept while the app is open (closing the panel does not lose it), never saved
let turns: Turn[] = []; let turnsFor: string | null = null
// which conversation is on screen: an answer that comes back for an earlier one (started over, signed out) is dropped
let epoch = 0
/** Signing out or changing household starts a new conversation. */
export const resetAsk = () => { turns = []; turnsFor = null; epoch++ }

/** Is the advisor open to this account? Asked once per sign-in; the server checks again on every question. */
export function useAiStatus() {
  const { mode, user } = useStore(); const ai = useStore(s => s.ai)
  useEffect(() => {
    if (mode !== 'db' || !user) { useStore.setState({ ai: null }); resetAsk(); return }
    let on = true
    Promise.resolve(sb().rpc('ai_status')).then(r => { if (on) useStore.setState({ ai: r.data && typeof r.data === 'object' ? r.data as AiStatus : null }) }).catch(() => { if (on) useStore.setState({ ai: null }) })
    return () => { on = false }
  }, [mode, user?.id])   // eslint-disable-line react-hooks/exhaustive-deps
  return ai
}
/** The button shows in the offline demo (to explain the feature) and for accounts the advisor is open to. */
export const askVisible = (mode: string | null, ai: AiStatus | null) => mode === 'demo' || (mode === 'db' && !!ai?.allowed)

export function AskButton({ variant = 'btn' }: { variant?: 'btn' | 'icon' }) {
  const { open } = useModal(); const go = () => open(<AskCresari />, { wide: true })
  if (variant === 'icon') return <button type="button" onClick={go} aria-label="Ask Cresari" title="Ask Cresari" data-testid="ask-icon">✦</button>
  return <button type="button" className="btn askbtn" onClick={go} title="Ask a question about your money" style={{ padding: '6px 10px' }} data-testid="ask-btn"><span aria-hidden="true">✦ </span>Ask</button>
}

async function ask(body: Record<string, unknown>): Promise<{ answer: string; limit: number; used: number }> {
  const { data, error } = await sb().functions.invoke('ask-cresari', { body })
  if (error) {
    let msg = 'Ask Cresari could not be reached — check your connection and try again'; let extra: Partial<AiStatus> = {}
    try { const ctx = (error as { context?: Response }).context; if (ctx && typeof ctx.json === 'function') { const j = await ctx.json(); if (j?.error) msg = String(j.error); if (typeof j?.limit === 'number') extra = { limit: j.limit, used: j.used } } } catch { /* keep the message */ }
    throw Object.assign(new Error(msg), extra)
  }
  return data as { answer: string; limit: number; used: number }
}

function Answer({ text }: { text: string }) {
  const line = (s: string) => boldRuns(s).map((r, i) => r.bold ? <b key={i}>{r.text}</b> : <span key={i}>{r.text}</span>)
  return <>{answerBlocks(text).map((b, i) => b.kind === 'p' ? <p key={i}>{line(b.text)}</p> : b.kind === 'h' ? <p key={i}><b>{b.text}</b></p>
    : b.kind === 'ul' ? <ul key={i}>{b.items.map((x, k) => <li key={k}>{line(x)}</li>)}</ul> : b.kind === 'ol' ? <ol key={i}>{b.items.map((x, k) => <li key={k}>{line(x)}</li>)}</ol> : null)}</>
}

export function AskCresari() {
  const { data, settings } = useData(); const { mode, user, household } = useStore(); const ai = useStore(s => s.ai); const { close } = useModal()
  const key = `${user?.id || 'demo'}:${household?.id || ''}`; if (turnsFor !== key) { turns = []; turnsFor = key; epoch++ }
  const [, bump] = useState(0); const [wiped, setWiped] = useState(false); const [q, setQ] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const [agreed, setAgreed] = useState(askConsented(user?.id)); const [detail, setDetail] = useState(askDetailOn()); const [showSent, setShowSent] = useState(false); const endRef = useRef<HTMLDivElement>(null); const boxRef = useRef<HTMLTextAreaElement>(null)
  const names = useMemo(() => [user?.email || '', String((user?.user_metadata as { full_name?: string; name?: string } | undefined)?.full_name || (user?.user_metadata as { name?: string } | undefined)?.name || ''), household?.name || '', ...data.members.flatMap(m => [m.display_name || '', m.email || ''])], [user, household, data.members])
  const context = useMemo(() => buildContext(data, settings, { detail, names }), [data, settings, detail, names])
  const sent = useMemo(() => JSON.stringify(context), [context]); const ideas = useMemo(() => starters(data, settings), [data, settings])
  const live = mode === 'db' && !!ai?.allowed; const left = ai ? Math.max(0, ai.limit - ai.used) : 0
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }) }, [busy, turns.length])   // eslint-disable-line react-hooks/exhaustive-deps
  const send = (text: string) => {
    const question = text.trim(); if (!question || busy || !live || !agreed || !household) return
    if (!navigator.onLine) { setErr('You are offline — Ask Cresari needs a connection'); return }
    const history = turns.slice(); const mine = epoch; turns = [...turns, { role: 'user', content: question }]; setQ(''); setErr(null); setBusy(true); bump(n => n + 1)
    ask({ household_id: household.id, question, context: sent, history, detail })
      // the count is the server's, so it is always taken; the answer only if this is still the conversation it was asked in
      .then(r => { useStore.setState({ ai: { allowed: true, limit: r.limit, used: r.used } }); if (mine === epoch) turns = [...turns, { role: 'assistant', content: r.answer }] })
      .catch((e: Error & Partial<AiStatus>) => { if (typeof e.limit === 'number' && ai) useStore.setState({ ai: { ...ai, limit: e.limit, used: e.used ?? ai.used } }); if (mine !== epoch) return; turns = turns.slice(0, -1); setQ(question); setErr(e.message) })
      .finally(() => { setBusy(false); bump(n => n + 1); setTimeout(() => boxRef.current?.focus(), 50) })
  }
  // switching transactions off also starts the conversation over: earlier answers may quote them, and they would be sent along as history
  const flip = (on: boolean) => { setDetail(on); setAskDetail(on); if (!on && turns.length) { turns = []; epoch++; setErr(null); setWiped(true) } else setWiped(false) }
  return <>
    <MHead title="Ask Cresari" />
    <MBody>
      <Note><b>General guidance to help you think it through — not licensed financial, investment, tax or legal advice.</b> Answers come from an AI reading a summary of your household's numbers; it can be wrong, so check anything important before you act on it.</Note>
      {mode === 'demo' && <div className="ask-off"><Pill cls="info">In testing</Pill> Ask Cresari answers questions about your own household's money — where it goes, which debt to pay first, whether you are saving enough. It works on a signed-in account and is being tested with a small group for now. Below is exactly what it would be sent from this sample household.</div>}
      {mode === 'db' && !live && <div className="ask-off"><Pill cls="info">In testing</Pill> Ask Cresari is being tested with a small group for now.</div>}
      {live && !agreed && <div className="ask-off" data-ask="consent"><b>Before you ask</b><p style={{ margin: '6px 0' }}>Ask Cresari uses an AI service — <b>Claude, made by Anthropic</b> — to write its answers. When you ask a question, the app sends Anthropic your question and a summary of your household's money (described below; you can see all of it). Cresari does not add anyone's name, email addresses, account names or numbers, or bank names to it — but your question is sent as you type it, so leave those out. Anthropic does not use it to train its models, and Cresari does not keep your questions or the answers.</p><Btn primary onClick={() => { if (user?.id) setAskConsent(user.id); setAgreed(true) }}>I agree — let me ask</Btn></div>}
      {live && agreed && <div className="ask-log" role="log" aria-live="polite" aria-label="Conversation">
        {turns.length === 0 && <div className="ask-start"><div className="ask-hi">What would you like to know about your money?</div><div className="ask-ideas">{ideas.map(x => <button key={x} type="button" className="chipbtn" onClick={() => send(x)} disabled={busy || left <= 0}>{x}</button>)}</div></div>}
        {turns.map((t, i) => t.role === 'user' ? <div key={i} className="ask-q"><span>{t.content}</span></div> : <div key={i} className="ask-a" data-ask="answer"><Answer text={t.content} /></div>)}
        {busy && <div className="ask-a ask-wait" aria-label="Thinking">Thinking<span className="ask-dots" aria-hidden="true">…</span></div>}
        <div ref={endRef} />
      </div>}
      {err && <div className="ask-err" role="alert">{err}</div>}
      {live && agreed && <form className="ask-form" onSubmit={e => { e.preventDefault(); send(q) }}>
        <textarea ref={boxRef} className="inp" rows={2} value={q} maxLength={MAX_QUESTION} placeholder={left > 0 ? 'Ask about your budget, spending, debt, savings, goals or retirement…' : 'That is today\'s questions used — more tomorrow'} aria-label="Your question" disabled={busy || left <= 0}
          onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(q) } }} />
        <Btn primary type="submit" disabled={busy || !q.trim() || left <= 0}>{busy ? 'Asking…' : 'Ask'}</Btn>
      </form>}
      {live && agreed && ai && <div className="ask-meta"><span data-ask="left">{left} of {ai.limit} questions left today</span>{turns.length > 0 && <button type="button" className="linkbtn" disabled={busy} onClick={() => { turns = []; epoch++; setErr(null); bump(n => n + 1) }}>Start a new conversation</button>}</div>}
      <div className="ask-sent">
        <label className="gm-ign" style={{ fontSize: 13, display: 'block' }}><input type="checkbox" checked={detail} disabled={busy} onChange={e => flip(e.target.checked)} data-ask="detail" /> Include my recent transactions (dates, amounts, categories, and the names of well-known businesses) for more specific answers</label>
        <Note>Sent to the AI service (Claude, by Anthropic) with each question: a summary of your household's money — monthly totals, spending by category, your budget, balances by account type, bills, goals{detail ? ', and your last 90 days of transactions' : ''}. {wiped ? <b>The conversation was started over, so nothing from your transactions is sent again. </b> : null}<b>Cresari never adds:</b> anyone's name, email addresses, account names or numbers, bank names, notes or attachments. <b>Your question is sent as you type it</b>, so leave names and account details out of it. The conversation is not saved. <button type="button" className="linkbtn" aria-expanded={showSent} onClick={() => setShowSent(v => !v)} data-ask="show">{showSent ? 'Hide what is sent' : 'See exactly what is sent'}</button></Note>
        {showSent && <pre className="ask-pre" data-ask="sent" tabIndex={0} aria-label="What is sent with a question">{JSON.stringify(context, null, 1)}</pre>}
      </div>
    </MBody>
    <MFoot><Btn primary onClick={close}>Done</Btn></MFoot>
  </>
}
