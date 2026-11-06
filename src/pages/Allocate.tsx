// Paycheck allocation (0.21.0): when a paycheck lands, a proposal for where it goes before the next one (lib/allocate.ts).
// Only the goal lines can be written — as transfers into each goal's account plus a contribution — and only when the person asks.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../app/hooks'
import type { Transaction } from '../app/data/types'
import { Btn, Card, Note, MHead, MBody, MFoot, useModal } from '../components/ui'
import { allocatePaycheck, recentPaychecks, GROUP_LABEL, type AllocGroup } from '../lib/allocate'
import { post } from '../lib/ledger'
import { isLiability } from '../lib/accounts'
import { fmtD, fmtDY, today } from '../lib/dates'
import { fm2, fmtMoney, parseNum, round2, sum } from '../lib/money'

const ORDER: AllocGroup[] = ['bills', 'debt', 'planned', 'goals', 'plan', 'everyday']
const COLOR: Record<AllocGroup, string> = { bills: 'var(--warn)', debt: 'var(--crit)', planned: 'var(--soon)', goals: 'var(--good)', plan: 'var(--info)', everyday: 'var(--idle)' }
const SEEN = 'wealthpilot.allocSeen'
const seen = (): string[] => { try { return JSON.parse(localStorage.getItem(SEEN) || '[]') } catch { return [] } }
const markSeen = (id: string) => { try { localStorage.setItem(SEEN, JSON.stringify([id, ...seen().filter(x => x !== id)].slice(0, 40))) } catch { /* private mode */ } }

export function AllocateModal({ pay, onDone }: { pay: Transaction; onDone: () => void }) {
  const { data, settings, insert, update, guarded, canEdit, acctLabels } = useData()
  const a = useMemo(() => allocatePaycheck(data, settings, pay), [data, settings, pay])
  const goalLines = a.lines.filter(l => l.group === 'goals')
  const [amt, setAmt] = useState<Record<string, string>>(() => Object.fromEntries(goalLines.map(l => [l.goalId!, l.amount.toFixed(2)])))
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(goalLines.map(l => [l.goalId!, true])))
  const goalSum = round2(sum(goalLines.map(l => (on[l.goalId!] ? parseNum(amt[l.goalId!] || '') || 0 : 0))))
  const committed = round2(a.committed - a.byGroup.goals + goalSum), leftover = round2(a.amount - committed)
  const from = pay.account_id ? data.accounts.find(x => x.id === pay.account_id) : null
  const logGoals = () => guarded(async () => { let n = 0
    for (const l of goalLines) { const v = round2(parseNum(amt[l.goalId!] || '') || 0); if (!on[l.goalId!] || v <= 0) continue
      const g = data.goals.find(x => x.id === l.goalId); if (!g) continue; const to = g.account_id ? data.accounts.find(x => x.id === g.account_id) : null; let txId: string | null = null
      if (from && to && to.id !== from.id && !isLiability(to)) { const tx = await insert('transactions', { date: today(), kind: 'transfer', amount: v, account_id: from.id, to_account_id: to.id, payee: g.name, memo: 'Paycheck allocation', tags: [], status: 'cleared', source: 'manual', goal_id: g.id, exclude_from_budget: false }); txId = tx.id; await post(data, (id, p) => update('accounts', id, p), tx, 1, tx.date) }
      await insert('contributions', { goal_id: g.id, date: today(), amount: v, transaction_id: txId, notes: `from the ${fmtD(pay.date)} paycheck` }); n++ }
    markSeen(pay.id); onDone(); return n }, 'Goal transfers logged')
  const bar = ORDER.map(gp => ({ gp, v: gp === 'goals' ? goalSum : a.byGroup[gp] })).filter(x => x.v > 0)
  const total = Math.max(a.amount, committed) || 1
  return <><MHead title={`Plan this paycheck · ${fm2(a.amount)} on ${fmtD(pay.date)}`} /><MBody>
    <Note>What this paycheck has to cover until {a.nextPay ? <>the next one on <b>{fmtDY(a.nextPay)}</b></> : <b>{fmtDY(a.until)}</b>} ({a.days} days). Bills, payments and planned items come from your calendar; goals take their share of each monthly contribution{settings.plan ? '; your applied plan adds its extra' : ''}. Nothing is moved unless you log the goal transfers.</Note>
    <div className="allocbar" role="img" aria-label={`Committed ${fmtMoney(committed)} of ${fmtMoney(a.amount)}`}>{bar.map(x => <i key={x.gp} style={{ width: `${x.v / total * 100}%`, background: COLOR[x.gp] }} title={`${GROUP_LABEL[x.gp]} ${fmtMoney(x.v)}`} />)}{leftover > 0 && <i style={{ width: `${leftover / total * 100}%`, background: 'transparent' }} />}</div>
    <div className={`msg ${leftover < 0 ? 'warn' : 'good'}`} style={{ margin: '8px 0 12px' }}>{leftover < 0 ? <>This paycheck is <b>{fmtMoney(-leftover)} short</b> of what is lined up before the next one — trim a goal share or move a planned item.</> : <><b>{fmtMoney(leftover)}</b> unassigned after everything below — a buffer, or extra toward a goal or debt.</>}</div>
    <div className="alloc">{ORDER.map(gp => { const ls = a.lines.filter(l => l.group === gp); if (!ls.length) return null
      return <div key={gp}><div className="grp"><span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: COLOR[gp], marginRight: 6 }} />{GROUP_LABEL[gp]}</span><span className="num">{fmtMoney(gp === 'goals' ? goalSum : a.byGroup[gp])}</span></div>
        {ls.map((l, i) => gp === 'goals' ? <div key={l.goalId} className="ln"><label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={!!on[l.goalId!]} onChange={e => setOn(o => ({ ...o, [l.goalId!]: e.target.checked }))} disabled={!canEdit} /> {l.label}{l.accountId ? <span className="note" style={{ margin: 0 }}> → {acctLabels[l.accountId]}</span> : null}</label><input className="inp num" inputMode="decimal" value={amt[l.goalId!] || ''} onChange={e => setAmt(m => ({ ...m, [l.goalId!]: e.target.value }))} aria-label={`Amount for ${l.label}`} style={{ width: 100, textAlign: 'right', minHeight: 32 }} disabled={!canEdit || !on[l.goalId!]} /></div>
          : <div key={i} className="ln"><span>{l.date ? `${fmtD(l.date)} · ` : ''}{l.label}</span><span className="num">{fm2(l.amount)}</span></div>)}</div> })}
      {!a.lines.length && <div className="empty">Nothing is lined up before the next paycheck. Add bills, goals or a plan to see where it goes.</div>}</div>
    {!a.schedule && <Note>This deposit is not linked to a pay schedule, so the next payday is estimated. Link it on the Income page for exact dates.</Note>}
  </MBody><MFoot><Btn onClick={() => { markSeen(pay.id); onDone() }}>Close</Btn>{canEdit && goalLines.length > 0 && <Btn primary onClick={logGoals} disabled={goalSum <= 0}>Log {fmtMoney(goalSum)} to goals</Btn>}</MFoot></>
}

