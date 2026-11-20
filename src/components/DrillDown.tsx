// Drill-down panel (0.30.0): click a bar, a slice, a table row or a tile and see the exact transactions behind the figure — with the
// total, the merchants and months that make it up, and a way to re-file them without leaving the page. The lines come from lib/drill.ts,
// which uses the same rule as every figure, so the panel's total is the number that was clicked.
import { useMemo, useState } from 'react'
import { useData } from '../app/hooks'
import { useStore } from '../app/store'
import { Btn, MBody, MFoot, MHead, Note, useModal } from './ui'
import { drillLines, summarize, ledgerLink, type DrillFilter, type DrillLine } from '../lib/drill'
import { learnRule, upsertRule } from '../lib/rules'
import { fm2 as fmtMoney } from '../lib/money'   // to the cent: the panel's total must read exactly as the figure's own detail does
import { fmtD, mShort } from '../lib/dates'
import { merchantKey } from '../lib/intelligence'

const summarizeKey = (l: DrillLine) => merchantKey(l.txn.payee)

const SHOW = 200
export interface DrillProps { title: string; filter: DrillFilter; /** one line under the title, e.g. the period */ note?: string }

/** `const drill = useDrill()` then `drill('Groceries · November', { from, to, category: 'Groceries' })`. */
export function useDrill() { const { open } = useModal(); return (title: string, filter: DrillFilter, note?: string) => { open(<DrillDown title={title} filter={filter} note={note} />, { wide: true }) } }

