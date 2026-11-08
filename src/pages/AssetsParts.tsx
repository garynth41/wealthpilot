// 0.24.0 — property & vehicles, balance history / balance on a date, and the manual credit-score trend. Math lives in lib/assets.ts,
// lib/history.ts and lib/credit.ts; these components only render and write through the store.
import { useMemo, useState } from 'react'
import { useData } from '../app/hooks'
import type { Account, AssetType, CreditScore } from '../app/data/types'
import { ASSET_TYPE_LABEL } from '../app/data/types'
import { Card, KPI, Btn, Pill, Note, Empty, Field, MHead, MBody, MFoot, useModal, useConfirm } from '../components/ui'
import { Chart, C } from '../components/Chart'
import { assetRows, estimateNow, DEFAULT_DEPRECIATION, REVALUE_DAYS } from '../lib/assets'
import { balanceOn, historySeries, historyFor } from '../lib/history'
import { BANDS, band, creditTrends, creditTips, people } from '../lib/credit'
import { isLiability, liabilities, acctLabel } from '../lib/accounts'
import { debtTotals } from '../lib/debts'
import { fmtMoney, fm2, parseNum, sum } from '../lib/money'
import { addDays, fmtDY, today, ago } from '../lib/dates'

const VALUE_SOURCES = ['Zillow', 'Redfin', 'Realtor.com', 'Appraisal', 'County assessment', 'Kelley Blue Book', 'Edmunds', 'Carvana offer', 'NADA guides', 'My estimate']

/** Accounts page: every home, vehicle and other valued asset with the loan against it. */
export function PropertyCard() {
  const { data, canEdit } = useData(); const { open, close } = useModal()
  const rows = useMemo(() => assetRows(data), [data])
  const tot = { value: sum(rows.map(r => r.value)), owed: sum(rows.map(r => r.owed)) }; const due = rows.filter(r => r.stale).length
  const add = (t: AssetType) => open(<ValueModal newType={t} onDone={close} />)
  return <Card span={12} id="property" title="Property & vehicles" hint={`value from an estimate — Zillow, an appraisal, Kelley Blue Book — updated each quarter (${REVALUE_DAYS} days)`} right={canEdit ? <><Btn sm onClick={() => add('home')}>+ Home</Btn><Btn sm onClick={() => add('vehicle')}>+ Vehicle</Btn><Btn sm onClick={() => add('rental')}>+ Rental</Btn><Btn sm onClick={() => add('other')}>+ Other asset</Btn></> : undefined}>
    {rows.length === 0 ? <Empty>No property or vehicles yet. Add your home or car with today's estimate, and link the mortgage or auto loan to see your equity.</Empty> : <>
      <div className="kpis" style={{ marginBottom: 10 }}><KPI l="Estimated value" v={fmtMoney(tot.value)} cls="info" s={`${rows.length} asset${rows.length === 1 ? '' : 's'}`} /><KPI l="Owed against them" v={fmtMoney(tot.owed)} cls={tot.owed ? 'warn' : 'good'} s="linked mortgages and loans" /><KPI l="Equity" v={fmtMoney(tot.value - tot.owed)} cls={tot.value - tot.owed >= 0 ? 'good' : 'crit'} s={tot.value ? `${Math.round((tot.value - tot.owed) / tot.value * 100)}% of the value` : '—'} /><KPI l="Values to update" v={String(due)} cls={due ? 'warn' : 'good'} s={due ? 'a quarter old or undated' : 'all current'} /></div>
      <div className="tblwrap"><table className="tbl"><caption className="sr-only">Property and vehicles</caption><thead><tr><th>Asset</th><th>Type</th><th className="num">Value</th><th>As of</th><th>Source</th><th className="num">Guide today</th><th>Loan against it</th><th className="num">Owed</th><th className="num">Equity</th><th className="num">Loan-to-value</th><th></th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.a.id} data-id={r.a.id} className={r.stale ? 'st-warn' : 'st-good'}>
          <td><b>{r.a.name}</b></td><td>{r.a.asset_type ? ASSET_TYPE_LABEL[r.a.asset_type] : 'Other asset'}</td><td className="num">{fmtMoney(r.value)}</td>
          <td>{r.asOf ? <>{fmtDY(r.asOf)} <span style={{ color: 'var(--ink-3)' }}>· {ago(r.asOf)}</span>{r.stale && <> <Pill cls="warn">update due</Pill></>}</> : <Pill cls="warn">no date</Pill>}</td>
          <td>{r.a.value_source || '—'}</td>
          <td className="num" title={r.a.depreciation_pct != null ? `${r.a.depreciation_pct > 0 ? 'loses' : 'gains'} about ${Math.abs(+r.a.depreciation_pct)}% a year` : 'no depreciation guide set'}>{r.estimate != null ? fmtMoney(r.estimate) : '—'}</td>
          <td>{r.loan ? acctLabel(r.loan, data.accounts) : '—'}</td><td className="num">{r.loan ? fmtMoney(r.owed) : '—'}</td>
          <td className="num" style={{ color: r.equity < 0 ? 'var(--crit-ink)' : undefined }}>{fmtMoney(r.equity)}</td>
          <td className="num">{r.ltv == null ? '—' : <span style={{ color: `var(--${r.ltv > 1 ? 'crit' : r.ltv > 0.8 ? 'warn' : 'good'})` }}>{Math.round(r.ltv * 100)}%</span>}</td>
          <td><span className="btnrow">{canEdit && <Btn sm onClick={() => open(<ValueModal a={r.a} onDone={close} />)}>Update value</Btn>}<Btn sm onClick={() => open(<HistoryModal a={r.a} onDone={close} />)}>History</Btn></span></td></tr>)}</tbody></table></div></>}
    <Note>Type the value from a free estimate and the date you looked it up; the dashboard and the Monday digest remind you when a value is a quarter old. <b>Guide today</b> moves the last value by the yearly rate you set (vehicles lose about 15% a year) — a prompt to look it up again, never a replacement. Loan-to-value above 80% usually means paying PMI on a home or being upside-down on a car.</Note>
  </Card>
}

