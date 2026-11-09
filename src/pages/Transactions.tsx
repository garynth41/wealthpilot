import { useSearchParams } from 'react-router-dom'
import { useMemo, useRef, useState, type FormEvent } from 'react'
import { useData } from '../app/hooks'
import { useStore } from '../app/store'
import type { Account, Transaction, TransactionSplit, TxnKind, SavedView } from '../app/data/types'
import { Card, Btn, Pill, KPI, useConfirm, Seg, Field, useModal, MHead, MBody, MFoot, Note } from '../components/ui'
import { Table, type Col } from '../components/Table'
import { addDays, fmtD, today, monthStart, curMonth } from '../lib/dates'
import { parseNum, fm2, fmtMoney, sum } from '../lib/money'
import { post } from '../lib/ledger'
import { suggest, applySuggestion, planAutoCategorise, learnRule, upsertRule, similarEarlier, REVIEW_TAG } from '../lib/rules'
import { CommentsModal, commentsFor } from './Comments'
import { logGoalLinks } from '../app/goalLinks'
import { spanFor } from '../lib/periods'
import { isLiability, isRevolving } from '../lib/accounts'
import { splitsFor, validateSplits, splitRemaining, isSplit } from '../lib/splits'
import { DuplicatesReview, duplicateCounts } from './Duplicates'
import { AttachmentsModal, attachmentsFor } from './Attachments'
import { focusIdFrom, highlight } from '../lib/focus'
import { patchProblem, amountProblem, InputError } from '../lib/validate'
import { useEffect } from 'react'

const SRC_PILL: Record<string, string> = { manual: 'info', email: 'wait', import: 'idle', recurring: 'good', statement: 'idle', adjustment: 'idle' }
/** The name of a row's 📎 / 💬 button: "2 comments", "1 receipt", or "Comments" / "Receipts" when there are none. The button shows the count
 *  beside the icon, so the name holds that number as a word (WCAG 2.5.3 label in name — a count in brackets is not read as part of it). */
