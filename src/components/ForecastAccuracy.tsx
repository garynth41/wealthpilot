// "How accurate was last month's forecast?" (0.35.0). Each month's forecast is saved once (app/store saveForecast → forecast_snapshots);
// when the month is over, lib/forecastCheck.ts compares it with the transactions recorded for the same days. This card says how close
// it was, where the difference came from, and how earlier months did — or, before there is anything to compare, what was saved and when
// the first comparison will appear.
import { useMemo } from 'react'
import type { Data, Settings } from '../app/data/types'
import { forecastChecks, MIN_DAYS, type ForecastCheck, type Grade } from '../lib/forecastCheck'
import { fmtMoney } from '../lib/money'
import { fmtD, fmtDY, parse } from '../lib/dates'
import { Note, Pill } from './ui'

const GRADE: Record<Grade, { cls: string; label: string }> = { close: { cls: 'good', label: 'Close' }, fair: { cls: 'warn', label: 'Fair' }, off: { cls: 'crit', label: 'Off' } }
const monthOf = (d: string) => parse(d).toLocaleDateString('en-US', { month: 'long' })
const pct = (n: number) => (n < 0.005 ? 'under 1%' : `${n < 0.1 ? (n * 100).toFixed(1) : Math.round(n * 100)}%`)
const delta = (n: number) => (Math.abs(n) < 0.5 ? '—' : (n > 0 ? '+' : '−') + fmtMoney(Math.abs(n)))
/** In plain words, the part that explains most of the difference. */
function biggest(c: ForecastCheck): string | null {
  const b = c.biggest; if (!b) return null
  const more = b.diff > 0
  return `${b.label} came in ${fmtMoney(Math.abs(b.diff))} ${more ? 'higher' : 'lower'} than expected${b.side === 'out' ? (more ? ', which left you with less' : ', which left you with more') : ''}.`
}
export function ForecastAccuracy({ data, settings, canSave }: { data: Data; settings: Settings; canSave: boolean }) {
  const { done, running } = useMemo(() => forecastChecks(data, settings), [data, settings]); const c = done[0]
  return <div className="fa" data-fa="card">
    {c ? <>
      <div className={`fa-answer ${c.empty ? 'idle' : GRADE[c.grade].cls}`} data-fa="answer">
        <div className="fa-top">{!c.empty && <Pill cls={GRADE[c.grade].cls}>{GRADE[c.grade].label}</Pill>}<b>{monthOf(c.f.through)}: {c.empty ? 'nothing to compare' : `${pct(c.pct)} off`}</b></div>
        {c.empty ? <p>Cresari saved a forecast on {fmtDY(c.f.taken_on)}, but no transactions are recorded for {fmtD(c.f.taken_on)} – {fmtD(c.f.through)}, so there is nothing to check it against.</p>
          : <p>On {fmtDY(c.f.taken_on)} Cresari expected you to end {monthOf(c.f.through)} with <b>{fmtMoney(c.f.expected_end)}</b> in cash. Your recorded transactions put it at <b>{fmtMoney(c.actual.end)}</b> — {Math.abs(c.diff) < 0.5 ? 'right on the forecast' : <>{fmtMoney(Math.abs(c.diff))} {c.diff > 0 ? 'more' : 'less'} than expected</>}. {biggest(c)}</p>}
      </div>
      {!c.empty && <div className="tblwrap"><table className="tbl fa-tbl" data-fa="rows">
        <thead><tr><th>{fmtD(c.f.taken_on)} – {fmtD(c.f.through)}</th><th className="num">Expected</th><th className="num">What happened</th><th className="num">Difference</th></tr></thead>
        <tbody>
          {c.rows.map(r => <tr key={r.g}><td>{r.label}</td><td className="num">{fmtMoney(r.expected)}</td><td className="num">{fmtMoney(r.actual)}</td><td className="num">{delta(r.diff)}</td></tr>)}
          <tr className="fa-sum"><td>Money in</td><td className="num">{fmtMoney(c.f.expected_in)}</td><td className="num">{fmtMoney(c.actual.in)}</td><td className="num">{delta(c.actual.in - c.f.expected_in)}</td></tr>
          <tr className="fa-sum"><td>Money out</td><td className="num">{fmtMoney(c.f.expected_out)}</td><td className="num">{fmtMoney(c.actual.out)}</td><td className="num">{delta(c.actual.out - c.f.expected_out)}</td></tr>
          <tr className="fa-sum"><td><b>Cash at the end</b></td><td className="num"><b>{fmtMoney(c.f.expected_end)}</b></td><td className="num"><b>{fmtMoney(c.actual.end)}</b></td><td className="num"><b>{delta(c.diff)}</b></td></tr>
        </tbody></table></div>}
      {done.length > 1 && <><h3 className="cc-h">Earlier months</h3>
        <div className="fa-hist" data-fa="history">{done.slice(1).map(x => <div className="fa-h" key={x.f.id}><span>{monthOf(x.f.through)} {x.f.through.slice(0, 4)}</span><span>expected <b>{fmtMoney(x.f.expected_end)}</b></span><span>ended <b>{x.empty ? '—' : fmtMoney(x.actual.end)}</b></span><span>{x.empty ? 'nothing recorded' : <><Pill cls={GRADE[x.grade].cls}>{GRADE[x.grade].label}</Pill> {pct(x.pct)} off</>}</span></div>)}</div></>}
    </> : <div className="fa-answer idle" data-fa="answer">
      <div className="fa-top"><b>{running ? `The first check comes after ${fmtD(running.through)}` : 'Nothing to check yet'}</b></div>
      <p>{running ? <>Cresari saved this month's forecast on {fmtDY(running.taken_on)}: it expects you to end {monthOf(running.through)} with <b>{fmtMoney(running.expected_end)}</b> in cash. Once the month is over, this card shows how close that was and where any difference came from.</>
        : canSave ? <>Cresari saves each month's forecast the first time the app is opened that month with at least {MIN_DAYS} days left, then checks it against what really happened. The first one will be saved next month.</>
          : <>A forecast is saved each month when someone who can edit the whole household opens the app. None has been saved yet.</>}</p>
    </div>}
    {c && running && <p className="cc-sub" data-fa="running">This month: on {fmtD(running.taken_on)} Cresari expected you to end {monthOf(running.through)} with {fmtMoney(running.expected_end)}. That is checked after {fmtD(running.through)}.</p>}
    <Note>How this is measured: the saved forecast against the transactions recorded for the same days, in cash terms — what reached or left the accounts that count as cash. A card purchase counts when the card is paid; a move between two cash accounts counts for nothing. Close is within 5% of the cash expected, Fair within 15%. A saved forecast is never changed afterwards. Transactions entered late, or missing, show up here as a difference.</Note>
  </div>
}
