// Feedback & testers (0.29.0) — for whoever runs Cresari (app_admins; the database enforces it, this page only hides itself). Invite
// testers with a link (one code per group, so sign-ups and feedback can be told apart), see how each invite is doing, and work through
// the feedback: mark what is new, seen, planned, fixed, not planned or already reported; add a note; reply by email; turn it into a
// GitHub issue; export it all. New feedback also arrives as a push and an email (the notify function, on production).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../app/store'
import { sb } from '../app/supabase'
import { publicUrl, saveFile } from '../app/native'
import { Btn, Card, KPI, Note, Pill, Seg, useConfirm } from '../components/ui'
import { STATUSES, KINDS, feedbackCsv, feedbackSummary, issueLink, kindLabel, replyLink, statusLabel, whenSent, type Feedback, type FeedbackStatus } from '../lib/feedback'
import { cleanCode, inviteLink, inviteMessage, mailtoLink, smsLink } from '../lib/invite'

const REPO = 'garynth41/wealthpilot'
type Stat = { tester: string; signed_up: number; active_7d: number; households: number; feedback: number }
type View = 'open' | 'new' | 'all' | 'closed'
const OPEN = ['new', 'seen', 'planned']

export function FeedbackInboxPage() {
  const { appAdmin, mode, user, toast } = useStore()
  if (mode === 'db' && appAdmin === null) return <div className="grid g12"><Card span={12} title="Feedback & testers"><p className="note" style={{ margin: 0 }} aria-live="polite">Checking that this is your page…</p></Card></div>
  if (mode !== 'db' || !appAdmin) return <div className="grid g12"><Card span={12} title="Feedback & testers">
    <p style={{ marginTop: 0 }}>Only the person who runs Cresari can open this page.</p><Note>To send feedback yourself, use the ✉ Feedback button at the top of any screen.</Note></Card></div>
  return <Inbox userEmail={user?.email || ''} toast={toast} />
}

/** Every note, a page at the time (the server hands back at most 1,000 rows per request), so an old open note is never cut off. Each page
 *  starts after the last note of the one before (its time and id), so a note sent or deleted while this runs cannot skip or repeat one. */
async function loadAll(): Promise<{ rows: Feedback[]; error: string | null }> {
  const PAGE = 1000, rows: Feedback[] = []; let last: Feedback | null = null
  for (;;) {   // no cap: a short page ends it
    const { data, error } = await sb().rpc('feedback_inbox', { p_before: last?.created_at ?? null, p_before_id: last?.id ?? null, p_limit: PAGE })
    if (error) return { rows, error: error.message }
    const page = (data || []) as Feedback[]; rows.push(...page); if (page.length < PAGE) break; last = page[page.length - 1]
  }
  return { rows, error: null }
}

