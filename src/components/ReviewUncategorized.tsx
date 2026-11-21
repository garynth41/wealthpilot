// Review uncategorized (0.31.0): every transaction without a category, gathered by merchant, with the app's best answer on each.
// Accept one, accept every confident one at once, or pick another category — each choice files the merchant's transactions and
// (unless rule learning is off) teaches a rule, so the same merchant never needs asking twice. The grouping and the answers come
// from lib/categorize.ts; the built-in merchant list is lib/merchants.ts and runs on the device.
// 0.34.0: "Ask AI" for the merchants the app could not place. It runs only on a press, after a notice that lists exactly what is sent
// (lib/aiCategorize.ts): the descriptions — payments to people included — with amounts, and the category names. The reply only fills in
// suggestions, marked as the AI's; nothing is filed until the person accepts.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useData } from '../app/hooks'
import { useStore } from '../app/store'
import { Btn, MBody, MFoot, MHead, Note, Pill, Seg, useModal } from './ui'
import { acceptPlan, coverage, reasonFor, reviewGroups, type ReviewGroup } from '../lib/categorize'
import { fm2, fmtMoney } from '../lib/money'
import { fmtD } from '../lib/dates'
import { sb } from '../app/supabase'
import { nameScrubber } from '../lib/advisor'
import { aiApply, aiBatch, aiCandidates, type AiBatch, type AiSuggestion } from '../lib/aiCategorize'

type Show = 'all' | 'sure' | 'likely' | 'none'
/** One acceptance at a time across the whole app, also when the screen is closed and reopened while a save is still on its way. */
let accepting = false
const SHOWN = 60