export function DrillDown({ title, filter, note }: DrillProps) {
  const { data, settings, catOpts, catLabels, cat, acctName, canEdit, guarded, saveSettings } = useData(); const { close } = useModal()
  const [merchant, setMerchant] = useState<string | null>(null); const [picked, setPicked] = useState<Set<string>>(new Set()); const [moveTo, setMoveTo] = useState('')
  const income = filter.flow === 'income'
  const all = useMemo(() => drillLines(data, filter), [data, filter])
  const lines = useMemo(() => (merchant ? all.filter(l => summarizeKey(l) === merchant) : all), [all, merchant])
  const s = useMemo(() => summarize(data, lines), [data, lines]); const whole = useMemo(() => summarize(data, all), [data, all])
  const opts = catOpts(income ? ['income'] : ['expense'])
  const keyOf = (l: DrillLine, i: number) => l.txn.id + (l.slice ? ':' + i : '')
  const movable = lines.filter(l => !l.slice)   // a slice of a split transaction is re-filed in the ledger's split editor
  const chosen = movable.filter(l => picked.has(l.txn.id))
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allOn = movable.length > 0 && movable.every(l => picked.has(l.txn.id))
  const learn = async (payee: string | null | undefined, kind: string, category_id: string) => {
    if (!payee || settings.learnRules === false || kind === 'transfer') return
    const r = learnRule(payee, { category_id }, kind as 'expense' | 'income'); if (r) await saveSettings({ rules: upsertRule(useStore.getState().settings().rules || [], r) })
  }
  const setOne = (l: DrillLine, id: string) => guarded(async () => { await useStore.getState().update('transactions', l.txn.id, { category_id: id || null }); if (id) await learn(l.txn.payee, l.txn.kind, id) }, id ? `Filed under ${cat(id)?.name || 'the category'}` : 'Category cleared')
  const moveChosen = () => { if (!moveTo || !chosen.length) return; const ids = chosen.map(l => l.txn.id), n = ids.length
    void guarded(async () => { await useStore.getState().bulkUpdate('transactions', ids, { category_id: moveTo }); for (const p of new Set(chosen.map(l => l.txn.payee).filter(Boolean))) await learn(p, chosen[0].txn.kind, moveTo); setPicked(new Set()); setMoveTo('') }, `Moved ${n} transaction${n === 1 ? '' : 's'} to ${cat(moveTo)?.name || 'the category'}`) }
  const bar = (v: number, max: number) => <span className="dd-bar" aria-hidden="true"><span style={{ width: `${max > 0 ? Math.max(2, Math.round(Math.abs(v) / max * 100)) : 0}%` }} /></span>
  const topM = whole.merchants.slice(0, 8), maxM = Math.max(0, ...topM.map(m => Math.abs(m.total))), maxMo = Math.max(0, ...s.months.map(m => Math.abs(m.total)))
  const second = filter.category === undefined && s.categories.length > 1 ? 'cats' : s.months.length > 1 ? 'months' : null
  const maxC = Math.max(0, ...s.categories.slice(0, 8).map(c => Math.abs(c.total)))
  return <>
    <MHead title={title} />
    <MBody>
      {note && <Note>{note}</Note>}
      {all.length === 0 ? <div className="empty">No transactions are behind this figure in this period.</div> : <>
        <div className="kpis dd-kpis">
          <div className="kpi info"><div className="l">{income ? 'Total received' : 'Total'}</div><div className="v" data-dd="total">{fmtMoney(s.total)}</div><div className="s">{merchant ? `of ${fmtMoney(whole.total)} in all` : `${fmtD(filter.from)} – ${fmtD(filter.to)}`}</div></div>
          <div className="kpi info"><div className="l">Transactions</div><div className="v" data-dd="count">{s.count}</div><div className="s">average {fmtMoney(s.average)}</div></div>
          {s.largest && <div className="kpi info"><div className="l">Largest</div><div className="v">{fmtMoney(s.largest.amount)}</div><div className="s">{(s.largest.txn.payee || 'No payee').slice(0, 28)} · {fmtD(s.largest.txn.date)}</div></div>}
        </div>
        <div className="dd-parts">
          <section aria-label="Merchants"><h3 className="gm-h">{income ? 'Who paid' : 'Where it went'} <span className="note" style={{ margin: 0 }}>· tap one to see only it</span></h3>
            <ul className="dd-list">{topM.map(m => <li key={m.key}><button type="button" className={`dd-row${merchant === m.key ? ' on' : ''}`} aria-pressed={merchant === m.key} onClick={() => { setMerchant(merchant === m.key ? null : m.key); setPicked(new Set()) }}><span className="nm">{m.name}</span><span className="ct">{m.count}×</span>{bar(m.total, maxM)}<span className="amt">{fmtMoney(m.total)}</span></button></li>)}</ul>
            {whole.merchants.length > topM.length && <Note>and {whole.merchants.length - topM.length} more below</Note>}
          </section>
          {second && <section aria-label={second === 'cats' ? 'Categories' : 'Months'}><h3 className="gm-h">{second === 'cats' ? 'By category' : 'By month'}</h3>
            <ul className="dd-list">{second === 'cats' ? s.categories.slice(0, 8).map(c => <li key={c.name}><span className="dd-row static"><span className="nm">{c.name}</span><span className="ct">{c.count}×</span>{bar(c.total, maxC)}<span className="amt">{fmtMoney(c.total)}</span></span></li>)
              : s.months.map(m => <li key={m.month}><span className="dd-row static"><span className="nm">{mShort(m.month)}</span><span className="ct">{m.count}×</span>{bar(m.total, maxMo)}<span className="amt">{fmtMoney(m.total)}</span></span></li>)}</ul>
          </section>}
        </div>
        {merchant && <div className="dd-chip">Showing only <b>{whole.merchants.find(m => m.key === merchant)?.name}</b> <button type="button" onClick={() => setMerchant(null)}>Show all</button></div>}
        {canEdit && movable.length > 0 && <div className="dd-move"><label className="dd-all"><input type="checkbox" checked={allOn} onChange={() => setPicked(allOn ? new Set() : new Set(movable.map(l => l.txn.id)))} /> Select all {movable.length}</label>
          <select className="inp" aria-label="Move the selected transactions to this category" value={moveTo} onChange={e => setMoveTo(e.target.value)}><option value="">Move selected to…</option>{opts.map(c => <option key={c.id} value={c.id}>{catLabels[c.id]}</option>)}</select>
          <Btn primary sm disabled={!moveTo || !chosen.length} onClick={moveChosen}>Move {chosen.length || ''}</Btn></div>}
        <div className="tblwrap dd-tbl"><table className="tbl"><thead><tr>{canEdit && <th style={{ width: 30 }}><span className="sr-only">Select</span></th>}<th>Date</th><th>Payee</th><th>Category</th><th>Account</th><th className="num">Amount</th></tr></thead>
          <tbody>{lines.slice(0, SHOW).map((l, i) => <tr key={keyOf(l, i)} className={picked.has(l.txn.id) && !l.slice ? 'is-selected' : ''}>
            {canEdit && <td>{!l.slice && <input type="checkbox" aria-label={`Select ${l.txn.payee || 'transaction'} ${fmtD(l.txn.date)}`} checked={picked.has(l.txn.id)} onChange={() => toggle(l.txn.id)} />}</td>}
            <td style={{ whiteSpace: 'nowrap' }}>{fmtD(l.txn.date)}</td>
            <td>{l.txn.payee || <span className="note" style={{ margin: 0 }}>No payee</span>}{l.txn.memo ? <div className="note" style={{ margin: 0 }}>{l.txn.memo.slice(0, 70)}</div> : null}</td>
            <td>{l.slice || !canEdit ? <span>{cat(l.category_id)?.name || 'Uncategorized'}{l.slice ? <span className="note" style={{ margin: 0 }}> · part of a split</span> : null}</span>
              : <select aria-label={`Category for ${l.txn.payee || 'transaction'}`} value={l.category_id || ''} onChange={e => setOne(l, e.target.value)}><option value="">— uncategorized —</option>{opts.map(c => <option key={c.id} value={c.id}>{catLabels[c.id]}</option>)}{l.category_id && !opts.some(c => c.id === l.category_id) ? <option value={l.category_id}>{cat(l.category_id)?.name || 'Other'}</option> : null}</select>}</td>
            <td>{acctName(l.txn.account_id)}</td><td className="num">{fmtMoney(l.amount)}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={canEdit ? 5 : 4}>{lines.length > SHOW ? `Showing the newest ${SHOW} of ${lines.length} — open them in the ledger for the rest` : `${lines.length} transaction${lines.length === 1 ? '' : 's'}`}</td><td className="num">{fmtMoney(s.total)}</td></tr></tfoot></table></div>
      </>}
    </MBody>
    <MFoot>{all.length > 0 && <Btn onClick={() => { location.hash = ledgerLink(lines); close() }}>Open in the ledger</Btn>}<Btn primary onClick={close}>Done</Btn></MFoot>
  </>
}
