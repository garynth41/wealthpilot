// Tax lots and tax-loss harvesting (0.22.0) — engines in lib/lots.ts. A holding's lots become the source of its quantity and cost basis.
import { useMemo, useState } from 'react'
import { useData } from '../app/hooks'
import { useStore } from '../app/store'
import type { Holding, HoldingLot } from '../app/data/types'
import { Btn, Card, Note, Pill, MHead, MBody, MFoot, Field, useConfirm, useModal } from '../components/ui'
import { lotSummary, holdingFromLots, harvestCandidates, ORDINARY_OFFSET_LIMIT, WASH_DAYS } from '../lib/lots'
import { estimateTax, ltcgRate } from '../lib/tax'
import { fmtD, fmtDY, today } from '../lib/dates'
import { fm2, fmtMoney, parseNum, round2 } from '../lib/money'

export function LotsModal({ h, onDone }: { h: Holding; onDone: () => void }) {
  const { data, insert, update, remove, guarded, canEdit } = useData(); const confirm = useConfirm()
  const sum = lotSummary(data, h)
  const [date, setDate] = useState(today()); const [qty, setQty] = useState(''); const [cost, setCost] = useState('')
  /** after any lot change the holding's quantity and cost basis follow the lots */
  const sync = async () => { const lots = useStore.getState().data.lots.filter(l => l.holding_id === h.id); if (lots.length) await update('holdings', h.id, holdingFromLots(lots)) }
  const add = () => { const q = parseNum(qty), c = parseNum(cost); if (!q || q <= 0 || c == null || c < 0) return
    guarded(async () => { await insert('lots', { holding_id: h.id, acquired_on: date, quantity: q, cost: round2(c) }); await sync(); setQty(''); setCost('') }, 'Lot added') }
  const seed = () => guarded(async () => { await insert('lots', { holding_id: h.id, acquired_on: (h.created_at || today()).slice(0, 10), quantity: +h.quantity || 0, cost: +h.cost_basis || 0, notes: 'whole position — split it into the real purchases' }); await sync() }, 'One lot created from the holding')
  const edit = (l: HoldingLot, patch: Partial<HoldingLot>) => guarded(async () => { await update('lots', l.id, patch); await sync() })
  const del = async (l: HoldingLot) => { if (!(await confirm(`Remove the ${l.quantity} bought on ${fmtD(l.acquired_on)}?`, 'Remove'))) return; guarded(async () => { await remove('lots', l.id); await sync() }, 'Lot removed') }
  return <><MHead title={`Tax lots · ${h.symbol || h.name}`} /><MBody>
    <Note>Each purchase with its date and total cost. Gains on lots held more than a year are long-term (taxed at 0/15/20%); a year or less is short-term (taxed like wages). The holding's quantity and cost basis follow its lots.</Note>
    {sum.lots.length === 0 ? <div className="empty">No lots yet. {canEdit && +h.quantity > 0 && <Btn sm onClick={seed}>Start from the holding ({h.quantity} for {fm2(+h.cost_basis || 0)})</Btn>}</div>
      : <div className="tblwrap" style={{ marginTop: 8 }}><table className="tbl"><caption className="sr-only">Lots</caption><thead><tr><th scope="col">Bought</th><th scope="col" className="num">Quantity</th><th scope="col" className="num">Cost</th><th scope="col" className="num">Value</th><th scope="col" className="num">Gain / loss</th><th scope="col">Term</th><th scope="col" /></tr></thead><tbody>
        {sum.lots.map(v => <tr key={v.lot.id} className={v.gain < 0 ? 'st-warn' : 'st-good'}>
          <td>{canEdit ? <input className="inp" type="date" defaultValue={v.lot.acquired_on} aria-label="Bought on" onBlur={e => { if (e.target.value && e.target.value !== v.lot.acquired_on) edit(v.lot, { acquired_on: e.target.value }) }} /> : fmtD(v.lot.acquired_on)}</td>
          <td className="num">{canEdit ? <input className="inp num" inputMode="decimal" defaultValue={String(v.lot.quantity)} aria-label="Quantity" style={{ width: 90, textAlign: 'right' }} onBlur={e => { const n = parseNum(e.target.value); if (n && n > 0 && n !== +v.lot.quantity) edit(v.lot, { quantity: n }) }} /> : v.lot.quantity}</td>
          <td className="num">{canEdit ? <input className="inp num" inputMode="decimal" defaultValue={v.cost.toFixed(2)} aria-label="Total cost" style={{ width: 100, textAlign: 'right' }} onBlur={e => { const n = parseNum(e.target.value); if (n != null && n >= 0 && n !== v.cost) edit(v.lot, { cost: round2(n) }) }} /> : fm2(v.cost)}</td>
          <td className="num">{fm2(v.value)}</td><td className="num" style={{ color: v.gain >= 0 ? 'var(--good-ink)' : 'var(--crit-ink)' }}>{(v.gain >= 0 ? '+' : '') + fm2(v.gain)}{v.gainPct != null ? ` (${Math.round(v.gainPct * 100)}%)` : ''}</td>
          <td>{v.term === 'long' ? <Pill cls="good">long-term</Pill> : <Pill cls="wait" >short · long on {fmtD(v.longOn)}</Pill>}</td>
          <td>{canEdit && <button className="del" onClick={() => del(v.lot)} aria-label={`Remove lot bought ${v.lot.acquired_on}`}>✕</button>}</td></tr>)}
      </tbody><tfoot><tr><td>Total</td><td className="num">{sum.quantity}</td><td className="num">{fm2(sum.cost)}</td><td colSpan={4}>short-term {(sum.shortGain >= 0 ? '+' : '') + fm2(sum.shortGain)} · long-term {(sum.longGain >= 0 ? '+' : '') + fm2(sum.longGain)}</td></tr></tfoot></table></div>}
    {sum.mismatch && <div className="msg warn" style={{ marginTop: 8 }}>The lots add up to {sum.quantity} for {fm2(sum.cost)}; the holding says {h.quantity} for {fm2(+h.cost_basis || 0)}. {canEdit && <Btn sm onClick={() => guarded(sync, 'Holding updated from its lots')}>Use the lots</Btn>}</div>}
    {canEdit && <div className="grid3" style={{ marginTop: 12 }}><Field label="Bought on"><input className="inp" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field><Field label="Quantity"><input className="inp" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} placeholder="10" /></Field><Field label="Total cost" hint="price × quantity + fees"><input className="inp" inputMode="decimal" value={cost} onChange={e => setCost(e.target.value)} placeholder="0.00" /></Field></div>}
  </MBody><MFoot><Btn onClick={onDone}>Close</Btn>{canEdit && <Btn primary onClick={add} disabled={!parseNum(qty) || parseNum(cost) == null}>Add lot</Btn>}</MFoot></>
}

