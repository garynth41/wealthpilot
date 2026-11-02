import { useSearchParams } from 'react-router-dom'
import { useMemo, useState, type FormEvent } from 'react'
import { useData } from '../app/hooks'
import { useStore } from '../app/store'
import type { Transaction, TxnKind } from '../app/data/types'
import { Card, Btn, Pill, KPI, useConfirm, Seg, Field, useModal, MHead, MBody, MFoot } from '../components/ui'
import { Table, type Col } from '../components/Table'
import { addDays, fmtD, today, monthStart, curMonth } from '../lib/dates'
import { parseNum, fm2, fmtMoney, sum } from '../lib/money'
import { post } from '../lib/ledger'
import { suggest, applySuggestion, planAutoCategorise, learnRule, upsertRule } from '../lib/rules'
import { spanFor } from '../lib/periods'
import { isLiability } from '../lib/accounts'

const SRC_PILL: Record<string, string> = { manual: 'info', email: 'wait', import: 'idle', recurring: 'good', statement: 'idle', adjustment: 'idle' }
export function TransactionsPage() {
  const { data, settings, update, remove, guarded, canEdit, catOpts, catLabels, accts, acctLabels, acctName, cat, saveSettings } = useData()
  const confirm = useConfirm(); const { open, close } = useModal()
  const [range, setRange] = useState<'period' | '30' | 'month' | '90' | 'all'>('period'); const [kind, setKind] = useState<'all' | TxnKind | 'uncat'>('all'); const [acct, setAcct] = useState('')
  const sp = spanFor(data, settings); const t = today()
  const from = range === 'period' ? sp.start : range === '30' ? addDays(t, -29) : range === 'month' ? monthStart(curMonth()) : range === '90' ? addDays(t, -89) : '0000'
  const to = range === 'period' ? sp.end : '9999'
  const [params, setParams] = useSearchParams(); const ids = useMemo(() => new Set((params.get('ids') || '').split(',').filter(Boolean)), [params])
  const rows = useMemo(() => data.transactions.filter(x => (ids.size ? ids.has(x.id) : x.date >= from && x.date <= to) && (kind === 'all' || (kind === 'uncat' ? !x.category_id && x.kind !== 'transfer' : x.kind === kind)) && (!acct || x.account_id === acct || x.to_account_id === acct)).sort((a, b) => b.date.localeCompare(a.date) || String(b.created_at || '').localeCompare(String(a.created_at || ''))), [data.transactions, from, to, kind, acct, ids])
  const inc = sum(rows.filter(x => x.kind === 'income' && x.status !== 'void').map(x => x.amount)), exp = sum(rows.filter(x => x.kind === 'expense' && x.status !== 'void').map(x => x.amount)), tr = sum(rows.filter(x => x.kind === 'transfer' && x.status !== 'void').map(x => x.amount))
  const uncat = data.transactions.filter(x => !x.category_id && x.kind !== 'transfer' && x.status !== 'void').length
  const change = (row: Transaction, k: string, v: unknown) => guarded(async () => {
    const patch: Partial<Transaction> = { [k]: v } as Partial<Transaction>
    if (['amount', 'kind', 'account_id', 'to_account_id', 'status'].includes(k)) { await post(data, (id, p) => update('accounts', id, p), row, -1); await update('transactions', row.id, patch); await post(data, (id, p) => update('accounts', id, p), { ...row, ...patch }, 1, (patch.date as string) || row.date) }
    else await update('transactions', row.id, patch)
    if (k === 'category_id' && v && row.payee && settings.learnRules !== false && row.kind !== 'transfer') { const r = learnRule(row.payee, { category_id: v as string }, row.kind as 'expense' | 'income'); if (r) await saveSettings({ rules: upsertRule(settings.rules || [], r) }) }
  })
  const autoCat = () => { const plan = planAutoCategorise(data, settings); if (!plan.length) return useStore.getState().toast('No uncategorized transaction matches a rule, a remembered payee or your history'); guarded(async () => { for (const p of plan) await update('transactions', p.t.id, p.patch) }, `${plan.length} transaction${plan.length === 1 ? '' : 's'} categorized`) }
  const del = async (row: Transaction) => { if (!(await confirm(`Delete ${row.payee || 'this transaction'} (${fm2(row.amount)} on ${fmtD(row.date)})? Account balances are adjusted back.`))) return; guarded(async () => { await post(data, (id, p) => update('accounts', id, p), row, -1); await remove('transactions', row.id) }, 'Transaction deleted') }
  const cols: Col<Transaction>[] = [
    { k: 'date', label: 'Date', type: 'date' }, { k: 'payee', label: 'Payee', type: 'text', w: 160, placeholder: 'Who' },
    { k: 'category_id', label: 'Category', type: 'select', opts: ['', ...catOpts(['expense', 'income', 'transfer']).map(c => c.id)], labels: { '': '— uncategorized —', ...catLabels }, w: 180, sortVal: r => cat(r.category_id)?.name || null },
    { k: 'amount', label: 'Amount', type: 'money', cls: 'num', w: 100 },
    { k: 'kind', label: 'Type', type: 'select', opts: ['expense', 'income', 'transfer'], labels: { expense: 'Expense', income: 'Income', transfer: 'Transfer' }, w: 100 },
    { k: 'account_id', label: 'Account', type: 'select', opts: ['', ...accts.map(a => a.id)], labels: { '': '—', ...acctLabels }, w: 150 },
    { k: 'to_account_id', label: 'To (transfer)', type: 'select', opts: ['', ...accts.map(a => a.id)], labels: { '': '—', ...acctLabels }, w: 150 },
    { k: 'status', label: 'Status', type: 'select', opts: ['cleared', 'pending', 'void'], labels: { cleared: 'Cleared', pending: 'Pending', void: 'Void' }, w: 95 },
    { k: 'memo', label: 'Memo', type: 'text', w: 180 }, { k: 'source', label: 'Source', type: 'ro', fmt: r => <Pill cls={SRC_PILL[r.source] || 'idle'}>{r.source}</Pill> }, { k: 'ref', label: 'ID', type: 'ro', cls: 'id' },
  ]
  const addForm = () => open(<AddTxn onDone={close} />, { wide: true })
  return <>
    {ids.size > 0 && <div className="banner info" style={{ marginBottom: 12 }}>Showing {rows.length} linked transaction{rows.length === 1 ? '' : 's'} from Insights. <button className="btn sm" onClick={() => setParams({})}>Show all</button></div>}
    <div className="kpis" style={{ marginBottom: 16 }}><KPI l="Income" v={fmtMoney(inc)} cls="good" s={`${rows.filter(x => x.kind === 'income').length} deposits`} /><KPI l="Spending" v={fmtMoney(exp)} cls="warn" s={`${rows.filter(x => x.kind === 'expense').length} transactions`} /><KPI l="Transfers & payments" v={fmtMoney(tr)} cls="info" s="to savings, cards and loans" /><KPI l="Net" v={(inc - exp - tr >= 0 ? '+' : '') + fmtMoney(inc - exp - tr)} cls={inc - exp - tr >= 0 ? 'good' : 'crit'} s="income − spending − transfers" /><KPI l="Uncategorized" v={String(uncat)} cls={uncat ? 'warn' : 'good'} s={uncat ? <>not counted against any budget line{canEdit && <> · <button className="btn sm" onClick={autoCat}>Auto-categorize</button></>}</> : 'everything is categorized'} /></div>
    <div className="slicers"><div className="slicer"><div className="l">Range</div><div className="opts">{([['period', sp.label], ['30', 'Last 30 days'], ['month', 'This month'], ['90', 'Last 90 days'], ['all', 'All']] as const).map(([v, l]) => <button key={v} className={range === v ? 'on' : ''} onClick={() => setRange(v)}>{l}</button>)}</div></div>
      <div className="slicer"><div className="l">Type</div><div className="opts">{([['all', 'All'], ['expense', 'Expenses'], ['income', 'Income'], ['transfer', 'Transfers'], ['uncat', 'Uncategorized']] as const).map(([v, l]) => <button key={v} className={kind === v ? 'on' : ''} onClick={() => setKind(v)}>{l}</button>)}</div></div>
      <div className="slicer"><div className="l">Account</div><div className="opts"><button className={acct ? '' : 'on'} onClick={() => setAcct('')}>All</button>{accts.map(a => <button key={a.id} className={acct === a.id ? 'on' : ''} onClick={() => setAcct(a.id)}>{acctName(a.id)}</button>)}</div></div></div>
    <Card title="Ledger" hint="click any cell to edit · amounts are always positive, the type gives the direction" right={canEdit ? <Btn primary sm onClick={addForm}>+ Add transaction</Btn> : undefined}>
      <Table rows={rows} cols={cols} onChange={change} onDelete={del} editable={canEdit} rowCls={r => r.status === 'void' ? 'st-idle ex-off' : r.status === 'pending' ? 'st-wait' : r.kind === 'income' ? 'st-good' : r.kind === 'transfer' ? 'st-info' : !r.category_id ? 'st-warn' : ''} empty="No transactions in this range. Add one, or sync your email on the Email page." />
      <div className="note">Expenses reduce the account they were paid from (a card's balance owed goes up); income adds to it; a transfer moves money between accounts and a transfer to a card or loan is a debt payment. Budget actuals are the sum of expenses by category for the period, so categorize everything.</div>
    </Card>
  </>
}
export function AddTxn({ onDone, preset }: { onDone: () => void; preset?: Partial<Transaction> }) {
  const { data, settings, insert, update, guarded, catOpts, catLabels, accts, acctLabels, saveSettings } = useData()
  const [f, setF] = useState<Partial<Transaction>>({ date: today(), kind: 'expense', amount: 0, account_id: accts.find(a => a.kind === 'checking')?.id || accts[0]?.id || null, to_account_id: null, category_id: null, payee: '', memo: '', status: 'cleared', ...preset })
  const [amt, setAmt] = useState(preset?.amount ? String(preset.amount) : '')
  const set = (k: keyof Transaction, v: unknown) => setF(x => ({ ...x, [k]: v }))
  const [hint, setHint] = useState('')
  const onPayeeBlur = () => { if (f.kind === 'transfer' || !f.payee) return; const sg = suggest(data, settings, { payee: f.payee, kind: f.kind as 'expense' | 'income' }); const patch = applySuggestion(f, sg); if (patch) { setF(x => ({ ...x, ...patch })); setHint(sg.how === 'rule' ? `category set by your rule "${sg.rule?.pattern}"` : sg.how === 'remembered' ? 'category from a remembered email payee' : 'category from how you filed this payee before') } }
  const kinds: Array<[TxnKind, string]> = [['expense', 'Expense'], ['income', 'Income'], ['transfer', 'Transfer / payment']]
  const submit = (e: FormEvent) => { e.preventDefault(); const a = parseNum(amt); if (!a || a <= 0) return
    guarded(async () => { const row = await insert('transactions', { ...f, amount: Math.round(a * 100) / 100, tags: [], source: 'manual', exclude_from_budget: false }); await post(data, (id, p) => update('accounts', id, p), row, 1, row.date)
      if (!hint && row.category_id && row.payee && row.kind !== 'transfer' && settings.learnRules !== false) { const r = learnRule(row.payee, { category_id: row.category_id }, row.kind as 'expense' | 'income'); if (r) await saveSettings({ rules: upsertRule(settings.rules || [], r) }) }
      onDone() }, `${fm2(a)} logged`) }
  const liabilityTo = f.kind === 'transfer' && f.to_account_id && isLiability(data.accounts.find(a => a.id === f.to_account_id)!)
  return <form onSubmit={submit}><MHead title="Add transaction" /><MBody>
    <div style={{ marginBottom: 12 }}><Seg value={f.kind as TxnKind} options={kinds} onChange={v => { set('kind', v); if (v !== 'transfer') set('to_account_id', null) }} /></div>
    <div className="grid3"><Field label="Date"><input className="inp" type="date" value={f.date || ''} onChange={e => set('date', e.target.value)} required /></Field><Field label="Amount"><input className="inp" inputMode="decimal" placeholder="0.00" value={amt} onChange={e => setAmt(e.target.value)} autoFocus required /></Field><Field label="Status"><select className="inp" value={f.status} onChange={e => set('status', e.target.value)}><option value="cleared">Cleared</option><option value="pending">Pending</option></select></Field></div>
    <div className="grid2"><Field label={f.kind === 'income' ? 'Deposited to' : f.kind === 'transfer' ? 'From account' : 'Paid from'}><select className="inp" value={f.account_id || ''} onChange={e => set('account_id', e.target.value || null)}><option value="">—</option>{accts.map(a => <option key={a.id} value={a.id}>{acctLabels[a.id]}</option>)}</select></Field>
      {f.kind === 'transfer' ? <Field label="To account" hint="a card or loan here = a debt payment"><select className="inp" value={f.to_account_id || ''} onChange={e => set('to_account_id', e.target.value || null)} required><option value="">—</option>{accts.filter(a => a.id !== f.account_id).map(a => <option key={a.id} value={a.id}>{acctLabels[a.id]}</option>)}</select></Field>
        : <Field label="Category"><select className="inp" value={f.category_id || ''} onChange={e => set('category_id', e.target.value || null)}><option value="">— uncategorized —</option>{catOpts(f.kind === 'income' ? 'income' : 'expense').map(c => <option key={c.id} value={c.id}>{catLabels[c.id]}</option>)}</select></Field>}</div>
    {f.kind === 'transfer' && <Field label="Budget line (optional)" hint={liabilityTo ? 'e.g. Credit card payments, so the payment shows in the budget' : 'e.g. Emergency fund, so the transfer counts toward that line'}><select className="inp" value={f.category_id || ''} onChange={e => set('category_id', e.target.value || null)}><option value="">— none —</option>{catOpts('expense').map(c => <option key={c.id} value={c.id}>{catLabels[c.id]}</option>)}</select></Field>}
    <div className="grid2"><Field label="Payee" hint={hint || undefined}><input className="inp" value={f.payee || ''} onChange={e => set('payee', e.target.value)} onBlur={onPayeeBlur} placeholder="Kroger, Landlord, Employer…" /></Field><Field label="Memo"><input className="inp" value={f.memo || ''} onChange={e => set('memo', e.target.value)} /></Field></div>
  </MBody><MFoot><Btn onClick={onDone}>Cancel</Btn><Btn type="submit" primary>Save</Btn></MFoot></form>
}
