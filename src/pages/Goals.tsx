import { useState } from 'react'
import { useData } from '../app/hooks'
import type { Goal } from '../app/data/types'
import { Card, KPI, Btn, Pill, Note, useConfirm, useModal, MHead, MBody, MFoot, Field } from '../components/ui'
import { Table, type Col } from '../components/Table'
import { goalProgress } from '../lib/goals'
import { goalMilestones, goalWhatIf } from '../lib/planning'
import { fmtMoney, fm2, parseNum, sum } from '../lib/money'
import { addDays, fmtDY, today } from '../lib/dates'
import { post } from '../lib/ledger'
import { isLiability } from '../lib/accounts'
import { ScenarioBar } from '../components/Scenarios'
import { normalize } from '../lib/scenarios'
import { Link } from 'react-router-dom'

const KIND: Record<Goal['kind'], string> = { savings: 'Savings', emergency_fund: 'Emergency fund', debt_payoff: 'Debt payoff', sinking_fund: 'Sinking fund', purchase: 'Purchase', other: 'Other' }
export function GoalsPage() {
  const { data, settings, insert, update, remove, guarded, canEdit, accts, acctLabels } = useData(); const planX = settings.plan?.goalExtra || {}; const confirm = useConfirm(); const { open, close } = useModal()
  const act = data.goals.filter(g => g.status === 'Active'); const prog = Object.fromEntries(data.goals.map(g => [g.id, goalProgress(data, g)]))
  const totalTarget = sum(act.map(g => prog[g.id].target)), totalSaved = sum(act.map(g => prog[g.id].saved)), monthly = sum(act.map(g => g.monthly_contribution)), need = sum(act.map(g => prog[g.id].needPerMonth || 0))
  const cols: Col<Goal>[] = [{ k: 'name', label: 'Goal', type: 'text', w: 160 }, { k: 'kind', label: 'Kind', type: 'select', opts: Object.keys(KIND), labels: KIND, w: 130 }, { k: 'target_amount', label: 'Target', type: 'money', cls: 'num' }, { k: 'target_date', label: 'By', type: 'date' }, { k: 'inflation_pct', label: 'Inflation %/yr', type: 'number', cls: 'num', w: 70, placeholder: '—' }, { k: '_t', label: 'Target then', type: 'ro', cls: 'num', fmt: g => prog[g.id].inflated ? <span title={`in dollars of ${g.target_date ? fmtDY(g.target_date) : 'today'}`}>{fmtMoney(prog[g.id].target)}</span> : '—', sortVal: g => prog[g.id].target },
    { k: 'account_id', label: 'Saved in', type: 'select', opts: ['', ...accts.map(a => a.id)], labels: { '': '—', ...acctLabels }, w: 150 }, { k: 'starting_amount', label: 'Starting amount', type: 'money', cls: 'num' }, { k: 'monthly_contribution', label: 'Per month', type: 'money', cls: 'num' },
    { k: '_s', label: 'Saved', type: 'ro', cls: 'num', fmt: g => <b>{fmtMoney(prog[g.id].saved)}</b> }, { k: '_p', label: 'Progress', type: 'ro', fmt: g => <><span className="usebar"><i style={{ width: Math.round(prog[g.id].pct * 100) + '%', background: g.color || 'var(--accent)' }} /></span>{Math.round(prog[g.id].pct * 100)}%</> },
    { k: '_n', label: 'Needed / mo', type: 'ro', cls: 'num', fmt: g => prog[g.id].needPerMonth == null ? '—' : fmtMoney(prog[g.id].needPerMonth!) }, { k: '_e', label: 'On track', type: 'ro', fmt: g => { const p = prog[g.id]; return p.reached ? <Pill cls="good">Reached</Pill> : p.onTrack == null ? <Pill cls="idle">no date</Pill> : p.onTrack ? <Pill cls="good">yes{p.eta ? ` · ${fmtDY(p.eta)}` : ''}</Pill> : <Pill cls="warn">behind{p.eta ? ` · ${fmtDY(p.eta)}` : ''}</Pill> } },
    { k: 'priority', label: 'Priority', type: 'int', min: 1, max: 9, w: 50 }, { k: 'status', label: 'Status', type: 'select', opts: ['Active', 'Paused', 'Reached', 'Cancelled'], w: 100 }, { k: 'color', label: 'Color', type: 'text', w: 80 }, { k: 'notes', label: 'Notes', type: 'text', w: 160 }, { k: 'ref', label: 'ID', type: 'ro', cls: 'id' }]
  return <>
    <div className="kpis" style={{ marginBottom: 16 }}><KPI l="Active goals" v={String(act.length)} cls="info" s={`${fmtMoney(totalTarget)} in targets`} /><KPI l="Saved toward goals" v={fmtMoney(totalSaved)} cls="good" s={totalTarget ? `${Math.round(totalSaved / totalTarget * 100)}% of all targets` : ''} /><KPI l="Contributing" v={fmtMoney(monthly) + '/mo'} cls={monthly >= need ? 'good' : 'warn'} s={`${fmtMoney(need)}/mo needed to hit every date`} /><KPI l="Gap" v={fmtMoney(Math.max(0, need - monthly)) + '/mo'} cls={need - monthly > 0 ? 'warn' : 'good'} s={need - monthly > 0 ? 'raise contributions or move a date' : 'every goal is funded'} /></div>
    <div className="grid g12">
      {act.map(g => { const p = prog[g.id]; return <Card key={g.id} span={4} title={g.name} help="Each goal" hint={KIND[g.kind]}><div style={{ fontSize: 26, fontWeight: 600 }}>{fmtMoney(p.saved)} <span style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 400 }}>of {fmtMoney(p.target)}</span></div>{p.inflated && <div className="note" style={{ marginTop: 0 }}>{fmtMoney(g.target_amount)} in today's dollars, grown {g.inflation_pct}%/yr{g.target_date ? ` to ${fmtDY(g.target_date)}` : ''}</div>}<div className="mix" style={{ margin: '8px 0' }}><span style={{ width: Math.round(p.pct * 100) + '%', background: g.color || 'var(--accent)' }} /></div><div className="note" style={{ marginTop: 0 }}>{p.reached ? 'Reached 🎉' : <>{fmtMoney(p.left)} to go{g.target_date ? ` by ${fmtDY(g.target_date)}` : ''} · {fmtMoney(g.monthly_contribution)}/mo{p.needPerMonth != null ? ` · need ${fmtMoney(p.needPerMonth)}/mo` : ''}{p.eta ? ` · at this pace ${fmtDY(p.eta)}` : ''}</>}{planX[g.id] > 0 && <> · <Link to="/plan"><Pill cls="good">plan +{fmtMoney(planX[g.id])}/mo</Pill></Link></>}</div><Milestones g={g} />{canEdit && g.kind !== 'debt_payoff' && <div className="btnrow" style={{ marginTop: 8 }}><Btn sm primary onClick={() => open(<Contribute g={g} onDone={close} />)}>+ Contribute</Btn><Btn sm onClick={() => open(<WhatIf g={g} onDone={close} />)}>What if…</Btn></div>}</Card> })}
      <Card span={12} title="All goals" hint="debt-payoff goals track the linked account's balance; the rest track contributions" right={canEdit ? <Btn primary sm onClick={() => guarded(() => insert('goals', { name: 'New goal', kind: 'savings', target_amount: 1000, target_date: addDays(today(), 365), account_id: accts.find(a => a.kind === 'savings')?.id || null, starting_amount: 0, monthly_contribution: 100, priority: 2, status: 'Active', sort_order: data.goals.length + 1 }), 'Added — fill in the row')}>+ Add goal</Btn> : undefined}>
        <Table rows={data.goals} cols={cols} editable={canEdit} onChange={(g, k, v) => guarded(() => update('goals', g.id, { [k]: v, ...((k === 'inflation_pct' && v && !g.target_base_date) || (k === 'target_amount' && g.inflation_pct) ? { target_base_date: today() } : {}) } as Partial<Goal>))} onDelete={async g => { if (await confirm(`Delete ${g.name} and its contribution history?`)) guarded(() => remove('goals', g.id), 'Deleted') }} rowCls={g => g.status !== 'Active' ? 'st-idle ex-off' : prog[g.id].reached ? 'st-good' : prog[g.id].onTrack === false ? 'st-warn' : 'st-good'} search={false} />
        <Note>A contribution is a transfer from checking to the goal's account (the savings balance goes up and the budget line, if you pick one, counts it). Set <b>Starting amount</b> to what was already saved when you created the goal. Give a goal an <b>inflation</b> rate to enter its target in today's dollars — the amount needed by the target date grows each year (about {settings.defaultInflationPct ?? 3}% is typical; college costs have run higher).</Note></Card>
      <Card span={12} title="Contribution history">{data.contributions.length ? <div className="tblwrap" style={{ maxHeight: 320 }}><table className="tbl"><thead><tr><th>Date</th><th>Goal</th><th className="num">Amount</th><th>Note</th><th></th></tr></thead><tbody>{data.contributions.slice().sort((a, b) => b.date.localeCompare(a.date)).map(c => <tr key={c.id}><td>{fmtDY(c.date)}</td><td>{data.goals.find(g => g.id === c.goal_id)?.name || '—'}</td><td className="num">{fm2(c.amount)}</td><td>{c.notes}</td><td>{canEdit && <button className="del" onClick={async () => { if (await confirm('Remove this contribution? The transaction (if any) stays.')) guarded(() => remove('contributions', c.id)) }}>✕</button>}</td></tr>)}</tbody></table></div> : <div className="empty">No contributions yet.</div>}</Card>
    </div>
  </>
}
function Contribute({ g, onDone }: { g: Goal; onDone: () => void }) {
  const { data, insert, update, guarded, accts, acctLabels, catOpts } = useData()
  const [date, setDate] = useState(today()); const [amt, setAmt] = useState(g.monthly_contribution ? g.monthly_contribution.toFixed(2) : ''); const [from, setFrom] = useState(accts.find(a => a.kind === 'checking')?.id || ''); const [log, setLog] = useState(!!g.account_id)
  const cat = catOpts('expense').find(c => /savings goal|emergency fund/i.test(c.name) && (g.kind === 'emergency_fund' ? /emergency/i.test(c.name) : true))
  const save = () => { const v = parseNum(amt); if (!v || v <= 0) return
    guarded(async () => { let txId: string | null = null
      if (log && g.account_id && from) { const tx = await insert('transactions', { date, kind: 'transfer', amount: v, account_id: from, to_account_id: g.account_id, category_id: cat?.id || null, payee: g.name, memo: 'Goal contribution', tags: [], status: 'cleared', source: 'manual', goal_id: g.id, exclude_from_budget: false }); txId = tx.id; await post(data, (id, p) => update('accounts', id, p), tx, 1, date) }
      await insert('contributions', { goal_id: g.id, date, amount: v, transaction_id: txId }); onDone() }, `${fm2(v)} added to ${g.name}`) }
  const target = g.account_id ? data.accounts.find(a => a.id === g.account_id) : null
  return <><MHead title={`Contribute — ${g.name}`} /><MBody><div className="grid2"><Field label="Date"><input className="inp" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field><Field label="Amount"><input className="inp" inputMode="decimal" value={amt} onChange={e => setAmt(e.target.value)} autoFocus /></Field></div>
    {target && !isLiability(target) && <><label className="gm-ign" style={{ fontSize: 13 }}><input type="checkbox" checked={log} onChange={e => setLog(e.target.checked)} /> also log the transfer into {acctLabels[target.id]}</label>{log && <Field label="From account"><select className="inp" value={from} onChange={e => setFrom(e.target.value)}>{accts.filter(a => a.id !== target.id && !isLiability(a)).map(a => <option key={a.id} value={a.id}>{acctLabels[a.id]}</option>)}</select></Field>}</>}
  </MBody><MFoot><Btn onClick={onDone}>Cancel</Btn><Btn primary onClick={save}>Save</Btn></MFoot></>
}

/** 25 / 50 / 75 / 100 % markers with the date each was or will be reached at the current pace. */
function Milestones({ g }: { g: Goal }) {
  const { data } = useData(); const ms = goalMilestones(data, g)
  return <div className="milestones" title="Milestones at the current contribution rate">{ms.map(m => <span key={m.pct} className={m.reached ? 'done' : ''}><b>{Math.round(m.pct * 100)}%</b><small>{m.reached ? (m.reachedOn ? fmtDY(m.reachedOn) : 'at start') : m.date ? fmtDY(m.date) : '—'}</small></span>)}</div>
}
/** What-if: slide the monthly contribution or add a lump sum and see the landing date vs the target. Nothing is saved unless you click Apply. */
function WhatIf({ g, onDone }: { g: Goal; onDone: () => void }) {
  const { data, update, guarded, canEdit } = useData(); const [monthly, setMonthly] = useState(g.monthly_contribution); const [lump, setLump] = useState(0)
  const base = goalWhatIf(data, g); const w = goalWhatIf(data, g, { monthly, lump }); const max = Math.max(500, Math.ceil((base.neededForTarget || g.monthly_contribution || 100) * 2.5 / 50) * 50)
  return <><MHead title={`What if — ${g.name}`} /><MBody>
    <ScenarioBar kind="goal" goalId={g.id} current={{ goalId: g.id, monthly, lump }} onLoad={x => { const v = normalize('goal', x); setMonthly(v.monthly); setLump(v.lump) }} compact />
    <Field label={`Monthly contribution: ${fmtMoney(monthly)}`}><input type="range" min={0} max={max} step={10} value={monthly} onChange={e => setMonthly(+e.target.value)} style={{ width: '100%' }} /></Field>
    <Field label={`One-off lump sum: ${fmtMoney(lump)}`}><input type="range" min={0} max={Math.max(100, Math.ceil(goalProgress(data, g).target))} step={50} value={lump} onChange={e => setLump(+e.target.value)} style={{ width: '100%' }} /></Field>
    <div className="kpis" style={{ margin: '10px 0' }}>
      <KPI l="Reached" v={w.months === 0 ? 'now' : w.date ? fmtDY(w.date) : 'never'} cls={w.months === 0 ? 'good' : w.onTime == null ? 'info' : w.onTime ? 'good' : 'crit'} s={w.months == null ? 'no contribution' : `${w.months} month${w.months === 1 ? '' : 's'}${g.target_date ? ` · target ${fmtDY(g.target_date)}` : ''}`} />
      <KPI l="Today's plan" v={base.date ? fmtDY(base.date) : '—'} cls="idle" s={`${fmtMoney(g.monthly_contribution)}/mo`} />
      {base.neededForTarget != null && <KPI l="Needed to hit the date" v={fmtMoney(base.neededForTarget) + '/mo'} cls={monthly >= base.neededForTarget ? 'good' : 'warn'} s={w.byTarget != null ? `${fmtMoney(w.byTarget)} saved by then at ${fmtMoney(monthly)}/mo` : ''} />}
    </div>
    <Note>Moving the slider changes nothing until you apply it. The lump sum is a preview only — log it with "Contribute" when the money moves.</Note>
  </MBody><MFoot><Btn onClick={onDone}>Close</Btn>{canEdit && <Btn primary disabled={monthly === g.monthly_contribution} onClick={() => guarded(async () => { await update('goals', g.id, { monthly_contribution: monthly }); onDone() }, 'Monthly contribution updated')}>Apply {fmtMoney(monthly)}/mo</Btn>}</MFoot></>
}
