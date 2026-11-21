// The Cash calendar card (0.33.0 — Gary, Nov 20: the stepped line with unlabeled dots and one long table was hard to read).
// It now opens with a plain answer, labels the chart itself, shows each week's money in against money out, suggests what would raise
// the lowest point (lib/cashView.ts), and lists what is coming week by week. A Month view shows the same days as a real calendar.
// 0.35.0 (Gary, Nov 21): "Can I afford it?" tries a purchase against the calendar; a day can be clicked (on the chart or in Month) to see
// what lands on it and to plan something for it; one cash account can be looked at on its own; suggestions worth less than $50 are gone.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Chart, C } from './Chart'
import { Note, Btn } from './ui'
import { DefaultAccountBtn } from './DefaultAccount'
import type { CalItem } from '../lib/forecast'
import { calWeeks, tightestWeek, calVerdict, calTips, calMonths, afford, calDay, amountOf, type Cal } from '../lib/cashView'
import { fmtMoney } from '../lib/money'
import { addDays, diffDays, fmtD, fmtDY, fmtDow, parse, today } from '../lib/dates'

const KIND: Record<CalItem['src'], string> = { pay: 'Pay', bill: 'Bill', sub: 'Subscription', debt: 'Card or loan', planned: 'Planned', goal: 'Goal', flex: 'Everyday', relief: 'Relief', tax: 'Tax' }
const clean = (l: string) => l.replace(/ \(autopay\)$/, '').replace(' (recent average per week)', ' — your recent weekly average')
const signed = (n: number) => (n >= 0 ? '+' : '−') + fmtMoney(Math.abs(n))
const k = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

