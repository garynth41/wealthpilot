import { useMemo, useState } from 'react'
import { useData } from '../app/hooks'
import type { Recurring, Transaction } from '../app/data/types'
import { REC_FREQ_LABEL } from '../app/data/types'
import { Card, KPI, Btn, Pill, Note, useConfirm, useModal, MHead, MBody, MFoot, Field } from '../components/ui'
import { Table, type Col } from '../components/Table'
import { upcoming, monthlyCommitments, recMonthly, STATUS_PILL, type Upcoming } from '../lib/recurring'
import { addDays, fmtD, fmtDY, today, nextMonthDay } from '../lib/dates'
import { fmtMoney, fm2, parseNum, sum } from '../lib/money'
import { post } from '../lib/ledger'
import { isLiability } from '../lib/accounts'
import { Chart, C } from '../components/Chart'

const KIND_LABEL: Record<Recurring['kind'], string> = { bill: 'Bill', subscription: 'Subscription', debt_payment: 'Card / loan payment', income: 'Income', transfer: 'Transfer', savings: 'Savings' }
export function BillsPage() {
  const { data, insert, update, remove, guarded, canEdit, catOpts, catLabels, accts, acctLabels, acctName } = useData(); const confirm = useConfirm(); const { open, close } = useModal()
  const [days, setDays] = useState(30); const [show, setShow] = useState<'all' | Recurring['kind']>('all')
  const t = today(); const up = useMemo(() => upcoming(data, addDays(t, -45), addDays(t, days)), [data, days, t])
  const open_ = up.filter(u => !['paid', 'skipped'].includes(u.status) && u.date >= addDays(t, -45)); const over = open_.filter(u => u.status === 'overdue'); const soon = open_.filter(u => u.days >= 0 && u.days <= 7)
  const commit = monthlyCommitments(data); const subs = data.recurring.filter(r => r.status === 'Active' && r.kind === 'subscription')
  const rows = data.recurring.filter(r => show === 'all' || r.kind === show).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  const markPaid = (u: Upcoming) => open(<PayModal u={u} onDone={close} />)
  const skip = (u: Upcoming) => guarded(async () => { if (u.occ) await update('occurrences', u.occ.id, { status: 'skipped' }); else await insert('occurrences', { recurring_id: u.r.id, due_date: u.date, amount: u.amount, status: 'skipped' }) }, 'Skipped')
  const cols: Col<Recurring>[] = [
    { k: 'name', label: 'Name', type: 'text', w: 150 }, { k: 'kind', label: 'Kind', type: 'select', opts: Object.keys(KIND_LABEL), labels: KIND_LABEL, w: 140 }, { k: 'payee', label: 'Payee', type: 'text', w: 130 },
    { k: 'amount', label: 'Amount', type: 'money', cls: 'num' }, { k: 'amount_varies', label: 'Varies', type: 'bool' }, { k: 'frequency', label: 'Every', type: 'select', opts: Object.keys(REC_FREQ_LABEL), labels: REC_FREQ_LABEL, w: 130 }, { k: 'day_of_month', label: 'Day', type: 'int', min: 1, max: 31, w: 60 }, { k: 'next_due', label: 'Next due', type: 'date' },
    { k: '_m', label: 'Per month', type: 'ro', cls: 'num', fmt: r => fmtMoney(recMonthly(r)), sortVal: r => recMonthly(r) },
    { k: 'account_id', label: 'From account', type: 'select', opts: ['', ...accts.map(a => a.id)], labels: { '': '—', ...acctLabels }, w: 140 }, { k: 'liability_account_id', label: 'Pays (card / loan / savings)', type: 'select', opts: ['', ...accts.filter(a => a.id).map(a => a.id)], labels: { '': '—', ...acctLabels }, w: 150 },
    { k: 'category_id', label: 'Budget line', type: 'select', opts: ['', ...catOpts(['expense', 'income']).map(c => c.id)], labels: { '': '—', ...catLabels }, w: 170 }, { k: 'autopay', label: 'Autopay', type: 'bool' }, { k: 'reminder_days', label: 'Remind (days)', type: 'int', min: 0, max: 30, w: 60 },
    { k: 'status', label: 'Status', type: 'select', opts: ['Active', 'Paused', 'Cancelled'], w: 100 }, { k: 'last_paid_on', label: 'Last paid', type: 'ro', fmt: r => r.last_paid_on ? `${fmtD(r.last_paid_on)}${r.last_paid_amount ? ' · ' + fm2(r.last_paid_amount) : ''}` : '—' }, { k: 'notes', label: 'Notes', type: 'text', w: 160 }, { k: 'ref', label: 'ID', type: 'ro', cls: 'id' }]
  const byDay = useMemo(() => { const m: Record<string, number> = {}; up.filter(u => !['paid', 'skipped'].includes(u.status) && u.date >= t && u.r.kind !== 'income').forEach(u => { m[u.date] = (m[u.date] || 0) + u.amount }); return Object.entries(m).sort() }, [up, t])
  const c = C()
  return <>
    <div className="kpis" style={{ marginBottom: 16 }}>
      <KPI l="Monthly commitments" v={fmtMoney(commit.total)} cls="info" s={`bills ${fmtMoney(commit.bills)} · subscriptions ${fmtMoney(commit.subs)} · debt ${fmtMoney(commit.debt)} · savings ${fmtMoney(commit.savings)}`} />
      <KPI l={`Due next ${days} days`} v={fmtMoney(sum(open_.filter(u => u.date >= t && u.r.kind !== 'income').map(u => u.amount)))} cls="warn" s={`${open_.filter(u => u.date >= t).length} payments`} />
      <KPI l="Overdue" v={String(over.length)} cls={over.length ? 'crit' : 'good'} s={over.length ? fmtMoney(sum(over.map(u => u.amount))) + ' not yet paid' : 'nothing overdue'} />
      <KPI l="Due within 7 days" v={String(soon.length)} cls={soon.length ? 'warn' : 'good'} s={soon.length ? fmtMoney(sum(soon.map(u => u.amount))) : 'clear week'} />
      <KPI l="Subscriptions" v={String(subs.length)} cls={subs.length > 6 ? 'warn' : 'info'} s={`${fmtMoney(sum(subs.map(recMonthly)))}/mo · ${fmtMoney(sum(subs.map(recMonthly)) * 12)}/yr`} />
      <KPI l="On autopay" v={`${data.recurring.filter(r => r.status === 'Active' && r.autopay).length} of ${data.recurring.filter(r => r.status === 'Active').length}`} cls="info" s="autopays still need the cash in the account" /></div>
    <div className="grid g12">
      <Card span={7} title="Coming up & overdue" hint="computed from each item's schedule; paid when a matching transaction exists" right={<span className="opts">{[14, 30, 60, 90].map(d => <button key={d} className={d === days ? 'on' : ''} onClick={() => setDays(d)}>{d} days</button>)}</span>}>
        {open_.length ? <div className="tblwrap" style={{ maxHeight: 520 }}><table className="tbl"><thead><tr><th>Date</th><th>Item</th><th className="num">Amount</th><th>From</th><th>Status</th><th></th></tr></thead><tbody>{open_.map((u, i) => <tr key={i} className={`st-${STATUS_PILL[u.status].cls === 'info' ? 'wait' : STATUS_PILL[u.status].cls}`}><td>{fmtD(u.date)} <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{u.days === 0 ? 'today' : u.days < 0 ? `${-u.days}d ago` : `in ${u.days}d`}</span></td><td>{u.r.name}{u.r.autopay && <span style={{ color: 'var(--ink-3)', fontSize: 12 }}> · autopay</span>}<div style={{ color: 'var(--ink-3)', fontSize: 12 }}>{KIND_LABEL[u.r.kind]}{u.r.amount_varies ? ' · amount varies' : ''}</div></td><td className="num">{fm2(u.amount)}</td><td style={{ fontSize: 12.5 }}>{acctName(u.r.account_id)}</td><td><Pill cls={STATUS_PILL[u.status].cls}>{STATUS_PILL[u.status].label}</Pill></td><td>{canEdit && <span className="btnrow"><Btn sm onClick={() => markPaid(u)}>{u.r.kind === 'income' ? 'Received' : 'Mark paid'}</Btn><Btn sm onClick={() => skip(u)}>Skip</Btn></span>}</td></tr>)}</tbody></table></div> : <div className="empty">Nothing due in this window.</div>}
        <Note><b>Mark paid</b> logs the transaction (a card or loan payment becomes a transfer that reduces the balance) and the item shows as paid. Items are matched automatically when a transaction with the same payee lands within a few days of the due date.</Note></Card>
      <Card span={5} title="Cash needed by day" hint={`next ${days} days, unpaid items only`}>
        <Chart title="Cash needed by day" data={[{ type: 'bar', x: byDay.map(([d]) => d), y: byDay.map(([, v]) => v), marker: { color: byDay.map(([d]) => d <= addDays(t, 7) ? c.warn : c.blue) }, hovertemplate: '%{x|%b %d}: $%{y:,.0f}<extra></extra>' }]} layout={{ xaxis: { type: 'date', tickformat: '%b %d' }, yaxis: { tickprefix: '$' }, showlegend: false }} height={240} />
        <Note>Total {fmtMoney(sum(byDay.map(([, v]) => v)))} · heaviest day {byDay.length ? `${fmtDY(byDay.slice().sort((a, b) => b[1] - a[1])[0][0])} (${fmtMoney(byDay.slice().sort((a, b) => b[1] - a[1])[0][1])})` : '—'}</Note></Card>
      <Card span={12} title="Recurring items" hint="bills, subscriptions, card and loan payments, savings transfers and recurring income" right={<><span className="opts">{(['all', 'bill', 'subscription', 'debt_payment', 'savings', 'income'] as const).map(k => <button key={k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>{k === 'all' ? 'All' : KIND_LABEL[k]}</button>)}</span>{canEdit && <Btn primary sm onClick={() => guarded(() => insert('recurring', { name: 'New bill', kind: 'bill', amount: 0, amount_varies: false, frequency: 'monthly', day_of_month: 1, next_due: nextMonthDay(1), account_id: accts.find(a => a.kind === 'checking')?.id || null, autopay: false, reminder_days: 3, status: 'Active', sort_order: data.recurring.length + 1 }), 'Added — fill in the row')}>+ Add</Btn>}</>}>
        <Table rows={rows} cols={cols} editable={canEdit} onChange={(r, k, v) => guarded(() => update('recurring', r.id, { [k]: v } as Partial<Recurring>))} onDelete={async r => { if (await confirm(`Delete ${r.name}? Past transactions are kept.`)) guarded(() => remove('recurring', r.id), 'Deleted') }} rowCls={r => r.status !== 'Active' ? 'st-idle ex-off' : r.kind === 'income' ? 'st-good' : r.autopay ? 'st-wait' : ''} defaultSort={{ k: 'next_due', dir: 1 }} />
        <Note>Set <b>Pays</b> on a card or loan payment so Mark paid reduces that balance; set it on a savings transfer so the money lands in the savings account. The <b>Budget line</b> is where the payment counts in the budget. Items read from email appear here automatically once approved.</Note></Card>
    </div>
  </>
}
function PayModal({ u, onDone }: { u: Upcoming; onDone: () => void }) {
  const { data, insert, update, guarded, acctLabels, accts } = useData()
  const [date, setDate] = useState(today() < u.date ? today() : u.date); const [amt, setAmt] = useState(u.amount.toFixed(2)); const [from, setFrom] = useState(u.r.account_id || accts.find(a => a.kind === 'checking')?.id || '')
  const target = u.r.liability_account_id ? data.accounts.find(a => a.id === u.r.liability_account_id) : null
  const save = () => { const a = parseNum(amt); if (!a || a <= 0) return
    guarded(async () => { const kind: Transaction['kind'] = u.r.kind === 'income' ? 'income' : target ? 'transfer' : 'expense'
      const tx = await insert('transactions', { date, kind, amount: Math.round(a * 100) / 100, account_id: from || null, to_account_id: target ? target.id : null, category_id: u.r.category_id || null, payee: u.r.payee || u.r.name, memo: u.r.name, tags: [], status: 'cleared', source: 'recurring', recurring_id: u.r.id, exclude_from_budget: false })
      await post(data, (id, p) => update('accounts', id, p), tx, 1, date)
      if (target && isLiability(target) && target.due_date && a >= (+target.minimum_payment || 0) - 0.005 && date <= addDays(target.due_date, 3)) await update('accounts', target.id, { last_paid_due: target.due_date })
      if (u.occ) await update('occurrences', u.occ.id, { status: 'paid', paid_on: date, transaction_id: tx.id, amount: a }); else await insert('occurrences', { recurring_id: u.r.id, due_date: u.date, amount: a, status: 'paid', paid_on: date, transaction_id: tx.id })
      await update('recurring', u.r.id, { last_paid_on: date, last_paid_amount: a, next_due: u.r.frequency === 'irregular' ? u.r.next_due : undefined as unknown as string })
      onDone() }, `${fm2(a)} recorded`) }
  return <><MHead title={`${u.r.kind === 'income' ? 'Received' : 'Mark paid'} — ${u.r.name}`} /><MBody>
    <Note>{u.r.kind === 'income' ? 'Logs the income' : target ? `Logs a transfer to ${acctLabels[target.id]} and reduces its balance` : 'Logs the expense'} {u.r.category_id ? 'against its budget line' : '(no budget line set)'}.</Note>
    <div className="grid3" style={{ marginTop: 10 }}><Field label="Date"><input className="inp" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field><Field label="Amount"><input className="inp" inputMode="decimal" value={amt} onChange={e => setAmt(e.target.value)} /></Field><Field label={u.r.kind === 'income' ? 'Into' : 'From'}><select className="inp" value={from} onChange={e => setFrom(e.target.value)}>{accts.map(a => <option key={a.id} value={a.id}>{acctLabels[a.id]}</option>)}</select></Field></div>
  </MBody><MFoot><Btn onClick={onDone}>Cancel</Btn><Btn primary onClick={save}>Save</Btn></MFoot></>
}