const countName = (n: number, noun: string) => n ? `${n} ${noun}${n === 1 ? '' : 's'}` : noun[0].toUpperCase() + noun.slice(1) + 's'
export function TransactionsPage() {
  const { data, settings, insert, update, remove, guarded, canEdit, catOpts, catLabels, accts, acctLabels, acctName, cat, saveSettings } = useData()
  const confirm = useConfirm(); const { open, close } = useModal()
  const [params, setParams] = useSearchParams()
  const [range, setRange] = useState<'period' | '30' | 'month' | '90' | 'all'>(() => params.get('tag') ? 'all' : 'period'); const [kind, setKind] = useState<'all' | TxnKind | 'uncat'>(() => params.get('kind') === 'uncat' ? 'uncat' : 'all'); const [acct, setAcct] = useState('')
  const [tag, setTag] = useState(() => params.get('tag') || ''); const [selected, setSelected] = useState<Set<string>>(new Set()); const [viewId, setViewId] = useState('')
  const allTags = useMemo(() => [...new Set(data.transactions.flatMap(x => x.tags || []))].sort(), [data.transactions])
  const acctUpd = (id: string, p: Partial<Account>) => update('accounts', id, p)
  const pushUndo = useStore.getState().pushUndo
  const sp = spanFor(data, settings); const t = today()
  const dupN = useMemo(() => duplicateCounts(data.transactions, data.duplicates, data.accounts), [data.transactions, data.duplicates, data.accounts]); const openDups = () => open(<DuplicatesReview onDone={close} />, { wide: true })
  const from = range === 'period' ? sp.start : range === '30' ? addDays(t, -29) : range === 'month' ? monthStart(curMonth()) : range === '90' ? addDays(t, -89) : '0000'
  const to = range === 'period' ? sp.end : '9999'
  const ids = useMemo(() => new Set((params.get('ids') || '').split(',').filter(Boolean)), [params])
  const rows = useMemo(() => data.transactions.filter(x => (ids.size ? ids.has(x.id) : x.date >= from && x.date <= to) && (kind === 'all' || (kind === 'uncat' ? !x.category_id && x.kind !== 'transfer' : x.kind === kind)) && (!acct || x.account_id === acct || x.to_account_id === acct) && (!tag || (x.tags || []).includes(tag))).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || ''))), [data.transactions, from, to, kind, acct, tag, ids])
  const focusId = focusIdFrom(params.toString() ? '?' + params.toString() : '')
  useEffect(() => { if (focusId && !rows.some(r => r.id === focusId) && data.transactions.some(t => t.id === focusId)) { setRange('all'); setKind('all'); setAcct(''); setTag('') } }, [focusId, rows, data.transactions])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const tg = params.get('tag'); if (tg) { setTag(tg); setRange('all') } if (params.get('kind') === 'uncat') setKind('uncat') }, [params])
  // a link that names a set (ids=, tag=, kind=uncat) rather than one row lands on the first row of that set (0.26.0)
  const firstOfSet = !focusId && (ids.size || params.get('tag') || params.get('kind')) ? ([...ids][0] || rows[0]?.id || '') : ''
  useEffect(() => { if (firstOfSet) setTimeout(() => highlight(firstOfSet), 200) }, [firstOfSet])
  const inc = sum(rows.filter(x => x.kind === 'income' && x.status !== 'void').map(x => x.amount)), exp = sum(rows.filter(x => x.kind === 'expense' && x.status !== 'void').map(x => x.amount)), tr = sum(rows.filter(x => x.kind === 'transfer' && x.status !== 'void').map(x => x.amount))
  const uncat = data.transactions.filter(x => !x.category_id && x.kind !== 'transfer' && x.status !== 'void').length
  const MOVES_MONEY = ['amount', 'kind', 'account_id', 'to_account_id', 'status']
  /** Apply a patch to one transaction, moving account balances when the patch changes them, and push an undo step that reverses both. */
  const applyPatch = async (row: Transaction, patch: Partial<Transaction>, undoable = true) => {
    const bad = patchProblem('transactions', patch as Record<string, unknown>); if (bad) throw new InputError(bad)   // before any balance moves
    const moves = Object.keys(patch).some(k => MOVES_MONEY.includes(k)); const inverse: Partial<Transaction> = {}; for (const k of Object.keys(patch)) (inverse as Record<string, unknown>)[k] = (row as unknown as Record<string, unknown>)[k] ?? null
    if (moves) { await post(data, acctUpd, row, -1); await update('transactions', row.id, patch); await post(data, acctUpd, { ...row, ...patch }, 1, (patch.date as string) || row.date) }
    else await update('transactions', row.id, patch)
    if (undoable) pushUndo({ label: 'edit transaction', run: async () => { const cur = useStore.getState().data.transactions.find(t => t.id === row.id); if (cur) await applyPatch(cur, inverse, false) } })
  }
  const change = (row: Transaction, k: string, v: unknown) => guarded(async () => {
    const val = k === 'tags' ? String(v ?? '').split(',').map(x => x.trim()).filter(Boolean) : v
    await applyPatch(row, { [k]: val } as Partial<Transaction>)
    if (k === 'category_id' && v && row.payee && settings.learnRules !== false && row.kind !== 'transfer') { const r = learnRule(row.payee, { category_id: v as string }, row.kind as 'expense' | 'income'); if (r) await saveSettings({ rules: upsertRule(settings.rules || [], r) }) }
    // "apply this to earlier ones too" (0.21.0): one tap re-files the same merchant's other rows from the last 12 months, as one undo step
    const st = useStore.getState(); const earlier = (k === 'category_id' || k === 'payee') && val ? similarEarlier(st.data, row, k, row.payee, val) : []
    if (earlier.length) { const n = earlier.length, what = k === 'payee' ? `${n} earlier transaction${n === 1 ? '' : 's'} still say "${row.payee}"` : `${n} earlier ${row.payee || 'similar'} transaction${n === 1 ? ' is' : 's are'} filed differently`
      st.toast(`Saved · ${what}`, false, { label: `Apply to ${n}`, run: () => { void st.guarded(() => st.bulkUpdate('transactions', earlier.map(x => x.id), { [k]: val } as Partial<Transaction>), `Applied to ${n} earlier transaction${n === 1 ? '' : 's'}`) } }) }
    else st.toast('Saved', false, { label: 'Undo', run: () => { void st.guarded(() => st.undoLast(), 'Undone') } })
  })
  const autoCat = () => { const plan = planAutoCategorise(data, settings); if (!plan.length) return useStore.getState().toast('No uncategorized transaction matches a rule, a remembered payee or your history'); guarded(async () => { for (const p of plan) await update('transactions', p.t.id, p.patch); await logGoalLinks(plan.map(p => p.t.id)) }, `${plan.length} transaction${plan.length === 1 ? '' : 's'} categorized`) }
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
  const openComments = (row: Transaction) => open(<CommentsModal txn={row} onDone={close} />, { wide: true })
  // saved views (0.19.0): a named filter pinned above the ledger, kept in household settings
  const views = settings.savedViews || []
  const applyView = (v: SavedView) => { setViewId(v.id); setRange(v.range); setKind(v.kind); setAcct(v.account_id || ''); setTag(v.tag || '') }
  const saveView = () => { const name = window.prompt('Name this view', `${kind === 'all' ? 'All' : kind} · ${range === 'period' ? sp.label : range}${tag ? ' · #' + tag : ''}`); if (!name) return; const v: SavedView = { id: 'v' + Date.now().toString(36), name: name.trim().slice(0, 40), range, kind, account_id: acct || null, tag: tag || null }; guarded(() => saveSettings({ savedViews: [...views, v] }), 'View saved'); setViewId(v.id) }
  const dropView = async (v: SavedView) => { if (!(await confirm(`Remove the saved view “${v.name}”? The transactions are not touched.`, 'Remove'))) return; guarded(() => saveSettings({ savedViews: views.filter(x => x.id !== v.id) }), 'View removed') }
  const cols: Col<Transaction>[] = [
    { k: 'date', label: 'Date', type: 'date', required: true }, { k: 'check_number', label: 'Chk #', type: 'text', w: 64, placeholder: '' }, { k: 'payee', label: 'Payee', type: 'text', w: 160, placeholder: 'Who' },
    { k: 'category_id', label: 'Category', type: 'select', opts: ['', ...catOpts(['expense', 'income', 'transfer']).map(c => c.id)], labels: { '': '— uncategorized —', ...catLabels }, w: 180, sortVal: r => cat(r.category_id)?.name || null },
    { k: 'amount', label: 'Amount', type: 'money', cls: 'num', w: 100, required: true },
    { k: 'kind', label: 'Type', type: 'select', opts: ['expense', 'income', 'transfer'], labels: { expense: 'Expense', income: 'Income', transfer: 'Transfer' }, w: 100 },
    { k: 'account_id', label: 'Account', type: 'select', opts: ['', ...accts.map(a => a.id)], labels: { '': '—', ...acctLabels }, w: 150 },
    { k: 'to_account_id', label: 'To (transfer)', type: 'select', opts: ['', ...accts.map(a => a.id)], labels: { '': '—', ...acctLabels }, w: 150 },
    { k: 'status', label: 'Status', type: 'select', opts: ['cleared', 'pending', 'void'], labels: { cleared: 'Cleared', pending: 'Pending', void: 'Void' }, w: 95 },
    { k: 'memo', label: 'Memo', type: 'text', w: 180 }, { k: 'tags', label: 'Tags', type: 'text', w: 130, placeholder: 'tag, tag', sortVal: r => (r.tags || []).join(',') || null }, { k: 'source', label: 'Source', type: 'ro', fmt: r => <Pill cls={SRC_PILL[r.source] || 'idle'}>{r.source}</Pill> }, { k: 'ref', label: 'ID', type: 'ro', cls: 'id' },
  ]
  const addForm = () => open(<AddTxn onDone={close} />, { wide: true })
  // home-screen shortcut (0.23.0): …/#/transactions?add=1 opens the add form straight away
  useEffect(() => { if (params.get('add') === '1' && canEdit) { const p = new URLSearchParams(params); p.delete('add'); setParams(p, { replace: true }); addForm() } }, [params, canEdit])   // eslint-disable-line react-hooks/exhaustive-deps
  const quickCat = (row: Transaction) => open(<QuickCategory row={row} onPick={id => { close(); change(row, 'category_id', id) }} onDone={close} />)
  return <>
    {ids.size > 0 && <div className="banner info" style={{ marginBottom: 12 }}>Showing {rows.length} linked transaction{rows.length === 1 ? '' : 's'} from Insights. <button type="button" className="btn sm" onClick={() => setParams({})}>Show all</button></div>}
    <div className="kpis" style={{ marginBottom: 16 }}><KPI l="Income" v={fmtMoney(inc)} cls="good" s={`${rows.filter(x => x.kind === 'income').length} deposits`} /><KPI l="Spending" v={fmtMoney(exp)} cls="warn" s={`${rows.filter(x => x.kind === 'expense').length} transactions`} /><KPI l="Transfers & payments" v={fmtMoney(tr)} cls="info" s="to savings, cards and loans" /><KPI l="Net" v={(inc - exp - tr >= 0 ? '+' : '') + fmtMoney(inc - exp - tr)} cls={inc - exp - tr >= 0 ? 'good' : 'crit'} s="income − spending − transfers" /><KPI l="Uncategorized" v={String(uncat)} cls={uncat ? 'warn' : 'good'} s={uncat ? <>not counted against any budget line{canEdit && <> · <button type="button" className="btn sm" onClick={autoCat}>Auto-categorize</button></>}</> : 'everything is categorized'} /></div>
    {views.length > 0 && <div className="slicer" style={{ marginBottom: 10 }}><div className="l">Saved views</div><div className="opts">{views.map(v => <span key={v.id} className="viewchip"><button type="button" className={viewId === v.id ? 'on' : ''} aria-pressed={viewId === v.id} onClick={() => applyView(v)} title={`${v.kind} · ${v.range}${v.tag ? ' · #' + v.tag : ''}`}>{v.name}</button>{canEdit && <button type="button" className="viewx" aria-label={`Remove view ${v.name}`} title="Remove this view" onClick={() => dropView(v)}>×</button>}</span>)}</div></div>}
    <div className="slicers"><div className="slicer"><div className="l">Range</div><div className="opts">{([['period', sp.label], ['30', 'Last 30 days'], ['month', 'This month'], ['90', 'Last 90 days'], ['all', 'All']] as const).map(([v, l]) => <button type="button" key={v} className={range === v ? 'on' : ''} aria-pressed={range === v} onClick={() => setRange(v)}>{l}</button>)}</div></div>
      <div className="slicer"><div className="l">Type</div><div className="opts">{([['all', 'All'], ['expense', 'Expenses'], ['income', 'Income'], ['transfer', 'Transfers'], ['uncat', 'Uncategorized']] as const).map(([v, l]) => <button type="button" key={v} className={kind === v ? 'on' : ''} aria-pressed={kind === v} onClick={() => setKind(v)}>{l}</button>)}</div></div>
      <div className="slicer"><div className="l">Account</div><div className="opts"><button type="button" className={acct ? '' : 'on'} aria-pressed={!acct} onClick={() => setAcct('')}>All</button>{accts.map(a => <button type="button" key={a.id} className={acct === a.id ? 'on' : ''} aria-pressed={acct === a.id} onClick={() => setAcct(a.id)}>{acctName(a.id)}</button>)}</div></div>
      {allTags.length > 0 && <div className="slicer"><div className="l">Tag</div><div className="opts"><button type="button" className={tag ? '' : 'on'} aria-pressed={!tag} onClick={() => setTag('')}>All</button>{allTags.map(tg => <button type="button" key={tg} className={tag === tg ? 'on' : ''} aria-pressed={tag === tg} onClick={() => setTag(tg)}>#{tg}</button>)}</div></div>}
      {canEdit && <div className="slicer"><div className="l">View</div><div className="opts"><button type="button" onClick={saveView} title="Pin the current range, type, account and tag as a named view">★ Save this view</button></div></div>}</div>
    {tag === REVIEW_TAG && rows.length > 0 && <div className="banner info" style={{ marginBottom: 12 }}>{rows.length} transaction{rows.length === 1 ? '' : 's'} flagged for review by your payee rules. Check each one, then clear the flag.{canEdit && <> <button type="button" className="btn sm" onClick={() => guarded(async () => { const before = rows.map(r => ({ id: r.id, tags: r.tags || [] })); for (const r of rows) await update('transactions', r.id, { tags: (r.tags || []).filter(x => x !== REVIEW_TAG) }); pushUndo({ label: 'mark reviewed', run: async () => { for (const b of before) await update('transactions', b.id, { tags: b.tags }) } }) }, `${rows.length} marked reviewed`)}>Mark all reviewed</button></>}</div>}
    {(dupN.review > 0 || dupN.pendingAuto > 0) && <div className="banner" style={{ marginBottom: 12 }}>{dupN.pendingAuto > 0 ? `${dupN.pendingAuto} duplicate${dupN.pendingAuto === 1 ? '' : 's'} found` : ''}{dupN.pendingAuto > 0 && dupN.review > 0 ? ' · ' : ''}{dupN.review > 0 ? `${dupN.review} possible duplicate${dupN.review === 1 ? '' : 's'} to check` : ''} <button type="button" className="btn sm" onClick={openDups}>Review</button></div>}
    <Card title="Ledger" hint="click any cell to edit · amounts are always positive, the type gives the direction · every transaction appears once: duplicates are merged" right={<span className="btnrow"><Btn sm onClick={openDups}>Duplicates{dupN.merged ? ` (${dupN.merged} merged)` : ''}</Btn>{canEdit && <Btn primary sm onClick={addForm}>+ Add transaction</Btn>}</span>}>
      {canEdit && selected.size > 0 && <BulkBar n={selected.size} catOpts={catOpts(['expense', 'income', 'transfer']).map(c => [c.id, catLabels[c.id]] as [string, string])} allTags={allTags} onCategory={id => bulk({ category_id: id || null }, 'Category set')} onBudget={on => bulk({ exclude_from_budget: !on }, on ? 'Counted in budget' : 'Excluded from budget')} onTag={bulkTag} onDelete={bulkDel} onClear={() => setSelected(new Set())} />}
      <Table rows={rows} cols={cols} onChange={change} onDelete={del} editable={canEdit} caption="Transactions" rowLabel={r => `${r.payee || (r.kind === 'transfer' ? 'Transfer' : 'Transaction')}, ${fm2(r.amount)}, ${fmtD(r.date)}`} onSwipe={canEdit ? (r, dir) => { if (dir === 'left' && r.kind !== 'transfer') quickCat(r) } : undefined} swipeHint="Swipe a card left to categorize it" selected={canEdit ? selected : undefined} onSelect={canEdit ? setSelected : undefined} actions={r => <>{r.kind !== 'transfer' && canEdit ? <Btn sm onClick={() => openSplit(r)} title="Split this transaction across categories">{isSplit(data, r) ? `Split (${splitsFor(data, r.id).length})` : 'Split'}</Btn> : isSplit(data, r) ? <Pill cls="info">split</Pill> : null}<Btn sm onClick={() => openFiles(r)} title="Receipts and documents" aria-label={countName(attachmentsFor(data, r.id).length, 'receipt')}>{attachmentsFor(data, r.id).length ? `📎 ${attachmentsFor(data, r.id).length}` : '📎'}</Btn><Btn sm onClick={() => openComments(r)} title="Comments" aria-label={countName(commentsFor(data, r.id).length, 'comment')}>{commentsFor(data, r.id).length ? `💬 ${commentsFor(data, r.id).length}` : '💬'}</Btn></>} rowCls={r => r.status === 'void' ? 'st-idle ex-off' : r.status === 'pending' ? 'st-wait' : r.kind === 'income' ? 'st-good' : r.kind === 'transfer' ? 'st-info' : !r.category_id ? 'st-warn' : ''} empty="No transactions in this range. Add one, or sync your email on the Email page." />
      <div className="note">Expenses reduce the account they were paid from (a card's balance owed goes up); income adds to it; a transfer moves money between accounts and a transfer to a card or loan is a debt payment. Budget actuals are the sum of expenses by category for the period, so categorize everything.</div>
    </Card>
  </>
}
export function AddTxn({ onDone, preset }: { onDone: () => void; preset?: Partial<Transaction> }) {
  const { data, settings, insert, update, guarded, catOpts, catLabels, accts, acctLabels, saveSettings, logPaycheck, toast } = useData()
  const [f, setF] = useState<Partial<Transaction>>({ date: today(), kind: 'expense', amount: 0, account_id: accts.find(a => a.kind === 'checking')?.id || accts[0]?.id || null, to_account_id: null, category_id: null, payee: '', memo: '', status: accts.find(a => a.kind === 'checking')?.bank_balance != null ? 'pending' : 'cleared', ...preset })
  const [amt, setAmt] = useState(preset?.amount ? String(preset.amount) : '')
  const [saving, setSaving] = useState(false)
  const set = (k: keyof Transaction, v: unknown) => setF(x => ({ ...x, [k]: v }))
  const [hint, setHint] = useState('')
  const onPayeeBlur = () => { if (f.kind === 'transfer' || !f.payee) return; const sg = suggest(data, settings, { payee: f.payee, kind: f.kind as 'expense' | 'income' }); const patch = applySuggestion(f, sg); if (patch) { setF(x => ({ ...x, ...patch })); setHint(sg.how === 'rule' ? `category set by your rule "${sg.rule?.pattern}"` : sg.how === 'remembered' ? 'category from a remembered email payee' : 'category from how you filed this payee before') } }
  const kinds: Array<[TxnKind, string]> = [['expense', 'Expense'], ['income', 'Income'], ['transfer', 'Transfer / payment']]
  // 0.25.1: anything that cannot be saved says why under its field and the dialog stays open (Enter used to do nothing, silently)
  const [err, setErr] = useState<{ date?: string; amount?: string; to?: string }>({}); const formRef = useRef<HTMLFormElement>(null)
  const submit = (e: FormEvent) => { e.preventDefault(); if (saving) return
    const problems = { date: f.date ? undefined : 'Enter the date.', amount: amountProblem(amt, { negative: 'Amounts are always positive — pick Expense, Income or Transfer above for the direction.' }) || undefined, to: f.kind === 'transfer' && !f.to_account_id ? 'Choose the account the money goes to.' : undefined }
    if (problems.date || problems.amount || problems.to) { setErr(problems); requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return }
    setErr({}); const a = parseNum(amt)!
    setSaving(true)
    void guarded(async () => { const body = { ...f, amount: Math.round(a * 100) / 100, tags: f.tags || [], source: 'manual' as const, exclude_from_budget: !!f.exclude_from_budget }
      let row: Transaction
      // 0.25.1: a paycheck (Income → Paychecks ahead → Received) is logged once — if that payday's deposit is already on file, nothing is added
      if (body.kind === 'income' && body.pay_schedule_id) { const r = await logPaycheck(body); if (r.existing) { toast(`Already recorded: ${fm2(r.txn.amount)} on ${fmtD(r.txn.date)}${r.txn.payee ? ` from ${r.txn.payee}` : ''} — nothing was added`); onDone(); return } row = r.txn }
      else { row = await insert('transactions', body); await post(data, (id, p) => update('accounts', id, p), row, 1, row.date) }
      await logGoalLinks([row.id])
      if (!hint && row.category_id && row.payee && row.kind !== 'transfer' && settings.learnRules !== false) { const r = learnRule(row.payee, { category_id: row.category_id }, row.kind as 'expense' | 'income'); if (r) await saveSettings({ rules: upsertRule(settings.rules || [], r) }) }
      toast(`${fm2(a)} logged`); onDone() }).finally(() => setSaving(false)) }
  const liabilityTo = f.kind === 'transfer' && f.to_account_id && isLiability(data.accounts.find(a => a.id === f.to_account_id)!)
  return <form onSubmit={submit} noValidate ref={formRef}><MHead title="Add transaction" /><MBody>
    <div style={{ marginBottom: 12 }}><Seg value={f.kind as TxnKind} options={kinds} onChange={v => { set('kind', v); if (v !== 'transfer') set('to_account_id', null) }} /></div>
    <div className="grid3"><Field label="Date" error={err.date}><input className="inp" type="date" value={f.date || ''} onChange={e => { set('date', e.target.value); if (err.date) setErr(x => ({ ...x, date: undefined })) }} required /></Field><Field label="Amount" error={err.amount}><input className="inp" inputMode="decimal" placeholder="0.00" value={amt} onChange={e => { setAmt(e.target.value); if (err.amount) setErr(x => ({ ...x, amount: undefined })) }} autoFocus required /></Field><Field label="Status" hint={accts.find(a => a.id === f.account_id)?.bank_balance != null ? 'this account has a bank feed: pending = outstanding until the bank shows it' : undefined}><select className="inp" value={f.status} onChange={e => set('status', e.target.value)}><option value="cleared">Cleared</option><option value="pending">Pending (outstanding)</option></select></Field></div>
    {f.kind === 'expense' && <Field label="Check number" hint="leave blank for card, ACH or cash"><input className="inp" inputMode="numeric" value={f.check_number || ''} onChange={e => set('check_number', e.target.value ? String(+e.target.value.replace(/\D/g, '') || '') : null)} style={{ maxWidth: 160 }} /></Field>}
    <div className="grid2"><Field label={f.kind === 'income' ? 'Deposited to' : f.kind === 'transfer' ? 'From account' : 'Paid from'}><select className="inp" value={f.account_id || ''} onChange={e => set('account_id', e.target.value || null)}><option value="">—</option>{accts.map(a => <option key={a.id} value={a.id}>{acctLabels[a.id]}</option>)}</select></Field>
      {f.kind === 'transfer' ? <Field label="To account" hint="a card or loan here = a debt payment" error={err.to}><select className="inp" value={f.to_account_id || ''} onChange={e => { set('to_account_id', e.target.value || null); if (err.to) setErr(x => ({ ...x, to: undefined })) }} required><option value="">—</option>{accts.filter(a => a.id !== f.account_id).map(a => <option key={a.id} value={a.id}>{acctLabels[a.id]}</option>)}</select></Field>
        : <Field label="Category"><select className="inp" value={f.category_id || ''} onChange={e => set('category_id', e.target.value || null)}><option value="">— uncategorized —</option>{catOpts(f.kind === 'income' ? 'income' : 'expense').map(c => <option key={c.id} value={c.id}>{catLabels[c.id]}</option>)}</select></Field>}</div>
    {f.kind === 'transfer' && <Field label="Budget line (optional)" hint={liabilityTo && isRevolving(data.accounts.find(a => a.id === f.to_account_id)!) ? 'not needed — a card payment is not spending: what you bought on the card already counts in its own lines' : liabilityTo ? 'e.g. Loan payments, so the payment counts in the budget' : ['savings', 'investment', 'retirement'].includes(data.accounts.find(a => a.id === f.to_account_id)?.kind || '') ? 'e.g. Emergency fund, so the transfer counts toward that line (as saving, not spending)' : 'e.g. Emergency fund, so the transfer counts toward that line'}><select className="inp" value={f.category_id || ''} onChange={e => set('category_id', e.target.value || null)}><option value="">— none —</option>{catOpts('expense').map(c => <option key={c.id} value={c.id}>{catLabels[c.id]}</option>)}</select></Field>}
    <div className="grid2"><Field label="Payee" hint={hint || undefined}><input className="inp" value={f.payee || ''} onChange={e => set('payee', e.target.value)} onBlur={onPayeeBlur} placeholder="Kroger, Landlord, Employer…" /></Field><Field label="Memo"><input className="inp" value={f.memo || ''} onChange={e => set('memo', e.target.value)} /></Field></div>
  </MBody><MFoot><Btn onClick={onDone}>Cancel</Btn><Btn type="submit" primary disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn></MFoot></form>
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
        <td><button type="button" className="del" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1}`} disabled={rows.length <= 2}>✕</button></td></tr>)}
    </tbody><tfoot><tr><td>{left !== 0 ? <span style={{ color: 'var(--crit-ink)' }}>{left > 0 ? `${fm2(left)} still to assign` : `${fm2(-left)} over`}</span> : <span style={{ color: 'var(--good-ink)' }}>Adds up</span>}</td><td className="num">{fm2(sum(slices.map(s => s.amount)))}</td><td colSpan={2}><span className="btnrow"><Btn sm onClick={() => setRows(rs => [...rs, { category_id: null, amount: left > 0 ? left.toFixed(2) : '0.00', memo: '' }])}>+ Line</Btn>{left !== 0 && rows.length > 0 && <Btn sm onClick={() => setRow(rows.length - 1, { amount: (Math.max(0, (parseNum(rows[rows.length - 1].amount) || 0) + left)).toFixed(2) })}>Put the rest on the last line</Btn>}</span></td></tr></tfoot></table></div>
    {problem && <div className="msg warn" style={{ marginTop: 10 }}>{problem}</div>}
  </MBody><MFoot>{existing.length > 0 && canEdit && <span style={{ marginRight: 'auto' }}><Btn danger onClick={unsplit}>Remove split</Btn></span>}<Btn onClick={onDone}>Cancel</Btn><Btn primary onClick={save} disabled={!!problem || !canEdit}>Save split</Btn></MFoot></>
}
/** The bulk-edit bar shown above the ledger while rows are selected. */
function BulkBar({ n, catOpts, allTags, onCategory, onBudget, onTag, onDelete, onClear }: { n: number; catOpts: Array<[string, string]>; allTags: string[]; onCategory: (id: string) => void; onBudget: (on: boolean) => void; onTag: (tag: string, on: boolean) => void; onDelete: () => void; onClear: () => void }) {
  const [tg, setTg] = useState('')
  return <div className="banner info" role="region" aria-label="Bulk edit" style={{ marginBottom: 10, gap: 8 }}><b>{n} selected</b>
    <select className="inp" style={{ width: 'auto' }} defaultValue="" onChange={e => { if (e.target.value !== '') { onCategory(e.target.value === '__none' ? '' : e.target.value); e.target.value = '' } }} aria-label="Set category for selected"><option value="">Set category…</option><option value="__none">— uncategorized —</option>{catOpts.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select>
    <span className="btnrow"><input className="inp" list="wp-tags" placeholder="tag" value={tg} onChange={e => setTg(e.target.value)} style={{ width: 120 }} aria-label="Tag to add or remove" /><datalist id="wp-tags">{allTags.map(t => <option key={t} value={t} />)}</datalist><Btn sm disabled={!tg.trim()} onClick={() => { onTag(tg.trim(), true); setTg('') }}>+ Tag</Btn><Btn sm disabled={!tg.trim()} onClick={() => { onTag(tg.trim(), false); setTg('') }}>− Tag</Btn></span>
    <span className="btnrow"><Btn sm onClick={() => onBudget(true)}>Count in budget</Btn><Btn sm onClick={() => onBudget(false)}>Exclude from budget</Btn><Btn sm danger onClick={onDelete}>Delete</Btn><Btn sm onClick={onClear}>Clear selection</Btn></span>
  </div>
}

/** Phones (0.23.0): the categories most likely for this transaction, one tap each — the rule or history suggestion first, then the
 *  categories used most for this kind of transaction, then every category. */
function QuickCategory({ row, onPick, onDone }: { row: Transaction; onPick: (id: string) => void; onDone: () => void }) {
  const { data, settings, catOpts, catLabels } = useData()
  const kind = row.kind === 'income' ? 'income' : 'expense'; const sg = suggest(data, settings, { payee: row.payee, kind })
  const counts = new Map<string, number>(); for (const t of data.transactions) if (t.kind === row.kind && t.category_id) counts.set(t.category_id, (counts.get(t.category_id) || 0) + 1)
  const opts = catOpts(kind); const top = [...new Set([...(sg.category_id ? [sg.category_id] : []), ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)])].filter(id => opts.some(c => c.id === id)).slice(0, 8)
  return <><MHead title={`Categorize · ${row.payee || 'transaction'} · ${fm2(row.amount)}`} /><MBody>
    <div className="quickcats">{top.map(id => <button type="button" key={id} className={`btn ${id === sg.category_id ? 'primary' : ''}`} onClick={() => onPick(id)}>{catLabels[id]}{id === sg.category_id ? ' · suggested' : ''}</button>)}</div>
    <Field label="Any category"><select className="inp" defaultValue="" onChange={e => { if (e.target.value) onPick(e.target.value) }}><option value="">Choose…</option>{opts.map(c => <option key={c.id} value={c.id}>{catLabels[c.id]}</option>)}</select></Field>
  </MBody><MFoot><Btn onClick={onDone}>Cancel</Btn></MFoot></>
}
