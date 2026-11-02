import { useMemo, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../app/hooks'
import type { Account, ImportLog } from '../app/data/types'
import { Card, KPI, Note, Btn, Field, Pill, Empty, Banner } from '../components/ui'
import { parseCsv, detectMapping, mapRows, parseOfx, sniffFormat, dedupe, DUP_LABEL, type Mapping, type Proposed, type ImportRow } from '../lib/import'
import { post } from '../lib/ledger'
import { suggest, applySuggestion } from '../lib/rules'
import { fm2, fmtMoney, round2 } from '../lib/money'
import { fmtD, today, ago } from '../lib/dates'
import { isLiability, acctLabel } from '../lib/accounts'
import { BankSyncCard, syncKpi } from './BankSync'
import type { SyncStatus } from '../app/data/types'

type Stage = 'pick' | 'map' | 'review' | 'done'
const COLS: Array<[keyof Mapping, string]> = [['date', 'Date'], ['payee', 'Payee / description'], ['amount', 'Amount (signed)'], ['debit', 'Debit / money out'], ['credit', 'Credit / money in'], ['memo', 'Memo'], ['id', 'Transaction id'], ['type', 'Type']]

export function ConnectionsPage() {
  const { data, settings, accts, saveSettings, insertMany, update, guarded, canEdit } = useData()
  const [stage, setStage] = useState<Stage>('pick'); const [file, setFile] = useState<{ name: string; text: string } | null>(null); const [acctId, setAcctId] = useState(accts[0]?.id || '')
  const [rows, setRows] = useState<string[][]>([]); const [map, setMap] = useState<Mapping | null>(null); const [ofx, setOfx] = useState<ReturnType<typeof parseOfx> | null>(null)
  const [skipDups, setSkipDups] = useState(true); const [setBalance, setSetBalance] = useState(true); const [result, setResult] = useState<ImportLog | null>(null); const [err, setErr] = useState('')
  const [sync, setSync] = useState<SyncStatus | null>(null); const sk = syncKpi(sync)
  const account = data.accounts.find(a => a.id === acctId) as Account | undefined
  const format = file ? sniffFormat(file.name, file.text) : 'csv'

  const onFile = (e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (!f) return; setErr(''); setResult(null)
    f.text().then(text => { setFile({ name: f.name, text }); if (sniffFormat(f.name, text) === 'ofx') { const r = parseOfx(text); setOfx(r); setRows([]); setMap(null); if (r.acctId) { const last4 = r.acctId.replace(/\D/g, '').slice(-4); const hit = data.accounts.find(a => a.last4 && last4 && a.last4 === last4); if (hit) setAcctId(hit.id) } setStage('review') }
      else { const rs = parseCsv(text); const m = detectMapping(rs); setRows(rs); setOfx(null); setMap(m ? { ...m, negativeIsOutflow: !(account && isLiability(account)) ? true : m.negativeIsOutflow } : null); setStage(m ? 'map' : 'map'); if (!m) setErr('Could not recognise the columns — pick them below.') } }).catch(ex => setErr(String(ex))) }

  const imported: ImportRow[] = useMemo(() => (ofx ? ofx.rows : map ? mapRows(rows, map, { card: !!account && isLiability(account), source: 'csv' }) : []), [ofx, map, rows, account])
  const proposed: Proposed[] = useMemo(() => (account ? dedupe(data, account, imported).map(p => { if (p.txn.kind === 'transfer') return p; const sg = suggest(data, settings, { payee: p.txn.payee, kind: p.txn.kind as 'expense' | 'income' }); const patch = applySuggestion(p.txn, sg); return patch ? { ...p, txn: { ...p.txn, ...patch }, how: sg.how } : p }) : []), [data, settings, account, imported])
  const categorised = proposed.filter(p => p.txn.category_id).length
  const bad = proposed.filter(p => p.row.warn), dups = proposed.filter(p => p.dup), fresh = proposed.filter(p => !p.dup && !p.row.warn)
  const toAdd = skipDups ? fresh : proposed.filter(p => !p.row.warn && p.dup !== 'in_file')
  const inflow = toAdd.filter(p => p.row.kind === 'income').reduce((a, p) => a + p.row.amount, 0), outflow = toAdd.filter(p => p.row.kind === 'expense').reduce((a, p) => a + p.row.amount, 0)

  const apply = () => guarded(async () => {
    if (!account || !file) return
    const made = await insertMany('transactions', toAdd.map(p => p.txn))
    let d = data; for (const t of made) { await post(d, async (id, patch) => { await update('accounts', id, patch); d = { ...d, accounts: d.accounts.map(a => a.id === id ? { ...a, ...patch } : a) } }, t, 1, t.date) }
    if (setBalance && ofx?.balance != null) await update('accounts', account.id, { balance: isLiability(account) ? Math.abs(ofx.balance) : ofx.balance, balance_as_of: ofx.balanceAsOf || today() })
    const log: ImportLog = { at: new Date().toISOString(), file: file.name, format, account_id: account.id, rows: proposed.length, added: made.length, skipped: proposed.length - made.length, balance: ofx?.balance ?? null }
    await saveSettings({ imports: [log, ...(settings.imports || [])].slice(0, 50) }); setResult(log); setStage('done')
  }, 'Statement imported')
  const reset = () => { setFile(null); setRows([]); setMap(null); setOfx(null); setStage('pick'); setErr('') }
  const history = settings.imports || []
  const lastByAcct = (a: Account) => history.find(h => h.account_id === a.id)

  return <>
    <div className="kpis" style={{ marginBottom: 16 }}>
      <KPI l="Connected sources" v={`${accts.length} account${accts.length === 1 ? '' : 's'}`} cls="info" s="statement files (CSV / OFX / QFX) · email capture · manual" />
      <KPI l="Last import" v={history[0] ? ago(history[0].at.slice(0, 10)) : '—'} cls={history[0] ? 'good' : 'idle'} s={history[0] ? `${history[0].file} · ${history[0].added} added` : 'nothing imported yet'} />
      <KPI l="Imported transactions" v={String(data.transactions.filter(t => t.source === 'import').length)} cls="info" s="source = import" />
      <KPI l="Automatic bank sync" v={sk.v} cls={sk.cls} s={sk.s} />
    </div>
    <div className="grid g12">
      <BankSyncCard onKpi={setSync} />
      <Card span={7} title="Import a statement" hint="CSV, OFX or QFX from your bank or card — duplicates are detected before anything is written">
        {!canEdit && <Banner cls="warn">You have read-only access — imports are disabled.</Banner>}
        {stage === 'pick' && <>
          <Field label="Into account"><select className="inp" value={acctId} onChange={e => setAcctId(e.target.value)}>{accts.map(a => <option key={a.id} value={a.id}>{acctLabel(a, data.accounts)}</option>)}</select></Field>
          <Field label="Statement file" hint="exported from online banking; nothing leaves your browser except the transactions you approve"><input className="inp" type="file" accept=".csv,.txt,.ofx,.qfx,.xml" onChange={onFile} disabled={!canEdit || !acctId} /></Field>
          {err && <div className="msg crit">{err}</div>}
          <Note>How to get the file: most banks have <b>Download / Export</b> on the account activity page; pick <b>CSV</b> or <b>Quicken (QFX)</b>. QFX / OFX files carry a transaction id, which makes re-imports exact; CSVs are de-duplicated by date, amount and payee.</Note>
        </>}
        {stage === 'map' && file && <>
          <p className="note" style={{ marginTop: 0 }}><b>{file.name}</b> · {rows.length} rows · {map?.hasHeader ? 'header row detected' : 'no header row'} · into <b>{account ? acctLabel(account, data.accounts) : '—'}</b> <Btn sm onClick={reset}>Change file</Btn></p>
          {err && <div className="msg warn">{err}</div>}
          <div className="grid g12">{COLS.map(([k, label]) => <div key={k} style={{ gridColumn: 'span 4' }}><Field label={label}><select className="inp" value={map && typeof map[k] === 'number' ? String(map[k]) : ''} onChange={e => setMap(m => ({ ...(m || { date: -1, payee: -1, hasHeader: true, negativeIsOutflow: true }), [k]: e.target.value === '' ? undefined : +e.target.value }))}><option value="">—</option>{rows[0]?.map((h, i) => <option key={i} value={i}>{map?.hasHeader ? h || `col ${i + 1}` : `col ${i + 1}: ${h.slice(0, 18)}`}</option>)}</select></Field></div>)}</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', margin: '6px 0 12px' }}>
            <label><input type="checkbox" checked={!!map?.hasHeader} onChange={e => setMap(m => m && { ...m, hasHeader: e.target.checked })} /> First row is a header</label>
            <label><input type="checkbox" checked={!!map?.negativeIsOutflow} onChange={e => setMap(m => m && { ...m, negativeIsOutflow: e.target.checked })} /> Negative amounts are money out <span className="note" style={{ display: 'inline' }}>(untick for card files that list charges as positive)</span></label>
          </div>
          <PreviewTable rows={proposed.slice(0, 8)} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><Btn primary disabled={!map || map.date < 0 || map.payee < 0 || (map.amount == null && map.debit == null && map.credit == null) || !proposed.length} onClick={() => setStage('review')}>Review {proposed.length} rows →</Btn><Btn onClick={reset}>Cancel</Btn></div>
        </>}
        {stage === 'review' && file && account && <>
          <p className="note" style={{ marginTop: 0 }}><b>{file.name}</b> · {format.toUpperCase()}{ofx?.org ? ` · ${ofx.org}` : ''}{ofx?.start ? ` · ${fmtD(ofx.start)} – ${fmtD(ofx.end || ofx.start)}` : ''} · into <b>{acctLabel(account, data.accounts)}</b> {format === 'csv' && <Btn sm onClick={() => setStage('map')}>← Columns</Btn>} <Btn sm onClick={reset}>Change file</Btn></p>
          {ofx && <Field label="Into account"><select className="inp" value={acctId} onChange={e => setAcctId(e.target.value)}>{accts.map(a => <option key={a.id} value={a.id}>{acctLabel(a, data.accounts)}{ofx.acctId && a.last4 && ofx.acctId.replace(/\D/g, '').endsWith(a.last4) ? ' ✓ matches file' : ''}</option>)}</select></Field>}
          <div className="kpis" style={{ marginBottom: 12 }}><KPI l="New" v={String(fresh.length)} cls="good" s="will be added" /><KPI l="Duplicates" v={String(dups.length)} cls={dups.length ? 'warn' : 'idle'} s={skipDups ? 'will be skipped' : 'will be added anyway'} /><KPI l="Unreadable" v={String(bad.length)} cls={bad.length ? 'crit' : 'idle'} s="no date or amount — skipped" /><KPI l="Auto-categorized" v={`${categorised} / ${proposed.length}`} cls={categorised ? 'good' : 'idle'} s="by your rules, remembered payees and history" /><KPI l="Net effect" v={fmtMoney(inflow - outflow)} cls={inflow - outflow >= 0 ? 'good' : 'warn'} s={`+${fmtMoney(inflow)} in · −${fmtMoney(outflow)} out`} /></div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '0 0 10px' }}>
            <label><input type="checkbox" checked={skipDups} onChange={e => setSkipDups(e.target.checked)} /> Skip duplicates</label>
            {ofx?.balance != null && <label><input type="checkbox" checked={setBalance} onChange={e => setSetBalance(e.target.checked)} /> Set the account balance to the statement's {fm2(Math.abs(ofx.balance))}{ofx.balanceAsOf ? ` as of ${fmtD(ofx.balanceAsOf)}` : ''}</label>}
          </div>
          <PreviewTable rows={proposed} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><Btn primary disabled={!canEdit || !toAdd.length} onClick={apply}>Import {toAdd.length} transaction{toAdd.length === 1 ? '' : 's'}</Btn><Btn onClick={reset}>Cancel</Btn></div>
          <Note>Each new transaction moves the account balance exactly as one logged by hand would (money out on a card raises what you owe; a payment credited to a card lowers it). Imported rows get <code>source = import</code> and keep the file's transaction id so the same file can be imported again safely.</Note>
        </>}
        {stage === 'done' && result && <>
          <Banner cls="good"><b>{result.added}</b> transaction{result.added === 1 ? '' : 's'} added from <b>{result.file}</b>{result.skipped ? `, ${result.skipped} skipped` : ''}.</Banner>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><Link to="/transactions" className="btn primary">Open Transactions</Link><Btn onClick={reset}>Import another file</Btn></div>
        </>}
      </Card>
      <Card span={5} title="Accounts & last sync" hint="when each account last received a statement">
        <div className="tblwrap"><table className="tbl"><thead><tr><th>Account</th><th>Last import</th><th className="num">Balance as of</th></tr></thead><tbody>
          {accts.map(a => { const h = lastByAcct(a); return <tr key={a.id}><td><b>{acctLabel(a, data.accounts)}</b></td><td>{h ? <>{ago(h.at.slice(0, 10))} <span className="note" style={{ display: 'inline' }}>· {h.added} added</span></> : <Pill cls="idle">never</Pill>}</td><td className="num">{a.balance_as_of ? fmtD(a.balance_as_of) : '—'}</td></tr> })}
        </tbody></table></div>
      </Card>
      <Card span={12} title="Import history" hint="every statement file, newest first">
        {history.length === 0 ? <Empty>No imports yet.</Empty> : <div className="tblwrap"><table className="tbl"><thead><tr><th>When</th><th>File</th><th>Format</th><th>Account</th><th className="num">Rows</th><th className="num">Added</th><th className="num">Skipped</th><th className="num">Statement balance</th></tr></thead><tbody>
          {history.map((h, i) => <tr key={i}><td>{fmtD(h.at.slice(0, 10))}</td><td><b>{h.file}</b></td><td><Pill cls="info">{h.format.toUpperCase()}</Pill></td><td>{data.accounts.find(a => a.id === h.account_id) ? acctLabel(data.accounts.find(a => a.id === h.account_id)!, data.accounts) : '—'}</td><td className="num">{h.rows}</td><td className="num">{h.added}</td><td className="num">{h.skipped}</td><td className="num">{h.balance != null ? fm2(round2(Math.abs(h.balance))) : '—'}</td></tr>)}
        </tbody></table></div>}
      </Card>
    </div>
  </>
}

