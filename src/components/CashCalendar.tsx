// The Cash calendar card (0.33.0 — Gary, Nov 20: the stepped line with unlabeled dots and one long table was hard to read).
// It now opens with a plain answer, labels the chart itself, shows each week's money in against money out, suggests what would raise
// the lowest point (lib/cashView.ts), and lists what is coming week by week. A Month view shows the same days as a real calendar.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Chart, C } from './Chart'
import { Note } from './ui'
import type { CalItem } from '../lib/forecast'
import { calWeeks, tightestWeek, calVerdict, calTips, calMonths, type Cal } from '../lib/cashView'
import { fmtMoney } from '../lib/money'
import { addDays, diffDays, fmtD, fmtDY, fmtDow, parse } from '../lib/dates'

const KIND: Record<CalItem['src'], string> = { pay: 'Pay', bill: 'Bill', sub: 'Subscription', debt: 'Card or loan', planned: 'Planned', goal: 'Goal', flex: 'Everyday', relief: 'Relief', tax: 'Tax' }
const clean = (l: string) => l.replace(/ \(autopay\)$/, '').replace(' (recent average per week)', ' — your recent weekly average')
const signed = (n: number) => (n >= 0 ? '+' : '−') + fmtMoney(Math.abs(n))
const k = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

export function CashCalendar({ cal, days, onDays }: { cal: Cal; days: number; onDays: (d: number) => void }) {
  const [view, setView] = useState<'chart' | 'month'>('chart'); const c = C()
  const weeks = useMemo(() => calWeeks(cal), [cal]); const tight = useMemo(() => tightestWeek(weeks), [weeks]); const v = useMemo(() => calVerdict(cal), [cal]); const tips = calTips(cal)   // not kept between draws: its amounts follow the hide-amounts setting
  const first = cal.daily[0]?.d || '', last = cal.daily[cal.daily.length - 1]?.d || ''
  const head = v.state === 'out' ? `Cash runs out on ${fmtDY(v.date)}.` : v.state === 'floor' ? `Cash dips below your reserve on ${fmtDY(v.date)}.` : cal.floor ? 'You are covered — cash never drops below your reserve.' : 'You are covered — cash stays above zero.'
  const lowIsToday = v.low.date === first
  return <div className="cc">
    <div className={`cc-answer ${v.state}`} data-cc="answer">
      <div className="cc-eyebrow">Next {days} days</div>
      <div className="cc-head">{head}</div>
      <p>{lowIsToday ? <>Today is your lowest day in this window: cash only goes up from <b>{fmtMoney(v.low.bal)}</b>.</> : <>Your tightest day is <b>{fmtDow(v.low.date)} {fmtD(v.low.date)}</b>{v.paydayNext ? ', the day before payday' : ''}, when you will have <b>{fmtMoney(v.low.bal)}</b>.</>}
        {cal.floor ? <> That is {fmtMoney(Math.abs(v.cushion))} {v.cushion >= 0 ? 'above' : 'below'} your {fmtMoney(cal.floor)} reserve.</> : null} You end the {days} days with <b>{fmtMoney(cal.end)}</b>, {fmtMoney(Math.abs(v.change))} {v.change >= 0 ? 'more' : 'less'} than today.
        {v.state === 'out' ? <> Move a bill, add income, or talk to the lender before then — see <Link to="/hardship">Hardship</Link>.</> : null}</p>
    </div>
    <div className="cc-bar">
      <span className="seg" role="group" aria-label="How to show the calendar">{(['chart', 'month'] as const).map(x => <button type="button" key={x} className={view === x ? 'on' : ''} aria-pressed={view === x} onClick={() => setView(x)}>{x === 'chart' ? 'Chart' : 'Month'}</button>)}</span>
      <span className="opts">{[30, 60, 90, 120].map(d => <button type="button" key={d} className={d === days ? 'on' : ''} aria-pressed={d === days} onClick={() => onDays(d)}>{d} days</button>)}</span>
    </div>
    {view === 'chart' ? <>
      <h3 className="cc-h">Your cash, day by day</h3>
      <p className="cc-sub">The line is what you will have in the bank each day. Dotted green lines are paydays.{cal.floor ? ' The shaded band at the bottom is your reserve.' : ''}</p>
      <DayChart cal={cal} c={c} />
      <h3 className="cc-h">Week by week</h3>
      <p className="cc-sub">Money in beside money out for each week. The number above is what is left over, or short.{tight ? ` The week of ${fmtD(tight.from)} runs shortest.` : ''}</p>
      <WeekChart weeks={weeks} tight={tight} c={c} />
    </> : <MonthGrid cal={cal} />}
    {tips.length > 0 && <>
      <h3 className="cc-h">{v.state === 'ok' ? 'Ways to raise your lowest point' : 'What would help'}</h3>
      <p className="cc-sub">Worked out from your own bills and paydays. Each one is optional.</p>
      <div className="cc-tips" data-cc="tips">{tips.map((t, i) => <div className="cc-tip" key={t.key}><div className="cc-tip-h"><span className="cc-n" aria-hidden="true">{i + 1}</span><b>{t.title}</b></div><p>{t.text}</p><div className="cc-gain">{t.to ? <Link to={t.to}>{t.gain}</Link> : t.gain}</div></div>)}</div>
    </>}
    <h3 className="cc-h">What is coming, week by week</h3>
    <p className="cc-sub">Every paycheck, bill and payment behind the chart. Open a week to see its days.</p>
    <div className="cc-weeks" data-cc="weeks">{weeks.filter(w => w.items.length).map((w, i) => <details className={`cc-week${w === tight ? ' tight' : ''}`} key={w.from} open={i < 2}>
      <summary><span className="cc-wk">{fmtD(w.from)} – {fmtD(w.to)}{w === tight ? ' · tightest week' : ''}</span><span>In <b className="in">{fmtMoney(w.inTot)}</b></span><span>Out <b>{fmtMoney(w.outTot)}</b></span><span>Ends at <b className={w.end < 0 ? 'neg' : ''}>{fmtMoney(w.end)}</b></span></summary>
      {w.items.map((x, j) => <div className={`cc-row${x.bal! < 0 ? ' crit' : cal.floor && x.bal! < cal.floor ? ' warn' : ''}`} key={j}><span className="cc-day">{fmtDow(x.date)} {parse(x.date).getDate()}</span><span className="cc-what">{clean(x.label)} <small>· {KIND[x.src]}{/ \(autopay\)$/.test(x.label) ? ' · autopay' : ''}</small></span><span className={`cc-amt${x.amt > 0 ? ' in' : ''}`}>{signed(x.amt)}</span><span className="cc-bal">{fmtMoney(x.bal!)}</span></div>)}
    </details>)}{!cal.items.length && <div className="empty">Nothing scheduled — add pay schedules, recurring bills or planned items.</div>}</div>
    <Note>Starts from cash on hand ({fmtMoney(cal.start)}) on {fmtD(first)} and runs to {fmtD(last)}. Bills and subscriptions use each item's schedule (paid ones are skipped); card and loan payments use the planned payment on each due date; everyday spending is your last-90-day average for categories that are not covered by a recurring item, spread weekly.</Note>
  </div>
}

