// Year-to-date coverage card: which months of the year each account has on file, and what to import to complete it.
import { useMemo } from 'react'
import { useData } from '../app/hooks'
import { Card, Note, Pill } from '../components/ui'
import { ytdCoverage, monthLabel } from '../lib/coverage'
import { fmtDY } from '../lib/dates'

export function YtdCoverageCard() {
  const { data } = useData()
  const c = useMemo(() => ytdCoverage(data), [data])
  const cell = (key: string, state: string, n: number) => <td key={key} className="num" title={state === 'missing' ? 'not loaded — import a statement for this month' : state === 'quiet' ? 'no transactions this month' : `${n} transactions`}
    style={{ background: state === 'ok' ? 'var(--good-soft)' : state === 'missing' ? 'var(--crit-soft)' : 'transparent', color: state === 'ok' ? 'var(--good-ink)' : state === 'missing' ? 'var(--crit-ink)' : 'var(--ink-3)', fontWeight: 600 }}>{state === 'missing' ? '—' : n || '0'}</td>
  return <Card span={12} title={`Year-to-date coverage (${c.year})`} hint={`transactions on file per account and month, ${fmtDY(c.from)} to ${fmtDY(c.to)} · merged duplicates are not counted`}
    right={c.complete ? <Pill cls="good">Complete</Pill> : <Pill cls="warn">{c.missingAccounts} account{c.missingAccounts === 1 ? '' : 's'} with gaps</Pill>}>
    <div className="tblwrap"><table className="tbl"><thead><tr><th>Account</th>{c.months.map(m => <th key={m} className="num">{monthLabel(m)}</th>)}<th>On file from</th><th>To complete {c.year}, import</th></tr></thead><tbody>
      {c.rows.map(r => <tr key={r.accountId}><td>{r.name}</td>{r.months.map(m => cell(m.key, m.state, m.n))}<td>{r.first ? fmtDY(r.first) : '—'}</td>
        <td style={{ fontSize: 12.5 }}>{r.missing.length === 0 ? <span style={{ color: 'var(--good-ink)' }}>nothing — complete</span> : r.total === 0 && !r.first ? 'statements for the whole year (or link it in SimpleFIN)' : statementRange(c.from, r.first)}</td></tr>)}
    </tbody></table></div>
    <Note>SimpleFIN keeps about <b>90 days</b> of history, so earlier months come from statement files. On each bank's website download the account's activity as <b>CSV, OFX or QFX</b> (Quicken / Money format) for the range shown, then use <b>Import a statement</b> below with the matching account selected. Overlaps with what is already here are fine: every row is checked, and duplicates are merged with the bank-feed copy kept.</Note>
  </Card>
}
const statementRange = (from: string, first: string | null) => first && first > from ? `a statement from ${fmtDY(from)} to ${fmtDY(dayBefore(first))}` : 'statements for the red months'
const dayBefore = (d: string) => new Date(Date.parse(d + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10)