/** Losing positions in taxable accounts with the tax a sale would save, the wash-sale check and the $3,000 limit. */
export function HarvestCard() {
  const { data, settings } = useData(); const { open, close } = useModal()
  const est = useMemo(() => { try { return estimateTax(data, settings) } catch { return null } }, [data, settings])
  const ord = est ? round2(est.federal.marginal + est.state.rate) : 0.22, lt = est ? round2(ltcgRate(est) + est.state.rate) : 0.15
  const list = useMemo(() => harvestCandidates(data, { ordinaryRate: ord, ltcgRate: lt }), [data, ord, lt])
  const total = round2(list.reduce((n, x) => n + x.loss, 0)), saved = round2(list.reduce((n, x) => n + x.taxSaved, 0)); const cap = ORDINARY_OFFSET_LIMIT(est?.status || 'single')
  return <Card span={12} title="Tax-loss harvesting" hint={`taxable accounts only · losses at your rates: ${Math.round(ord * 100)}% short-term, ${Math.round(lt * 100)}% long-term`}>
    {list.length === 0 ? <div className="empty">No losing positions worth harvesting right now (at least $100 and 5% below cost). Add tax lots to a holding to see each purchase separately.</div> : <>
      <div className="tblwrap"><table className="tbl"><caption className="sr-only">Harvesting candidates</caption><thead><tr><th scope="col">Holding</th><th scope="col">Account</th><th scope="col" className="num">Loss</th><th scope="col" className="num">Short / long</th><th scope="col" className="num">Tax saved (est.)</th><th scope="col">Check</th><th scope="col" /></tr></thead><tbody>
        {list.map(x => <tr key={x.holding.id} className={x.wash ? 'st-warn' : 'st-info'}><td><b>{x.holding.symbol || x.holding.name}</b> <span className="note" style={{ display: 'inline' }}>{x.byLot ? `${x.lots.length} losing lot${x.lots.length === 1 ? '' : 's'}` : 'whole position'}</span></td><td>{x.account?.name || '—'}</td>
          <td className="num" style={{ color: 'var(--crit-ink)' }}>−{fm2(x.loss)} <span className="note" style={{ display: 'inline' }}>{Math.round(x.lossPct * 100)}%</span></td><td className="num">{fm2(x.shortLoss)} / {fm2(x.longLoss)}</td><td className="num"><b>{fmtMoney(x.taxSaved)}</b></td>
          <td style={{ fontSize: 12.5 }}>{x.wash ? <span style={{ color: 'var(--warn-ink)' }}>⚠ {x.wash}</span> : x.holdUntil ? `turns long-term ${fmtDY(x.holdUntil)}` : 'no purchase in the last 30 days'}</td>
          <td><Btn sm onClick={() => open(<LotsModal h={x.holding} onDone={close} />, { wide: true })}>Lots</Btn></td></tr>)}
      </tbody><tfoot><tr><td colSpan={2}>Total</td><td className="num">−{fm2(total)}</td><td /><td className="num"><b>{fmtMoney(saved)}</b></td><td colSpan={2} /></tr></tfoot></table></div>
      <Note>Selling a loser and buying a similar (not substantially identical) fund keeps you invested while booking the loss. Losses first cancel realized gains; beyond that up to {fmtMoney(cap)} a year comes off ordinary income and the rest carries forward. Do not buy the same security back — in any account, an IRA included — within {WASH_DAYS} days before or after the sale (wash-sale rule). Estimates, not tax advice.</Note></>}
  </Card>
}
