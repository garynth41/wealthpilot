// Investments & Retirement, the cards added in 0.39.0: how each account is taxed and this year's contributions against the limits, the target mix
// and drift, performance over time, and retirement income after tax. Engines: lib/contrib.ts, lib/allocation.ts, lib/retirementTax.ts.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../app/hooks'
import { ACCT_TAX_LABEL, type AcctTaxType, type AllocGroup, type RetirementInputs } from '../app/data/types'
import { Btn, Card, Empty, KPI, Note } from '../components/ui'
import { Chart, C } from '../components/Chart'
import { acctNameNode } from '../components/AcctName'
import { acctTypeOf, contributions, inferAcctType, resolveRetirement, type ContribLine } from '../lib/contrib'
import { ALLOC_GROUPS, ALLOC_LABEL, DRIFT_BAND, accountValue, contributionPlan, driftOf, impliedReturn, investAccounts, mixAsTarget, mixOf, performance, ruleOfThumb, targetOf, type Mix } from '../lib/allocation'
import type { AfterTaxPlan } from '../lib/retirementTax'
import { fmtMoney, fmtPct, parseNum, sum } from '../lib/money'
import { mShort, today } from '../lib/dates'

const TYPES = Object.keys(ACCT_TAX_LABEL) as AcctTaxType[]
const SHORT: Record<AcctTaxType, string> = { k401: 'Pre-tax workplace plan', roth401k: 'Roth workplace plan', ira: 'Traditional IRA', rothIra: 'Roth IRA', hsa: 'HSA', taxable: 'Taxable', other: 'Other' }
function Bar({ line }: { line: ContribLine }) {
  const pct = (v: number) => Math.min(100, Math.max(0, line.limit > 0 ? v / line.limit * 100 : 0))
  return <div style={{ position: 'relative', height: 10, borderRadius: 5, background: 'var(--line)', overflow: 'hidden', minWidth: 120 }} role="img" aria-label={`${fmtMoney(line.ytd)} of ${fmtMoney(line.limit)} so far, ${fmtMoney(line.rest)} still to come`}>
    <div style={{ position: 'absolute', inset: 0, width: pct(line.total) + '%', background: line.over > 0 ? 'var(--crit)' : 'var(--info)', opacity: 0.35 }} />
    <div style={{ position: 'absolute', inset: 0, width: pct(line.ytd) + '%', background: line.over > 0 ? 'var(--crit)' : 'var(--good)' }} /></div>
}
/** Each investment and retirement account with how it is taxed, and this year's contributions against the IRS limits and the employer match. */
export function ContributionsCard() {
  const { data, settings, saveSettings, guarded, canEdit } = useData(); const year = +today().slice(0, 4)
  const c = useMemo(() => contributions(data, settings, year), [data, settings, year]); const accts = investAccounts(data); const inv = settings.invest || {}
  const setType = (id: string, t: AcctTaxType) => guarded(() => saveSettings({ invest: { ...inv, acctType: { ...(inv.acctType || {}), [id]: t } } }), 'Saved')
  const lines = c.lines.filter(l => l.show)
  return <Card span={12} title="Accounts & contributions" hint={`how each account is taxed · what has gone in during ${year} against the IRS limits`}>
    {accts.length === 0 ? <Empty>No investment or retirement accounts yet. Add them on <Link to="/accounts">Account Balances</Link>.</Empty> : <div className="tblwrap"><table className="tbl" data-inv="accounts"><thead><tr><th>Account</th><th>How it is taxed</th><th className="num">Value</th><th className="num">You put in, {year}</th><th className="num">Employer, {year}</th></tr></thead><tbody>
      {accts.map(a => { const t = acctTypeOf(settings, a), by = c.byAccount[a.id]; return <tr key={a.id}><td>{acctNameNode(a.name, a.last4)}</td>
        <td>{canEdit ? <select className="inp" value={t} aria-label={`How ${a.name} is taxed`} onChange={e => setType(a.id, e.target.value as AcctTaxType)}>{TYPES.map(x => <option key={x} value={x}>{ACCT_TAX_LABEL[x]}</option>)}</select> : SHORT[t]}{!inv.acctType?.[a.id] && <span className="note" style={{ display: 'inline', marginLeft: 6 }}>from its name</span>}{inv.acctType?.[a.id] && inv.acctType[a.id] !== inferAcctType(a) ? <span className="note" style={{ display: 'inline', marginLeft: 6 }}>you chose</span> : null}</td>
        <td className="num">{fmtMoney(accountValue(data, a))}</td><td className="num">{by?.own ? fmtMoney(by.own) : '—'}</td><td className="num">{by?.employer ? fmtMoney(by.employer) : '—'}</td></tr> })}
    </tbody></table></div>}
    {lines.length > 0 && <><h3 style={{ margin: '14px 0 6px' }}>{year} against the limits</h3>
      <div className="tblwrap"><table className="tbl" data-inv="limits"><thead><tr><th>Limit</th><th className="num">So far</th><th className="num">Still to come</th><th className="num">Limit</th><th className="num">Room left</th><th style={{ width: '22%' }}>Progress</th></tr></thead><tbody>
        {lines.map(l => <tr key={l.key} className={l.over > 0 ? 'st-crit' : l.room < 1 && l.total > 0 ? 'st-good' : 'st-info'}><td><b>{l.label}</b><div className="note" style={{ margin: '2px 0 0' }}>from {l.from}{l.catchUp ? ` · includes the ${fmtMoney(l.catchUp)} catch-up for your age` : ''}
          {l.key === 'hsa' && canEdit ? <> · coverage <select className="inp" style={{ display: 'inline-block', width: 'auto', padding: '2px 6px' }} value={c.coverage} aria-label="HSA coverage" onChange={e => guarded(() => saveSettings({ invest: { ...inv, hsaCoverage: e.target.value as 'self' | 'family' } }), 'Saved')}><option value="self">self-only</option><option value="family">family</option></select></> : null}</div></td>
          <td className="num">{fmtMoney(l.ytd)}</td><td className="num">{l.rest > 0 ? fmtMoney(l.rest) : '—'}</td><td className="num">{fmtMoney(l.limit)}</td><td className="num">{l.over > 0 ? <span style={{ color: 'var(--crit-ink)' }}>{fmtMoney(l.over)} over</span> : <b>{fmtMoney(l.room)}</b>}</td><td><Bar line={l} /></td></tr>)}
      </tbody></table></div></>}
    {c.hasPayroll && <div className={`msg ${!c.hasStubs ? 'warn' : c.match.missedRest > 0.5 ? 'warn' : 'good'}`} data-inv="match">
      {!c.hasStubs ? <>Add your paycheck breakdown on <Link to="/income">Income &amp; Pay Periods</Link> (the Breakdown button on a pay schedule) and your 401(k) contributions, employer match and limits fill in here on their own.</>
        : !c.match.hasFormula ? <>Employer match: not set. Enter your employer's formula in the paycheck breakdown to see what you collect and whether any is left on the table.</>
        : c.match.missedRest > 0.5 ? <><b>{fmtMoney(c.match.missedPerCheck)}</b> of employer match goes uncollected every paycheck — <b>{fmtMoney(c.match.missedRest)}</b> over the paychecks left this year. Putting in {c.match.neededPct}% of pay collects all of it. So far this year your employer has added {fmtMoney(c.match.ytd)}.</>
        : <>You are collecting the full employer match: <b>{fmtMoney(c.match.ytd)}</b> so far this year, {fmtMoney(c.match.total)} by year end.</>}</div>}
    <Note>The tax type is read from the account's name and kind until you choose one; it decides which limit a contribution counts against and how the money is taxed in retirement. {c.age == null ? 'Save the retirement planner below with your age to add the catch-up amounts from 50. ' : ''}{c.limitsYear !== c.year ? `The ${c.year} limits are not in the app yet — these are ${c.limitsYear}'s. ` : ''}IRA and HSA figures count transfers into those accounts this calendar year from ordinary accounts (a rollover from another retirement account is not a contribution); a contribution made early in the year for the year before shows here too. Limits are per person: mark a spouse's or partner's paycheck in its breakdown and it gets its own workplace-plan line, without a catch-up because their age is not on file; the IRA line is one person's limit. Not checked: the income limits on a Roth IRA and a deductible IRA, and the separate limit a governmental 457(b) has alongside a 401(k) or 403(b).</Note>
  </Card>
}

/** The target mix, how far the actual mix has drifted from it, and what would bring it back. */
export function TargetCard() {
  const { data, settings, saveSettings, guarded, canEdit } = useData(); const inv = settings.invest || {}
  const m = useMemo(() => mixOf(data.holdings), [data.holdings]); const saved = targetOf(inv)
  const [draft, setDraft] = useState<Mix | null>(null); const t = draft || saved; const total = t ? sum(ALLOC_GROUPS.map(g => t[g])) : 0
  const dr = t && Math.abs(total - 100) < 0.01 ? driftOf(data.holdings, t) : null; const ri = resolveRetirement(data, settings)
  const plan = dr ? contributionPlan(dr, ri.annualContribution) : null; const imp = impliedReturn(m.pct, inv), impT = t && Math.abs(total - 100) < 0.01 ? impliedReturn(Object.fromEntries(ALLOC_GROUPS.map(g => [g, t[g] / 100])) as Mix, inv) : null
  const set = (g: AllocGroup, v: string) => setDraft({ ...(t || { stocks: 0, bonds: 0, cash: 0, real_estate: 0, other: 0 }), [g]: Math.min(100, Math.max(0, Math.round(parseNum(v) ?? 0))) })
  const save = () => { if (!draft || Math.abs(total - 100) > 0.01) return; guarded(async () => { await saveSettings({ invest: { ...inv, targets: draft } }); setDraft(null) }, 'Target mix saved') }
  const age = settings.retirement?.currentAge
  if (!data.holdings.length) return <Card span={6} title="Target mix & drift"><Empty>Add holdings to set a target mix and see how far the portfolio has moved from it.</Empty></Card>
  return <Card span={6} title="Target mix & drift" hint={saved && !draft ? (dr?.drifted ? `off target by up to ${dr.maxDiff.toFixed(0)} points` : `within ${DRIFT_BAND} points of target`) : 'set the share you want in each group'}>
    <div className="tblwrap"><table className="tbl" data-inv="target"><thead><tr><th>Group</th><th className="num">Now</th><th className="num">Now %</th><th className="num">Target %</th><th className="num">Off by</th><th className="num">Over / under</th></tr></thead><tbody>
      {ALLOC_GROUPS.filter(g => m.value[g] > 0 || (t && t[g] > 0) || g === 'stocks' || g === 'bonds' || g === 'cash').map(g => { const r = dr?.rows.find(x => x.group === g); return <tr key={g} className={r && Math.abs(r.diff) > DRIFT_BAND ? 'st-warn' : ''}><td>{ALLOC_LABEL[g]}</td><td className="num">{fmtMoney(m.value[g])}</td><td className="num">{fmtPct(m.pct[g])}</td>
        <td className="num">{canEdit ? <input className="inp num" inputMode="numeric" style={{ width: 64, textAlign: 'right' }} aria-label={`Target percent for ${ALLOC_LABEL[g]}`} key={g + (t ? t[g] : 'x')} defaultValue={t ? String(t[g]) : ''} placeholder="—" onBlur={e => { if ((t ? String(t[g]) : '') !== e.target.value.trim()) set(g, e.target.value) }} /> : t ? t[g] + '%' : '—'}</td>
        <td className="num">{r ? `${r.diff > 0 ? '+' : ''}${r.diff.toFixed(1)} pts` : '—'}</td><td className="num" style={{ color: r && Math.abs(r.diff) > DRIFT_BAND ? 'var(--warn-ink)' : undefined }}>{r ? (r.amount >= 0 ? '+' : '−') + fmtMoney(Math.abs(r.amount)) : '—'}</td></tr> })}
    </tbody><tfoot><tr><td>Total</td><td className="num">{fmtMoney(m.total)}</td><td className="num">100%</td><td className="num" style={{ color: t && Math.abs(total - 100) > 0.01 ? 'var(--crit-ink)' : undefined }}>{t ? total + '%' : '—'}</td><td colSpan={2}>{t && Math.abs(total - 100) > 0.01 ? `must add up to 100 — ${total > 100 ? total - 100 + ' over' : 100 - total + ' short'}` : ''}</td></tr></tfoot></table></div>
    {canEdit && <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
      <Btn sm onClick={() => setDraft(mixAsTarget(m.pct))}>Use my current mix</Btn>
      {age ? <Btn sm onClick={() => setDraft(ruleOfThumb(age))} title="A common rule of thumb, as a starting point: 110 minus your age in stocks, 5% cash, the rest bonds">Rule of thumb for age {age}</Btn> : null}
      {draft && <><Btn sm primary disabled={Math.abs(total - 100) > 0.01} onClick={save}>Save target</Btn><Btn sm onClick={() => setDraft(null)}>Cancel</Btn></>}</div>}
    {dr && !draft && (dr.drifted ? <div className="msg warn" data-inv="drift">
      <b>To get back to target, {fmtMoney(dr.moveTotal)} has to change groups:</b> sell {dr.sell.map(r => `${fmtMoney(r.amount)} of ${ALLOC_LABEL[r.group].toLowerCase()}`).join(', ')} and buy {dr.buy.map(r => `${fmtMoney(-r.amount)} of ${ALLOC_LABEL[r.group].toLowerCase()}`).join(', ')}.
      {plan && plan.months != null ? <> Without selling: send new money to {plan.split.map(x => `${ALLOC_LABEL[x.group].toLowerCase()} (${fmtMoney(x.perMonth)}/mo)`).join(', ')} and the gap closes in about {plan.months} month{plan.months === 1 ? '' : 's'} at {fmtMoney(ri.annualContribution)} a year.</> : null}</div>
      : <div className="msg good" data-inv="drift">Every group is within {DRIFT_BAND} points of its target. Nothing to move.</div>)}
    <Note>{imp ? `Today's mix implies about ${(imp.ret * 100).toFixed(1)}% a year with swings of about ${(imp.vol * 100).toFixed(0)}%` : ''}{impT && saved && !draft ? `; the target, ${(impT.ret * 100).toFixed(1)}% and ${(impT.vol * 100).toFixed(0)}%` : ''}{imp ? ' — planning assumptions (stocks 7%, bonds 4%, cash 3% a year), not forecasts. ' : ''}Funds count as stocks unless their sector is Fixed income, Cash or Real estate. Moving money inside a 401(k) or IRA is not taxed; selling in a taxable account can be, so new contributions are usually the cheaper way back. The rule of thumb is a starting point, not advice.</Note>
  </Card>
}

