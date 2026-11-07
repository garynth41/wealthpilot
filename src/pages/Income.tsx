import { useMemo } from 'react'
import { useData } from '../app/hooks'
import type { PaySchedule } from '../app/data/types'
import { PAY_FREQ_LABEL } from '../app/data/types'
import { Card, KPI, Btn, Pill, Note, useConfirm, useModal } from '../components/ui'
import { Table, type Col } from '../components/Table'
import { payDates, nextPayDate, lastPayDate, monthlyIncome, monthlyEquivalent, paycheckOnFile } from '../lib/paySchedule'
import { addDays, fmtD, fmtDY, today, diffDays, monthStart, monthEnd, curMonth, mAdd, mShort } from '../lib/dates'
import { fmtMoney, fm2, sum } from '../lib/money'
import { spanFor } from '../lib/periods'
import { rangeStat } from '../lib/budget'
import { Chart, C } from '../components/Chart'
import { AddTxn } from './Transactions'
import { RecentPaychecks } from './Allocate'

const KIND_LABEL: Record<PaySchedule['kind'], string> = { salary: 'Salary', hourly: 'Hourly', benefit: 'Benefit', severance: 'Severance', side: 'Side income', rental: 'Rental', investment: 'Investment', support: 'Support', other: 'Other' }
export function IncomePage() {
  const { data, settings, insert, update, remove, guarded, canEdit, catOpts, catLabels, accts, acctLabels, acctName } = useData(); const confirm = useConfirm(); const { open, close } = useModal()
  const t = today(); const act = data.paySchedules.filter(p => p.status === 'Active'); const sp = spanFor(data, settings)
  const next90 = useMemo(() => act.flatMap(p => payDates(p, t, addDays(t, 90)).map(d => ({ p, d }))).sort((a, b) => a.d.localeCompare(b.d)), [act, t])
  const monthly = monthlyIncome(data.paySchedules); const thisPeriod = sum(act.flatMap(p => payDates(p, sp.start, sp.end).map(() => +p.net_amount || 0)))
  const received = rangeStat(data, sp.start, sp.end).income
  const nextPay = next90[0]
  const months = [...Array(6)].map((_, i) => mAdd(curMonth(), i - 5)); const hist = months.map(m => rangeStat(data, monthStart(m), monthEnd(m)).income)
  const cols: Col<PaySchedule>[] = [
    { k: 'name', label: 'Name', type: 'text', w: 160 }, { k: 'payer', label: 'Payer / employer', type: 'text', w: 150 }, { k: 'kind', label: 'Kind', type: 'select', opts: Object.keys(KIND_LABEL), labels: KIND_LABEL, w: 110 },
    { k: 'frequency', label: 'Paid', type: 'select', opts: Object.keys(PAY_FREQ_LABEL), labels: PAY_FREQ_LABEL, w: 130 }, { k: 'anchor_date', label: 'A known pay date', type: 'date' },
    { k: 'net_amount', label: 'Take-home', type: 'money', cls: 'num' }, { k: 'gross_amount', label: 'Gross', type: 'money', cls: 'num' }, { k: '_m', label: 'Per month', type: 'ro', cls: 'num', fmt: p => fmtMoney(monthlyEquivalent(+p.net_amount || 0, p.frequency)) },
    { k: '_n', label: 'Next pay', type: 'ro', fmt: p => { const n = nextPayDate(p); return n ? `${fmtD(n)} · in ${diffDays(n, t)}d` : '—' } }, { k: '_l', label: 'Last pay', type: 'ro', fmt: p => fmtD(lastPayDate(p)) },
    { k: 'deposit_account_id', label: 'Deposited to', type: 'select', opts: ['', ...accts.map(a => a.id)], labels: { '': '—', ...acctLabels }, w: 150 }, { k: 'category_id', label: 'Income category', type: 'select', opts: ['', ...catOpts('income').map(c => c.id)], labels: { '': '—', ...catLabels }, w: 150 },
    { k: 'starts_on', label: 'Starts', type: 'date' }, { k: 'ends_on', label: 'Ends', type: 'date' }, { k: 'status', label: 'Status', type: 'select', opts: ['Active', 'Paused', 'Ended'], w: 95 }, { k: 'notes', label: 'Notes', type: 'text', w: 160 }, { k: 'ref', label: 'ID', type: 'ro', cls: 'id' }]
  const c = C()
  return <>
    <div className="kpis" style={{ marginBottom: 16 }}>
      <KPI l="Take-home per month" v={fmtMoney(monthly)} cls="good" s={`${act.length} active source${act.length === 1 ? '' : 's'} · ${fmtMoney(monthly * 12)}/yr`} />
      <KPI l="Next paycheck" v={nextPay ? fmtD(nextPay.d) : '—'} cls={nextPay ? (diffDays(nextPay.d, t) <= 3 ? 'good' : 'info') : 'idle'} s={nextPay ? `${nextPay.p.name} · ${fmtMoney(nextPay.p.net_amount)} · in ${diffDays(nextPay.d, t)} days` : 'add a pay schedule'} />
      <KPI l={`Expected · ${sp.label}`} v={fmtMoney(thisPeriod)} cls="info" s={`${act.flatMap(p => payDates(p, sp.start, sp.end)).length} pay dates in the period`} />
      <KPI l={`Received · ${sp.label}`} v={fmtMoney(received)} cls={received >= thisPeriod && thisPeriod > 0 ? 'good' : received > 0 ? 'warn' : 'idle'} s={thisPeriod ? `${Math.round(received / thisPeriod * 100)}% of expected` : 'income transactions this period'} />
      <KPI l="Pay cadence" v={act[0] ? PAY_FREQ_LABEL[act[0].frequency] : '—'} cls="info" s={act.length > 1 ? `primary source · ${act.length - 1} other` : 'primary source'} /></div>
    <div className="grid g12">
      <Card span={12} title="Income sources & pay schedules" hint="enter one known pay date and the cadence — every other pay date is computed" right={canEdit ? <Btn primary sm onClick={() => guarded(() => insert('paySchedules', { name: 'Paycheck', kind: 'salary', frequency: settings.payFrequencyDefault, anchor_date: t, net_amount: 0, deposit_account_id: accts.find(a => a.kind === 'checking')?.id || null, category_id: catOpts('income')[0]?.id || null, status: 'Active' }), 'Added — fill in the row')}>+ Add income source</Btn> : undefined}>
        <Table rows={data.paySchedules} cols={cols} editable={canEdit} onChange={(r, k, v) => guarded(() => update('paySchedules', r.id, { [k]: v } as Partial<PaySchedule>))} onDelete={async r => { if (await confirm(`Delete ${r.name}?`)) guarded(() => remove('paySchedules', r.id), 'Deleted') }} rowCls={r => r.status !== 'Active' ? 'st-idle ex-off' : 'st-good'} />
        <Note>Weekly / every-2-weeks schedules count from the known pay date; twice-a-month uses the 15th and the last day (change the days in Settings); monthly keeps the day of the month. The biggest active source drives the <b>pay period</b> budget cadence.</Note></Card>
      <Card span={6} title="Paychecks ahead" hint="next 90 days">{next90.length ? <div className="tblwrap" style={{ maxHeight: 360 }}><table className="tbl"><thead><tr><th>Date</th><th>Source</th><th className="num">Take-home</th><th>Into</th><th></th></tr></thead><tbody>{next90.map((x, i) => <tr key={i} className="st-good"><td>{fmtDY(x.d)} <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>in {diffDays(x.d, t)}d</span></td><td>{x.p.name}</td><td className="num">{fm2(x.p.net_amount)}</td><td style={{ fontSize: 12.5 }}>{acctName(x.p.deposit_account_id)}</td><td>{(() => { const got = paycheckOnFile(data, x.p, x.d); return got ? <span title={`${fm2(got.amount)} on ${fmtDY(got.date)}${got.payee ? ' from ' + got.payee : ''}`}><Pill cls="good">Recorded</Pill></span> : canEdit && <Btn sm onClick={() => open(<AddTxn onDone={close} preset={{ kind: 'income', amount: +x.p.net_amount, date: x.d, account_id: x.p.deposit_account_id, category_id: x.p.category_id, payee: x.p.payer || x.p.name, pay_schedule_id: x.p.id }} />, { wide: true })}>Received</Btn> })()}</td></tr>)}</tbody></table></div> : <div className="empty">Add an income source to see pay dates.</div>}
        <Note>Total in the next 90 days: <b>{fmtMoney(sum(next90.map(x => +x.p.net_amount || 0)))}</b>. <b>Received</b> logs the deposit when it lands (email capture can do this automatically); a payday whose deposit is already on file shows <b>Recorded</b>.</Note></Card>
      <Card span={6} title="Income received by month" hint="all income transactions · last 6 months"><Chart title="Income received by month" data={[{ type: 'bar', x: months.map(mShort), y: hist, marker: { color: c.good }, hovertemplate: '%{x}: $%{y:,.0f}<extra></extra>' }, { type: 'scatter', mode: 'lines', name: 'Expected / month', x: months.map(mShort), y: months.map(() => monthly), line: { color: c.blue, dash: 'dot', width: 2 }, hovertemplate: 'expected $%{y:,.0f}<extra></extra>' }]} layout={{ showlegend: true, yaxis: { tickprefix: '$' }, xaxis: { type: 'category' } }} height={260} />
        <Note>Months with three paychecks (every-2-weeks pay) show above the line — a good month to fund a goal or pay extra on debt.</Note></Card>
      <RecentPaychecks />
      <Card span={12} title="Status"><div className="btnrow">{data.paySchedules.map(p => <Pill key={p.id} cls={p.status === 'Active' ? 'good' : 'idle'}>{p.name} · {p.status}</Pill>)}</div></Card>
    </div>
  </>
}
