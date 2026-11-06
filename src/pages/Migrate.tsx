// 0.24.0 — move in from Mint, YNAB, Quicken or Monarch: one export file with every account's history. Parsing, matching, transfer
// pairing and de-duplication are lib/migrate.ts; this card picks the file, lets you confirm the matches and writes through the store.
// History is history: imported rows do not move today's balances (you type those, or the bank feed sets them).
import { useMemo, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../app/hooks'
import type { Account, AccountKind, ImportLog } from '../app/data/types'
import { ACCOUNT_KIND_LABEL, ASSET_KINDS, LIABILITY_KINDS } from '../app/data/types'
import { Card, KPI, Note, Btn, Field, Pill, Empty, Banner } from '../components/ui'
import { parseExport, proposeAccounts, proposeCategories, buildPlan, resolveIds, accountsFrom, categoriesFrom, SOURCE_LABEL, type Parsed } from '../lib/migrate'
import { isLiability, acctLabel } from '../lib/accounts'
import { fmtMoney } from '../lib/money'
import { fmtD, fmtDY, today } from '../lib/dates'
import { logGoalLinks } from '../app/goalLinks'

type AMap = Record<string, { target: string; kind: AccountKind }>
const CHUNK = 500

export function MigrateCard() {
  const { data, settings, accts, catLabels, cats, insert, insertMany, saveSettings, guarded, canEdit, repo } = useData()
  const [file, setFile] = useState<string>(''); const [p, setP] = useState<Parsed | null>(null); const [err, setErr] = useState('')
  const [amap, setAmap] = useState<AMap>({}); const [cmap, setCmap] = useState<Record<string, string>>({}); const [since, setSince] = useState('')
  const [busy, setBusy] = useState<string | null>(null); const [done, setDone] = useState<{ added: number; accounts: number; newAccounts: string[]; categories: number } | null>(null)

  const onFile = (e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (!f) return; setErr(''); setDone(null)
    f.text().then(text => { const r = parseExport(text, f.name)
      if (!r) { setP(null); setErr('This does not look like an export from Mint, YNAB, Quicken or Monarch. For a single bank statement use Import a statement above.'); return }
      if (!r.rows.length) { setP(null); setErr('The file was recognized but has no transactions in it.'); return }
      setFile(f.name); setP(r); setAmap(proposeAccounts(data, r)); setCmap(proposeCategories(data, r)); setSince('') }).catch(ex => setErr(String(ex))) }
  const reset = () => { setP(null); setFile(''); setErr(''); setDone(null) }

  const plan = useMemo(() => p ? buildPlan(data, p, accountsFrom(amap), categoriesFrom(cmap), { since: since || null }) : null, [data, p, amap, cmap, since])
  const newAccts = p ? p.accounts.filter(a => amap[a.name]?.target === 'new') : []; const newCats = p ? p.categories.filter(c => cmap[c.name] === 'new') : []
  const uncategorized = plan ? plan.add.filter(t => t.kind !== 'transfer' && !t.category_id && !t.exclude_from_budget).length : 0

  const run = () => { if (!p || !plan || !plan.add.length) return
    guarded(async () => {
      const ids: Record<string, string> = {}
      // 1. accounts that do not exist yet — at a zero balance; the imported history does not move it
      let order = data.accounts.length
      for (const a of newAccts) { if (!plan.add.some(t => t.account_id === 'new:acct:' + a.name || t.to_account_id === 'new:acct:' + a.name)) continue
        setBusy(`Creating account ${a.name}…`); const kind = amap[a.name].kind; const liab = isLiability({ kind } as Account)
        const row = await insert('accounts', { name: a.name.slice(0, 80), kind, balance: 0, balance_as_of: today(), apr: 0, minimum_payment: 0, autopay: false, include_in_cash: !liab && kind !== 'retirement' && kind !== 'investment', include_in_net_worth: true, status: 'Active', sort_order: ++order, notes: `Created by the ${SOURCE_LABEL[p.source]} import — type today's balance` })
        ids['new:acct:' + a.name] = row.id }
      // 2. categories to create, in the export's own group
      let corder = data.categories.length
      for (const c of newCats) { setBusy(`Creating category ${c.name}…`)
        const row = await insert('categories', { name: c.name.slice(0, 60), group: c.group || 'Imported', kind: c.inn > c.out ? 'income' : 'expense', priority: 'Important', cost_type: 'Variable', default_budget: 0, budget_cadence: 'period', rollover: false, sort_order: ++corder, archived: false })
        ids['new:cat:' + c.name] = row.id }
      // 3. the transactions, in chunks
      const rows = resolveIds(plan.add, ids); let added = 0
      for (let i = 0; i < rows.length; i += CHUNK) { setBusy(`Adding transactions ${i + 1}–${Math.min(rows.length, i + CHUNK)} of ${rows.length}…`); const made = await insertMany('transactions', rows.slice(i, i + CHUNK)); added += made.length; await logGoalLinks(made) }
      const touched = new Set(rows.flatMap(t => [t.account_id, t.to_account_id]).filter(Boolean) as string[])
      await repo!.logAudit('import', `Moved in from ${SOURCE_LABEL[p.source]} (${file}): ${added} transactions across ${touched.size} accounts, ${plan.dups} already here`, { file, source: p.source, added, duplicates: plan.dups, transfers: plan.transfers, accounts: touched.size, new_accounts: Object.keys(ids).filter(k => k.startsWith('new:acct:')).length }).catch(() => {})
      const log: ImportLog = { at: new Date().toISOString(), file, format: p.source === 'qif' ? 'qif' : 'csv', account_id: [...touched][0] || '', rows: p.rows.length, added, skipped: p.rows.length - added, balance: null, source: SOURCE_LABEL[p.source], accounts: touched.size }
      await saveSettings({ imports: [log, ...(settings.imports || [])].slice(0, 50) })
      setDone({ added, accounts: touched.size, newAccounts: newAccts.filter(a => ids['new:acct:' + a.name]).map(a => a.name), categories: newCats.length }); setP(null)
    }, 'Import finished').finally(() => setBusy(null)) }

  const kindOpts = [...ASSET_KINDS.filter(k => k !== 'other_asset'), ...LIABILITY_KINDS]
  return <Card span={12} id="migrate" title="Move from Mint, YNAB, Quicken or Monarch" hint="one export file with every account's history — accounts and categories are matched by name, transfers paired, duplicates skipped">
    {!canEdit && <Banner cls="warn">You have read-only access — imports are disabled.</Banner>}
    {done && <><Banner cls="good"><b>{done.added}</b> transaction{done.added === 1 ? '' : 's'} added across {done.accounts} account{done.accounts === 1 ? '' : 's'}{done.categories ? `, ${done.categories} new categor${done.categories === 1 ? 'y' : 'ies'}` : ''}.</Banner>
      {done.newAccounts.length > 0 && <Banner cls="warn">New accounts start at a zero balance — type today's balance for {done.newAccounts.join(', ')} on <Link to="/accounts">Accounts</Link>, or connect the bank feed.</Banner>}
      <div className="btnrow" style={{ marginTop: 8 }}><Link to="/transactions" className="btn primary">Open Transactions</Link><Btn onClick={reset}>Import another file</Btn></div></>}
    {!p && !done && <>
      <Field label="Export file" hint="nothing leaves your browser except the transactions you approve"><input className="inp" type="file" accept=".csv,.txt,.qif" onChange={onFile} disabled={!canEdit} aria-label="Export file from Mint, YNAB, Quicken or Monarch" /></Field>
      {err && <div className="msg crit">{err}</div>}
      <div className="tblwrap" style={{ marginTop: 8 }}><table className="tbl"><caption className="sr-only">Where to find the export</caption><thead><tr><th>From</th><th>Where to find the export</th></tr></thead><tbody>
        <tr><td><b>Mint</b></td><td>the <i>transactions.csv</i> you downloaded (Transactions → Export) before Mint closed</td></tr>
        <tr><td><b>YNAB</b></td><td>Budget menu → Export budget → the <i>Register</i> CSV in the zip</td></tr>
        <tr><td><b>Monarch</b></td><td>Settings → Data → Export transactions</td></tr>
        <tr><td><b>Quicken</b></td><td>File → Export → QIF file (all accounts), or a transaction report saved as CSV</td></tr></tbody></table></div>
    </>}
    {p && plan && <>
      <p className="note" style={{ marginTop: 0 }}><b>{file}</b> · <Pill cls="info">{SOURCE_LABEL[p.source]}</Pill> · {p.rows.length} transactions{p.from ? ` · ${fmtD(p.from)} – ${fmtD(p.to || p.from)}` : ''}{p.skipped.length ? ` · ${p.skipped.length} skipped (${[...new Set(p.skipped.map(r => r.skip))].join(', ')})` : ''} <Btn sm onClick={reset}>Change file</Btn></p>
      <div className="kpis" style={{ marginBottom: 12 }}><KPI l="Will be added" v={String(plan.add.length)} cls={plan.add.length ? 'good' : 'idle'} s={`${Object.keys(plan.byAccount).length} account${Object.keys(plan.byAccount).length === 1 ? '' : 's'}`} /><KPI l="Already here" v={String(plan.dups)} cls={plan.dups ? 'warn' : 'idle'} s="skipped as duplicates" /><KPI l="Transfers paired" v={String(plan.transfers)} cls="info" s={plan.oneSided ? `${plan.oneSided} one-sided, kept out of the budget` : 'both sides in the file'} /><KPI l="Uncategorized" v={String(uncategorized)} cls={uncategorized ? 'warn' : 'good'} s="categorize later on Transactions" /><KPI l="New accounts" v={String(newAccts.length)} cls={newAccts.length ? 'warn' : 'good'} s={newAccts.length ? 'start at a zero balance' : 'all matched'} /></div>
      <div className="grid g12">
        <div style={{ gridColumn: 'span 6' }}><b style={{ fontSize: 13 }}>Accounts</b>
          <div className="tblwrap" style={{ maxHeight: 360, marginTop: 6 }}><table className="tbl"><caption className="sr-only">Account matches</caption><thead><tr><th>In the file</th><th className="num">Rows</th><th>Goes to</th></tr></thead><tbody>
            {p.accounts.map(a => { const m = amap[a.name]; return <tr key={a.name} className={m?.target === 'skip' ? 'st-idle' : m?.target === 'new' ? 'st-warn' : 'st-good'}><td><b>{a.name}</b></td><td className="num">{a.count}</td><td>
              <select className="inp" value={m?.target || 'new'} aria-label={`Account for ${a.name}`} onChange={e => setAmap(x => ({ ...x, [a.name]: { ...x[a.name], target: e.target.value } }))}><option value="new">Create a new account</option><option value="skip">Skip this account</option>{accts.map(x => <option key={x.id} value={x.id}>{acctLabel(x, data.accounts)}</option>)}</select>
              {m?.target === 'new' && <select className="inp" style={{ marginTop: 4 }} value={m.kind} aria-label={`Type for new account ${a.name}`} onChange={e => setAmap(x => ({ ...x, [a.name]: { ...x[a.name], kind: e.target.value as AccountKind } }))}>{kindOpts.map(k => <option key={k} value={k}>{ACCOUNT_KIND_LABEL[k]}</option>)}</select>}
            </td></tr> })}</tbody></table></div></div>
        <div style={{ gridColumn: 'span 6' }}><b style={{ fontSize: 13 }}>Categories</b>
          <div className="tblwrap" style={{ maxHeight: 360, marginTop: 6 }}><table className="tbl"><caption className="sr-only">Category matches</caption><thead><tr><th>In the file</th><th className="num">Rows</th><th>Goes to</th></tr></thead><tbody>
            {p.categories.length === 0 ? <tr><td colSpan={3}><Empty>The file has no categories.</Empty></td></tr> : p.categories.map(c => <tr key={c.name}><td>{c.group && c.group !== c.name ? <span style={{ color: 'var(--ink-3)' }}>{c.group} › </span> : null}<b>{c.name}</b></td><td className="num">{c.count}</td><td>
              <select className="inp" value={cmap[c.name] || 'none'} aria-label={`Category for ${c.name}`} onChange={e => setCmap(x => ({ ...x, [c.name]: e.target.value }))}><option value="none">Leave uncategorized</option><option value="new">Create “{c.name}”</option>{cats.map(x => <option key={x.id} value={x.id}>{catLabels[x.id]}</option>)}</select></td></tr>)}</tbody></table></div></div>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', marginTop: 10 }}>
        <Field label="Only transactions on or after" hint="blank for everything in the file"><input className="inp" type="date" value={since} min={p.from || undefined} max={p.to || undefined} onChange={e => setSince(e.target.value)} /></Field>
        <Btn primary disabled={!canEdit || !plan.add.length || !!busy} onClick={run}>{busy ? 'Working…' : `Import ${plan.add.length} transaction${plan.add.length === 1 ? '' : 's'}`}</Btn><Btn onClick={reset} disabled={!!busy}>Cancel</Btn>
      </div>
      {busy && <div className="msg info" role="status" style={{ marginTop: 8 }}>{busy}</div>}
      {plan.add.length > 0 && <div className="tblwrap" style={{ maxHeight: 280, marginTop: 10 }}><table className="tbl"><caption className="sr-only">First rows to be added</caption><thead><tr><th>Date</th><th>Payee</th><th>Account</th><th>Category</th><th className="num">Amount</th><th>Kind</th></tr></thead><tbody>
        {plan.add.slice(0, 40).map((t, i) => { const nm = (id?: string | null) => !id ? '—' : id.startsWith('new:acct:') ? id.slice(9) + ' (new)' : id.startsWith('new:cat:') ? id.slice(8) + ' (new)' : data.accounts.find(a => a.id === id)?.name || catLabels[id] || '—'
          return <tr key={i}><td>{fmtDY(t.date!)}</td><td>{t.payee || '—'}</td><td>{nm(t.account_id)}{t.kind === 'transfer' ? <> → {nm(t.to_account_id)}</> : null}</td><td>{t.kind === 'transfer' ? '—' : nm(t.category_id)}</td><td className="num">{fmtMoney(t.amount || 0)}</td><td>{t.kind === 'transfer' ? <Pill cls="info">transfer</Pill> : t.kind === 'income' ? <Pill cls="good">in</Pill> : <Pill cls="warn">out</Pill>}{t.exclude_from_budget ? <> <Pill cls="idle">not budgeted</Pill></> : null}</td></tr> })}</tbody></table>{plan.add.length > 40 && <div className="note">…and {plan.add.length - 40} more</div>}</div>}
      <Note>Imported history keeps today's balances as they are — it fills in your spending, trends and reports. Each row keeps a stable id, so importing the same file again adds nothing. Transfers between two accounts in the file become one transfer; a transfer to an account that is not in the file is kept but left out of the budget.</Note>
    </>}
  </Card>
}