/** Dashboard card: a paycheck landed in the last 3 days and has not been planned yet on this device. */
export function PaycheckCard() {
  const { data } = useData(); const { open, close } = useModal(); const [, force] = useState(0)
  const pay = recentPaychecks(data).find(p => !seen().includes(p.id)); if (!pay) return null
  const dismiss = () => { markSeen(pay.id); force(n => n + 1) }
  return <Card span={12} title="Your paycheck landed" hint="give every dollar a job before the next one" right={<span className="btnrow"><Btn sm primary onClick={() => open(<AllocateModal pay={pay} onDone={() => { close(); force(n => n + 1) }} />, { wide: true })}>Plan it</Btn><Btn sm onClick={dismiss}>Dismiss</Btn></span>}>
    <div>{fm2(pay.amount)} from <b>{pay.payee || 'your employer'}</b> on {fmtDY(pay.date)}. See what it has to cover until the next paycheck and what is left. <Link to="/income">All paychecks →</Link></div></Card>
}

/** Income page: the last few paychecks with an "Allocate…" button each. */
export function RecentPaychecks() {
  const { data } = useData(); const { open, close } = useModal()
  const list = recentPaychecks(data, 45).slice(0, 6)
  return <Card span={12} title="Recent paychecks" hint="where each one goes until the next">
    {list.length ? <div className="tblwrap"><table className="tbl"><caption className="sr-only">Recent paychecks</caption><thead><tr><th scope="col">Date</th><th scope="col">From</th><th scope="col" className="num">Take-home</th><th scope="col" /></tr></thead><tbody>
      {list.map(p => <tr key={p.id} className="st-good"><td>{fmtDY(p.date)}</td><td>{p.payee || '—'}</td><td className="num">{fm2(p.amount)}</td><td><Btn sm onClick={() => open(<AllocateModal pay={p} onDone={close} />, { wide: true })}>Allocate…</Btn></td></tr>)}
    </tbody></table></div> : <div className="empty">No paychecks in the last 45 days. When one lands (logged, imported, synced or read from email) it shows here.</div>}
  </Card>
}