function Inbox({ userEmail, toast }: { userEmail: string; toast: (t: string, err?: boolean) => void }) {
  const [rows, setRows] = useState<Feedback[] | null>(null); const [stats, setStats] = useState<Stat[]>([]); const [err, setErr] = useState<string | null>(null)
  const [statsErr, setStatsErr] = useState<string | null>(null)
  const [view, setView] = useState<View>('open'); const [kind, setKind] = useState(''); const [q, setQ] = useState('')
  const confirm = useConfirm()
  const load = useCallback(async () => {
    const [f, s] = await Promise.all([loadAll(), sb().rpc('tester_stats')])
    if (s.error) setStatsErr(s.error.message); else { setStatsErr(null); setStats((s.data || []) as Stat[]) }
    if (f.error) { setErr(f.error); return } setErr(null); setRows(f.rows)
  }, [])
  useEffect(() => { void load() }, [load])
  const sum = useMemo(() => feedbackSummary(rows || []), [rows])
  const shown = useMemo(() => (rows || []).filter(r => (view === 'all' || (view === 'new' ? r.status === 'new' : view === 'open' ? OPEN.includes(r.status) : !OPEN.includes(r.status)))
    && (!kind || r.kind === kind) && (!q.trim() || [r.message, r.admin_note, r.page, r.device, r.email, r.tester].join(' ').toLowerCase().includes(q.trim().toLowerCase()))), [rows, view, kind, q])
  const patch = async (id: string, p: Partial<Pick<Feedback, 'status' | 'admin_note' | 'issue_url'>>) => {
    const { error } = await sb().from('feedback').update(p).eq('id', id); if (error) { toast(error.message, true); return }
    setRows(rs => (rs || []).map(r => (r.id === id ? { ...r, ...p } : r)))
  }
  const remove = async (f: Feedback) => {
    if (!(await confirm(`Delete this ${kindLabel(f.kind).toLowerCase()} note for good? Use it for spam only — mark real feedback "Won’t do" instead.`))) return
    const { error } = await sb().from('feedback').delete().eq('id', f.id); if (error) { toast(error.message, true); return } setRows(rs => (rs || []).filter(r => r.id !== f.id)); toast('Deleted')
  }
  return <>
    <div className="kpis">
      <KPI l="New" v={rows ? sum.open : '…'} cls={sum.open ? 'warn' : 'good'} s="not looked at yet" />
      <KPI l="This week" v={rows ? sum.week : '…'} cls="info" s={`${sum.total} in all`} />
      <KPI l="Open bugs" v={rows ? sum.bugs : '…'} cls={sum.bugs ? 'crit' : 'good'} s="not fixed or closed" />
      <KPI l="Average rating" v={sum.rating == null ? '—' : `${sum.rating} ★`} cls="info" s={sum.rated ? `from ${sum.rated} rating${sum.rated === 1 ? '' : 's'}` : 'no ratings yet'} />
    </div>
    <div className="grid g12" style={{ marginTop: 16 }}>
      <InviteCard from={userEmail} />
      <Card span={5} title="Testers by invite code" hint="counts only — no names" right={<Btn sm onClick={() => void load()}>Refresh</Btn>}>
        {statsErr ? <div className="msg crit" role="alert">Could not load the numbers: {statsErr}. Press Refresh to try again.</div>
          : stats.length ? <div className="tblwrap"><table className="tbl"><thead><tr><th scope="col">Invite code</th><th scope="col" className="num">Signed up</th><th scope="col" className="num">Active 7 days</th><th scope="col" className="num">Households</th><th scope="col" className="num">Feedback</th></tr></thead>
          <tbody>{stats.map(s => <tr key={s.tester || '-'}><td>{s.tester || <span className="note" style={{ margin: 0 }}>no code</span>}</td><td className="num">{s.signed_up}</td><td className="num">{s.active_7d}</td><td className="num">{s.households}</td><td className="num">{s.feedback}</td></tr>)}</tbody></table></div>
          : <Note>No sign-ups or feedback yet. Share an invite link to start.</Note>}
        <Note>“No code” includes you and anyone who signed up without an invite link.</Note>
      </Card>
      <AdvisorCard toast={toast} />
      <Card span={12} title="Inbox" hint={rows ? `${shown.length} of ${rows.length}` : 'loading…'} right={<><Btn sm onClick={() => void load()}>Refresh</Btn><Btn sm disabled={!rows?.length} onClick={() => void saveFile(`cresari-feedback-${new Date().toISOString().slice(0, 10)}.csv`, feedbackCsv(shown), 'text/csv')}>Export CSV</Btn></>}>
        <div className="btnrow fb-filters"><Seg<View> value={view} onChange={setView} options={[['open', 'Open'], ['new', 'New'], ['closed', 'Closed'], ['all', 'All']]} />
          <select className="inp" aria-label="Kind" value={kind} onChange={e => setKind(e.target.value)} style={{ width: 'auto' }}><option value="">Every kind</option>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input className="inp" type="search" aria-label="Search feedback" placeholder="Search the notes…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 260 }} /></div>
        {err && <div className="msg crit">{err}</div>}
        {rows && !shown.length && <Note>{rows.length ? 'Nothing matches these filters.' : 'No feedback yet. When testers send some, it appears here — and on production you get a push and an email for each one.'}</Note>}
        <ul className="fb-inbox">{shown.map(f => <FeedbackItem key={f.id} f={f} onPatch={p => void patch(f.id, p)} onDelete={() => void remove(f)} />)}</ul>
      </Card>
    </div>
  </>
}

