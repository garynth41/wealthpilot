// Year-to-date coverage: for each account, which months of the year have transactions on file, and which months were never loaded.
// SimpleFIN keeps about 90 days; anything older has to come from a statement file (CSV / OFX / QFX) — this tells the owner exactly which.
import type { Data } from '../app/data/types'
import { today } from './dates'

export interface CoverageMonth { key: string; n: number; state: 'ok' | 'quiet' | 'missing' }
export interface CoverageRow { accountId: string; name: string; kind: string; first: string | null; last: string | null; months: CoverageMonth[]; missing: string[]; total: number }
export interface Coverage { year: string; from: string; to: string; months: string[]; rows: CoverageRow[]; complete: boolean; firstOnFile: string | null; missingAccounts: number }

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const monthLabel = (key: string) => MONTH[+key.slice(5, 7) - 1]

/** months: Jan..the as-of month. A month is "missing" when it falls before the account's first transaction on file (never loaded),
 *  "quiet" when it is after the first transaction but has none (a dormant account, not a gap), "ok" otherwise. */
export function ytdCoverage(d: Data, asOf = today()): Coverage {
  const year = asOf.slice(0, 4), from = `${year}-01-01`, to = asOf
  const months = Array.from({ length: +asOf.slice(5, 7) }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
  const live = d.transactions.filter(t => t.status !== 'void' && !t.duplicate_of)
  const rows: CoverageRow[] = d.accounts.filter(a => a.status === 'Active').map(a => {
    const mine = live.filter(t => t.account_id === a.id || t.to_account_id === a.id).map(t => t.date).sort()
    const inYear = mine.filter(x => x >= from && x <= to)
    const first = mine[0] || null, last = mine[mine.length - 1] || null
    const cells: CoverageMonth[] = months.map(key => { const n = inYear.filter(x => x.startsWith(key)).length; return { key, n, state: n ? 'ok' : !first || key < first.slice(0, 7) ? 'missing' : 'quiet' } })
    // the month holding the first transaction is only partly loaded when that transaction is after the 3rd
    const fm = first && first >= from ? first.slice(0, 7) : null
    const missing = cells.filter(c => c.state === 'missing').map(c => c.key)
    if (fm && +first!.slice(8, 10) > 3 && !missing.includes(fm)) missing.push(`${fm} (before ${monthLabel(fm)} ${+first!.slice(8, 10)})`)
    return { accountId: a.id, name: a.name, kind: a.kind, first, last, months: cells, missing, total: inYear.length }
  })
  const firstOnFile = live.map(t => t.date).sort()[0] || null
  const withData = rows.filter(r => r.total > 0)
  return { year, from, to, months, rows, complete: withData.length > 0 && withData.every(r => r.missing.length === 0), firstOnFile, missingAccounts: rows.filter(r => r.missing.length > 0).length }
}