function PreviewTable({ rows }: { rows: Proposed[] }) {
  const { catLabels } = useData()
  if (!rows.length) return <Empty>No rows to show.</Empty>
  return <div className="tblwrap" style={{ maxHeight: 420 }}><table className="tbl"><thead><tr><th>#</th><th>Date</th><th>Payee</th><th>Category</th><th className="num">Amount</th><th>Kind</th><th>Status</th></tr></thead><tbody>
    {rows.map((p, i) => <tr key={i} style={{ opacity: p.row.warn || p.dup ? .6 : 1 }}><td>{p.row.line}</td><td>{p.row.date ? fmtD(p.row.date) : <span style={{ color: 'var(--crit)' }}>?</span>}</td><td>{p.row.payee || <i>—</i>}{p.row.memo && <div className="note" style={{ margin: 0 }}>{p.row.memo}</div>}</td><td style={{ color: p.txn.category_id ? undefined : 'var(--ink-3)' }}>{p.txn.category_id ? catLabels[p.txn.category_id] : '—'}</td><td className="num">{p.row.amount ? fm2(p.row.amount) : '?'}</td><td>{p.txn.kind === 'transfer' ? <Pill cls="good">payment</Pill> : p.row.kind === 'income' ? <Pill cls="good">in</Pill> : <Pill cls="warn">out</Pill>}</td><td>{p.row.warn ? <Pill cls="crit">{p.row.warn}</Pill> : p.dup ? <Pill cls="idle">{DUP_LABEL[p.dup]}</Pill> : <Pill cls="good">new</Pill>}</td></tr>)}
  </tbody></table></div>
}