function FeedbackItem({ f, onPatch, onDelete }: { f: Feedback; onPatch: (p: Partial<Pick<Feedback, 'status' | 'admin_note' | 'issue_url'>>) => void; onDelete: () => void }) {
  const [note, setNote] = useState(f.admin_note || ''); useEffect(() => setNote(f.admin_note || ''), [f.admin_note])
  const reply = replyLink(f)
  const cls = f.kind === 'bug' ? 'crit' : f.kind === 'confusing' ? 'warn' : f.kind === 'praise' ? 'good' : 'info'
  return <li className={`fb-item st-${f.status}`} data-testid="fb-item">
    <div className="fb-head"><Pill cls={cls}>{kindLabel(f.kind)}</Pill>{f.rating ? <span className="fb-rating" aria-label={`${f.rating} of 5 stars`}>{'★'.repeat(f.rating)}<span className="dim">{'★'.repeat(5 - f.rating)}</span></span> : null}
      <span className="note" style={{ margin: 0 }}>{whenSent(f.created_at)}</span>
      <span className="fb-from">{f.email ? <a href={reply || undefined}>{f.email}</a> : f.demo ? 'demo visitor' : f.user_id ? 'signed-in tester (no reply address)' : 'visitor'}{f.tester ? <> · invite <b>{f.tester}</b></> : null}</span>
      <select className="inp fb-status" aria-label="Status" value={f.status} onChange={e => onPatch({ status: e.target.value as FeedbackStatus })}>{STATUSES.map(([s, l]) => <option key={s} value={s}>{l}</option>)}</select></div>
    <p className="fb-msg">{f.message}</p>
    <div className="note fb-ctx">{[f.page, f.app_version && 'v' + f.app_version, f.platform, f.device, f.screen, f.look, f.demo && 'offline demo'].filter(Boolean).join(' · ') || 'no page or device details (the tester unticked them)'}</div>
    <div className="fb-actions">
      <input className="inp" aria-label="Your note on this feedback" placeholder="Your note (only you see it)…" value={note} onChange={e => setNote(e.target.value)} onBlur={() => { if (note !== (f.admin_note || '')) onPatch({ admin_note: note.trim() || null }) }} />
      {reply && <a className="btn sm" href={reply}>Reply by email</a>}
      {f.issue_url ? <a className="btn sm" href={f.issue_url} target="_blank" rel="noreferrer">Open issue ↗</a>
        : <a className="btn sm" href={issueLink(REPO, f)} target="_blank" rel="noreferrer" title="Opens GitHub's new-issue form with this note filled in — the repository is public, so check it before saving">Make GitHub issue ↗</a>}
      {!f.issue_url && <Btn sm onClick={() => { const u = prompt('Paste the issue\'s address to link it here', 'https://github.com/' + REPO + '/issues/'); if (u && /^https:\/\//.test(u)) onPatch({ issue_url: u.trim() }) }}>Link issue</Btn>}
      <Btn sm danger onClick={onDelete}>Delete</Btn>
    </div>
    {f.status !== 'new' && <div className="note" style={{ margin: '4px 0 0' }}>Status: {statusLabel(f.status)}{f.user_id ? ' — the tester sees this on their own feedback list' : ''}</div>}
  </li>
}

function InviteCard({ from }: { from: string }) {
  const [code, setCode] = useState('beta'); const c = cleanCode(code)
  const link = inviteLink(publicUrl(), c); const msg = inviteMessage(link, from ? from.split('@')[0] : '')
  const [copied, setCopied] = useState(''); const copy = async (what: string, text: string) => { try { await navigator.clipboard.writeText(text); setCopied(what) } catch { setCopied('') } }
  const share = async () => { try { await navigator.share({ title: msg.subject, text: msg.body.replace(link, '').trim(), url: link }) } catch { /* cancelled */ } }
  return <Card span={7} title="Invite testers" hint="share a link — anyone with it can try the demo or make an account">
    <div className="field"><label htmlFor="inv-code">Invite code <span className="note" style={{ display: 'inline' }}>— one per group, to tell them apart (letters, digits, - and _)</span></label>
      <input id="inv-code" className="inp" value={code} onChange={e => { setCode(e.target.value); setCopied('') }} placeholder="e.g. church, linkedin, family" style={{ maxWidth: 260 }} /></div>
    <div className="field"><label>Link</label><div className="inv-link"><code data-testid="invite-link">{link}</code></div></div>
    <div className="btnrow" style={{ flexWrap: 'wrap' }}>
      <Btn primary onClick={() => void copy('link', link)}>{copied === 'link' ? 'Copied ✓' : 'Copy link'}</Btn>
      <Btn onClick={() => void copy('message', msg.body)}>{copied === 'message' ? 'Copied ✓' : 'Copy message'}</Btn>
      {typeof navigator !== 'undefined' && 'share' in navigator && <Btn onClick={() => void share()}>Share…</Btn>}
      <a className="btn" href={mailtoLink(msg)}>Email</a><a className="btn" href={smsLink(msg.body)}>Text</a>
      <a className="btn" href={link} target="_blank" rel="noreferrer">Preview ↗</a>
    </div>
    <details style={{ marginTop: 10 }}><summary>The message</summary><pre className="inv-msg">{msg.subject}{'\n\n'}{msg.body}</pre></details>
    <Note>Before people you do not know sign up, Cresari has to send its sign-up emails through its own email service — until then only the demo works for them (docs/TESTING.md, step 1).</Note>
  </Card>
}

// ---- Ask Cresari (0.32.0): who may use the advisor, the limits and the model — all changed here, without a release ----
interface AiPerson { user_id: string; email: string; daily_limit: number | null; added_at: string; used_24h: number; used_30d: number }
interface AiOverview { access: 'testers' | 'all' | 'off'; daily_limit: number; global_daily: number; model: string; used_24h: number; used_30d: number; tokens_30d: number; people: AiPerson[] }
function AdvisorCard({ toast }: { toast: (t: string, err?: boolean) => void }) {
  const [o, setO] = useState<AiOverview | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState(''); const [limit, setLimit] = useState(''); const [cfg, setCfg] = useState({ daily: '', global: '', model: '' })
  const load = useCallback(async () => { const r = await sb().rpc('ai_admin_overview'); const x = r?.data as Partial<AiOverview> | null; if (r?.error || !x || typeof x !== 'object' || !Array.isArray(x.people) || typeof x.daily_limit !== 'number') { setErr(r?.error?.message || 'the server did not answer — the advisor may not be set up on it yet'); return } const d = { used_24h: 0, used_30d: 0, tokens_30d: 0, global_daily: 0, model: '', access: 'testers', ...x } as AiOverview; setErr(null); setO(d); setCfg({ daily: String(d.daily_limit), global: String(d.global_daily), model: d.model }) }, [])
  useEffect(() => { void load() }, [load])
  const run = async (what: PromiseLike<{ error: { message: string } | null }>, done: string) => { setBusy(true); try { const r = await what; if (r.error) toast(r.error.message, true); else { toast(done); await load() } } finally { setBusy(false) } }
  const num = (s: string) => (/^\d{1,6}$/.test(s.trim()) ? +s.trim() : null)
  const add = () => { const e = email.trim(); if (!e) return; void run(sb().rpc('ai_admin_set', { p_email: e, p_allowed: true, p_daily_limit: limit.trim() ? num(limit) : null }), `${e} can use Ask Cresari`).then(() => { setEmail(''); setLimit('') }) }
  const ACCESS: Array<[AiOverview['access'], string]> = [['testers', 'People listed here'], ['all', 'Everyone'], ['off', 'Off']]
  return <Card span={12} title="Ask Cresari" hint="who can use the advisor, and how much — changes apply at once" right={<Btn sm onClick={() => void load()}>Refresh</Btn>}>
    {err ? <div className="msg crit" role="alert">Could not load the advisor settings: {err}. Press Refresh to try again.</div> : !o ? <p className="note" style={{ margin: 0 }}>Loading…</p> : <>
      <div className="kpis"><KPI l="Questions today" v={o.used_24h} cls="info" s={`ceiling ${o.global_daily} for everyone`} /><KPI l="Last 30 days" v={o.used_30d} cls="info" s={`${o.tokens_30d.toLocaleString()} tokens`} /><KPI l="Open to" v={o.access === 'all' ? 'Everyone' : o.access === 'off' ? 'Nobody' : `${o.people.length} + you`} cls={o.access === 'off' ? 'warn' : 'good'} s={o.access === 'testers' ? 'people listed below' : o.access === 'all' ? 'every signed-in account' : 'switched off'} /></div>
      <div className="grid2" style={{ marginTop: 12 }}>
        <div><div className="field"><label>Who can use it</label><span role="group" aria-label="Who can use Ask Cresari"><Seg value={o.access} options={ACCESS} onChange={v => { if (v !== o.access) void run(sb().rpc('ai_admin_config', { p_access: v }), v === 'off' ? 'Ask Cresari is off' : v === 'all' ? 'Ask Cresari is open to everyone' : 'Ask Cresari is open to the people listed') }} /></span></div>
          <div className="grid2"><div className="field"><label htmlFor="ai-daily">Questions a day, each person</label><input id="ai-daily" className="inp" inputMode="numeric" value={cfg.daily} onChange={e => setCfg(c => ({ ...c, daily: e.target.value }))} /></div>
            <div className="field"><label htmlFor="ai-global">Questions a day, everyone</label><input id="ai-global" className="inp" inputMode="numeric" value={cfg.global} onChange={e => setCfg(c => ({ ...c, global: e.target.value }))} /></div></div>
          <div className="field"><label htmlFor="ai-model">Model</label><input id="ai-model" className="inp" value={cfg.model} onChange={e => setCfg(c => ({ ...c, model: e.target.value }))} spellCheck={false} /></div>
          <Btn sm disabled={busy || (cfg.daily === String(o.daily_limit) && cfg.global === String(o.global_daily) && cfg.model.trim() === o.model)} onClick={() => void run(sb().rpc('ai_admin_config', { p_daily_limit: num(cfg.daily), p_global_daily: num(cfg.global), p_model: cfg.model.trim() || null }), 'Advisor settings saved')}>Save settings</Btn>
          <Note>Each question is counted before it is sent, so the limits also cap what the AI service can cost. Only the counts are kept — never a question or an answer.</Note></div>
        <div><div className="field"><label htmlFor="ai-email">Give someone access</label><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><input id="ai-email" className="inp" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="the address they sign in with" style={{ flex: '2 1 200px' }} /><input className="inp" inputMode="numeric" value={limit} onChange={e => setLimit(e.target.value)} placeholder={`limit (${o.daily_limit})`} aria-label="Their daily limit (blank = the default)" style={{ flex: '1 1 90px' }} /><Btn sm primary disabled={busy || !email.trim()} onClick={add}>Add</Btn></div></div>
          {o.people.length === 0 ? <div className="empty">Nobody has been added yet. You can always use it yourself.</div> : <div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th className="num">Limit</th><th className="num">Today</th><th className="num">30 days</th><th /></tr></thead>
            <tbody>{o.people.map(p => <tr key={p.user_id}><td style={{ overflowWrap: 'anywhere' }}>{p.email}</td><td className="num">{p.daily_limit ?? `${o.daily_limit} (default)`}</td><td className="num">{p.used_24h}</td><td className="num">{p.used_30d}</td><td><Btn sm disabled={busy} onClick={() => void run(sb().rpc('ai_admin_set', { p_email: p.email, p_allowed: false }), `${p.email} no longer has access`)} aria-label={`Remove ${p.email}`}>Remove</Btn></td></tr>)}</tbody></table></div>}</div>
      </div></>}
  </Card>
}
