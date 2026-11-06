// Market prices for holdings (0.20.0). NO imports: this file is copied byte-for-byte into supabase/functions/price-feed/prices.ts
// by scripts/sync-engines.mjs, so the browser (tests, staleness badges) and the daily price-feed function share one set of rules.
//
// A holding is auto-priced when it has a symbol and price_source is not 'manual'. The feed asks Yahoo's chart endpoint (stocks, ETFs,
// mutual funds, crypto pairs), on its second host when the first fails. (Stooq was the original fallback; in Nov 2026 its quote URL
// returned 404 and its history URL a JavaScript bot check, so it cannot be used from a server.) A price only ever moves forward in time:
// an older quote never overwrites a newer typed price.

export interface PHolding { id: string; household_id?: string; symbol?: string | null; asset_class?: string | null; price: number; price_as_of?: string | null; price_source?: 'auto' | 'manual' | null }
export interface Quote { symbol: string; price: number; date: string; currency?: string; source: 'yahoo' }
export interface PricePatch { id: string; household_id?: string; symbol: string; price: number; price_as_of: string; from: number }

/** Trimmed, upper-case symbol as typed ('vti ' → 'VTI'); null when there is nothing usable. */
export function normSymbol(s: string | null | undefined): string | null {
  const t = String(s || '').trim().toUpperCase().replace(/\s+/g, '')
  return t && /^[A-Z0-9.^=\-/]{1,20}$/.test(t) ? t : null
}
/** The symbol a quote service understands: crypto without a pair gets -USD (BTC → BTC-USD); class shares use a dash (BRK.B → BRK-B). */
export function quoteSymbol(symbol: string | null | undefined, assetClass?: string | null): string | null {
  const s = normSymbol(symbol); if (!s) return null
  if (assetClass === 'crypto' && !/[-/]/.test(s)) return `${s}-USD`
  return s.replace('/', '-').replace(/^([A-Z]{1,5})\.([A-Z])$/, '$1-$2')
}
export const isAutoPriced = (h: PHolding) => (h.price_source ?? 'auto') !== 'manual' && !!quoteSymbol(h.symbol, h.asset_class)

/** Yahoo's chart endpoint; host 1 first, host 2 as the fallback (they fail independently). */
export const yahooUrl = (sym: string, host: 1 | 2 = 1) => `https://query${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`

/** Calendar date of a unix timestamp in New York (US market dates). */
export function nyDate(unixSeconds: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(unixSeconds * 1000))
  const g = (t: string) => parts.find(p => p.type === t)?.value || ''
  return `${g('year')}-${g('month')}-${g('day')}`
}
/** Yahoo chart JSON → the latest price and its market date; null when the symbol is unknown or the payload has no price. */
export function parseYahooChart(sym: string, j: unknown): Quote | null {
  const r = (j as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; regularMarketTime?: number; currency?: string }; timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> } })?.chart?.result?.[0]
  if (!r) return null
  const m = r.meta || {}
  if (typeof m.regularMarketPrice === 'number' && m.regularMarketPrice > 0 && typeof m.regularMarketTime === 'number')
    return { symbol: sym, price: Math.round(m.regularMarketPrice * 10000) / 10000, date: nyDate(m.regularMarketTime), currency: m.currency || 'USD', source: 'yahoo' }
  const ts = r.timestamp || [], closes = r.indicators?.quote?.[0]?.close || []
  for (let k = Math.min(ts.length, closes.length) - 1; k >= 0; k--) { const c = closes[k]; if (typeof c === 'number' && c > 0) return { symbol: sym, price: Math.round(c * 10000) / 10000, date: nyDate(ts[k]), currency: m.currency || 'USD', source: 'yahoo' } }
  return null
}
/** Which holdings a set of quotes should update. Never moves a price backwards in time; skips no-op updates. */
export function planPriceUpdates(holdings: PHolding[], quotes: Record<string, Quote>): PricePatch[] {
  const out: PricePatch[] = []
  for (const h of holdings) {
    if (!isAutoPriced(h)) continue
    const q = quotes[quoteSymbol(h.symbol, h.asset_class)!]; if (!q) continue
    const asOf = (h.price_as_of || '').slice(0, 10)
    if (asOf && q.date < asOf) continue
    if (asOf === q.date && Math.abs((+h.price || 0) - q.price) < 0.00005) continue
    out.push({ id: h.id, household_id: h.household_id, symbol: q.symbol, price: q.price, price_as_of: q.date, from: +h.price || 0 })
  }
  return out
}
/** Distinct quote symbols the feed has to fetch. */
export const symbolsToFetch = (holdings: PHolding[]) => [...new Set(holdings.filter(isAutoPriced).map(h => quoteSymbol(h.symbol, h.asset_class)!))].sort()
/** Whole days since the price was set; null when it never was. Weekends make 1–3 days normal for an auto-priced holding. */
export function priceAgeDays(h: Pick<PHolding, 'price_as_of'>, today: string): number | null {
  if (!h.price_as_of) return null
  return Math.round((Date.parse(today.slice(0, 10) + 'T12:00:00Z') - Date.parse(h.price_as_of.slice(0, 10) + 'T12:00:00Z')) / 86400000)
}
/** 'fresh' within 4 days (a long weekend), 'stale' within 30, 'old' beyond that or never priced. */
export const priceFreshness = (h: Pick<PHolding, 'price_as_of'>, today: string): 'fresh' | 'stale' | 'old' => { const a = priceAgeDays(h, today); return a == null || a > 30 ? 'old' : a > 4 ? 'stale' : 'fresh' }
