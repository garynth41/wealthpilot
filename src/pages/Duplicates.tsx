// Duplicate review: pairs that look alike but are not clear-cut (decide each), and every merged duplicate (undo any).
import { useMemo } from 'react'
import { useData } from '../app/hooks'
import { useStore } from '../app/store'
import type { Account, Transaction } from '../app/data/types'
import { Btn, Note, Pill, MHead, MBody, MFoot } from '../components/ui'
import { planDedupe, keeperOrder, keeperPatch, origin, type DTxn, type DedupeOptions } from '../lib/dedupe'
import { fmtD } from '../lib/dates'
import { fm2 } from '../lib/money'
import { Link } from 'react-router-dom'
import { linkTo } from '../lib/focus'

const ORIGIN: Record<string, [string, string]> = { bank: ['bank feed', 'good'], file: ['statement file', 'info'], typed: ['typed / email', 'idle'] }
const srcPill = (t: Transaction) => { const o = origin(t as unknown as DTxn); const [l, c] = ORIGIN[o]; return <Pill cls={c}>{t.source === 'email' ? 'email' : l}</Pill> }

export function duplicateCounts(txns: Transaction[], merged: Transaction[], accounts: Account[] = [], options?: DedupeOptions | null) {
  const plan = planDedupe(txns as unknown as DTxn[], accounts, options)
  return { review: plan.review.length, pendingAuto: plan.auto.reduce((n, g) => n + g.dups.length, 0), merged: merged.length }
}

export function DuplicatesReview({ onDone }: { onDone: () => void }) {
  const { data, acctLabels, guarded, canEdit, settings } = useData(); const st = useStore.getState
  const plan = useMemo(() => planDedupe(data.transactions as unknown as DTxn[], data.accounts, settings.dedupe), [data.transactions, data.accounts, settings.dedupe])
  const byId = useMemo(() => new Map([...data.transactions, ...data.duplicates].map(t => [t.id, t])), [data.transactions, data.duplicates])
  const line = (t?: Transaction) => t ? <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr 150px 92px 110px', gap: 8, alignItems: 'center', fontSize: 13 }}>
    <span>{fmtD(t.date)}</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.payee || ''}><Link to={linkTo('/transactions', t.id)} onClick={onDone}>{t.payee || <i style={{ color: 'var(--ink-3)' }}>no payee</i>}</Link></span>
    <span style={{ color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.account_id ? acctLabels[t.account_id] : t.to_account_id ? '→ ' + acctLabels[t.to_account_id] : 'no account'}</span>
    <b className="num" style={{ textAlign: 'right' }}>{t.kind === 'income' ? '+' : '−'}{fm2(t.amount)}</b><span>{srcPill(t)}</span></div> : null
  const merge = (a: string, b: string) => guarded(async () => {
    const [k, d] = [byId.get(a)!, byId.get(b)!].sort((x, y) => keeperOrder(x as unknown as DTxn, y as unknown as DTxn))
    await st().mergeDuplicates(k.id, [d.id], keeperPatch(k as unknown as DTxn, [d as unknown as DTxn]) as Partial<Transaction>)
  }, 'Merged — one copy kept')
  const keepBoth = (a: string, b: string) => guarded(() => st().notDuplicates([a, b]), 'Marked as two different transactions')
  const merged = data.duplicates.slice().sort((a, b) => b.date.localeCompare(a.date))
  return <><MHead title="Duplicate transactions" /><MBody>
    <Note>Every new transaction — from the bank feed, a statement file, email or typed by hand — is checked against what is already there. Clear-cut copies are merged automatically (the bank's copy is kept and inherits the category); a card or loan payment that arrives as two bank rows — out of checking or savings, onto the card — becomes one transfer, and an emailed or typed copy of it merges in too. Nothing is deleted, and any merge can be undone below (undoing the card side of a payment puts both rows back as they arrived). Look-alikes that could be real (two identical charges on one day, the same amount in two accounts) wait here for you.</Note>
    {plan.auto.length > 0 && <div className="msg warn">{plan.auto.reduce((n, g) => n + g.dups.length, 0)} clear-cut duplicate{plan.auto.length === 1 ? '' : 's'} not merged yet{canEdit ? '' : ' — someone with edit access can merge them'}. {canEdit && <Btn sm primary onClick={() => guarded(() => st().autoDedupe())}>Merge them now</Btn>}</div>}
    <h3 style={{ margin: '14px 0 6px', display: 'flex', alignItems: 'center', gap: 10 }}>Needs your decision ({plan.review.length}){canEdit && plan.review.length > 1 && <Btn sm onClick={() => guarded(() => st().notDuplicates([...new Set(plan.review.flatMap(p => [p.a, p.b]))]), 'All kept as separate transactions')}>Keep all as separate</Btn>}</h3>
    {plan.review.length === 0 ? <div className="empty">Nothing to decide.</div> : plan.review.map(p => <div key={p.a + p.b} className="card" style={{ padding: 10, marginBottom: 8, boxShadow: 'none', border: '1px solid var(--line)' }}>
      {line(byId.get(p.a))}{line(byId.get(p.b))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}><span className="note" style={{ margin: 0, flex: 1 }}>{p.reason}</span>
        {canEdit && <><Btn sm primary onClick={() => merge(p.a, p.b)}>Same transaction — keep one</Btn><Btn sm onClick={() => keepBoth(p.a, p.b)}>Two different transactions</Btn></>}</div></div>)}
    <h3 style={{ margin: '14px 0 6px' }}>Merged — hidden from every total ({merged.length})</h3>
    {merged.length === 0 ? <div className="empty">No merged duplicates.</div> : <div className="tblwrap" style={{ maxHeight: 320 }}><table className="tbl"><thead><tr><th>Date</th><th>Duplicate</th><th className="num">Amount</th><th>From</th><th>Kept copy</th><th /></tr></thead><tbody>
      {merged.map(d => { const k = byId.get(d.duplicate_of || ''); return <tr key={d.id}><td>{fmtD(d.date)}</td><td>{d.payee}</td><td className="num">{fm2(d.amount)}</td><td>{srcPill(d)}</td><td>{k ? `${fmtD(k.date)} · ${k.payee || ''}` : '—'}</td><td>{canEdit && <Btn sm onClick={() => guarded(() => st().restoreDuplicate(d.id), 'Restored — it will not be merged again')}>Undo</Btn>}</td></tr> })}
    </tbody></table></div>}
  </MBody><MFoot><Btn onClick={onDone}>Close</Btn></MFoot></>
}
