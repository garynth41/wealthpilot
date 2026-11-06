// Checkbook Reconciliation — register, matching, statement reconciliation, issues, history. All rules in lib/reconcile.ts and lib/dedupe.ts.
import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../app/hooks'
import { useStore } from '../app/store'
import type { Transaction, Account } from '../app/data/types'
import { Card, KPI, Btn, Pill, Note, Field, Seg, Empty, useConfirm } from '../components/ui'
import { accountState, outstanding, unreconciled, suggestMatches, reconcileStatement, defaultCleared, findIssues, effectOn, itemType, AUTO_MATCH_SCORE, type RTxn } from '../lib/reconcile'
import { keeperPatch, type DTxn } from '../lib/dedupe'
import { fmtD, fmtDY, today, ago, fmtDT } from '../lib/dates'
import { fm2, fmtMoney, parseNum } from '../lib/money'
import { acctLabel, isLiability } from '../lib/accounts'
import { post } from '../lib/ledger'
import { linkTo } from '../lib/focus'

const KIND_LABEL: Record<string, string> = { check: 'Check', payment: 'Payment', deposit: 'Deposit', transfer: 'Transfer' }
const AUDIT_PILL: Record<string, string> = { sync: 'good', import: 'info', sync_failure: 'crit', override: 'warn', adjustment: 'warn', reconciliation: 'good', match: 'info', unmatch: 'warn', balance_change: 'idle', correction: 'warn', register: 'idle' }