/** Add a property or vehicle, or type its new value. */
export function ValueModal({ a, newType, onDone }: { a?: Account; newType?: AssetType; onDone: () => void }) {
  const { data, insert, update, guarded } = useData()
  const prevLoan = a ? (a.linked_account_id ? data.accounts.find(x => x.id === a.linked_account_id) : data.accounts.find(x => x.linked_account_id === a.id)) : undefined
  const [type, setType] = useState<AssetType>(a?.asset_type || newType || 'other'); const [name, setName] = useState(a?.name || (newType === 'home' ? 'Home' : newType === 'vehicle' ? 'Car' : newType === 'rental' ? 'Rental property' : 'Asset'))
  const [val, setVal] = useState(a ? String(+a.balance || '') : ''); const [asOf, setAsOf] = useState(today()); const [src, setSrc] = useState(a?.value_source || (type === 'vehicle' ? 'Kelley Blue Book' : type === 'home' || type === 'rental' ? 'Zillow' : 'My estimate'))
  const [dep, setDep] = useState(String(a?.depreciation_pct ?? DEFAULT_DEPRECIATION[type] ?? 0)); const [loan, setLoan] = useState(prevLoan?.id || ''); const [nw, setNw] = useState(a ? a.include_in_net_worth : true)
  const est = a ? estimateNow(a) : null
  const loans = liabilities(data).filter(x => !x.linked_account_id || x.linked_account_id === a?.id)
  const save = () => { const v = parseNum(val); if (v == null || v < 0) return
    const d = dep.trim() === '' ? null : Math.max(-50, Math.min(80, parseNum(dep) ?? 0))
    guarded(async () => {
      const patch: Partial<Account> = { name: name.trim() || 'Asset', asset_type: type, balance: Math.round(v * 100) / 100, balance_as_of: asOf, value_source: src.trim() || null, depreciation_pct: d, linked_account_id: loan || null, include_in_net_worth: nw }
      const row = a ? await update('accounts', a.id, patch) : await insert('accounts', { ...patch, kind: 'other_asset', apr: 0, minimum_payment: 0, autopay: false, include_in_cash: false, status: 'Active', sort_order: data.accounts.length + 1 })
      // the link lives on the asset; clear an older one recorded on the loan side
      if (prevLoan && prevLoan.linked_account_id === row.id && prevLoan.id !== loan) await update('accounts', prevLoan.id, { linked_account_id: null })
      onDone() }, a ? 'Value updated' : 'Added') }
  return <><MHead title={a ? `Update the value — ${a.name}` : `Add ${ASSET_TYPE_LABEL[type].toLowerCase()}`} /><MBody>
    {a && <Note>Last value {fmtMoney(a.balance)}{a.balance_as_of ? ` on ${fmtDY(a.balance_as_of)} (${ago(a.balance_as_of)})` : ''}{a.value_source ? ` from ${a.value_source}` : ''}.{est != null && <> The guide estimates <b>{fmtMoney(est)}</b> today — <button type="button" className="btn sm" onClick={() => setVal(est.toFixed(0))}>use it</button></>}</Note>}
    <div className="grid2" style={{ marginTop: 10 }}>
      <Field label="Name"><input className="inp" value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label="Type"><select className="inp" value={type} onChange={e => { const t = e.target.value as AssetType; setType(t); if (!a) setDep(String(DEFAULT_DEPRECIATION[t] ?? 0)) }}>{(Object.keys(ASSET_TYPE_LABEL) as AssetType[]).map(t => <option key={t} value={t}>{ASSET_TYPE_LABEL[t]}</option>)}</select></Field>
      <Field label="Value" hint="what it would sell for today"><input className="inp" inputMode="decimal" value={val} onChange={e => setVal(e.target.value)} placeholder="e.g. 325000" aria-label="Value" /></Field>
      <Field label="Value as of"><input className="inp" type="date" value={asOf} max={today()} onChange={e => setAsOf(e.target.value)} /></Field>
      <Field label="Where the value came from"><input className="inp" list="value-sources" value={src} onChange={e => setSrc(e.target.value)} aria-label="Where the value came from" /><datalist id="value-sources">{VALUE_SOURCES.map(s => <option key={s} value={s} />)}</datalist></Field>
      <Field label="Loan against it" hint="its mortgage or auto loan, for equity"><select className="inp" value={loan} onChange={e => setLoan(e.target.value)}><option value="">— none —</option>{loans.map(x => <option key={x.id} value={x.id}>{acctLabel(x, data.accounts)}</option>)}</select></Field>
      <Field label="Yearly change for the guide, %" hint="positive loses value (cars ~15), negative gains (homes ~−3); blank for none"><input className="inp" inputMode="decimal" value={dep} onChange={e => setDep(e.target.value)} /></Field>
      <Field label="Net worth"><label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={nw} onChange={e => setNw(e.target.checked)} /> count it in net worth</label></Field>
    </div>
  </MBody><MFoot><Btn onClick={onDone}>Cancel</Btn><Btn primary onClick={save}>{a ? 'Save value' : 'Add'}</Btn></MFoot></>
}

