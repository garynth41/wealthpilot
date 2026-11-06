// Tax lots and tax-loss harvesting (0.22.0). A holding can carry purchase lots (date, quantity, total cost); gains then split into
// short-term (held one year or less) and long-term, and losing lots in taxable accounts become harvesting candidates.
// Planning guidance only: the $3,000-a-year limit on losses against ordinary income and the wash-sale rule are flagged, not modelled exactly.
import type { Account, Data, Holding, HoldingLot } from '../app/data/types'
import { addDays, diffDays, today } from './dates'
import { round2, sum } from './money'

/** The day a lot turns long-term: more than one year after it was bought (the day after the first anniversary). */
export const longTermOn = (acquired: string) => { const y = +acquired.slice(0, 4) + 1; const md = acquired.slice(5, 10) === '02-29' ? '02-28' : acquired.slice(5, 10); return addDays(`${y}-${md}`, 1) }
export const WASH_DAYS = 30
/** Accounts whose gains are taxed when sold (retirement accounts and HSAs are not). */
export const isTaxableAccount = (a?: Account | null) => !a || a.kind === 'investment' || a.kind === 'other_asset' || a.kind === 'cash'

export interface LotView { lot: HoldingLot; price: number; value: number; cost: number; gain: number; gainPct: number | null; days: number; term: 'short' | 'long'; longOn: string }
export const lotsFor = (d: Pick<Data, 'lots'>, holdingId: string): HoldingLot[] => (d.lots || []).filter(l => l.holding_id === holdingId).sort((a, b) => a.acquired_on.localeCompare(b.acquired_on))
export function lotView(h: Pick<Holding, 'price'>, lot: HoldingLot, asOf = today()): LotView {
  const price = +h.price || 0, value = round2((+lot.quantity || 0) * price), cost = round2(+lot.cost || 0), gain = round2(value - cost)
  const longOn = longTermOn(lot.acquired_on)
  return { lot, price, value, cost, gain, gainPct: cost > 0 ? round2(gain / cost) : null, days: Math.max(0, diffDays(asOf, lot.acquired_on)), term: asOf >= longOn ? 'long' : 'short', longOn }
}
export interface LotSummary { lots: LotView[]; quantity: number; cost: number; shortGain: number; longGain: number; mismatch: { quantity: number; cost: number } | null; nextLongTerm: LotView | null }
/** A holding's lots with totals; `mismatch` when the lots do not add up to the holding's quantity and cost basis. */
export function lotSummary(d: Pick<Data, 'lots'>, h: Holding, asOf = today()): LotSummary {
  const lots = lotsFor(d, h.id).map(l => lotView(h, l, asOf)); const quantity = round2(sum(lots.map(l => +l.lot.quantity))), cost = round2(sum(lots.map(l => l.cost)))
  const off = lots.length && (Math.abs(quantity - (+h.quantity || 0)) > 0.0001 || Math.abs(cost - (+h.cost_basis || 0)) > 0.005)
  const nextLongTerm = lots.filter(l => l.term === 'short').sort((a, b) => a.longOn.localeCompare(b.longOn))[0] || null
  return { lots, quantity, cost, shortGain: round2(sum(lots.filter(l => l.term === 'short').map(l => l.gain))), longGain: round2(sum(lots.filter(l => l.term === 'long').map(l => l.gain))), mismatch: off ? { quantity: round2((+h.quantity || 0) - quantity), cost: round2((+h.cost_basis || 0) - cost) } : null, nextLongTerm }
}
/** What the holding row should say once its lots are the source of truth. */
export const holdingFromLots = (lots: Array<Pick<HoldingLot, 'quantity' | 'cost'>>) => ({ quantity: round2(sum(lots.map(l => +l.quantity || 0)) * 10000) / 10000, cost_basis: round2(sum(lots.map(l => +l.cost || 0))) })

export interface Harvest { holding: Holding; account: Account | null; lots: LotView[]; byLot: boolean; loss: number; shortLoss: number; longLoss: number; lossPct: number; taxSaved: number; wash: string | null; holdUntil: string | null }
/** Losing positions in taxable accounts, largest loss first. With lots, only the losing lots are sold (specific identification);
 *  without lots the whole position is assumed long-term. `wash` warns when the same symbol was bought in the last 30 days anywhere
 *  (an IRA purchase counts too); buying it back within 30 days after the sale would also disallow the loss. */
export function harvestCandidates(d: Pick<Data, 'holdings' | 'lots' | 'accounts'>, opts: { minLoss?: number; minPct?: number; ordinaryRate?: number; ltcgRate?: number; asOf?: string } = {}): Harvest[] {
  const asOf = opts.asOf || today(), minLoss = opts.minLoss ?? 100, minPct = opts.minPct ?? 0.05, ord = opts.ordinaryRate ?? 0.22, lt = opts.ltcgRate ?? 0.15
  const sym = (h: Holding) => String(h.symbol || '').trim().toUpperCase()
  const out: Harvest[] = []
  for (const h of d.holdings) {
    const a = h.account_id ? d.accounts.find(x => x.id === h.account_id) || null : null
    if (!isTaxableAccount(a) || h.asset_class === 'cash' || !(+h.price > 0)) continue
    const own = lotsFor(d, h.id); const byLot = own.length > 0
    const views = byLot ? own.map(l => lotView(h, l, asOf)) : [lotView(h, { id: 'all-' + h.id, household_id: h.household_id, holding_id: h.id, acquired_on: '1900-01-01', quantity: +h.quantity || 0, cost: +h.cost_basis || 0 }, asOf)]
    const losing = views.filter(v => v.gain < -0.005); if (!losing.length) continue
    const loss = round2(-sum(losing.map(v => v.gain))), cost = sum(losing.map(v => v.cost)), lossPct = cost > 0 ? round2(loss / cost) : 0
    if (loss < minLoss || lossPct < minPct) continue
    const shortLoss = round2(-sum(losing.filter(v => v.term === 'short').map(v => v.gain))), longLoss = round2(loss - shortLoss)
    let wash: string | null = null
    if (sym(h)) { const recent = d.holdings.filter(x => sym(x) === sym(h)).flatMap(x => lotsFor(d, x.id).map(l => ({ l, x }))).filter(({ l }) => l.acquired_on > addDays(asOf, -WASH_DAYS - 1) && l.acquired_on <= asOf).sort((p, q) => q.l.acquired_on.localeCompare(p.l.acquired_on))[0]
      if (recent) { const acc = d.accounts.find(z => z.id === recent.x.account_id); wash = `${sym(h)} was bought on ${recent.l.acquired_on}${acc && acc.id !== h.account_id ? ` in ${acc.name}` : ''} — a sale at a loss within ${WASH_DAYS} days of a purchase is a wash sale` } }
    // a short-term lot close to turning long-term is usually better held (long-term losses are worth less, but so is selling early for a gain elsewhere) — show the date
    const soon = losing.filter(v => v.term === 'short' && diffDays(v.longOn, asOf) <= 30).sort((p, q) => p.longOn.localeCompare(q.longOn))[0]
    out.push({ holding: h, account: a, lots: losing, byLot, loss, shortLoss, longLoss, lossPct, taxSaved: round2(shortLoss * ord + longLoss * lt), wash, holdUntil: soon ? soon.longOn : null })
  }
  return out.sort((p, q) => q.loss - p.loss)
}
/** Losses beyond realised gains offset at most $3,000 of ordinary income a year ($1,500 married filing separately); the rest carries forward. */
export const ORDINARY_OFFSET_LIMIT = (status: string) => (status === 'mfs' ? 1500 : 3000)
