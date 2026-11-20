// Review uncategorized (0.31.0): every transaction without a category, gathered by merchant, with the app's best answer on each.
// Accept one, accept every confident one at once, or pick another category — each choice files the merchant's transactions and
// (unless rule learning is off) teaches a rule, so the same merchant never needs asking twice. The grouping and the answers come
// from lib/categorize.ts; the built-in merchant list is lib/merchants.ts and runs on the device.
import { useEffect, useMemo, useState } from 'react'
import { useData } from '../app/hooks'
import { useStore } from '../app/store'
import { Btn, MBody, MFoot, MHead, Note, Pill, Seg, useModal } from './ui'
import { acceptPlan, coverage, reasonFor, reviewGroups, type ReviewGroup } from '../lib/categorize'
import { fm2, fmtMoney } from '../lib/money'
import { fmtD } from '../lib/dates'

type Show = 'all' | 'sure' | 'likely' | 'none'
const SHOWN = 60

export function ReviewUncategorized() {
  const { data, settings, catOpts, catLabels, cat, acctName, canEdit, guarded, saveSettings } = useData(); const { close } = useModal()
  const groups = useMemo(() => reviewGroups(data, settings), [data, settings]); const cov = useMemo(() => coverage(data), [data])
  const [pick, setPick] = useState<Record<string, string>>({}); const [openId, setOpenId] = useState<string | null>(null); const [show, setShow] = useState<Show>('all'); const [busy, setBusy] = useState(false)
  // the screen belongs to the ledger: following a link to another page closes it rather than leaving it over that page
  useEffect(() => { const on = () => { if (!location.hash.startsWith('#/transactions')) close() }; window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on) }, [close])
  const chosen = (g: ReviewGroup) => (g.id in pick ? pick[g.id] : g.category_id || '')
  const sure = groups.filter(g => g.confidence === 'high' && g.category_id), likely = groups.filter(g => g.confidence === 'medium' && g.category_id), none = groups.filter(g => !g.category_id)
  const list = show === 'sure' ? sure : show === 'likely' ? likely : show === 'none' ? none : groups
  const learn = settings.learnRules !== false
  const file = (gs: ReviewGroup[], done: (n: number, learned: number) => string) => {
    const ready = gs.map(g => ({ ...g, category_id: chosen(g) })).filter(g => g.category_id); if (!ready.length || busy) return
    // one acceptance at a time (two would each save rules from the same starting list and one would be lost), and the rules first:
    // if that save fails nothing has been filed, so the group is still here to try again
    setBusy(true)
    void guarded(async () => { try { const plan = acceptPlan(ready, useStore.getState().settings().rules || [], learn); if (plan.learned) await saveSettings({ rules: plan.rules }); for (const b of plan.byCat) await useStore.getState().bulkUpdate('transactions', b.ids, { category_id: b.category_id }); setPick({}) } finally { setBusy(false) } }, done(ready.reduce((k, g) => k + g.txns.length, 0), learn ? ready.filter(g => g.key !== 'unknown').length : 0))
  }
  const n = (k: number, w = 'transaction') => `${k} ${w}${k === 1 ? '' : 's'}`
  const acceptOne = (g: ReviewGroup) => file([g], k => `${n(k)} filed under ${cat(chosen(g))?.name || 'the category'}${learn && g.key !== 'unknown' ? ' · remembered for next time' : ''}`)
  const acceptSure = () => file(sure, (k, r) => `${n(k)} categorized${r ? ` · ${n(r, 'rule')} learned` : ''}`)
  const sureCount = sure.reduce((k, g) => k + g.txns.length, 0)
  const opts = (kind: 'expense' | 'income') => catOpts([kind])
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
        <ul className="ru-list">{list.slice(0, SHOWN).map(g => { const c = chosen(g), own = g.id in pick && pick[g.id] !== (g.category_id || ''), o = opts(g.kind)
          return <li key={g.id} className="ru-item" data-ru-group={g.name}>
            <div className="ru-row">
              <button type="button" className="ru-name" aria-expanded={openId === g.id} onClick={() => setOpenId(openId === g.id ? null : g.id)} title="Show the transactions">
                <b>{g.name}</b><span className="ru-sub">{g.txns.length}× · {g.kind === 'income' ? 'received ' : ''}{fm2(g.total)} · last {fmtD(g.last)}</span></button>
              <div className="ru-pick">
                {!own && g.category_id ? <Pill cls={g.confidence === 'high' ? 'good' : 'info'}>{g.confidence === 'high' ? 'Sure' : 'Likely'}</Pill> : !c ? <Pill cls="warn">Your pick</Pill> : <Pill cls="idle">Your pick</Pill>}
                {canEdit ? <select className="inp" aria-label={`Category for ${g.name}`} value={c} onChange={e => setPick(p => ({ ...p, [g.id]: e.target.value }))}><option value="">— choose a category —</option>{o.map(x => <option key={x.id} value={x.id}>{catLabels[x.id]}</option>)}</select> : <span>{cat(c)?.name || '—'}</span>}
                {canEdit && <Btn sm primary={!!c} disabled={!c || busy} onClick={() => acceptOne(g)} aria-label={`Accept ${cat(c)?.name || 'category'} for ${g.name}`}>Accept</Btn>}
              </div>
            </div>
            {!own && g.category_id ? <div className="ru-why">{reasonFor(g)}</div> : null}
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