export interface CashScope { id: string; name: string; bal: number }
export interface CashCalendarProps {
  cal: Cal; days: number; onDays: (d: number) => void
  /** the same calendar 120 days out, for trying a purchase on a date past the window being shown */
  wide: Cal
  /** the cash accounts, and which one is being looked at on its own (null: all cash together) */
  accounts: CashScope[]; scope: string | null; onScope: (id: string | null) => void; home: string | null
  /** add a planned one-off item (amount: plus in, minus out); absent when the person cannot edit */
  onPlan?: (row: { date: string; label: string; amount: number }) => Promise<unknown>
  /** this person's default account (0.36.0): starred in the list, and what the calendar opened on */
  defaultId?: string | null
}
export function CashCalendar({ cal, days, onDays, wide, accounts, scope, onScope, home, onPlan, defaultId }: CashCalendarProps) {
  const [view, setView] = useState<'chart' | 'month'>('chart'); const c = C()
  const one = cal.account, others = accounts.filter(a => a.id !== one?.id), homeName = accounts.find(a => a.id === home)?.name || ''
  const weeks = useMemo(() => calWeeks(cal), [cal]); const tight = useMemo(() => tightestWeek(weeks), [weeks]); const v = useMemo(() => calVerdict(cal), [cal]); const tips = calTips(cal, others)   // not kept between draws: its amounts follow the hide-amounts setting
  const first = cal.daily[0]?.d || '', last = cal.daily[cal.daily.length - 1]?.d || ''
  const who = one ? one.name : 'Cash'
  const head = v.state === 'out' ? `${who} runs out on ${fmtDY(v.date)}.` : v.state === 'floor' ? `Cash dips below your reserve on ${fmtDY(v.date)}.` : one ? `${one.name} is covered — it stays above zero.` : cal.floor ? 'You are covered — cash never drops below your reserve.' : 'You are covered — cash stays above zero.'
  const lowIsToday = v.low.date === first
  // a day picked on the chart or in Month; dropped when the window no longer holds it
  const [day0, setDay] = useState<string | null>(null); const day = day0 && day0 >= first && day0 <= last ? day0 : null
  // "Can I afford it?"
  const [what, setWhat] = useState(''); const [amt, setAmt] = useState(''); const [on, setOn] = useState(''); const amount = amountOf(amt), badAmt = !!amt.trim() && !(amount > 0), onDate = on || addDays(today(), 7); const [saving, setSaving] = useState(false)
  const inWindow = onDate >= first && onDate <= last, src = inWindow ? cal : wide, wideLast = wide.daily[wide.daily.length - 1]?.d || last
  const a = useMemo(() => (amount > 0 ? afford(src, amount, onDate) : null), [src, amount, onDate])
  return <div className="cc">
    <div className={`cc-answer ${v.state}`} data-cc="answer">
      <div className="cc-eyebrow">Next {days} days{one ? ` · ${one.name} only` : ''}</div>
      <div className="cc-head">{head}</div>
      <p>{lowIsToday ? <>Today is {one ? 'its' : 'your'} lowest day in this window: {one ? 'the balance' : 'cash'} only goes up from <b>{fmtMoney(v.low.bal)}</b>.</> : <>{one ? 'Its' : 'Your'} tightest day is <b>{fmtDow(v.low.date)} {fmtD(v.low.date)}</b>{v.paydayNext ? ', the day before payday' : ''}, when {one ? 'it will hold' : 'you will have'} <b>{fmtMoney(v.low.bal)}</b>.</>}
        {cal.floor ? <> That is {fmtMoney(Math.abs(v.cushion))} {v.cushion >= 0 ? 'above' : 'below'} your {fmtMoney(cal.floor)} reserve.</> : null} {one ? 'It ends' : 'You end'} the {days} days with <b>{fmtMoney(cal.end)}</b>, {fmtMoney(Math.abs(v.change))} {v.change >= 0 ? 'more' : 'less'} than today.
        {v.state === 'out' && !one ? <> Move a bill, add income, or talk to the lender before then — see <Link to="/hardship">Hardship</Link>.</> : null}</p>
    </div>
    {one && <Note><b>{one.name} on its own</b>, from its balance of {fmtMoney(cal.start)}: what is paid into it and out of it, and what you spend from it day to day. {one.id === home ? (cal.assumed > 0 ? `${cal.assumed} item${cal.assumed === 1 ? ' has' : 's have'} no account set and ${cal.assumed === 1 ? 'is' : 'are'} counted here, as this is where most of your pay lands — set the account on a bill or paycheck to make this exact.` : 'Every item here names this account.') : `Anything with no account set is counted against ${homeName || 'your main account'}, not here.`} Your reserve is not applied to a single account: it is about all your cash together.</Note>}
    <div className="cc-afford" data-cc="afford">
      <div className="cc-afford-q"><b id="cc-afford-h">Can I afford it?</b>
        <input className="inp" aria-label="What it is (optional)" placeholder="What is it? (optional)" value={what} maxLength={60} onChange={e => setWhat(e.target.value)} />
        <span className="cc-money"><span aria-hidden="true">$</span><input className="inp" inputMode="decimal" aria-label="How much it costs" placeholder="Amount" value={amt} onChange={e => setAmt(e.target.value)} data-cc="afford-amt" aria-invalid={badAmt || undefined} /></span>
        <label className="cc-on">on <input className="inp" type="date" aria-label="The day you would pay" value={onDate} min={first} max={wideLast} onChange={e => setOn(e.target.value)} /></label>
        {(amt || what || on) && <Btn sm onClick={() => { setAmt(''); setWhat(''); setOn('') }}>Clear</Btn>}</div>
      {badAmt && <div className="cc-afford-a idle" role="status" data-cc="afford-bad">Type the amount as a number, such as 900 or 1,250.50.</div>}
      {a && <div className={`cc-afford-a ${a.outside ? 'idle' : a.already ? 'warn' : a.state}`} role="status" data-cc="afford-a">
        {a.outside ? <>Cresari looks 120 days ahead. Pick a day on or before {fmtDY(wideLast)}.</>
          : a.already ? <><b>You are already short before this.</b> {one ? one.name : 'Cash'} {src.firstZero ? 'runs out' : 'dips below your reserve'} on {fmtDY(src.firstZero || src.firstFloor)} as things stand. Spending {fmtMoney(amount)} on {fmtD(onDate)} would take the lowest point to {fmtMoney(a.low.bal)}.</>
          : a.state === 'ok' ? <><b>Yes — it fits.</b> After {fmtMoney(amount)} on {fmtDow(onDate)} {fmtD(onDate)}, {one ? 'the lowest this account gets' : 'your lowest point'} would be <b>{fmtMoney(a.low.bal)}</b> on {fmtD(a.low.date)}{src.floor ? <>, still {fmtMoney(a.low.bal - src.floor)} above your reserve</> : null}. The most you could spend that day and stay {src.floor ? 'above your reserve' : 'above zero'} is {fmtMoney(a.max)}.</>
          : <><b>{a.state === 'out' ? 'Not on that day.' : 'Only by dipping into your reserve.'}</b> {a.state === 'out' ? <>{one ? one.name : 'Cash'} would run out on {fmtDY(a.firstBad)}</> : <>Cash would drop to {fmtMoney(a.low.bal)} on {fmtD(a.low.date)}</>}, {fmtMoney(a.short)} {src.floor ? 'under your reserve' : 'short'} at the lowest point. {a.fitsFrom ? <>The same amount fits from <b>{fmtDow(a.fitsFrom)} {fmtD(a.fitsFrom)}</b>.</> : <>No day through {fmtD(src.daily[src.daily.length - 1].d)} fits the whole amount.</>} On {fmtD(onDate)} the most that fits is {fmtMoney(a.max)}.</>}
        {!a.outside && <div className="cc-afford-do">
          {!inWindow && <span className="cc-sub">{fmtD(onDate)} is past the {days} days shown, so this looks through {fmtD(wideLast)}.</span>}
          {a.fitsFrom && a.fitsFrom !== onDate && a.state !== 'ok' && <Btn sm onClick={() => setOn(a.fitsFrom!)}>Try {fmtD(a.fitsFrom)}</Btn>}
          {onPlan && <Btn sm primary={a.state === 'ok' && !a.already} disabled={saving} onClick={() => { if (saving) return; setSaving(true)   // one save at a time; what was typed stays if it does not go through
            void onPlan({ date: onDate, label: what.trim() || 'Planned purchase', amount: -amount }).then(r => { if (r !== undefined) { setAmt(''); setWhat(''); setOn('') } }).finally(() => setSaving(false)) }}>{saving ? 'Adding…' : `Add it to my plan on ${fmtD(onDate)}`}</Btn>}
        </div>}
      </div>}
    </div>
    <div className="cc-bar">
      <span className="seg" role="group" aria-label="How to show the calendar">{(['chart', 'month'] as const).map(x => <button type="button" key={x} className={view === x ? 'on' : ''} aria-pressed={view === x} onClick={() => setView(x)}>{x === 'chart' ? 'Chart' : 'Month'}</button>)}</span>
      {accounts.length > 1 && <select className="inp cc-scope" aria-label="Which cash to show" value={scope || ''} onChange={e => onScope(e.target.value || null)} data-cc="scope"><option value="">All cash together</option>{accounts.map(x => <option key={x.id} value={x.id}>{x.id === defaultId ? '★ ' : ''}{x.name} only</option>)}</select>}
      {accounts.length > 1 && one && <DefaultAccountBtn id={one.id} name={one.name} />}
      <span className="opts">{[30, 60, 90, 120].map(d => <button type="button" key={d} className={d === days ? 'on' : ''} aria-pressed={d === days} onClick={() => onDays(d)}>{d} days</button>)}</span>
    </div>
    {view === 'chart' ? <>
      <h3 className="cc-h">{one ? `${one.name}, day by day` : 'Your cash, day by day'}</h3>
      <p className="cc-sub">The line is what {one ? 'the account will hold' : 'you will have in the bank'} each day. Dotted green lines are paydays.{cal.floor ? ' The shaded band at the bottom is your reserve.' : ''}{a && inWindow && !a.outside ? ' The dashed line is with the purchase you are trying.' : ''} Click a day to see what lands on it.</p>
      <DayChart cal={cal} c={c} onDay={setDay} trial={a && inWindow && !a.outside ? { date: onDate, amount } : null} />
      {day && <DayPanel cal={cal} date={day} onClose={() => setDay(null)} onPlan={onPlan} onTry={d => { setOn(d); document.getElementById('cc-afford-h')?.scrollIntoView({ block: 'center' }) }} />}
      <h3 className="cc-h">Week by week</h3>
      <p className="cc-sub">Money in beside money out for each week. The number above is what is left over, or short.{tight ? ` The week of ${fmtD(tight.from)} runs shortest.` : ''}</p>
      <WeekChart weeks={weeks} tight={tight} c={c} />
    </> : <><MonthGrid cal={cal} day={day} onDay={setDay} />
      {day && <DayPanel cal={cal} date={day} onClose={() => setDay(null)} onPlan={onPlan} onTry={d => { setOn(d); document.getElementById('cc-afford-h')?.scrollIntoView({ block: 'center' }) }} />}</>}
    {tips.length > 0 && <>
      <h3 className="cc-h">{v.state === 'ok' ? 'Ways to raise your lowest point' : 'What would help'}</h3>
      <p className="cc-sub">Worked out from your own bills and paydays, and only shown when it would move at least $50. Each one is optional.</p>
      <div className="cc-tips" data-cc="tips">{tips.map((t, i) => <div className="cc-tip" key={t.key}><div className="cc-tip-h"><span className="cc-n" aria-hidden="true">{i + 1}</span><b>{t.title}</b></div><p>{t.text}</p><div className="cc-gain">{t.to ? <Link to={t.to}>{t.gain}</Link> : t.gain}</div></div>)}</div>
    </>}
    <h3 className="cc-h">What is coming, week by week</h3>
    <p className="cc-sub">Every paycheck, bill and payment behind the chart. Open a week to see its days.</p>
    <div className="cc-weeks" data-cc="weeks">{weeks.filter(w => w.items.length).map((w, i) => <details className={`cc-week${w === tight ? ' tight' : ''}`} key={w.from} open={i < 2}>
      <summary><span className="cc-wk">{fmtD(w.from)} – {fmtD(w.to)}{w === tight ? ' · tightest week' : ''}</span><span>In <b className="in">{fmtMoney(w.inTot)}</b></span><span>Out <b>{fmtMoney(w.outTot)}</b></span><span>Ends at <b className={w.end < 0 ? 'neg' : ''}>{fmtMoney(w.end)}</b></span></summary>
      {w.items.map((x, j) => <ItemRow key={j} x={x} floor={cal.floor} />)}
    </details>)}{!cal.items.length && <div className="empty">Nothing scheduled — add pay schedules, recurring bills or planned items.</div>}</div>
    <Note>Starts from {one ? `${one.name}'s balance` : 'cash on hand'} ({fmtMoney(cal.start)}) on {fmtD(first)} and runs to {fmtD(last)}. Bills and subscriptions use each item's schedule (paid ones are skipped); card and loan payments use the planned payment on each due date; everyday spending is your last-90-day average for categories that are not covered by a recurring item, spread weekly{one ? ' — here, only what was spent from this account' : ''}.</Note>
  </div>
}
function ItemRow({ x, floor }: { x: CalItem; floor: number }) {
  return <div className={`cc-row${x.bal! < 0 ? ' crit' : floor && x.bal! < floor ? ' warn' : ''}`}><span className="cc-day">{fmtDow(x.date)} {parse(x.date).getDate()}</span><span className="cc-what">{clean(x.label)} <small>· {KIND[x.src]}{/ \(autopay\)$/.test(x.label) ? ' · autopay' : ''}</small></span><span className={`cc-amt${x.amt > 0 ? ' in' : ''}`}>{signed(x.amt)}</span><span className="cc-bal">{fmtMoney(x.bal!)}</span></div>
}
/** One day, opened from the chart or the month: what lands on it, what is in the bank that evening, and a way to plan something for it. */
function DayPanel({ cal, date, onClose, onPlan, onTry }: { cal: Cal; date: string; onClose: () => void; onPlan?: CashCalendarProps['onPlan']; onTry: (d: string) => void }) {
  const d = calDay(cal, date); const [label, setLabel] = useState(''); const [amt, setAmt] = useState(''); const [dir, setDir] = useState<'out' | 'in'>('out'); const [busy, setBusy] = useState(false)
  useEffect(() => { setLabel(''); setAmt('') }, [date])
  const n = amountOf(amt), bad = !!amt.trim() && !(n > 0)
  const save = async () => { if (!onPlan || !(n > 0) || busy) return; setBusy(true); try { const r = await onPlan({ date, label: label.trim() || (dir === 'in' ? 'Planned money in' : 'Planned purchase'), amount: dir === 'in' ? n : -n }); if (r !== undefined) { setLabel(''); setAmt('') } } finally { setBusy(false) } }
  return <div className="cc-daypanel" data-cc="day" role="region" aria-label={`What lands on ${fmtDY(date)}`}>
    <div className="cc-dp-h"><b>{fmtDow(date)}, {fmtDY(date)}</b><span>{d.bal == null ? '' : <>In the bank that evening: <b className={d.bal < 0 ? 'neg' : ''}>{fmtMoney(d.bal)}</b></>}</span><button type="button" className="btn sm" onClick={onClose} aria-label="Close this day">✕</button></div>
    {d.items.length ? d.items.map((x, j) => <ItemRow key={j} x={x} floor={cal.floor} />) : <div className="cc-sub" style={{ margin: '4px 0' }}>Nothing is scheduled for this day.</div>}
    <div className="cc-dp-add">
      {onPlan && <><span className="cc-sub">Plan something for this day:</span>
        <input className="inp" aria-label="What it is" placeholder="What is it?" value={label} maxLength={60} onChange={e => setLabel(e.target.value)} />
        <select className="inp" aria-label="Money out or in" value={dir} onChange={e => setDir(e.target.value as 'out' | 'in')}><option value="out">Money out</option><option value="in">Money in</option></select>
        <span className="cc-money"><span aria-hidden="true">$</span><input className="inp" inputMode="decimal" aria-label="Amount" placeholder="Amount" value={amt} onChange={e => setAmt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void save() }} aria-invalid={bad || undefined} /></span>
        <Btn sm primary disabled={!(n > 0) || busy} onClick={() => void save()}>Add to this day</Btn></>}
      <Btn sm onClick={() => onTry(date)}>Can I afford something this day?</Btn>
    </div>
  </div>
}

