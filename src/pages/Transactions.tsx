import { useSearchParams } from 'react-router-dom'
import { useMemo, useState, type FormEvent } from 'react'
import { useData } from '../app/hooks'
import { useStore } from '../app/store'
import type { Account, Transaction, TransactionSplit, TxnKind, SavedView } from '../app/data/types'
import { Card, Btn, Pill, KPI, useConfirm, Seg, Field, useModal, MHead, MBody, MFoot, Note } from '../components/ui'
import { Table, type Col } from '../components/Table'
import { addDays, fmtD, today, monthStart, curMonth } from '../lib/dates'
import { parseNum, fm2, fmtMoney, sum } from '../lib/money'
import { post } from '../lib/ledger'
import { suggest, applySuggestion, planAutoCategorise, learnRule, upsertRule } from '../lib/rules'
import { spanFor } from '../lib/periods'
import { isLiability } from '../lib/accounts'
import { splitsFor, validateSplits, splitRemaining, isSplit } from '../lib/splits'
import { DuplicatesReview, duplicateCounts } from './Duplicates'
import { AttachmentsModal, attachmentsFor } from './Attachments'
import { focusIdFrom, highlight } from '../lib/focus'
import { useEffect } from 'react'

const SRC_PILL: Record<string, string> = { manual: 'info', email: 'wait', import: 'idle', recurring: 'good', statement: 'idle', adjustment: 'idle' }
export function TransactionsPage() {
  const { data, settings, insert, update, remove, guarded, canEdit, catOpts, catLabels, accts, acctLabels, acctName, cat, saveSettings } = useData()
  const confirm = useConfirm(); const { open, close } = useModal()
  const [range, setRange] = useState<'period' | '30' | 'month' | '90' | 'all'>('period'); const [kind, setKind] = useState<'all' | TxnKind | 'uncat'>('all'); const [acct, setAcct] = useState('')
  const [tag, setTag] = useState(''); const [selected, setSelected] = useState<Set<string>>(new Set()); const [viewId, setViewId] = useState('')
  const allTags = useMemo(() => [...new Set(data.transactions.flatMap(x => x.tags || []))].sort(), [data.transactions])
  const acctUpd = (id: string, p: Partial<Account>) => update('accounts', id, p)
  const pushUndo = useStore.getState().pushUndo
  const sp = spanFor(data, settings); const t = today()
  const dupN = useMemo(() => duplicateCounts(data.transactions, data.duplicates), [data.transactions, data.duplicates]); const openDups = () => open(<DuplicatesReview onDone={close} />, { wide: true })
  const from = range === 'period' ? sp.start : range === '30' ? addDays(t, -29) : range === 'month' ? monthStart(curMonth()) : range === '90' ? addDays(t, -89) : '0000'
  const to = range === 'period' ? sp.end : '9999'
  const [params, setParams] = useSearchParams(); const ids = useMemo(() => new Set((params.get('ids') || '').split(',').filter(Boolean)), [params])
  const rows = useMemo(() => data.transactions.filter(x => (ids.size ? ids.has(x.id) : x.date >= from && x.date <= to) && (kind === 'all' || (kind === 'uncat' ? !x.category_id && x.kind !== 'transfer' : x.kind === kind)) && (!acct || x.account_id === acct || x.to_account_id === acct) && (!tag || (x.tags || []).includes(tag))).sort((a, b) => b.date.localeCompare(a.date) || String(b.created_at || '').localeCompare(String(a.created_at || ''))), [data.transactions, from, to, kind, acct, tag, ids])
  const focusId = focusIdFrom(params.toString() ? '?' + params.toString() : '')
  useEffect(() => { if (focusId && !rows.some(r => r.id === focusId) && data.transactions.some(t => t.id === focusId)) { setRange('all'); setKind('all'); setAcct(''); setTag('') } }, [focusId, rows, data.transactions])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const first = [...ids][0]; if (first && !focusId) setTimeout(() => highlight(first), 200) }, [ids, focusId])
  const inc = sum(rows.filter(x => x.kind === 'income' && x.status !== 'void').map(x => x.amount)), exp = sum(rows.filter(x => x.kind === 'expense' && x.status !== 'void').map(x => x.amount)), tr = sum(rows.filter(x => x.kind === 'transfer' && x.status !== 'void').map(x => x.amount))
  const uncat = data.transactions.filter(x => !x.category_id && x.kind !== 'transfer' && x.status !== 'void').length
  const MOVES_MONEY = ['amount', 'kind', 'account_id', 'to_account_id', 'status']
  /** Apply a patch to one transaction, moving account balances when the patch changes them, and push an undo step that reverses both. */
  const applyPatch = async (row: Transaction, patch: Partial<Transaction>, undoable = true) => {
    const moves = Object.keys(patch).some(k => MOVES_MONEY.includes(k)); const inverse: Partial<Transaction> = {}; for (const k of Object.keys(patch)) (inverse as Record<string, unknown>)[k] = (row as unknown as Record<string, unknown>)[k] ?? null
    if (moves) { await post(data, acctUpd, row, -1); await update('transactions', row.id, patch); await post(data, acctUpd, { ...row, ...patch }, 1, (patch.date as string) || row.date) }
    else await update('transactions', row.id, patch)
    if (undoable) pushUndo({ label: 'edit transaction', run: async () => { const cur = useStore.getState().data.transactions.find(t => t.id === row.id); if (cur) await applyPatch(cur, inverse, false) } })
  }
  const change = (row: Transaction, k: string, v: unknown) => guarded(async () => {
    const val = k === 'tags' ? String(v ?? '').split(',').map(x => x.trim()).filter(Boolean) : v
    await applyPatch(row, { [k]: val } as Partial<Transaction>)
    if (k === 'category_id' && v && row.payee && settings.learnRules !== false && row.kind !== 'transfer') { const r = learnRule(row.payee, { category_id: v as string }, row.kind as 'expense' | 'income'); if (r) await saveSettings({ rules: upsertRule(settings.rules || [], r) }) }
  }, 'Saved')
  const autoCat = () => { const plan = planAutoCategorise(data, settings); if (!plan.length) return useStore.getState().toast('No uncategorized transaction matches a rule, a remembered payee or your history'); guarded(async () => { for (const p of plan) await update('transactions', p.t.id, p.patch) }, `${plan.length} transaction${plan.length === 1 ? '' : 's'} categorized`) }
  const reinsert = async (row: Transaction) => { const { id: _i, created_at: _c, updated_at: _u, created_by: _cb, updated_by: _ub, ref: _r, ...rest } = row; void _i; void _c; void _u; void _cb; void _ub; void _r; const back = await insert('transactions', rest); await post(data, acctUpd, back, 1, back.date) }
  const del = async (row: Transaction) => { if (!(await confirm(`Delete ${row.payee || 'this transaction'} (${fm2(row.amount)} on ${fmtD(row.date)})? Account balances are adjusted back.`))) return; guarded(async () => { await post(data, acctUpd, row, -1); await remove('transactions', row.id); pushUndo({ label: 'delete transaction', run: () => reinsert(row) }) }, 'Transaction deleted') }
  // bulk edit (0.19.0): the selected rows get one patch (category, tags, memo, in/out of budget) or are deleted, as one undo step
  const selRows = () => data.transactions.filter(x => selected.has(x.id))
  const bulk = (patch: Partial<Transaction>, label: string) => guarded(async () => { const n = await useStore.getState().bulkUpdate('transactions', [...selected], patch); return n }, `${label} on ${selected.size} transaction${selected.size === 1 ? '' : 's'}`)
  const bulkTag = (tg: string, on: boolean) => guarded(async () => { const rows = selRows(); const before = rows.map(r => ({ id: r.id, tags: r.tags || [] }))
    for (const r of rows) { const tags = on ? [...new Set([...(r.tags || []), tg])] : (r.tags || []).filter(x => x !== tg); await update('transactions', r.id, { tags }) }
    pushUndo({ label: 'tag', run: async () => { for (const b of before) await update('transactions', b.id, { tags: b.tags }) } }) }, `${on ? 'Tagged' : 'Untagged'} ${selected.size}`)
  const bulkDel = async () => { const rows = selRows(); if (!(await confirm(`Delete ${rows.length} transaction${rows.length === 1 ? '' : 's'}? Account balances are adjusted back.`))) return
    guarded(async () => { for (const r of rows) { await post(data, acctUpd, r, -1); await remove('transactions', r.id) } setSelected(new Set()); pushUndo({ label: 'delete', run: async () => { for (const r of rows) await reinsert(r) } }) }, `${rows.length} deleted`) }
  // split (0.19.0)
  const openSplit = (row: Transaction) => open(<SplitEditor txn={row} onDone={close} />, { wide: true })
  const openFiles = (row: Transaction) => open(<AttachmentsModal txn={row} onDone={close} />, { wide: true })
  // saved views (0.19.0): a named filter pinned above the ledger, kept in household settings
  const views = settings.savedViews || []
  const applyView = (v: SavedView) => { setViewId(v.id); setRange(v.range); setKind(v.kind); setAcct(v.account_id || ''); setTag(v.tag || '') }
  const saveView = () => { const name = window.prompt('Name this view', `${kind === 'all' ? 'All' : kind} · ${range === 'period' ? sp.label : range}${tag ? ' · #' + tag : ''}`); if (!name) return; const v: SavedView = { id: 'v' + Date.now().toString(36), name: name.trim().slice(0, 40), range, kind, account_id: acct || null, tag: tag || null }; guarded(() => saveSettings({ savedViews: [...views, v] }), 'View saved'); setViewId(v.id) }
  const dropView = (id: string) => guarded(() => saveSettings({ savedViews: views.filter(v => v.id !== id) }), 'View removed')
  const cols: Col<Transaction>[] = [
    { k: 'date', label: 'Date', type: 'date' }, { k: 'check_number', label: 'Chk #', type: 'text', w: 64, placeholder: '' }, { k: 'payee', label: 'Payee', type: 'text', w: 160, placeholder: 'Who' },
    { k: 'category_id', label: 'Category', type: 'select', opts: ['', ...catOpts(['expense', 'income', 'transfer']).map(c => c.id)], labels: { '': '— uncategorized —', ...catLabels }, w: 180, sortVal: r => cat(r.category_id)?.name || null },
    { k: 'amount', label: 'Amount', type: 'money', cls: 'num', w: 100 },
    { k: 'kind', label: 'Type', type: 'select', opts: ['expense', 'income', 'transfer'], labels: { expense: 'Expense', income: 'Income', transfer: 'Transfer' }, w: 100 },
    { k: 'account_id', label: 'Account', type: 'select', opts: ['', ...accts.map(a => a.id)], labels: { '': '—', ...acctLabels }, w: 150 },
    { k: 'to_account_id', label: 'To (transfer)', type: 'select', opts: ['', ...accts.map(a => a.id)], labels: { '': '—', ...acctLabels }, w: 150 },
    { k: 'status', label: 'Status', type: 'select', opts: ['cleared', 'pending', 'void'], labels: { cleared: 'Cleared', pending: 'Pending', void: 'Void' }, w: 95 },
    { k: 'memo', label: 'Memo', type: 'text', w: 180 }, { k: 'tags', label: 'Tags', type: 'text', w: 130, placeholder: 'tag, tag', sortVal: r => (r.tags || []).join(',') || null }, { k: 'source', label: 'Source', type: 'ro', fmt: r => <Pill cls={SRC_PILL[r.source] || 'idle'}>{r.source}</Pill> }, { k: 'ref', label: 'ID', type: 'ro', cls: 'id' },
  ]
  const addForm = () => open(<AddTxn onDone={close} />, { wide: true })
  return <>
    {ids.size > 0 && <div className="banner info" style={{ marginBottom: 12 }}>Showing {rows.length} linked transaction{rows.length === 1 ? '' : 's'} from Insights. <button className="btn sm" onClick={() => setParams({})}>Show all</button></div>}
    <div className="kpis" style={{ marginBottom: 16 }}><KPI l="Income" v={fmtMoney(inc)} cls="good" s={`${rows.filter(x => x.kind === 'income').length} deposits`} /><KPI l="Spending" v={fmtMoney(exp)} cls="warn" s={`${rows.filter(x => x.kind === 'expense').length} transactions`} /><KPI l="Transfers & payments" v={fmtMoney(tr)} cls="info" s="to savings, cards and loans" /><KPI l="Net" v={(inc - exp - tr >= 0 ? '+' : '') + fmtMoney(inc - exp - tr)} cls={inc - exp - tr >= 0 ? 'good' : 'crit'} s="income − spending − transfers" /><KPI l="Uncategorized" v={String(uncat)} cls={uncat ? 'warn' : 'good'} s={uncat ? <>not counted against any budget line{canEdit && <> · <button className="btn sm" onClick={autoCat}>Auto-categorize</button></>}</> : 'everything is categorized'} /></div>
    {views.length > 0 && <div className="slicer" style={{ marginBottom: 10 }}><div className="l">Saved views</div><div className="opts">{views.map(v => <button key={v.id} className={viewId === v.id ? 'on' : ''} onClick={() => applyView(v)} title={`${v.kind} · ${v.range}${v.tag ? ' · #' + v.tag : ''}`}>{v.name}{canEdit && <span role="button" aria-label={`Remove view ${v.name}`} onClick={e => { e.stopPropagation(); dropView(v.id) }} style={{ marginLeft: 6, opacity: .6 }}>×</span>}</button>)}</div></div>}
    <div className="slicers"><div className="slicer"><div className="l">Range</div><div className="opts">{([['period', sp.label], ['30', 'Last 30 days'], ['month', 'This month'], ['90', 'Last 90 days'], ['all', 'All']] as const).map(([v, l]) => <button key={v} className={range === v ? 'on' : ''} onClick={() => setRange(v)}>{l}</button>)}</div></div>
      <div className="slicer"><div className="l">Type</div><div className="opts">{([['all', 'All'], ['expense', 'Expenses'], ['income', 'Income'], ['transfer', 'Transfers'], ['uncat', 'Uncategorized']] as const).map(([v, l]) => <button key={v} className={kind === v ? 'on' : ''} onClick={() => setKind(v)}>{l}</button>)}</div></div>
      <div className="slicer"><div className="l">Account</div><div className="opts"><button className={acct ? '' : 'on'} onClick={() => setAcct('')}>All</button>{accts.map(a => <button key={a.id} className={acct === a.id ? 'on' : ''} onClick={() => setAcct(a.id)}>{acctName(a.id)}</button>)}</div></div>
      {allTags.length > 0 && <div className="slicer"><div className="l">Tag</div><div className="opts"><button className={tag ? '' : 'on'} onClick={() => setTag('')}>All</button>{allTags.map(tg => <button key={tg} className={tag === tg ? 'on' : ''} onClick={() => setTag(tg)}>#{tg}</button>)}</div></div>}
      {canEdit && <div className="slicer"><div className="l">View</div><div className="opts"><button onClick={saveView} title="Pin the current range, type, account and tag as a named view">★ Save this view</button></div></div>}</div>
    {(dupN.review > 0 || dupN.pendingAuto > 0) && <div className="banner" style={{ marginBottom: 12 }}>{dupN.pendingAuto > 0 ? `${dupN.pendingAuto} duplicate${dupN.pendingAuto === 1 ? '' : 's'} found` : ''}{dupN.pendingAuto > 0 && dupN.review > 0 ? ' · ' : ''}{dupN.review > 0 ? `${dupN.review} possible duplicate${dupN.review === 1 ? '' : 's'} to check` : ''} <button className="btn sm" onClick={openDups}>Review</button></div>}
    <Card title="Ledger" hint="click any cell to edit · amounts are always positive, the type gives the direction · every transaction appears once: duplicates are merged" right={<span className="btnrow"><Btn sm onClick={openDups}>Duplicates{dupN.merged ? ` (${dupN.merged} merged)` : ''}</Btn>{canEdit && <Btn primary sm onClick={addForm}>+ Add transaction</Btn>}</span>}>
      {canEdit && selected.size > 0 && <BulkBar n={selected.size} catOpts={catOpts(['expense', 'income', 'transfer']).map(c => [c.id, catLabels[c.id]] as [string, string])} allTags={allTags} onCategory={id => bulk({ category_id: id || null }, 'Category set')} onBudget={on => bulk({ exclude_from_budget: !on }, on ? 'Counted in budget' : 'Excluded from budget')} onTag={bulkTag} onDelete={bulkDel} onClear={() => setSelected(new Set())} />}
      <Table rows={rows} cols={cols} onChange={change} onDelete={del} editable={canEdit} caption="Transactions" selected={canEdit ? selected : undefined} onSelect={canEdit ? setSelected : undefined} actions={r => <>{r.kind !== 'transfer' && canEdit ? <Btn sm onClick={() => openSplit(r)} title="Split this transaction across categories">{isSplit(data, r) ? `Split (${splitsFor(data, r.id).length})` : 'Split'}</Btn> : isSplit(data, r) ? <Pill cls="info">split</Pill> : null}<Btn sm onClick={() => openFiles(r)} title="Receipts and documents">{attachmentsFor(data, r.id).length ? `📎 ${attachmentsFor(data, r.id).length}` : '📎'}</Btn></>} rowCls={r => r.status === 'void' ? 'st-idle ex-off' : r.status === 'pending' ? 'st-wait' : r.kind === 'income' ? 'st-good' : r.kind === 'transfer' ? 'st-info' : !r.category_id ? 'st-warn' : ''} empty="No transactions in this range. Add one, or sync your email on the Email page." />
      <div className="note">Expenses reduce the account they were paid from (a card's balance owed goes up); income adds to it; a transfer moves money between accounts and a transfer to a card or loan is a debt payment. Budget actuals are the sum of expenses by category for the period, so categorize everything.</div>
    </Card>
  </>
}
export function AddTxn({ onDone, preset }: { onDone: () => void; preset?: Partial<Transaction> }) {
  const { data, settings, insert, update, guarded, catOpts, catLabels, accts, acctLabels, saveSettings } = useData()
  const [f, setF] = useState<Partial<Transaction>>({ date: today(), kind: 'expense', amount: 0, account_id: accts.find(a => a.kind === 'checking')?.id || accts[0]?.id || null, to_account_id: null, category_id: null, payee: '', memo: '', status: accts.find(a => a.kind === 'checking')?.bank_balance != null ? 'pending' : 'cleared', ...preset })
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
    <div className="grid3"><Field label="Date"><input className="inp" type="date" value={f.date || ''} onChange={e => set('date', e.target.value)} required /></Field><Field label="Amount"><input className="inp" inputMode="decimal" placeholder="0.00" value={amt} onChange={e => setAmt(e.target.value)} autoFocus required /></Field><Field label="Status" hint={accts.find(a => a.id === f.account_id)?.bank_balance != null ? 'this account has a bank feed: pending = outstanding until the bank shows it' : undefined}><select className="inp" value={f.status} onChange={e => set('status', e.target.value)}><option value="cleared">Cleared</option><option value="pending">Pending (outstanding)</option></select></Field></div>
    {f.kind === 'expense' && <Field label="Check number" hint="leave blank for card, ACH or cash"><input className="inp" inputMode="numeric" value={f.check_number || ''} onChange={e => set('check_number', e.target.value ? String(+e.target.value.replace(/\D/g, '') || '') : null)} style={{ maxWidth: 160 }} /></Field>}
    <div className="grid2"><Field label={f.kind === 'income' ? 'Deposited to' : f.kind === 'transfer' ? 'From account' : 'Paid from'}><select className="inp" value={f.account_id || ''} onChange={e => set('account_id', e.target.value || null)}><option value="">—</option>{accts.map(a => <option key={a.id} value={a.id}>{acctLabels[a.id]}</option>)}</select></Field>
      {f.kind === 'transfer' ? <Field label="To account" hint="a card or loan here = a debt payment"><select className="inp" value={f.to_account_id || ''} onChange={e => set('to_account_id', e.target.value || null)} required><option value="">—</option>{accts.filter(a => a.id !== f.account_id).map(a => <option key={a.id} value={a.id}>{acctLabels[a.id]}</option>)}</select></Field>
        : <Field label="Category"><select className="inp" value={f.category_id || ''} onChange={e => set('category_id', e.target.value || null)}><option value="">— uncategorized —</option>{catOpts(f.kind === 'income' ? 'income' : 'expense').map(c => <option key={c.id} value={c.id}>{catLabels[c.id]}</option>)}</select></Field>}</div>
    {f.kind === 'transfer' && <Field label="Budget line (optional)" hint={liabilityTo ? 'e.g. Credit card payments, so the payment shows in the budget' : 'e.g. Emergency fund, so the transfer counts toward that line'}><select className="inp" value={f.category_id || ''} onChange={e => set('category_id', e.target.value || null)}><option value="">— none —</option>{catOpts('expense').map(c => <option key={c.id} value={c.id}>{catLabels[c.id]}</option>)}</select></Field>}
    <div className="grid2"><Field label="Payee" hint={hint || undefined}><input className="inp" value={f.payee || ''} onChange={e => set('payee', e.target.value)} onBlur={onPayeeBlur} placeholder="Kroger, Landlord, Employer…" /></Field><Field label="Memo"><input className="inp" value={f.memo || ''} onChange={e => set('memo', e.target.value)} /></Field></div>
  </MBody><MFoot><Btn onClick={onDone}>Cancel</Btn><Btn type="submit" primary>Save</Btn></MFoot></form>
}

/** Split one transaction across categories. Slices must add up to the transaction; the parent's category becomes a display default. */
export function SplitEditor({ txn, onDone }: { txn: Transaction; onDone: () => void }) {
  const { data, insert, update, remove, guarded, catOpts, catLabels, canEdit } = useData()
  const existing = splitsFor(data, txn.id)
  const [rows, setRows] = useState<Array<{ id?: string; category_id: string | null; amount: string; memo: string }>>(existing.length ? existing.map(s => ({ id: s.id, category_id: s.category_id || null, amount: (+s.amount).toFixed(2), memo: s.memo || '' })) : [{ category_id: txn.category_id || null, amount: txn.amount.toFixed(2), memo: '' }, { category_id: null, amount: '0.00', memo: '' }])
  const slices = rows.map(r => ({ amount: parseNum(r.amount) || 0, category_id: r.category_id })); const problem = validateSplits(txn.amount, slices); const left = splitRemaining(txn.amount, slices)
  const setRow = (i: number, p: Partial<typeof rows[number]>) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...p } : r))
  const save = () => guarded(async () => {
    const keep = new Set<string>()
    for (let i = 0; i < rows.length; i++) { const r = rows[i]; const body: Partial<TransactionSplit> = { transaction_id: txn.id, category_id: r.category_id, amount: Math.round((parseNum(r.amount) || 0) * 100) / 100, memo: r.memo || null, sort_order: i }
      if (r.id) { await update('splits', r.id, body); keep.add(r.id) } else { const n = await insert('splits', body); keep.add(n.id) } }
    for (const s of existing) if (!keep.has(s.id)) await remove('splits', s.id)
    onDone() }, 'Split saved')
  const unsplit = () => guarded(async () => { for (const s of existing) await remove('splits', s.id); onDone() }, 'Split removed — the transaction counts whole again')
  return <><MHead title={`Split: ${txn.payee || 'transaction'} · ${fm2(txn.amount)} on ${fmtD(txn.date)}`} /><MBody>
    <Note>Each line counts against its own category in budgets and reports. The lines must add up to {fm2(txn.amount)}.</Note>
    <div className="tblwrap" style={{ marginTop: 10 }}><table className="tbl"><caption className="sr-only">Split lines</caption><thead><tr><th scope="col">Category</th><th scope="col" className="num">Amount</th><th scope="col">Memo</th><th /></tr></thead><tbody>
      {rows.map((r, i) => <tr key={i}><td><select className="inp" value={r.category_id || ''} onChange={e => setRow(i, { category_id: e.target.value || null })} aria-label={`Category for line ${i + 1}`}><option value="">— uncategorized —</option>{catOpts(txn.kind === 'income' ? 'income' : 'expense').map(c => <option key={c.id} value={c.id}>{catLabels[c.id]}</option>)}</select></td>
        <td className="num"><input className="inp num" inputMode="decimal" value={r.amount} onChange={e => setRow(i, { amount: e.target.value })} aria-label={`Amount for line ${i + 1}`} style={{ width: 110, textAlign: 'right' }} /></td>
        <td><input className="inp" value={r.memo} onChange={e => setRow(i, { memo: e.target.value })} aria-label={`Memo for line ${i + 1}`} /></td>
        <td><button className="del" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1}`} disabled={rows.length <= 2}>✕</button></td></tr>)}
    </tbody><tfoot><tr><td>{left !== 0 ? <span style={{ color: 'var(--crit-ink)' }}>{left > 0 ? `${fm2(left)} still to assign` : `${fm2(-left)} over`}</span> : <span style={{ color: 'var(--good-ink)' }}>Adds up</span>}</td><td className="num">{fm2(sum(slices.map(s => s.amount)))}</td><td colSpan={2}><span className="btnrow"><Btn sm onClick={() => setRows(rs => [...rs, { category_id: null, amount: left > 0 ? left.toFixed(2) : '0.00', memo: '' }])}>+ Line</Btn>{left !== 0 && rows.length > 0 && <Btn sm onClick={() => setRow(rows.length - 1, { amount: (Math.max(0, (parseNum(rows[rows.length - 1].amount) || 0) + left)).toFixed(2) })}>Put the rest on the last line</Btn>}</span></td></tr></tfoot></table></div>
    {problem && <div className="msg warn" style={{ marginTop: 10 }}>{problem}</div>}
  </MBody><MFoot>{existing.length > 0 && canEdit && <span style={{ marginRight: 'auto' }}><Btn danger onClick={unsplit}>Remove split</Btn></span>}<Btn onClick={onDone}>Cancel</Btn><Btn primary onClick={save} disabled={!!problem || !canEdit}>Save split</Btn></MFoot></>
}
/** The bulk-edit bar shown above the ledger while rows are selected. */
function BulkBar({ n, catOpts, allTags, onCategory, onBudget, onTag, onDelete, onClear }: { n: number; catOpts: Array<[string, string]>; allTags: string[]; onCategory: (id: string) => void; onBudget: (on: boolean) => void; onTag: (tag: string, on: boolean) => void; onDelete: () => void; onClear: () => void }) {
  const [tg, setTg] = useState('')
  return <div className="banner info" role="region" aria-label="Bulk edit" style={{ marginBottom: 10, gap: 8 }}><b>{n} selected</b>
    <select className="inp" style={{ width: 'auto', minHeight: 36 }} defaultValue="" onChange={e => { if (e.target.value !== '') { onCategory(e.target.value === '__none' ? '' : e.target.value); e.target.value = '' } }} aria-label="Set category for selected"><option value="">Set category…</option><option value="__none">— uncategorized —</option>{catOpts.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select>
    <span className="btnrow"><input className="inp" list="wp-tags" placeholder="tag" value={tg} onChange={e => setTg(e.target.value)} style={{ width: 120, minHeight: 36 }} aria-label="Tag to add or remove" /><datalist id="wp-tags">{allTags.map(t => <option key={t} value={t} />)}</datalist><Btn sm disabled={!tg.trim()} onClick={() => { onTag(tg.trim(), true); setTg('') }}>+ Tag</Btn><Btn sm disabled={!tg.trim()} onClick={() => { onTag(tg.trim(), false); setTg('') }}>− Tag</Btn></span>
    <span className="btnrow"><Btn sm onClick={() => onBudget(true)}>Count in budget</Btn><Btn sm onClick={() => onBudget(false)}>Exclude from budget</Btn><Btn sm danger onClick={onDelete}>Delete</Btn><Btn sm onClick={onClear}>Clear selection</Btn></span>
  </div>
}