export function ReconcilePage() {
  const { data, accts, canEdit, guarded, repo } = useData(); const st = useStore.getState; const confirm = useConfirm()
  const cashAccts = useMemo(() => accts.filter(a => ['checking', 'savings', 'cash', 'credit_card', 'line_of_credit', 'store_card'].includes(a.kind)), [accts])
  const [acctId, setAcctId] = useState(cashAccts.find(a => a.bank_balance != null)?.id || cashAccts[0]?.id || '')
  const a = cashAccts.find(x => x.id === acctId) || null
  const txns = data.transactions as unknown as RTxn[]
  const mine = useMemo(() => a ? txns.filter(t => t.account_id === a.id || t.to_account_id === a.id) : [], [txns, a])
  const state = useMemo(() => a ? accountState(a, mine) : null, [a, mine])
  const lastSync = data.audit.find(e => e.kind === 'sync')?.created_at?.slice(0, 10) || null
  const issues = useMemo(() => a ? findIssues(a, [...mine, ...(data.duplicates as unknown as RTxn[]).filter(t => t.account_id === a.id)], today(), a.bank_balance_as_of || lastSync) : [], [a, mine, data.duplicates, lastSync])
  const suggestions = useMemo(() => a ? suggestMatches(mine, a) : [], [a, mine])
  const byId = useMemo(() => new Map(data.transactions.map(t => [t.id, t])), [data.transactions])
  const [tab, setTab] = useState<'register' | 'match' | 'statement' | 'issues' | 'history'>('register')
  const eff = (t: RTxn) => a ? effectOn(t, a.id, a.kind) : 0
  const line = (t: Transaction, extra?: React.ReactNode) => <tr key={t.id}><td>{fmtD(t.date)}</td><td>{t.check_number ? '#' + +t.check_number : ''}</td><td>{t.payee}</td><td style={{ color: 'var(--ink-3)' }}>{t.memo}</td><td className="num" style={{ color: eff(t as RTxn) < 0 ? 'var(--crit-ink)' : 'var(--good-ink)' }}>{eff(t as RTxn) < 0 ? '−' : '+'}{fm2(Math.abs(eff(t as RTxn)))}</td><td>{extra}</td></tr>

  // --- matching ---
  const doMatch = (entryId: string, bankId: string, score: number) => guarded(async () => {
    const e = byId.get(entryId)!, b = byId.get(bankId)!
    await st().mergeDuplicates(b.id, [e.id], keeperPatch(b as unknown as DTxn, [e as unknown as DTxn]) as Partial<Transaction>)
    await st().update('transactions', b.id, { cleared_on: b.date })
    await repo!.logAudit(score < AUTO_MATCH_SCORE ? 'override' : 'match', `${score < AUTO_MATCH_SCORE ? 'Matched by hand' : 'Matched'}: ${e.check_number ? 'check #' + +e.check_number + ' ' : ''}${e.payee || ''} ${fm2(e.amount)} → bank ${fmtD(b.date)} (score ${score})`, { entry: e.id, bank: b.id, score, manual: score < AUTO_MATCH_SCORE }, a!.id); await st().refresh()
  }, 'Matched')
  const matchAll = () => guarded(async () => { let n = 0; for (const s of suggestions.filter(x => x.auto)) { await doMatch(s.entryId, s.bankId, s.score); n++ } return n }, 'Automatic matches applied')
  const notMatch = (entryId: string) => guarded(async () => { await st().update('transactions', entryId, { dedupe_ok: true }); await repo!.logAudit('unmatch', `Marked as not a match: ${byId.get(entryId)?.payee || ''} ${fm2(byId.get(entryId)?.amount || 0)}`, { entry: entryId }, a!.id) }, 'Kept separate — it stays outstanding until you match it by hand')
  const markCleared = (t: Transaction) => guarded(async () => { await st().update('transactions', t.id, { status: 'cleared', cleared_on: today() }); await repo!.logAudit('correction', `Marked cleared by hand: ${t.payee || ''} ${fm2(t.amount)}`, { txn: t.id }, a!.id) }, 'Marked cleared')
  const voidEntry = async (t: Transaction) => { if (!(await confirm(`Void ${t.check_number ? 'check #' + +t.check_number : 'this entry'} (${fm2(t.amount)})? It stays in the register as void and stops counting.`, 'Void'))) return; guarded(async () => { await post(data, (id, p) => st().update('accounts', id, p), t, -1); await st().update('transactions', t.id, { status: 'void' }); await repo!.logAudit('correction', `Voided: ${t.check_number ? 'check #' + +t.check_number + ' ' : ''}${t.payee || ''} ${fm2(t.amount)}`, { txn: t.id }, a!.id) }, 'Voided') }

  // --- statement ---
  const prev = useMemo(() => a ? data.reconciliations.filter(r => r.account_id === a.id).sort((x, y) => y.statement_date.localeCompare(x.statement_date))[0] || null : null, [a, data.reconciliations])
  const [stmtDate, setStmtDate] = useState(today()); const [stmtBal, setStmtBal] = useState(''); const [cleared, setCleared] = useState<Set<string> | null>(null); const [adjReason, setAdjReason] = useState(''); const [notes, setNotes] = useState('')
  const stmtBalance: number | null = stmtBal === '' ? (a?.bank_balance ?? null) : parseNum(stmtBal)
  const candidates = useMemo(() => a ? mine.filter(t => !t.duplicate_of && t.status !== 'void' && !t.reconciliation_id && t.date <= stmtDate) : [], [a, mine, stmtDate])
  const clearedIds = cleared ?? new Set(a ? defaultCleared(mine, a, stmtDate) : [])
  const result = useMemo(() => a && stmtBalance != null ? reconcileStatement({ account: a, txns: mine, statementDate: stmtDate, statementBalance: stmtBalance, clearedIds: [...clearedIds], previous: prev ? { statement_date: prev.statement_date, statement_balance: prev.statement_balance } : null }) : null, [a, mine, stmtDate, stmtBalance, clearedIds, prev])
  const toggle = (id: string) => setCleared(s => { const n = new Set(s ?? clearedIds); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const complete = () => guarded(async () => {
    if (!a || !result || stmtBalance == null) return
    if (!result.balanced && !adjReason.trim()) throw new Error('The difference is not zero — tick the missing items, fix an amount, or give a reason to accept it as an adjustment')
    const rec = await repo!.completeReconciliation({ account_id: a.id, statement_date: stmtDate, statement_balance: stmtBalance, opening_balance: result.openingBalance, cleared_ids: [...clearedIds], book_balance: result.bookBalance, cleared_deposits: result.clearedDeposits, cleared_payments: result.clearedPayments, outstanding_checks: result.outstandingChecks, deposits_in_transit: result.depositsInTransit, reconciled_balance: result.reconciledBalance, variance: result.variance, adjustment: result.balanced ? 0 : -result.variance, adjustment_reason: result.balanced ? null : adjReason.trim(), notes: notes.trim() || null })
    await st().refresh(); setCleared(null); setStmtBal(''); setAdjReason(''); setNotes(''); setTab('history'); return rec
  }, 'Reconciliation completed')

  if (!a) return <Card span={12} title="Checkbook Reconciliation"><Empty>Add a checking, savings, cash or card account first.</Empty></Card>
  const S = state!
  return <>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
      <Field label="Account"><select className="inp" value={acctId} onChange={e => { setAcctId(e.target.value); setCleared(null); setStmtBal('') }}>{cashAccts.map(x => <option key={x.id} value={x.id}>{acctLabel(x, data.accounts)}{x.bank_balance != null ? ' · bank feed' : ''}</option>)}</select></Field>
      <span style={{ flex: 1 }} />
      {S.verified ? <Pill cls="good">Verified · bank figure {S.bankAsOf ? ago(S.bankAsOf) : ''}</Pill> : <Pill cls="warn">No bank figure yet — book balance only</Pill>}
    </div>
    <div className="kpis" style={{ marginBottom: 16 }}>
      <KPI l="Book balance" v={fmtMoney(S.bookBalance)} cls="info" s="your own running figure" />
      <KPI l="Bank balance" v={S.bankBalance == null ? '—' : fmtMoney(S.bankBalance)} cls={S.verified ? 'good' : 'idle'} s={S.bankAsOf ? `reported ${fmtDY(S.bankAsOf)}` : 'sync, import a statement or reconcile'} />
      <KPI l="Reconciled balance" v={fmtMoney(S.reconciledBalance)} cls="good" s="bank + deposits in transit − outstanding · used by every module" />
      <KPI l="Variance" v={(S.variance > 0 ? '+' : '') + fmtMoney(S.variance)} cls={Math.abs(S.variance) < 0.01 ? 'good' : 'crit'} s="book − reconciled" />
      <KPI l="Outstanding checks" v={fmtMoney(S.outstandingChecks)} cls={S.outstandingChecksCount ? 'warn' : 'good'} s={`${S.outstandingChecksCount} not yet cleared`} />
      <KPI l="Deposits in transit" v={fmtMoney(S.depositsInTransit)} cls={S.depositsInTransitCount ? 'warn' : 'good'} s={`${S.depositsInTransitCount} not yet at the bank`} />
      <KPI l="Uncleared" v={String(S.uncleared)} cls="info" s="register entries awaiting the bank" />
      <KPI l="Last reconciliation" v={S.lastReconciledOn ? fmtDY(S.lastReconciledOn) : 'Never'} cls={S.lastReconciledOn && ago(S.lastReconciledOn) !== 'today' ? 'info' : 'idle'} s={prev ? `statement ${fmtMoney(prev.statement_balance)} · ${prev.status === 'completed' ? 'balanced' : 'with adjustment'}` : 'reconcile against a statement'} />
    </div>
    <div style={{ marginBottom: 14 }}><Seg value={tab} options={[['register', `Register (${S.uncleared} open)`], ['match', `Match to bank (${suggestions.length})`], ['statement', 'Reconcile a statement'], ['issues', `Issues (${issues.length})`], ['history', 'History & audit']]} onChange={setTab} /></div>

    {tab === 'register' && <div className="grid g12">
      {canEdit && <Card span={5} title="Record a check, payment or deposit" hint="goes into the register as outstanding until the bank shows it"><RegisterForm account={a} onDone={() => undefined} /></Card>}
      <Card span={canEdit ? 7 : 12} title="Outstanding — not yet at the bank" hint="matched automatically when the bank feed shows them; or match / mark cleared by hand">
        {outstanding(mine, a).length === 0 ? <Empty>Nothing outstanding — the bank has shown everything you recorded.</Empty> : <div className="tblwrap"><table className="tbl"><thead><tr><th>Date</th><th>Chk #</th><th>Payee</th><th>Memo</th><th className="num">Amount</th><th /></tr></thead><tbody>
          {outstanding(mine, a).sort((x, y) => x.date.localeCompare(y.date)).map(t => line(t as Transaction, canEdit && <span className="btnrow"><Btn sm onClick={() => markCleared(t as Transaction)}>Cleared</Btn><Btn sm danger onClick={() => voidEntry(t as Transaction)}>Void</Btn></span>))}
        </tbody></table></div>}
        <Note>{KIND_LABEL.check}s carry a number so the bank line "CHECK 1234" matches them exactly. Payments and deposits match on amount, date and payee. Verified balance = bank balance {isLiability(a) ? '' : '+ deposits in transit − outstanding'}.</Note>
      </Card>
      <Card span={12} title="Unreconciled bank activity" hint="cleared at the bank, not yet ticked in a completed reconciliation">
        {unreconciled(mine, a).length === 0 ? <Empty>Everything is reconciled.</Empty> : <div className="tblwrap" style={{ maxHeight: 360 }}><table className="tbl"><thead><tr><th>Date</th><th>Chk #</th><th>Payee</th><th>Memo</th><th className="num">Amount</th><th /></tr></thead><tbody>
          {unreconciled(mine, a).sort((x, y) => y.date.localeCompare(x.date)).map(t => line(t as Transaction, <Pill cls={t.external_id ? 'good' : 'idle'}>{t.external_id ? (t.external_id.startsWith('sfin:') ? 'bank feed' : 'statement file') : 'cleared by hand'}</Pill>))}
        </tbody></table></div>}
      </Card>
    </div>}

    {tab === 'match' && <Card span={12} title="Match register entries to bank activity" hint={`score 0–100: amount (50) · check number (30) · date (15) · payee (5) · ${AUTO_MATCH_SCORE}+ with no other candidate = automatic`} right={canEdit && suggestions.some(s => s.auto) ? <Btn primary sm onClick={matchAll}>Apply {suggestions.filter(s => s.auto).length} automatic match{suggestions.filter(s => s.auto).length === 1 ? '' : 'es'}</Btn> : undefined}>
      {suggestions.length === 0 ? <Empty>No outstanding entry looks like any bank row. {outstanding(mine, a).length ? 'Entries stay outstanding until the bank shows them.' : ''}</Empty> : <div className="tblwrap"><table className="tbl"><thead><tr><th>Register entry</th><th>Bank row</th><th className="num">Amount</th><th>Score</th><th>Why</th><th /></tr></thead><tbody>
        {suggestions.map(s => { const e = byId.get(s.entryId)!, b = byId.get(s.bankId)!; return <tr key={s.entryId}><td>{fmtD(e.date)} {e.check_number ? '#' + +e.check_number : ''} {e.payee}</td><td>{fmtD(b.date)} {b.payee}</td><td className="num">{fm2(e.amount)}</td><td><Pill cls={s.auto ? 'good' : s.score >= 70 ? 'warn' : 'idle'}>{s.score}% {s.auto ? 'auto' : 'suggested'}</Pill></td><td style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{s.reasons.join(' · ')}</td><td>{canEdit && <span className="btnrow"><Btn sm primary onClick={() => doMatch(s.entryId, s.bankId, s.score)}>Match</Btn><Btn sm onClick={() => notMatch(s.entryId)}>Not a match</Btn></span>}</td></tr> })}
      </tbody></table></div>}
      <Note>A match merges the register entry into the bank row (the bank's date and description are kept; your check number, category and memo carry over). It can be undone in <Link to="/transactions">Transactions → Duplicates</Link>. Matching by hand below {AUTO_MATCH_SCORE} is recorded as an override in the audit trail.</Note>
    </Card>}

    {tab === 'statement' && <div className="grid g12">
      <Card span={4} title="Statement" hint={prev ? `previous: ${fmtDY(prev.statement_date)} ending ${fmtMoney(prev.statement_balance)}` : 'first reconciliation — the opening balance is taken from this statement'}>
        <Field label="Statement date"><input className="inp" type="date" value={stmtDate} onChange={e => { setStmtDate(e.target.value); setCleared(null) }} /></Field>
        <Field label="Ending balance on the statement" hint={a.bank_balance != null ? `bank feed says ${fmtMoney(a.bank_balance)} as of ${a.bank_balance_as_of ? fmtDY(a.bank_balance_as_of) : '—'}` : undefined}><input className="inp" inputMode="decimal" value={stmtBal} placeholder={a.bank_balance != null ? String(a.bank_balance) : '0.00'} onChange={e => setStmtBal(e.target.value)} /></Field>
        {result && <div className="tblwrap" style={{ marginTop: 8 }}><table className="tbl"><tbody>
          <tr><td>Opening balance{result.firstTime ? ' (derived)' : ''}</td><td className="num">{fm2(result.openingBalance)}</td></tr>
          <tr><td>+ Cleared deposits ({result.clearedCount} items ticked)</td><td className="num">{fm2(result.clearedDeposits)}</td></tr>
          <tr><td>− Cleared payments</td><td className="num">{fm2(result.clearedPayments)}</td></tr>
          <tr><td><b>= Cleared balance</b></td><td className="num"><b>{fm2(result.computedEnding)}</b></td></tr>
          <tr><td>Statement ending balance</td><td className="num">{fm2(result.statementBalance)}</td></tr>
          <tr><td><b>Difference</b></td><td className="num" style={{ color: result.balanced ? 'var(--good-ink)' : 'var(--crit-ink)', fontWeight: 700 }}>{fm2(result.variance)}</td></tr>
          <tr><td>Outstanding checks ({result.outstandingChecksCount})</td><td className="num">−{fm2(result.outstandingChecks)}</td></tr>
          <tr><td>Deposits in transit ({result.depositsInTransitCount})</td><td className="num">+{fm2(result.depositsInTransit)}</td></tr>
          <tr><td><b>Reconciled balance</b></td><td className="num"><b>{fm2(result.reconciledBalance)}</b></td></tr>
        </tbody></table></div>}
        {result && !result.balanced && <Field label="Accept the difference as an adjustment — reason (recorded as an override)"><input className="inp" value={adjReason} onChange={e => setAdjReason(e.target.value)} placeholder="e.g. bank fee not recorded; interest posted" /></Field>}
        <Field label="Notes"><input className="inp" value={notes} onChange={e => setNotes(e.target.value)} /></Field>
        {canEdit && <Btn primary disabled={!result || stmtBalance == null} onClick={complete}>{result?.balanced ? 'Complete reconciliation' : 'Complete with adjustment'}</Btn>}
        <Note>Completing ticks the items, sets the bank balance to the statement figure, updates the verified balance every module uses, and writes an immutable audit record. Completed reconciliations cannot be edited.</Note>
      </Card>
      <Card span={8} title="Tick what appears on the statement" hint="bank rows are ticked for you; untick anything the statement does not show">
        {candidates.length === 0 ? <Empty>No unreconciled items on or before {fmtDY(stmtDate)}.</Empty> : <div className="tblwrap" style={{ maxHeight: 520 }}><table className="tbl"><thead><tr><th /><th>Date</th><th>Chk #</th><th>Payee</th><th>Type</th><th className="num">Amount</th><th>From</th></tr></thead><tbody>
          {candidates.sort((x, y) => x.date.localeCompare(y.date)).map(t => <tr key={t.id} style={{ opacity: clearedIds.has(t.id) ? 1 : .6 }}><td><input type="checkbox" checked={clearedIds.has(t.id)} onChange={() => toggle(t.id)} /></td><td>{fmtD(t.date)}</td><td>{t.check_number ? '#' + +t.check_number : ''}</td><td>{t.payee}</td><td>{KIND_LABEL[itemType(t, a.id, a.kind)]}</td><td className="num" style={{ color: eff(t) < 0 ? 'var(--crit-ink)' : 'var(--good-ink)' }}>{eff(t) < 0 ? '−' : '+'}{fm2(Math.abs(eff(t)))}</td><td><Pill cls={t.external_id ? 'good' : t.status === 'pending' ? 'warn' : 'idle'}>{t.external_id ? 'bank' : t.status === 'pending' ? 'outstanding' : 'by hand'}</Pill></td></tr>)}
        </tbody></table></div>}
      </Card>
    </div>}

    {tab === 'issues' && <Card span={12} title="Issues" hint="timing differences, anomalies, data integrity, long-outstanding items">
      {issues.length === 0 ? <Empty>Nothing to report for this account.</Empty> : <div className="alist"><ul>{issues.map((i, k) => <li key={k}><Pill cls={i.severity}>{i.kind.replace(/_/g, ' ')}</Pill><span><span className="t">{i.txnId ? <Link to={linkTo('/transactions', i.txnId)}>{i.title}</Link> : i.title}</span><div className="m">{i.detail}</div></span></li>)}</ul></div>}
      <Note>Duplicate imports are handled in <Link to="/transactions">Transactions → Duplicates</Link>; sync failures and connection problems show on <Link to="/connections">Cash & Account Operations</Link> and in the audit trail here.</Note>
    </Card>}

    {tab === 'history' && <div className="grid g12">
      <Card span={12} title="Completed reconciliations" hint="immutable">
        {data.reconciliations.filter(r => r.account_id === a.id).length === 0 ? <Empty>None yet.</Empty> : <div className="tblwrap"><table className="tbl"><thead><tr><th>Statement</th><th className="num">Statement balance</th><th className="num">Cleared</th><th className="num">Outstanding</th><th className="num">In transit</th><th className="num">Reconciled</th><th className="num">Variance</th><th>Status</th><th>By</th></tr></thead><tbody>
          {data.reconciliations.filter(r => r.account_id === a.id).sort((x, y) => y.statement_date.localeCompare(x.statement_date)).map(r => <tr key={r.id}><td>{fmtDY(r.statement_date)}</td><td className="num">{fm2(r.statement_balance)}</td><td className="num">{r.item_count}</td><td className="num">{fm2(r.outstanding_checks)}</td><td className="num">{fm2(r.deposits_in_transit)}</td><td className="num">{fm2(r.reconciled_balance)}</td><td className="num">{fm2(r.variance)}</td><td><Pill cls={r.status === 'completed' ? 'good' : 'warn'}>{r.status === 'completed' ? 'balanced' : 'adjusted'}</Pill>{r.adjustment_reason && <div className="note" style={{ margin: 0 }}>{r.adjustment_reason}</div>}</td><td style={{ fontSize: 12 }}>{r.completed_by_email || ''}<br />{fmtDT(r.completed_at)}</td></tr>)}
        </tbody></table></div>}
      </Card>
      <Card span={12} title="Audit trail" hint="imports · syncs · matches · overrides · reconciliations · corrections · balance changes — cannot be edited or deleted">
        {data.audit.filter(e => !e.account_id || e.account_id === a.id).length === 0 ? <Empty>No events yet.</Empty> : <div className="tblwrap" style={{ maxHeight: 480 }}><table className="tbl"><thead><tr><th>When</th><th>Event</th><th>What</th><th>Who</th></tr></thead><tbody>
          {data.audit.filter(e => !e.account_id || e.account_id === a.id).slice(0, 300).map(e => <tr key={e.id}><td style={{ whiteSpace: 'nowrap' }}>{fmtDT(e.created_at)}</td><td><Pill cls={AUDIT_PILL[e.kind] || 'idle'}>{e.kind.replace(/_/g, ' ')}</Pill></td><td>{e.summary}</td><td style={{ fontSize: 12 }}>{e.user_email || 'system'}</td></tr>)}
        </tbody></table></div>}
      </Card>
    </div>}
  </>
}

function RegisterForm({ account, onDone }: { account: Account; onDone: () => void }) {
  const { data, insert, guarded, repo, acctLabels, accts, cats } = useData(); const st = useStore.getState; const catOpts = cats.filter(c => !c.archived).map(c => [c.id, c.name] as [string, string])
  const nextCheck = useMemo(() => { const nums = data.transactions.filter(t => t.account_id === account.id && t.check_number).map(t => +t.check_number!).filter(n => n > 0); return nums.length ? String(Math.max(...nums) + 1) : '' }, [data.transactions, account.id])
  const [f, setF] = useState({ type: 'check' as 'check' | 'payment' | 'deposit' | 'transfer', check: nextCheck, date: today(), payee: '', memo: '', amount: '', category_id: '', to: '' })
  const submit = (e: FormEvent) => { e.preventDefault(); guarded(async () => {
    const amount = parseNum(f.amount); if (amount == null || !(amount > 0)) throw new Error('Enter an amount')
    const row: Partial<Transaction> = { date: f.date, amount, payee: f.payee || null, memo: f.memo || null, category_id: f.category_id || null, status: 'pending', source: 'manual', check_number: f.type === 'check' ? (f.check ? String(+f.check) : null) : null, tags: [], exclude_from_budget: false,
      kind: f.type === 'deposit' ? 'income' : f.type === 'transfer' ? 'transfer' : 'expense', account_id: account.id, to_account_id: f.type === 'transfer' ? f.to || null : null }
    const t = await insert('transactions', row); await post(data, (id, p) => st().update('accounts', id, p), t, 1, f.date)
    await repo!.logAudit('register', `Recorded ${f.type}${row.check_number ? ' #' + +row.check_number : ''}: ${f.payee || ''} ${fm2(amount)}`, { txn: t.id }, account.id)
    setF(x => ({ ...x, check: x.type === 'check' && x.check ? String(+x.check + 1) : x.check, payee: '', memo: '', amount: '' })); onDone()
  }, 'Recorded — outstanding until the bank shows it') }
  return <form onSubmit={submit}>
    <Field label="Type"><Seg value={f.type} options={[['check', 'Check'], ['payment', 'Payment'], ['deposit', 'Deposit'], ['transfer', 'Transfer']]} onChange={v => setF(x => ({ ...x, type: v }))} /></Field>
    <div className="grid2">{f.type === 'check' && <Field label="Check number"><input className="inp" inputMode="numeric" value={f.check} onChange={e => setF(x => ({ ...x, check: e.target.value }))} /></Field>}<Field label="Date"><input className="inp" type="date" value={f.date} onChange={e => setF(x => ({ ...x, date: e.target.value }))} /></Field></div>
    <Field label={f.type === 'deposit' ? 'From (payer)' : 'Payee'}><input className="inp" value={f.payee} onChange={e => setF(x => ({ ...x, payee: e.target.value }))} /></Field>
    <div className="grid2"><Field label="Amount"><input className="inp" inputMode="decimal" value={f.amount} onChange={e => setF(x => ({ ...x, amount: e.target.value }))} /></Field>
      {f.type === 'transfer' ? <Field label="To account"><select className="inp" value={f.to} onChange={e => setF(x => ({ ...x, to: e.target.value }))}><option value="">—</option>{accts.filter(x => x.id !== account.id).map(x => <option key={x.id} value={x.id}>{acctLabels[x.id]}</option>)}</select></Field>
        : <Field label="Category"><select className="inp" value={f.category_id} onChange={e => setF(x => ({ ...x, category_id: e.target.value }))}><option value="">—</option>{catOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>}</div>
    <Field label="Memo"><input className="inp" value={f.memo} onChange={e => setF(x => ({ ...x, memo: e.target.value }))} /></Field>
    <Btn primary type="submit">Record</Btn>
  </form>
}