const pc = (v: number | null) => (v == null ? '—' : (v >= 0 ? '+' : '−') + (Math.abs(v) * 100).toFixed(1) + '%')
/** What the accounts were worth over time, split into what was put in and what the investments earned. */
export function PerformanceCard() {
  const { data, settings } = useData(); const c = C()
  const p = useMemo(() => performance(data, settings, today(), a => acctTypeOf(settings, a)), [data, settings])
  if (p.points.length < 1) return <Card span={6} title="Performance"><Empty>Performance builds from the balances of your investment and retirement accounts as they change. Once an account has balances in two different months, this shows what you put in and what the investments earned.</Empty></Card>
  const base = p.points[0].value - p.points[0].flow - p.points[0].growth
  return <Card span={6} title="Performance" hint={`${p.months} month${p.months === 1 ? '' : 's'} of balances · money in separated from investment return`}>
    <div className="kpis" style={{ marginBottom: 8 }}>
      <KPI l="This year" v={pc(p.ytd)} cls={p.ytd == null ? 'idle' : p.ytd >= 0 ? 'good' : 'crit'} s="return on the money invested" />
      <KPI l={p.year != null ? 'Last 12 months' : 'Since the start'} v={pc(p.year ?? p.sinceStart)} cls={(p.year ?? p.sinceStart ?? 0) >= 0 ? 'good' : 'crit'} s={p.annualized != null ? `${pc(p.annualized)} a year since the start` : 'not annualized under a year'} />
      <KPI l="You put in" v={fmtMoney(p.contributed)} cls="info" s="paychecks, match and transfers" />
      <KPI l="Investments earned" v={(p.earned >= 0 ? '+' : '−') + fmtMoney(Math.abs(p.earned))} cls={p.earned >= 0 ? 'good' : 'crit'} s="change in value less money in" /></div>
    <Chart title="Value against money put in" data={[
      { type: 'scatter', mode: 'lines', name: 'Money in', x: p.points.map(x => mShort(x.month)), y: p.points.map(x => base + x.contributed), line: { color: c.ink3, width: 2, dash: 'dot' }, hovertemplate: '%{x}: put in $%{y:,.0f}<extra></extra>' },
      { type: 'scatter', mode: 'lines', name: 'Value', x: p.points.map(x => mShort(x.month)), y: p.points.map(x => x.value), line: { color: c.good, width: 3 }, fill: 'tonexty', fillcolor: 'rgba(22,163,74,.10)', hovertemplate: '%{x}: worth $%{y:,.0f}<extra></extra>' }]}
      layout={{ showlegend: true, yaxis: { tickprefix: '$' }, xaxis: { type: 'category' } }} height={230} />
    <Note>Value follows each account's recorded balance, month by month. Money in is transfers into the accounts plus the 401(k), match and HSA money from your paycheck breakdown (at today's per-paycheck amounts for earlier paydays). The return is what the investments earned divided by the money that was there to earn it, so a large deposit does not look like a gain. The gap between the two lines is what the investments have earned.</Note>
  </Card>
}