type Colors = ReturnType<typeof C>
function DayChart({ cal, c }: { cal: Cal; c: Colors }) {
  const xs = cal.daily.map(x => x.d), ys = cal.daily.map(x => x.bal), first = xs[0], last = xs[xs.length - 1]
  const top = Math.max(...ys, cal.start, cal.floor, 1), bottom = Math.min(0, cal.start, ...ys), span = top - bottom
  const pays = cal.items.filter(x => x.src === 'pay' && x.amt > 0); const bigPay = Math.max(0, ...pays.map(x => x.amt)); const paydays = pays.filter(x => x.amt >= bigPay * 0.5)
  const phone = typeof window !== 'undefined' && window.matchMedia('(max-width:700px)').matches
  // the few largest payments get a name on the chart; everything else is in the list below
  const big = cal.items.filter(x => x.amt < 0 && x.src !== 'flex' && Math.abs(diffDays(x.date, cal.low.date)) > 4).sort((a, b) => a.amt - b.amt).slice(0, phone ? 0 : 2)
  const ann = (x: string, y: number, text: string, o: Record<string, unknown> = {}) => ({ x, y, text, showarrow: false, font: { size: 12.5, color: c.ink }, ...o })
  const lowDate = cal.low.date, lowAtEdge = lowDate === first
  return <Chart title="Cash calendar — day by day" height={300}
    data={[{ type: 'scatter', mode: 'lines', x: xs, y: ys, line: { color: c.ink, width: 2.25, shape: 'hv' }, fill: 'tozeroy', fillcolor: cssA(c.blue || c.ink3, 0.14), hovertemplate: '%{x|%a %b %d}: $%{y:,.0f}<extra>in the bank</extra>' },
      { type: 'scatter', mode: 'markers', x: [first, last], y: [cal.start, cal.end], marker: { size: 9, color: c.ink }, hoverinfo: 'skip' },
      ...(lowAtEdge ? [] : [{ type: 'scatter' as const, mode: 'markers' as const, x: [lowDate], y: [cal.low.bal], marker: { size: 12, color: 'rgba(0,0,0,0)', line: { color: c.crit, width: 2.5 } }, hovertemplate: `Lowest point · %{x|%a %b %d}: $%{y:,.0f}<extra></extra>` }])]}
    layout={{ showlegend: false, margin: { l: 52, r: 18, t: 40, b: 36 }, yaxis: { tickprefix: '$', range: [bottom - span * 0.02, top + span * 0.16] }, xaxis: { type: 'date', tickformat: '%b %d', range: [addDays(first, -1), addDays(last, 1)] },
      shapes: [...(cal.floor ? [{ type: 'rect' as const, xref: 'paper' as const, x0: 0, x1: 1, y0: Math.min(0, bottom), y1: cal.floor, fillcolor: c.critSoft, opacity: 0.7, line: { width: 0 }, layer: 'below' as const }, { type: 'line' as const, xref: 'paper' as const, x0: 0, x1: 1, y0: cal.floor, y1: cal.floor, line: { color: c.crit, width: 1.5, dash: 'dash' as const } }] : []),
        ...paydays.map(p => ({ type: 'line' as const, x0: p.date, x1: p.date, yref: 'paper' as const, y0: 0, y1: 1, line: { color: c.good, width: 1, dash: 'dot' as const } }))],
      annotations: [
        ...(cal.floor ? [{ xref: 'paper', x: 0.01, xanchor: 'left', y: cal.floor, yanchor: 'top', yshift: -3, text: `Your reserve · ${k(cal.floor)}`, showarrow: false, font: { size: 12, color: cssVarInk('--crit-ink', c.crit) } }] : []),
        ...(paydays.length <= (phone ? 5 : 9) ? paydays.map(p => ({ x: p.date, yref: 'paper', y: 1, yanchor: 'bottom', text: phone ? 'Pay' : `Payday<br>+${k(p.amt)}`, showarrow: false, font: { size: 11.5, color: c.good } })) : []),
        ann(first, cal.start, `<b>${k(cal.start)}</b>`, { xanchor: 'left', yanchor: 'bottom', xshift: 8, yshift: 4 }),
        ann(last, cal.end, `<b>${k(cal.end)}</b>`, { xanchor: 'right', yanchor: 'bottom', xshift: -8, yshift: 6 }),
        ...(lowAtEdge ? [] : [ann(lowDate, cal.low.bal, `<b>Lowest · ${fmtD(lowDate)}</b><br>${k(cal.low.bal)}`, { yanchor: 'top', yshift: -12, bgcolor: cssVarInk('--surface', '#fff'), bordercolor: c.line, borderpad: 4 })]),
        ...big.filter(x => x.date !== lowDate).map(x => ann(x.date, x.bal!, `${clean(x.label).replace(/ payment$/, '')} −${k(-x.amt)}`, { xanchor: 'left', yanchor: 'top', xshift: 5, yshift: -2, font: { size: 11.5, color: c.ink3 } })),
      ] as never }} />
}
function WeekChart({ weeks, tight, c }: { weeks: ReturnType<typeof calWeeks>; tight: ReturnType<typeof tightestWeek>; c: Colors }) {
  const labels = weeks.map(w => fmtD(w.from)); const top = Math.max(1, ...weeks.map(w => Math.max(w.inTot, w.outTot)))
  const ti = tight ? weeks.indexOf(tight) : -1
  // on a phone with many weeks there is no room for a number over every pair: the tightest week keeps its number, the list below has the rest
  const crowded = typeof window !== 'undefined' && window.matchMedia('(max-width:700px)').matches && weeks.length > 6
  return <Chart title="Cash calendar — week by week" height={230}
    data={[{ type: 'bar', name: 'Money in', x: labels, y: weeks.map(w => w.inTot), marker: { color: c.good }, hovertemplate: 'Week of %{x}: $%{y:,.0f} in<extra></extra>' },
      { type: 'bar', name: 'Money out', x: labels, y: weeks.map(w => w.outTot), marker: { color: c.ink3 }, hovertemplate: 'Week of %{x}: $%{y:,.0f} out<extra></extra>' }]}
    layout={{ barmode: 'group', bargap: 0.35, showlegend: true, margin: { l: 52, r: 18, t: 34, b: 36 }, yaxis: { tickprefix: '$', range: [0, top * 1.22] }, xaxis: { type: 'category' },
      shapes: ti >= 0 ? [{ type: 'rect', xref: 'x', yref: 'paper', x0: ti - 0.5, x1: ti + 0.5, y0: 0, y1: 1, fillcolor: cssVarInk('--warn-soft', '#fdf0dc'), opacity: 0.8, line: { width: 0 }, layer: 'below' }] : [],
      annotations: weeks.map((w, i) => ({ w, i })).filter(({ i }) => !crowded || i === ti).map(({ w, i }) => ({ x: labels[i], y: Math.max(w.inTot, w.outTot), yanchor: 'bottom', yshift: 3, text: `<b>${w.net >= 0 ? '+' : '−'}${k(Math.abs(w.net))}</b>`, showarrow: false, font: { size: 12, color: w.net >= 0 ? c.good : cssVarInk('--crit-ink', c.crit) } })) as never }} />
}
/** The same days as a real calendar: what comes in and goes out on each day, and what is in the bank that evening. */
function MonthGrid({ cal }: { cal: Cal }) {
  const months = useMemo(() => calMonths(cal), [cal]); const [at0, setAt] = useState(0); const at = Math.min(at0, Math.max(0, months.length - 1)); const m = months[at] || ''   // a shorter window can leave the stored month past the end
  const byDay = useMemo(() => { const o: Record<string, CalItem[]> = {}; cal.items.forEach(x => { (o[x.date] ||= []).push(x) }); return o }, [cal]); const bal = useMemo(() => Object.fromEntries(cal.daily.map(x => [x.d, x.bal])), [cal])
  if (!m) return null
  const [y, mo] = m.split('-').map(Number); const firstDow = new Date(y, mo - 1, 1).getDay(), n = new Date(y, mo, 0).getDate()
  const cells: Array<string | null> = [...Array(firstDow).fill(null), ...Array.from({ length: n }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`)]
  const name = new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  return <div className="cc-month" data-cc="month">
    <div className="cc-mnav"><button type="button" className="btn sm" disabled={at <= 0} onClick={() => setAt(Math.max(0, at - 1))} aria-label="Earlier month">‹</button><b>{name}</b><button type="button" className="btn sm" disabled={at >= months.length - 1} onClick={() => setAt(Math.min(months.length - 1, at + 1))} aria-label="Later month">›</button></div>
    <div className="cc-mwrap"><div className="cc-mgrid" role="grid" aria-label={`Cash calendar for ${name}`}>
      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div className="cc-dow" key={d} role="columnheader">{d}</div>)}
      {cells.map((d, i) => { if (!d) return <div key={i} />
        const inside = d in bal, its = byDay[d] || [], inn = its.reduce((a, x) => a + (x.amt > 0 ? x.amt : 0), 0), out = its.reduce((a, x) => a + (x.amt < 0 ? -x.amt : 0), 0), low = d === cal.low.date && d !== cal.daily[0]?.d
        const b = bal[d]; const tone = !inside ? ' off' : b < 0 ? ' crit' : cal.floor && b < cal.floor ? ' warn' : its.some(x => x.src === 'pay' && x.amt > 0) ? ' pay' : ''
        return <div className={`cc-cell${tone}${low ? ' low' : ''}`} key={i} role="gridcell" aria-label={`${fmtD(d)}${inside ? `: ${inn ? `${fmtMoney(inn)} in, ` : ''}${out ? `${fmtMoney(out)} out, ` : ''}${fmtMoney(b)} in the bank` : ''}`}>
          <div className="cc-ctop"><b>{parse(d).getDate()}</b>{inside && (its.length > 0 || low) ? <span>{fmtMoney(b)}</span> : null}</div>
          {inn > 0 && <div className="cc-in">+{fmtMoney(inn)}</div>}{out > 0 && <div className="cc-out">−{fmtMoney(out)}</div>}
          {its.length > 0 && <div className="cc-names">{its.slice(0, 2).map(x => clean(x.label).split(' — ')[0]).join(', ')}{its.length > 2 ? ` +${its.length - 2}` : ''}</div>}
          {low && <div className="cc-lowtag">Lowest point</div>}
        </div> })}
    </div></div>
    <div className="cc-legend"><span><i className="sw pay" />Payday</span><span><i className="sw low" />Lowest point</span>{cal.floor ? <span><i className="sw warn" />Below your reserve</span> : null}<span>Top right of a day: what is in the bank that evening.</span></div>
  </div>
}
const cssVarInk = (n: string, fb: string) => (typeof document !== 'undefined' && getComputedStyle(document.documentElement).getPropertyValue(n).trim()) || fb
/** A color with some see-through, from a hex value. */
function cssA(hex: string, a: number) { const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()); if (!m) return hex; const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})` }