type Colors = ReturnType<typeof C>
function DayChart({ cal, c, onDay, trial }: { cal: Cal; c: Colors; onDay: (d: string) => void; trial: { date: string; amount: number } | null }) {
  const xs = cal.daily.map(x => x.d), ys = cal.daily.map(x => x.bal), first = xs[0], last = xs[xs.length - 1]
  const top = Math.max(...ys, cal.start, cal.floor, 1), bottom = Math.min(0, cal.start, ...ys, ...(trial ? cal.daily.map(x => x.bal - (x.d >= trial.date ? trial.amount : 0)) : [])), span = top - bottom
  const pays = cal.items.filter(x => x.src === 'pay' && x.amt > 0); const bigPay = Math.max(0, ...pays.map(x => x.amt)); const paydays = pays.filter(x => x.amt >= bigPay * 0.5)
  const phone = typeof window !== 'undefined' && window.matchMedia('(max-width:700px)').matches
  // the few largest payments get a name on the chart; everything else is in the list below
  const big = cal.items.filter(x => x.amt < 0 && x.src !== 'flex' && Math.abs(diffDays(x.date, cal.low.date)) > 4).sort((a, b) => a.amt - b.amt).slice(0, phone ? 0 : 2)
  const ann = (x: string, y: number, text: string, o: Record<string, unknown> = {}) => ({ x, y, text, showarrow: false, font: { size: 12.5, color: c.ink }, ...o })
  const lowDate = cal.low.date, lowAtEdge = lowDate === first
  const tys = trial ? cal.daily.map(x => x.bal - (x.d >= trial.date ? trial.amount : 0)) : []
  return <Chart title="Cash calendar — day by day" height={300} onPick={p => { const d = String(p.label).slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(d)) onDay(d) }} pickHint="Click a day to see what lands on it"
    data={[{ type: 'scatter', mode: 'lines', x: xs, y: ys, line: { color: c.ink, width: 2.25, shape: 'hv' }, fill: 'tozeroy', fillcolor: cssA(c.blue || c.ink3, 0.14), hovertemplate: '%{x|%a %b %d}: $%{y:,.0f}<extra>in the bank</extra>' },
      { type: 'scatter', mode: 'markers', x: [first, last], y: [cal.start, cal.end], marker: { size: 9, color: c.ink }, hoverinfo: 'skip' },
      ...(lowAtEdge ? [] : [{ type: 'scatter' as const, mode: 'markers' as const, x: [lowDate], y: [cal.low.bal], marker: { size: 12, color: 'rgba(0,0,0,0)', line: { color: c.crit, width: 2.5 } }, hovertemplate: `Lowest point · %{x|%a %b %d}: $%{y:,.0f}<extra></extra>` }]),
      ...(trial ? [{ type: 'scatter' as const, mode: 'lines' as const, x: xs, y: tys, line: { color: c.warn, width: 2, dash: 'dash' as const, shape: 'hv' as const }, hovertemplate: '%{x|%a %b %d}: $%{y:,.0f}<extra>with the purchase</extra>' }] : [])]}
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
function MonthGrid({ cal, day, onDay }: { cal: Cal; day: string | null; onDay: (d: string | null) => void }) {
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
        const body = <><div className="cc-ctop"><b>{parse(d).getDate()}</b>{inside && (its.length > 0 || low) ? <span>{fmtMoney(b)}</span> : null}</div>
          {inn > 0 && <div className="cc-in">+{fmtMoney(inn)}</div>}{out > 0 && <div className="cc-out">−{fmtMoney(out)}</div>}
          {its.length > 0 && <div className="cc-names">{its.slice(0, 2).map(x => clean(x.label).split(' — ')[0]).join(', ')}{its.length > 2 ? ` +${its.length - 2}` : ''}</div>}
          {low && <div className="cc-lowtag">Lowest point</div>}</>
        const label = `${fmtD(d)}${inside ? `: ${inn ? `${fmtMoney(inn)} in, ` : ''}${out ? `${fmtMoney(out)} out, ` : ''}${fmtMoney(b)} in the bank` : ''}`
        // a day inside the window opens: what lands on it, and a way to plan something for it
        return <div className={`cc-cell${tone}${low ? ' low' : ''}${day === d ? ' sel' : ''}`} key={i} role="gridcell" aria-label={inside ? undefined : label}>
          {inside ? <button type="button" className="cc-cellbtn" aria-label={`${label} — open this day`} aria-pressed={day === d} onClick={() => onDay(day === d ? null : d)}>{body}</button> : body}
        </div> })}
    </div></div>
    <div className="cc-legend"><span><i className="sw pay" />Payday</span><span><i className="sw low" />Lowest point</span>{cal.floor ? <span><i className="sw warn" />Below your reserve</span> : null}<span>Top right of a day: what is in the bank that evening. Click a day to open it.</span></div>
  </div>
}
const cssVarInk = (n: string, fb: string) => (typeof document !== 'undefined' && getComputedStyle(document.documentElement).getPropertyValue(n).trim()) || fb
/** A color with some see-through, from a hex value. */
function cssA(hex: string, a: number) { const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()); if (!m) return hex; const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})` }