/** Retirement year by year after tax: where each year's money comes from and what goes to tax. */
export function AfterTaxCard({ plan, i, onOff }: { plan: AfterTaxPlan | null; i: RetirementInputs; onOff?: (on: boolean) => void }) {
  const c = C()
  if (!plan) return <Card span={12} title="Retirement income after tax" hint="switched off — every dollar is treated as spendable">
    <Empty>Taxes are not being counted, so the planner treats pre-tax 401(k) and IRA money as fully spendable. {onOff && <Btn sm onClick={() => onOff(true)}>Count taxes</Btn>}</Empty></Card>
  const ys = plan.years, x = ys.map(y => y.age), at = plan.atRetirement, share = (v: number) => (at.total > 0 ? Math.round(v / at.total * 100) : 0)
  return <Card span={12} title="Retirement income after tax" hint="what each year is paid from, and what goes to income tax · today's dollars">
    <div className="kpis" style={{ marginBottom: 8 }}>
      <KPI l="Tax in retirement" v={fmtMoney(plan.avgTax) + '/yr'} cls={plan.avgTax > 0 ? 'warn' : 'good'} s={`${plan.effRate != null ? fmtPct(plan.effRate) + ' of retirement income · ' : ''}${fmtMoney(plan.lifetimeTax)} over ${ys.length} years`} />
      <KPI l="To spend each year" v={fmtMoney(i.desiredIncome)} cls={plan.depletionAge ? 'crit' : 'good'} s={plan.depletionAge ? `falls short from age ${plan.depletionAge}` : `after tax, every year to ${i.lifeExpectancy}`} />
      <KPI l="At retirement, by tax" v={`${share(at.pretax)}% pre-tax`} cls="info" s={`${fmtMoney(at.pretax)} taxed on the way out · ${fmtMoney(at.roth)} Roth and HSA, tax-free · ${fmtMoney(at.taxable)} taxable`} />
      <KPI l="Required distributions" v={plan.firstRmd ? `from age ${plan.firstRmd.age}` : `age ${plan.rmdAge}`} cls="info" s={plan.firstRmd ? `${fmtMoney(plan.firstRmd.amount)} the first year, whether needed or not` : 'no pre-tax money left by then'} />
      {plan.conversion && <KPI l="Low-tax room" v={fmtMoney(plan.conversion.room) + '/yr'} cls="info" s={`at age ${plan.conversion.age}, pre-tax money that could come out or move to Roth at ${Math.round(plan.conversion.rate * 100)}% or less`} />}</div>
    <Chart title="Where each year's income comes from" data={[
      { type: 'bar', name: 'Social Security', x, y: ys.map(y => y.ss), marker: { color: c.good }, hovertemplate: 'age %{x}: $%{y:,.0f}<extra>Social Security</extra>' },
      { type: 'bar', name: 'Pensions', x, y: ys.map(y => y.pension), marker: { color: c.wait }, hovertemplate: 'age %{x}: $%{y:,.0f}<extra>Pensions</extra>' },
      { type: 'bar', name: 'Taxable accounts', x, y: ys.map(y => y.fromTaxable), marker: { color: c.idle }, hovertemplate: 'age %{x}: $%{y:,.0f}<extra>Taxable</extra>' },
      { type: 'bar', name: 'Pre-tax accounts', x, y: ys.map(y => y.fromPretax), marker: { color: c.blue }, hovertemplate: 'age %{x}: $%{y:,.0f}<extra>Pre-tax</extra>' },
      { type: 'bar', name: 'Roth and HSA', x, y: ys.map(y => y.fromRoth), marker: { color: c.soon }, hovertemplate: 'age %{x}: $%{y:,.0f}<extra>Roth</extra>' },
      { type: 'scatter', mode: 'lines', name: 'Income tax', x, y: ys.map(y => y.tax), line: { color: c.crit, width: 3 }, hovertemplate: 'age %{x}: tax $%{y:,.0f}<extra></extra>' },
      { type: 'scatter', mode: 'lines', name: 'To spend', x, y: ys.map(y => y.spend), line: { color: c.ink, width: 2, dash: 'dot' }, hovertemplate: 'to spend $%{y:,.0f}<extra></extra>' }]}
      layout={{ barmode: 'stack', showlegend: true, yaxis: { tickprefix: '$' }, xaxis: { title: { text: 'age' } } }} height={300} />
    <Note>Each year the plan takes the required distribution, then draws from taxable accounts, then pre-tax accounts, then Roth, until what is left after that year's tax is the income you want to spend. Tax is worked out by the same engine as the <Link to="/tax">Tax</Link> page, with your filing status and state, on the latest tables in today's dollars. Pre-tax withdrawals and pensions are taxed as income; part of Social Security becomes taxable as other income rises; Roth and HSA money is not taxed. The planner adds each year's tax to what the portfolio must fund, so readiness, the Monte Carlo result and "money lasts to" all count it. {plan.conversion ? 'The low-tax room is a fact about those years, not a recommendation: converting means paying that tax sooner. ' : ''}A joint return is assumed to be two people of the same age; Medicare premium surcharges and the tax on a surviving spouse are not modelled.{onOff ? <> <Btn sm onClick={() => onOff(false)}>Stop counting taxes</Btn></> : null}</Note>
  </Card>
}