/** Recorded balances over time, and the balance on any past date. */
export function HistoryModal({ a, onDone }: { a: Account; onDone: () => void }) {
  const { data, remove, guarded, canEdit } = useData(); const c = C(); const confirm = useConfirm()
  const [date, setDate] = useState(addDays(today(), -30)); const liab = isLiability(a)
  const dropPoint = async (p: { id: string; as_of: string }) => { if (!(await confirm(`Delete the ${fmtDY(p.as_of)} point from ${a.name}'s history? The balance itself is not changed.`))) return; guarded(() => remove('balances', p.id), 'Point removed') }
  const pts = useMemo(() => historySeries(data, a), [data, a]); const rec = historyFor(data, a.id).slice().reverse()
  const on = balanceOn(data, a, date); const bankPts = pts.filter(p => p.bank != null)
  return <><MHead title={`Balance history — ${a.name}`} /><MBody>
    <Chart title={`${a.name} balance history`} data={[{ type: 'scatter', mode: 'lines+markers', name: liab ? 'Owed' : a.kind === 'other_asset' ? 'Value' : 'Book', x: pts.map(p => p.date), y: pts.map(p => p.balance), line: { color: liab ? c.crit : c.accent, width: 2, shape: a.kind === 'other_asset' ? 'hv' : 'linear' }, hovertemplate: '%{x|%b %d, %Y}: $%{y:,.2f}<extra></extra>' },
      ...(bankPts.length ? [{ type: 'scatter' as const, mode: 'markers' as const, name: 'Bank', x: bankPts.map(p => p.date), y: bankPts.map(p => p.bank), marker: { color: c.good, size: 8, symbol: 'diamond' }, hovertemplate: '%{x|%b %d, %Y}: bank $%{y:,.2f}<extra></extra>' }] : [])]}
      layout={{ showlegend: bankPts.length > 0, yaxis: { tickprefix: '$' }, xaxis: { type: 'date', tickformat: '%b %Y', hoverformat: '%b %d, %Y' } }} height={240} />
    {pts.length < 2 && <Note>History starts with the next balance change — every change is kept, one point per day.</Note>}
    <div className="grid2" style={{ marginTop: 10, alignItems: 'end' }}>
      <Field label="Balance on"><input className="inp" type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} aria-label="Balance on date" /></Field>
      <div className="kpi info" data-testid="balance-on"><div className="l">End of {fmtDY(date)}</div><div className="v">{on.balance == null ? '—' : fm2(on.balance)}</div><div className="s">{on.from === 'history' ? (on.recordedOn === date ? 'recorded that day' : `last recorded ${on.recordedOn ? fmtDY(on.recordedOn) : '—'}`) + (on.bank != null ? ` · bank ${fm2(on.bank)}` : '') : on.from === 'ledger' ? 'today\'s balance with later transactions undone' : 'no value recorded on or before that date'}</div></div>
    </div>
    {rec.length > 0 && <div className="tblwrap" style={{ maxHeight: 240, marginTop: 10 }}><table className="tbl"><caption className="sr-only">Recorded balances</caption><thead><tr><th>Date</th><th className="num">{a.kind === 'other_asset' ? 'Value' : 'Book'}</th><th className="num">Bank</th><th>From</th><th></th></tr></thead><tbody>{rec.map(p => <tr key={p.id}><td>{fmtDY(p.as_of)}</td><td className="num">{p.balance == null ? '—' : fm2(p.balance)}</td><td className="num">{p.bank_balance == null ? '—' : fm2(p.bank_balance)}</td><td>{p.source === 'bank' ? 'bank sync' : p.source === 'value' ? 'typed value' : 'book'}</td><td>{canEdit && <button type="button" className="del" aria-label={`Delete the ${fmtDY(p.as_of)} point`} onClick={() => void dropPoint(p)}>✕</button>}</td></tr>)}</tbody></table></div>}
    <Note>Every balance change is kept — one point per account per day: bank syncs, typed balances, statements and the transactions you log. Past dates with no point are worked out from today's balance by undoing the transactions dated after them.</Note>
  </MBody><MFoot><Btn primary onClick={onDone}>Done</Btn></MFoot></>
}