export function ReviewUncategorized() {
  const { data, settings, catOpts, catLabels, cat, acctName, canEdit, guarded, saveSettings } = useData(); const { close } = useModal(); const { mode, user, household } = useStore(); const aiStatus = useStore(s => s.ai)
  const groups = useMemo(() => reviewGroups(data, settings), [data, settings]); const cov = useMemo(() => coverage(data), [data])
  const [pick, setPick] = useState<Record<string, string>>({}); const [openId, setOpenId] = useState<string | null>(null); const [show, setShow] = useState<Show>('all'); const [busy, setBusy] = useState(false)
  // the screen belongs to the ledger: following a link to another page closes it rather than leaving it over that page
  useEffect(() => { const on = () => { if (!location.hash.startsWith('#/transactions')) close() }; window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on) }, [close])
  // the AI's suggestions for this visit: kept in memory only, and dropped for a category that has since been archived or removed
  const [ai, setAi] = useState<Record<string, AiSuggestion>>({}); const [aiAsk, setAiAsk] = useState<AiBatch | null>(null); const [aiBusy, setAiBusy] = useState(false); const [aiMsg, setAiMsg] = useState<string | null>(null); const [asked, setAsked] = useState<Set<string>>(new Set()); const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const aiFor = (g: ReviewGroup) => { const a = !g.category_id ? ai[g.id] : undefined; return a && data.categories.some(c => c.id === a.category_id && !c.archived && c.kind === g.kind) ? a : undefined }
  const chosen = (g: ReviewGroup) => (g.id in pick ? pick[g.id] : g.category_id || aiFor(g)?.category_id || '')
  const sure = groups.filter(g => g.confidence === 'high' && g.category_id), likely = groups.filter(g => g.confidence === 'medium' && g.category_id), none = groups.filter(g => !g.category_id)
  const list = show === 'sure' ? sure : show === 'likely' ? likely : show === 'none' ? none : groups
  const learn = settings.learnRules !== false
  const file = (gs: ReviewGroup[], done: (n: number, learned: number) => string) => {
    const ready = gs.map(g => ({ ...g, category_id: chosen(g) })).filter(g => g.category_id); if (!ready.length || busy || accepting) return
    // one acceptance at a time (two would each save rules from the same starting list and one would be lost), and the rules first:
    // if that save fails nothing has been filed, so the group is still here to try again
    setBusy(true); accepting = true; const free = () => { accepting = false; setBusy(false) }
    // freed here as well as inside: when the app is too busy to start the write at all, the callback never runs
    void Promise.resolve(guarded(async () => { try { const plan = acceptPlan(ready, useStore.getState().settings().rules || [], learn); if (plan.learned) await saveSettings({ rules: plan.rules }); for (const b of plan.byCat) await useStore.getState().bulkUpdate('transactions', b.ids, { category_id: b.category_id }); setPick({}) } finally { free() } }, done(ready.reduce((k, g) => k + g.txns.length, 0), learn ? ready.filter(g => g.key !== 'unknown').length : 0))).finally(free)
  }
  const n = (k: number, w = 'transaction') => `${k} ${w}${k === 1 ? '' : 's'}`
  const acceptOne = (g: ReviewGroup) => file([g], k => `${n(k)} filed under ${cat(chosen(g))?.name || 'the category'}${learn && g.key !== 'unknown' ? ' · remembered for next time' : ''}`)
  const acceptSure = () => file(sure, (k, r) => `${n(k)} categorized${r ? ` · ${n(r, 'rule')} learned` : ''}`)
  const sureCount = sure.reduce((k, g) => k + g.txns.length, 0)
  const opts = (kind: 'expense' | 'income') => catOpts([kind])
  // ---- Ask AI ----
  // a merchant the AI has already been asked about on this visit is not offered again: the answer would be the same, and it would cost a question
  const candidates = aiCandidates(groups).filter(g => !aiFor(g) && !asked.has(g.id)); const aiLive = mode === 'db' && !!aiStatus?.allowed; const aiLeft = aiStatus ? Math.max(0, aiStatus.limit - aiStatus.used) : 0
  const aiPicked = groups.filter(g => !(g.id in pick) && aiFor(g))
  const prepareAi = () => {
    const clean = nameScrubber([user?.email || '', String((user?.user_metadata as { full_name?: string; name?: string } | undefined)?.full_name || (user?.user_metadata as { name?: string } | undefined)?.name || ''), ...data.members.flatMap(m => [m.display_name || '', m.email || ''])], [household?.name || ''])
    setAiMsg(null); setAiAsk(aiBatch(candidates, catOpts(['expense', 'income']).filter(c => !c.archived).map(c => ({ id: c.id, label: catLabels[c.id] || c.name, kind: c.kind })), clean))
  }
  const sendAi = async () => {
    const batch = aiAsk; if (!batch || aiBusy || !household || !aiLive) return
    if (!navigator.onLine) { setAiMsg('You are offline — asking the AI needs a connection'); return }
    setAiBusy(true); setAiMsg(null); const asker = user?.id
    try {
      const { data: r, error } = await sb().functions.invoke('ask-cresari', { body: { household_id: household.id, ...batch.body } })
      if (error) { let msg = 'The AI could not be reached — check your connection and try again'; try { const ctx = (error as { context?: Response }).context; if (ctx && typeof ctx.json === 'function') { const j = await ctx.json(); if (j?.error) msg = String(j.error) } } catch { /* keep the message */ } throw new Error(msg) }
      const got = aiApply((r as { picks?: unknown })?.picks, batch), k = Object.keys(got).length
      if (useStore.getState().user?.id === asker && typeof (r as { limit?: unknown })?.limit === 'number') useStore.setState({ ai: { allowed: true, limit: (r as { limit: number }).limit, used: Number((r as { used?: number }).used) || 0 } })
      if (!alive.current) return
      setAi(a => ({ ...a, ...got })); setAsked(a => new Set([...a, ...batch.groupIds])); setAiAsk(null); if (k) setShow('none')
      setAiMsg(k ? `The AI suggested a category for ${k} of ${batch.groupIds.length} ${batch.groupIds.length === 1 ? 'merchant' : 'merchants'}. Check each one, then accept it or pick another.` : 'The AI could not place any of these — they are yours to pick.')
    } catch (e) { if (alive.current) setAiMsg(e instanceof Error ? e.message : 'The AI could not be reached — try again') } finally { if (alive.current) setAiBusy(false) }
  }
  const acceptAi = () => file(aiPicked, (k, r) => `${n(k)} categorized${r ? ` · ${n(r, 'rule')} learned` : ''}`)
  return <>
    <MHead title="Review uncategorized" />
    <MBody>
      <div className="kpis dd-kpis">
        <div className={`kpi ${cov.uncategorized ? 'warn' : 'good'}`}><div className="l">Uncategorized</div><div className="v" data-ru="left">{cov.uncategorized}</div><div className="s">{cov.uncategorized ? `${fmtMoney(cov.amount)} not on any budget line` : 'everything has a category'}</div></div>
        <div className="kpi info"><div className="l">Categorized</div><div className="v" data-ru="pct">{cov.pct}%</div><div className="s">{cov.categorized} of {cov.total} purchases and deposits</div></div>
        <div className="kpi good"><div className="l">Ready to file</div><div className="v" data-ru="sure">{sureCount}</div><div className="s">{sure.length ? `${n(sure.length, 'merchant')} Cresari is sure of` : 'nothing it is sure of'}</div></div>
      </div>
      {groups.length === 0 ? <div className="empty">Nothing to review — every purchase and deposit has a category.</div> : <>
        <div className="ru-bar">
          {canEdit && sure.length > 0 && <Btn primary disabled={busy} onClick={acceptSure}>Accept all {sureCount} sure ones</Btn>}
          <span role="group" aria-label="Show"><Seg value={show} options={[['all', `All ${groups.length}`], ['sure', `Sure ${sure.length}`], ['likely', `Likely ${likely.length}`], ['none', `Your pick ${none.length}`]]} onChange={setShow} /></span>
        </div>
        <Note>Grouped by merchant, most money first. <b>Sure</b> = one of your rules, how you filed it before, or a merchant Cresari knows. <b>Likely</b> = a good guess that wants your yes. {learn ? 'Each choice is remembered, so new transactions from the same merchant are filed on their own.' : 'Rule learning is off in Settings, so choices here are not remembered.'}</Note>
        {canEdit && (candidates.length > 0 || aiPicked.length > 0 || aiMsg) && <div className="ru-ai" data-ru="ai">
          {mode === 'demo' ? <Note><b>Ask AI</b> — on a signed-in account, one press sends the merchants Cresari could not place ({candidates.length} here) to an AI service for a suggested category. It is being tested with a small group for now.</Note>
            : !aiLive ? null : <>
              {!aiAsk && <div className="ru-bar" style={{ margin: 0 }}>
                {candidates.length > 0 && <Btn disabled={aiBusy || busy || aiLeft <= 0} onClick={prepareAi}><span aria-hidden="true">✦ </span>Ask AI about {candidates.length > 60 ? 'the 60 largest' : `the ${candidates.length}`} Cresari could not place</Btn>}
                {aiPicked.length > 0 && <Btn primary disabled={busy} onClick={acceptAi}>{aiPicked.length === 1 ? 'Accept the AI suggestion' : `Accept all ${aiPicked.length} AI suggestions`}</Btn>}
                {candidates.length > 0 && aiLeft <= 0 && <span className="ru-sub">Today's AI questions are used — more tomorrow.</span>}
              </div>}
              {aiAsk && <div className="ask-off" data-ru="ai-notice">
                <b>Before this is sent</b>
                <p style={{ margin: '6px 0' }}>This sends the list below to an AI service — <b>Claude, made by Anthropic</b> — which suggests a category for each one. <b>Sent:</b> each description as your bank wrote it, whether it was money out or in, the amount, and the names of your categories. <b>Descriptions of payments to people (Zelle, Venmo, checks and the like) are included, so a person's name in one is sent.</b> Email addresses and long numbers are taken out. <b>Not sent:</b> account names and numbers, dates, notes and attachments. Anthropic does not use it to train its models, and Cresari does not keep it. Nothing is filed for you: the suggestions come back for you to accept or change. This uses one of your {aiStatus?.limit} AI questions for today ({aiLeft} left).</p>
                <pre className="ask-pre" tabIndex={0} aria-label="The descriptions that will be sent" data-ru="ai-sent">{aiAsk.body.items.map(i => `${i.kind === 'income' ? 'in ' : 'out'}  ${fm2(i.amount)}  ${i.text}`).join('\n')}</pre>
                {aiAsk.more > 0 && <Note>{aiAsk.more} more will be left for another press.</Note>}
                <div className="ru-bar" style={{ margin: '8px 0 0' }}><Btn primary disabled={aiBusy} onClick={() => void sendAi()}>{aiBusy ? 'Asking…' : `Send these ${aiAsk.body.items.length} and suggest categories`}</Btn><Btn disabled={aiBusy} onClick={() => setAiAsk(null)}>Cancel</Btn></div>
              </div>}
              {aiMsg && <div className="ru-why" role="status" data-ru="ai-msg">{aiMsg}</div>}
            </>}
        </div>}
        <ul className="ru-list">{list.slice(0, SHOWN).map(g => { const c = chosen(g), own = g.id in pick && pick[g.id] !== (g.category_id || ''), o = opts(g.kind), sug = !(g.id in pick) ? aiFor(g) : undefined
          return <li key={g.id} className="ru-item" data-ru-group={g.name}>
            <div className="ru-row">
              <button type="button" className="ru-name" aria-expanded={openId === g.id} onClick={() => setOpenId(openId === g.id ? null : g.id)} title="Show the transactions">
                <b>{g.name}</b><span className="ru-sub">{g.txns.length}× · {g.kind === 'income' ? 'received ' : ''}{fm2(g.total)} · last {fmtD(g.last)}</span></button>
              <div className="ru-pick">
                {!own && g.category_id ? <Pill cls={g.confidence === 'high' ? 'good' : 'info'}>{g.confidence === 'high' ? 'Sure' : 'Likely'}</Pill> : sug ? <Pill cls="info">AI</Pill> : !c ? <Pill cls="warn">Your pick</Pill> : <Pill cls="idle">Your pick</Pill>}
                {canEdit ? <select className="inp" aria-label={`Category for ${g.name}`} value={c} onChange={e => setPick(p => ({ ...p, [g.id]: e.target.value }))}><option value="">— choose a category —</option>{o.map(x => <option key={x.id} value={x.id}>{catLabels[x.id]}</option>)}</select> : <span>{cat(c)?.name || '—'}</span>}
                {canEdit && <Btn sm primary={!!c} disabled={!c || busy} onClick={() => acceptOne(g)} aria-label={`Accept ${cat(c)?.name || 'category'} for ${g.name}`}>Accept</Btn>}
              </div>
            </div>
            {!own && g.category_id ? <div className="ru-why">{reasonFor(g)}</div> : sug ? <div className="ru-why">{sug.sure ? 'suggested by the AI — check it before you accept' : 'the AI\'s best guess — it was not sure'}</div> : null}
            {openId === g.id && <div className="tblwrap ru-tx"><table className="tbl"><tbody>{g.txns.slice(0, 25).map(t => <tr key={t.id}><td style={{ whiteSpace: 'nowrap' }}>{fmtD(t.date)}</td><td>{t.payee || 'No payee'}{t.memo ? <div className="note" style={{ margin: 0 }}>{t.memo.slice(0, 70)}</div> : null}</td><td>{acctName(t.account_id)}</td><td className="num">{fm2(t.amount)}</td></tr>)}</tbody></table>{g.txns.length > 25 && <Note>and {g.txns.length - 25} more</Note>}</div>}
          </li> })}</ul>
        {list.length > SHOWN && <Note>Showing the {SHOWN} largest of {list.length} — the rest appear as these are filed.</Note>}
        {list.length === 0 && <div className="empty">Nothing in this group.</div>}
      </>}
    </MBody>
    <MFoot><Btn onClick={() => { location.hash = '#/transactions?kind=uncat'; close() }}>Open in the ledger</Btn><Btn primary onClick={close}>Done</Btn></MFoot>
  </>
}
/** `const review = useReview()` then `review()` opens the screen. */
export function useReview() { const { open } = useModal(); return () => open(<ReviewUncategorized />, { wide: true }) }