/** Debts page: scores typed from a card issuer, a bank app or a bureau — never a credit pull. */
export function CreditScoreCard() {
  const { data, insert, remove, guarded, canEdit } = useData(); const confirm = useConfirm(); const c = C()
  const trends = useMemo(() => creditTrends(data), [data]); const dt = debtTotals(data); const tips = creditTips(dt.limit ? dt.util : null)
  const names = people(data.scores || []); const [who, setWho] = useState(names[0] || 'Me'); const [date, setDate] = useState(today()); const [score, setScore] = useState(''); const [bureau, setBureau] = useState<NonNullable<CreditScore['bureau']>>('Experian'); const [model, setModel] = useState('FICO 8'); const [src, setSrc] = useState('')
  const add = () => { const s = Math.round(parseNum(score) ?? 0); if (s < 250 || s > 900) return
    guarded(async () => { await insert('scores', { person: who.trim() || 'Me', date, score: s, bureau, model: model.trim() || null, source: src.trim() || null }); setScore('') }, 'Score saved') }
  const series = trends.flatMap(t => Object.entries(t.byBureau).map(([b, list]) => ({ name: `${t.person} · ${b}`, list })))
  const palette = [c.accent, c.blue, c.good, c.warn, c.soon, c.crit]
  const all = (data.scores || []).slice().sort((x, y) => y.date.localeCompare(x.date))
  return <Card span={12} id="credit" title="Credit score" hint="typed from your card issuer, bank app or a bureau — Cresari never pulls your credit">
    <div data-id="credit-scores" />
    {trends.length > 0 && <div className="kpis" style={{ marginBottom: 10 }}>{trends.map(t => { const b = band(t.latest.score); return <KPI key={t.person} l={t.person === 'Me' ? 'Your score' : t.person} v={<>{t.latest.score} <Pill cls={b.cls}>{b.label}</Pill></>} cls={b.cls} s={<>{t.change != null ? <b style={{ color: t.change >= 0 ? 'var(--good-ink)' : 'var(--crit-ink)' }}>{t.change >= 0 ? '+' : '−'}{Math.abs(t.change)} since {fmtDY(t.previous!.date)}</b> : 'first score'} · {t.latest.bureau || 'bureau?'}{t.latest.model ? ` ${t.latest.model}` : ''} · {fmtDY(t.latest.date)}{t.stale ? ' · over 90 days old' : ''}{t.nextBand ? ` · ${t.nextBand.points} points to ${t.nextBand.label}` : ''}</>} /> })}</div>}
    {series.length > 0 ? <Chart title="Credit score over time" data={series.map((s, i) => ({ type: 'scatter' as const, mode: 'lines+markers' as const, name: s.name, x: s.list.map(x => x.date), y: s.list.map(x => x.score), line: { color: palette[i % palette.length], width: 2 }, hovertemplate: `%{x|%b %d, %Y}: %{y}<extra>${s.name}</extra>` }))}
      layout={{ showlegend: true, yaxis: { range: [Math.max(300, Math.min(...all.map(x => x.score)) - 40), Math.min(850, Math.max(...all.map(x => x.score)) + 30)] }, xaxis: { type: 'date', tickformat: '%b %Y' },
        shapes: BANDS.filter(b => b.min > 0).map(b => ({ type: 'line' as const, xref: 'paper' as const, x0: 0, x1: 1, y0: b.min, y1: b.min, line: { color: c.idle, width: 1, dash: 'dot' as const } })),
        annotations: BANDS.filter(b => b.min > 0).map(b => ({ xref: 'paper' as const, x: 1, y: b.min, text: b.label, showarrow: false, xanchor: 'right' as const, yanchor: 'bottom' as const, font: { size: 10, color: c.idle } })) }} height={250} />
      : <Empty>No scores yet. Most credit cards and banks show a free FICO or VantageScore each month — type it here to see the trend.</Empty>}
    {canEdit && <div className="grid2" style={{ marginTop: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
      <Field label="Whose"><input className="inp" list="score-people" value={who} onChange={e => setWho(e.target.value)} aria-label="Whose score" /><datalist id="score-people">{[...new Set(['Me', ...names])].map(n => <option key={n} value={n} />)}</datalist></Field>
      <Field label="Date"><input className="inp" type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} /></Field>
      <Field label="Score"><input className="inp" inputMode="numeric" value={score} onChange={e => setScore(e.target.value)} placeholder="300–850" aria-label="Score" onKeyDown={e => { if (e.key === 'Enter') add() }} /></Field>
      <Field label="Bureau"><select className="inp" value={bureau} onChange={e => setBureau(e.target.value as NonNullable<CreditScore['bureau']>)}>{['Experian', 'Equifax', 'TransUnion', 'Combined', 'Other'].map(b => <option key={b}>{b}</option>)}</select></Field>
      <Field label="Model"><input className="inp" list="score-models" value={model} onChange={e => setModel(e.target.value)} aria-label="Score model" /><datalist id="score-models">{['FICO 8', 'FICO 9', 'FICO 10', 'VantageScore 3.0', 'VantageScore 4.0'].map(m => <option key={m} value={m} />)}</datalist></Field>
      <Field label="From"><input className="inp" value={src} onChange={e => setSrc(e.target.value)} placeholder="e.g. Discover card" /></Field>
      <div style={{ alignSelf: 'end' }}><Btn primary onClick={add}>Save score</Btn></div>
    </div>}
    <div className="grid g12" style={{ marginTop: 10 }}>
      <div style={{ gridColumn: 'span 6' }}><b style={{ fontSize: 13 }}>What moves it</b><ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>{tips.map(t => <li key={t} style={{ margin: '3px 0' }}>{t}</li>)}</ul></div>
      <div style={{ gridColumn: 'span 6' }}>{all.length > 0 && <div className="tblwrap" style={{ maxHeight: 200 }}><table className="tbl"><caption className="sr-only">Saved scores</caption><thead><tr><th>Date</th><th>Whose</th><th className="num">Score</th><th>Bureau · model</th><th>From</th><th></th></tr></thead><tbody>{all.map(s => <tr key={s.id}><td>{fmtDY(s.date)}</td><td>{s.person}</td><td className="num">{s.score}</td><td>{s.bureau || '—'}{s.model ? ` · ${s.model}` : ''}</td><td>{s.source || '—'}</td><td>{canEdit && <button type="button" className="del" aria-label={`Delete the ${s.date} score`} onClick={async () => { if (await confirm(`Delete the ${s.score} score from ${fmtDY(s.date)}?`)) guarded(() => remove('scores', s.id), 'Deleted') }}>✕</button>}</td></tr>)}</tbody></table></div>}</div>
    </div>
    <Note>Compare like with like: the change is measured against the last score from the same bureau and model, since FICO and VantageScore can differ by 20+ points on the same day. Bands follow FICO: 800+ exceptional, 740 very good, 670 good, 580 fair.</Note>
  </Card>
}
