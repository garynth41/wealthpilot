import { useMemo, useState } from 'react'
import { useData } from '../app/hooks'
import { Card, KPI, Btn, Pill, Note, Field, Empty, AList, useConfirm, useModal } from '../components/ui'
import { Link } from 'react-router-dom'
import { PaycheckEditor, stubSummary } from '../components/PaycheckEditor'
import { payrollSchedules } from '../lib/contrib'
import { hasStub, stubOf } from '../lib/paycheck'
import { taxMoves } from '../lib/taxMoves'
import { Table, type Col } from '../components/Table'
import { Chart, C } from '../components/Chart'
import { estimateTax, mergedItems, withholdingToBreakEven, TAX_DEFAULTS, TAX_ITEM_LABEL, tableFor, type TaxItem, type TaxItemKind, type TaxProfile } from '../lib/tax'
import { FILING_LABEL, STATES, TAX_YEARS, type FilingStatus } from '../lib/taxTables'
import { fmtMoney, fm2, fmtPct, parseNum } from '../lib/money'
import { fmtDY, today, diffDays } from '../lib/dates'

const INCOME: TaxItemKind[] = ['w2', '1099', 'business', 'dividends', 'interest', 'capital_gains', 'rental', 'retirement_income', 'social_security', 'other']
const OTHER: TaxItemKind[] = ['pretax_deduction', 'adjustment', 'itemized', 'withholding', 'estimated_payment', 'credit', 'state_withholding', 'local_withholding']

export function TaxPage() {
  const { data, settings, saveSettings, guarded, canEdit } = useData(); const confirm = useConfirm(); const c = C(); const { open, close } = useModal()
  const saved: TaxProfile = { ...TAX_DEFAULTS, ...(settings.tax || {}) }
  const [p, setP] = useState<TaxProfile>(saved); const dirty = JSON.stringify(p) !== JSON.stringify(saved)
  const set = <K extends keyof TaxProfile>(k: K, v: TaxProfile[K]) => setP(x => ({ ...x, [k]: v }))
  const num = (k: keyof TaxProfile) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, (parseNum(e.target.value) ?? 0) as never)
  const e = useMemo(() => estimateTax(data, settings, p), [data, settings, p])
  const base = useMemo(() => estimateTax(data, settings, { ...p, extraWithholdingPerCheck: 0, plannedEstimates: 0 }), [data, settings, p])
  const breakEven = useMemo(() => withholdingToBreakEven(data, settings, p), [data, settings, p])
  const items = mergedItems(data, { ...p, paychecksLeft: p.paychecksLeft == null ? null : e.paychecksLeft }, settings)
  const moves = useMemo(() => taxMoves(data, settings, p), [data, settings, p])
  const jobs = payrollSchedules(data).filter(x => x.status === 'Active' || hasStub(stubOf(settings, x.id))), noStub = jobs.filter(x => x.status === 'Active' && !hasStub(stubOf(settings, x.id)))
  const save = () => guarded(() => saveSettings({ tax: p }), 'Tax profile saved')
  const T = tableFor(p.year); const t = today()
  const cal = T.calendar.map(x => ({ ...x, days: diffDays(x.date, t) })).filter(x => x.days > -60)
  const nextEstimate = cal.find(x => x.kind === 'estimate' && x.days >= 0)

  // risk monitor
  const risks: Array<{ c: string; t: string; m: string }> = []
  const pr = e.safeHarbor.penaltyRates.map(r => Math.round(r * 100)); const rateText = pr.length ? `${pr[0]}${pr.length > 1 ? '–' + pr[pr.length - 1] : ''}%` : ''
  if (e.safeHarbor.metBy === 'under $1,000') risks.push({ c: 'good', t: 'No underpayment penalty expected — under $1,000 owed after withholding', m: `${fmtMoney(Math.max(0, e.safeHarbor.owedAfterWithholding))} left to pay after withholding; the IRS charges no penalty below $1,000 (the safe harbor would need ${fmtMoney(e.safeHarbor.required)}, ${e.safeHarbor.basis})` })
  else if (e.safeHarbor.met) risks.push({ c: 'good', t: 'Safe harbor met — no underpayment penalty expected', m: `paid / planned ${fmtMoney(e.paid.total)} vs required ${fmtMoney(e.safeHarbor.required)} (${e.safeHarbor.basis})` })
  else risks.push({ c: 'crit', t: `Under-withheld by ${fmtMoney(e.safeHarbor.shortfall)} against the safe harbor`, m: `required ${fmtMoney(e.safeHarbor.required)} (${e.safeHarbor.basis}); rough penalty if left unpaid until April 15 ≈ ${fmtMoney(e.safeHarbor.penaltyEstimate)}, at the IRS's quarterly rate${pr.length > 1 ? 's' : ''} of ${rateText} a year` })
  if (e.income.se > 0 && e.paid.estimates + e.paid.plannedEstimates === 0) risks.push({ c: 'warn', t: 'Self-employment income with no estimated payments', m: `SE + income tax on ${fmtMoney(e.income.se)} is not withheld — estimated payments (1040-ES) of about ${fmtMoney(e.safeHarbor.quarterlyNeeded || e.federal.se / Math.max(1, e.safeHarbor.estimatesLeft))} per remaining deadline keep you clear` })
  if (e.due > 1000) risks.push({ c: 'warn', t: `Projected to owe ${fmtMoney(e.due)} at filing`, m: breakEven != null && breakEven > 0 ? `raise withholding by about ${fmtMoney(breakEven)} per paycheck for the ${e.paychecksLeft} paychecks left (new W-4, step 4c)` : 'make an estimated payment before the next deadline' })
  if (e.refund > 2000) risks.push({ c: 'info', t: `Projected refund of ${fmtMoney(e.refund)}`, m: 'over-withholding is an interest-free loan to the IRS — you could lower withholding and save the difference instead' })
  if (!p.priorYearTax) risks.push({ c: 'info', t: "Add last year's total tax", m: 'the safe harbor can be 100% (110% above $150k AGI) of last year — often easier to hit than 90% of this year' })
  if (items.some(i => i.note && /gross pay not set/.test(i.note))) risks.push({ c: 'warn', t: 'Some income is estimated from net pay', m: 'set gross pay on Income & Pay Periods for an accurate W-2 figure' })
  if (noStub.length) risks.push({ c: 'warn', t: `No paycheck breakdown for ${noStub.map(x => x.name).join(', ')}`, m: 'without it the estimate taxes the full gross pay and counts no tax as withheld — add it under Paycheck breakdown below' })
  if (items.some(i => i.kind === 'withholding' && i.rest != null) && items.some(i => i.kind === 'withholding' && i.rest == null)) risks.push({ c: 'info', t: 'Tax withheld is counted from your paychecks and from a row you typed', m: 'keep the typed row only if it is for a different job; otherwise remove it so the same tax is not counted twice' })
  for (const x of jobs.filter(x => x.status === 'Active' && hasStub(stubOf(settings, x.id)))) { const sm = stubSummary(x, stubOf(settings, x.id), p.year); if (!sm.ok) risks.push({ c: 'info', t: `${x.name}: the paycheck breakdown is ${fmtMoney(Math.abs(sm.unexplained))} away from your take-home`, m: sm.unexplained > 0 ? 'something that comes out of the paycheck has not been entered, or your pay has changed' : 'more is entered than comes out, or the take-home on Income & Pay Periods is out of date' }) }
  if (e.state.due > 250) risks.push({ c: 'warn', t: `Projected to owe ${fmtMoney(e.state.due)} to ${e.state.name.split(' (')[0]}`, m: `state tax ${fmtMoney(e.state.tax)} against ${fmtMoney(e.state.paid)} withheld or paid` })
  if (e.local.due > 100) risks.push({ c: 'warn', t: `Projected to owe ${fmtMoney(e.local.due)} of city and school-district tax`, m: `tax ${fmtMoney(e.local.total)} against ${fmtMoney(e.local.paid)} withheld — a city you work in may not withhold for the city you live in` })

  const addItem = (kind: TaxItemKind) => setP(x => ({ ...x, items: [...x.items, { id: 'm' + Math.random().toString(36).slice(2, 9), kind, label: TAX_ITEM_LABEL[kind], amount: 0, source: 'manual' }] }))
  const cols: Col<TaxItem>[] = [
    { k: 'kind', label: 'Type', type: 'select', opts: [...INCOME, ...OTHER], labels: TAX_ITEM_LABEL, w: 220 },
    { k: 'label', label: 'Description', type: 'text', w: 240 },
    { k: 'amount', label: 'Amount (year)', type: 'money', cls: 'num', signed: true, required: true },
    { k: 'source', label: 'From', type: 'ro', fmt: r => r.source === 'auto' ? <Pill cls="info">auto</Pill> : <Pill cls="idle">manual</Pill> },
    { k: 'note', label: 'Note', type: 'ro', w: 250, fmt: r => r.note ? <span style={{ color: /gross pay not set/.test(r.note) ? 'var(--warn)' : 'var(--ink-3)' }}>{r.note}</span> : '' },
  ]
  const fed = e.federal; const net = Math.round((e.allRefund - e.allDue) * 100) / 100; const sgn = (v: number) => (v >= 0 ? '+' : '−') + fmtMoney(Math.abs(v))
  const bars = [['Federal income tax', fed.ordinary + fed.ltcg - fed.credits], ['Self-employment tax', fed.se], ['Medicare surtax + NIIT', fed.additionalMedicare + fed.niit], [e.state.name.split(' (')[0] + ' tax', e.state.tax], ['Local (municipal + school)', e.local.total]] as Array<[string, number]>

  return <>
    <div className="kpis" style={{ marginBottom: 16 }}>
      <KPI l={`Total tax ${p.year}`} v={fmtMoney(e.totalTax)} cls="warn" s={`federal ${fmtMoney(fed.total)} · state ${fmtMoney(e.state.tax)} · local ${fmtMoney(e.local.total)}`} />
      <KPI l={net >= 0 ? 'Projected refund' : 'Projected amount due'} v={fmtMoney(Math.abs(net))} cls={net >= 0 ? 'good' : -net > 1000 ? 'crit' : 'warn'} s={`federal ${sgn(e.refund - e.due)} · state ${sgn(e.state.refund - e.state.due)} · city ${sgn(e.local.refund - e.local.due)}`} />
      <KPI l="Effective rate" v={fmtPct(fed.effective, 1)} cls="info" s={`federal ÷ AGI · all taxes ÷ income ${fmtPct(e.effectiveAll, 1)}`} />
      <KPI l="Marginal rate" v={fmtPct(fed.marginal)} cls="info" s={`next dollar of ordinary income · + ${fmtPct(e.state.rate, 2)} state`} />
      <KPI l="Underpayment risk" v={e.safeHarbor.met ? 'Low' : fmtMoney(e.safeHarbor.shortfall)} cls={e.safeHarbor.met ? 'good' : 'crit'} s={e.safeHarbor.metBy === 'under $1,000' ? 'under $1,000 owed after withholding' : e.safeHarbor.met ? 'safe harbor met' : `short of the ${e.safeHarbor.basis} safe harbor`} />
      <KPI l="Next deadline" v={nextEstimate ? fmtDY(nextEstimate.date) : '—'} cls={nextEstimate && nextEstimate.days <= 21 ? 'warn' : 'info'} s={nextEstimate ? `${nextEstimate.label.split(' (')[0]} · in ${nextEstimate.days} days` : ''} />
    </div>
    <div className="grid g12">
      <Card span={4} title="Your tax profile" hint="saved with the household" right={canEdit ? <Btn primary sm onClick={save} disabled={!dirty}>Save</Btn> : undefined}>
        <div className="grid2">
          <Field label="Tax year"><select className="inp" value={p.year} onChange={x => set('year', +x.target.value)}>{TAX_YEARS.map(y => <option key={y} value={y}>{y}</option>)}</select></Field>
          <Field label="Filing status"><select className="inp" value={p.filingStatus} onChange={x => set('filingStatus', x.target.value as FilingStatus)}>{Object.entries(FILING_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Children under 17"><input className="inp" inputMode="numeric" value={p.dependentsUnder17} onChange={num('dependentsUnder17')} /></Field>
          <Field label="Other dependents"><input className="inp" inputMode="numeric" value={p.otherDependents} onChange={num('otherDependents')} /></Field>
          <Field label="People 65+ on return"><input className="inp" inputMode="numeric" value={p.age65} onChange={num('age65')} /></Field>
          <Field label="State"><select className="inp" value={p.state} onChange={x => set('state', x.target.value)}>{STATES.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}</select></Field>
          {p.state === 'FLAT' && <Field label="State rate %"><input className="inp" inputMode="decimal" value={p.stateRate ?? ''} onChange={num('stateRate')} /></Field>}
          <Field label="City income tax %" hint="e.g. 2.5"><input className="inp" inputMode="decimal" value={p.localRate} onChange={num('localRate')} /></Field>
          <Field label="School district tax %" hint="0 if none"><input className="inp" inputMode="decimal" value={p.schoolDistrictRate} onChange={num('schoolDistrictRate')} /></Field>
          <Field label="Last year's total tax" hint="Form 1040 line 24"><input className="inp" inputMode="decimal" value={p.priorYearTax || ''} onChange={num('priorYearTax')} /></Field>
          <Field label="Last year's AGI"><input className="inp" inputMode="decimal" value={p.priorYearAgi || ''} onChange={num('priorYearAgi')} /></Field>
        </div>
        <label style={{ display: 'block', marginTop: 6 }}><input type="checkbox" checked={p.autoAggregate} onChange={x => set('autoAggregate', x.target.checked)} /> Collect income automatically from pay schedules, holdings and rental income</label>
        <Note>Look up your city and school-district rates on the Ohio Department of Taxation "The Finder". Lewis Center addresses can fall in different municipalities and school districts.</Note>
      </Card>

      <Card span={8} title="Income, deductions & payments" hint="auto rows come from the rest of the app; add W-2 box 2 / 1099 figures as you receive them" right={canEdit ? <span className="btnrow"><select className="inp" style={{ width: 150, maxWidth: '100%' }} value="" onChange={x => x.target.value && addItem(x.target.value as TaxItemKind)} aria-label="Add an income, deduction or payment item"><option value="">+ Add item…</option>{[...INCOME, ...OTHER].map(k => <option key={k} value={k}>{TAX_ITEM_LABEL[k]}</option>)}</select></span> : undefined}>
        {items.length === 0 ? <Empty>No income yet. Add pay schedules on Income &amp; Pay Periods or add items here.</Empty> :
          <Table rows={items} cols={cols} name="tax-items" editable={canEdit} search={false} pageSize={25}
            onChange={(r, k, v) => { if (r.source === 'auto') return; setP(x => ({ ...x, items: x.items.map(i => i.id === r.id ? { ...i, [k]: k === 'amount' ? (+(v as number) || 0) : v } : i) })) }}
            onDelete={async r => { if (r.source === 'auto') return; if (await confirm(`Remove "${r.label}"?`)) setP(x => ({ ...x, items: x.items.filter(i => i.id !== r.id) })) }}
            rowCls={r => r.source === 'auto' ? 'st-info' : ''} />}
        <Note>Auto rows are read-only here — change them at their source (gross pay, holdings yields). Remember to <b>Save</b> after editing; nothing below is filed anywhere.</Note>
      </Card>

      <Card span={12} title="Paycheck breakdown" hint="what comes out of each paycheck — entered once, kept current as paydays pass">
        {jobs.length === 0 ? <Empty>No salary, hourly or severance pay yet. Add it on <Link to="/income">Income &amp; Pay Periods</Link>.</Empty> : <div className="tblwrap"><table className="tbl" data-tax="paychecks"><thead><tr><th>Job</th><th className="num">Gross</th><th className="num">Before tax</th><th className="num">Federal</th><th className="num">State</th><th className="num">City</th><th className="num">Take-home</th><th>Withheld so far · to come</th><th /></tr></thead><tbody>
          {jobs.map(x => { const st = stubOf(settings, x.id), has = hasStub(st), sm = stubSummary(x, st, p.year); return <tr key={x.id} className={!has ? 'st-warn' : sm.ok ? 'st-good' : 'st-info'}><td><b>{x.name}</b>{x.status !== 'Active' ? <span className="note" style={{ display: 'inline' }}> · ended</span> : null}</td><td className="num">{fm2(sm.gross)}</td>
            <td className="num">{has ? fm2(sm.pretax) : '—'}</td><td className="num">{has ? fm2(sm.fed) : '—'}</td><td className="num">{has ? fm2(sm.state) : '—'}</td><td className="num">{has ? fm2(sm.local) : '—'}</td><td className="num">{fm2(sm.net)}</td>
            <td style={{ fontSize: 12.5 }}>{has ? <>{fmtMoney(sm.y.by.fed.ytd + sm.y.by.state.ytd + sm.y.by.local.ytd)} over {sm.y.paid} paycheck{sm.y.paid === 1 ? '' : 's'} · {fmtMoney(sm.y.by.fed.rest + sm.y.by.state.rest + sm.y.by.local.rest)} over the {sm.y.left} left {sm.ok ? <Pill cls="good">adds up</Pill> : <Pill cls="warn">{fmtMoney(Math.abs(sm.unexplained))} off take-home</Pill>}</> : <span style={{ color: 'var(--warn-ink)' }}>not entered — the estimate is taxing the full gross and counting nothing as withheld</span>}</td>
            <td><Btn sm primary={!has} onClick={() => open(<PaycheckEditor ps={x} onDone={close} />, { wide: true })}>{has ? 'Edit' : canEdit ? 'Add breakdown' : 'View'}</Btn></td></tr> })}
        </tbody></table></div>}
        <Note>Each line here writes the matching rows above on its own: pre-tax deductions for the year, and federal, state and city tax withheld — so far, and still to come on the paychecks left. Nothing is typed twice, and nothing is filed anywhere.</Note>
      </Card>

      <Card span={12} title="Tax moves" hint={`what can still be done about ${moves.year}, and what each is worth at your income`}>
        {moves.moves.length === 0 ? <Empty>{moves.open ? 'Nothing to act on right now: your savings are at their limits or there is no room the app can see, and withholding is on track.' : `${moves.year} is closed — its deadlines have passed.`}</Empty> : <>
          <div className="tblwrap"><table className="tbl" data-tax="moves"><thead><tr><th>Move</th><th className="num">Worth</th><th>By</th></tr></thead><tbody>
            {moves.moves.map(m => <tr key={m.id} className={m.kind === 'free' || m.kind === 'save' ? 'st-good' : m.kind === 'avoid' ? 'st-warn' : 'st-info'}><td><b>{m.title}</b><div className="note" style={{ margin: '2px 0 0' }}>{m.detail}{m.to && m.to !== '/tax' ? <> <Link to={m.to}>Open</Link></> : null}</div></td>
              <td className="num" style={{ whiteSpace: 'nowrap' }}>{m.amount > 0 ? <b>{fmtMoney(m.amount)}</b> : '—'}<div className="note" style={{ margin: 0 }}>{m.kind === 'free' ? 'from your employer' : m.kind === 'save' ? 'less tax this year' : m.kind === 'avoid' ? 'penalty avoided' : m.kind === 'later' ? 'less tax later' : ''}</div></td><td style={{ whiteSpace: 'nowrap' }}>{m.by}</td></tr>)}
          </tbody></table></div>
          {moves.together > 0 && <Note>The savings moves made together would cut this year's tax by about <b>{fmtMoney(moves.together)}</b> — less than the rows added up when together they move your income into a lower bracket. Each figure is the difference between this page's estimate as it stands and the same estimate with the move made. Planning figures, not advice.</Note>}</>}
      </Card>

      <Card span={6} title="Estimated tax" hint={`${p.year} · ${FILING_LABEL[p.filingStatus]}`}>
        <div className="tblwrap"><table className="tbl"><tbody>
          {([['Total income', e.income.total], ['− pre-tax deductions & adjustments', -(e.pretax + e.adjustments)], ['− half of self-employment tax', -e.seDeduction], ['Adjusted gross income (AGI)', e.agi, 1], [`− ${e.itemized > e.standard ? 'itemized' : 'standard'} deduction`, -e.deduction], ['− senior deduction (65+)', -e.seniorDeduction], ['Taxable income', e.taxableIncome, 1],
            ['Federal income tax (ordinary)', fed.ordinary], ['Long-term gains tax', fed.ltcg], ['− credits', -fed.credits], ['Self-employment tax', fed.se], ['Additional Medicare + NIIT', fed.additionalMedicare + fed.niit], ['Federal total', fed.total, 1],
            [`${e.state.name.split(' (')[0]} (taxable ${fmtMoney(e.state.taxable)})`, e.state.tax], ['Municipal', e.local.municipal], ['School district', e.local.schoolDistrict], ['All taxes', e.totalTax, 1]] as Array<[string, number, number?]>)
            .filter(([, v, b]) => b || Math.abs(v) > 0.005).map(([l, v, b]) => <tr key={l}><td style={b ? { fontWeight: 600 } : { color: 'var(--ink-2)' }}>{l}</td><td className="num" style={b ? { fontWeight: 600 } : undefined}>{fm2(v)}</td></tr>)}
        </tbody></table></div>
        {e.income.socialSecurity > 0 && <Note>{fmtMoney(e.income.taxableSS)} of {fmtMoney(e.income.socialSecurity)} Social Security is taxable at this income.</Note>}
        <h3 style={{ margin: '12px 0 6px' }}>Where you stand with each</h3>
        <div className="tblwrap"><table className="tbl" data-tax="balances"><thead><tr><th>Paid to</th><th className="num">Tax</th><th className="num">Withheld / paid</th><th className="num">Refund or due</th></tr></thead><tbody>
          {([['Federal', fed.total, e.paid.total, e.refund - e.due], [e.state.name.split(' (')[0], e.state.tax, e.state.paid, e.state.refund - e.state.due], ['City and school district', e.local.total, e.local.paid, e.local.refund - e.local.due]] as Array<[string, number, number, number]>)
            .map(([l, tax, paid, bal]) => <tr key={l}><td>{l}</td><td className="num">{fm2(tax)}</td><td className="num">{fm2(paid)}</td><td className="num" style={{ color: bal >= 0 ? 'var(--good-ink)' : 'var(--crit-ink)', fontWeight: 600 }}>{bal >= 0 ? 'refund ' : 'due '}{fm2(Math.abs(bal))}</td></tr>)}
        </tbody><tfoot><tr><td>All three</td><td className="num">{fm2(e.totalTax)}</td><td className="num">{fm2(e.paid.total + e.state.paid + e.local.paid)}</td><td className="num">{net >= 0 ? 'refund ' : 'due '}{fm2(Math.abs(net))}</td></tr></tfoot></table></div>
        <Note>Withheld / paid counts what has come out of your paychecks so far, what the paychecks left this year will add, anything you typed, and for federal the estimated payments made or planned. A refund from one government does not pay what you owe another.</Note>
      </Card>

      <Card span={6} title="Where it goes"><Chart title="Tax by type" data={[{ type: 'bar', orientation: 'h', x: bars.map(b => Math.max(0, b[1])).reverse(), y: bars.map(b => b[0]).reverse(), marker: { color: [c.blue, c.wait, c.soon, c.warn, c.accent].reverse() }, hovertemplate: '%{y}: $%{x:,.0f}<extra></extra>' }]} layout={{ showlegend: false, xaxis: { tickprefix: '$' }, yaxis: { automargin: true } }} height={230} />
        <h3 style={{ margin: '10px 0 6px' }}>Underpayment risk monitor</h3><AList items={risks} /></Card>

      <Card span={6} title="Tax provisioning" hint="what-if — save to keep it">
        <Field label={`Paychecks left this year: ${e.paychecksLeft}${p.paychecksLeft == null ? ' (from your pay schedule)' : ''}`}><input type="range" min={0} max={26} value={e.paychecksLeft} onChange={x => set('paychecksLeft', +x.target.value)} style={{ width: '100%' }} aria-label="Paychecks left this year" aria-valuetext={`${e.paychecksLeft} paychecks`} />{p.paychecksLeft != null && <button type="button" className="btn sm" onClick={() => set('paychecksLeft', null)}>Use pay schedule</button>}</Field>
        <Field label={`Extra withholding per paycheck: ${p.extraWithholdingPerCheck >= 0 ? '' : '−'}${fmtMoney(Math.abs(p.extraWithholdingPerCheck))}`} hint="negative = withhold less"><input type="range" min={-500} max={1500} step={10} value={p.extraWithholdingPerCheck} onChange={x => set('extraWithholdingPerCheck', +x.target.value)} style={{ width: '100%' }} /></Field>
        <Field label={`Estimated payments still planned: ${fmtMoney(p.plannedEstimates)}`}><input type="range" min={0} max={Math.max(5000, Math.ceil(base.due / 500) * 500 + 2000)} step={50} value={p.plannedEstimates} onChange={x => set('plannedEstimates', +x.target.value)} style={{ width: '100%' }} /></Field>
        <Field label={`Set aside from self-employment income: ${p.seSetAsidePct}%`}><input type="range" min={0} max={45} value={p.seSetAsidePct} onChange={x => set('seSetAsidePct', +x.target.value)} style={{ width: '100%' }} /></Field>
        <div className="kpis" style={{ marginTop: 6 }}>
          <KPI l="Before changes" v={base.refund > 0 ? `+${fmtMoney(base.refund)}` : `−${fmtMoney(base.due)}`} cls={base.refund > 0 ? 'good' : 'crit'} s="refund (+) / due (−)" />
          <KPI l="After changes" v={e.refund > 0 ? `+${fmtMoney(e.refund)}` : `−${fmtMoney(e.due)}`} cls={e.refund > 0 || e.due < 100 ? 'good' : 'warn'} s={breakEven != null ? `break-even: ${breakEven >= 0 ? '+' : '−'}${fmtMoney(Math.abs(breakEven))}/paycheck` : 'set paychecks left'} />
          <KPI l="Tax reserve to hold" v={fmtMoney(e.allDue)} cls="info" s={e.income.se > 0 ? `SE set-aside ${fmtMoney(e.seSetAside)} (${p.seSetAsidePct}% of ${fmtMoney(e.income.se)})` : `federal ${fmtMoney(e.due)} · state ${fmtMoney(e.state.due)} · city ${fmtMoney(e.local.due)}`} />
        </div>
      </Card>

      <Card span={6} title="Tax calendar" hint={`${p.year} deadlines (federal and Ohio share the April date)`}>
        <div className="tblwrap"><table className="tbl"><thead><tr><th>Date</th><th>What</th><th className="num">When</th></tr></thead><tbody>
          {cal.map(x => <tr key={x.date + x.label} className={x.days < 0 ? 'past' : undefined}><td>{fmtDY(x.date)}</td><td><Pill cls={x.kind === 'estimate' ? 'warn' : x.kind === 'filing' ? 'crit' : x.kind === 'extension' ? 'info' : 'idle'}>{x.kind}</Pill> {x.label}</td><td className="num">{x.days < 0 ? `${-x.days} days ago` : x.days === 0 ? 'today' : `in ${x.days} days`}</td></tr>)}
        </tbody></table></div>
        <label className="gm-ign" style={{ fontSize: 13, display: 'block', marginTop: 8 }}><input type="checkbox" checked={settings.taxInCalendar !== false} disabled={!canEdit} onChange={x => guarded(() => saveSettings({ taxInCalendar: x.target.checked }), x.target.checked ? 'Estimated payments show in the cash calendar' : 'Estimated payments hidden from the cash calendar')} /> Show the estimated payments still due in the cash calendar and forecast ({settings.tax ? 'planned estimates plus any safe-harbor shortfall, at each deadline' : 'save this profile first'})</label>
        {!e.safeHarbor.met && <Note>To reach the safe harbor with estimates alone: about <b>{fmtMoney(e.safeHarbor.quarterlyNeeded)}</b> {e.safeHarbor.estimatesLeft === 1 ? 'at the one quarterly deadline left' : `at each of the ${e.safeHarbor.estimatesLeft} quarterly deadlines left`} (IRS Direct Pay or EFTPS; Ohio IT-1040ES for state). Paying late in the year still accrues a penalty for the earlier quarters; extra W-4 withholding is treated as paid evenly through the year, which usually avoids that.</Note>}
      </Card>
      <Card span={12} title="What this covers"><Note>Federal ordinary brackets, standard / itemized deduction and the 65+ add-on, the 2025–2028 senior deduction ($6,000 for each of you who is 65 or older, smaller above $75,000 of income — $150,000 married filing jointly), long-term capital gains rates stacked on ordinary income, self-employment tax (Social Security wage base, half deductible), Additional Medicare tax, NIIT, child and other-dependent credits, a simplified Social Security taxability rule, Ohio income tax (2025 and 2026 rates) with personal exemptions, city and school-district income tax (cafeteria-plan benefits left out of city wages, Social Security left out of Ohio income), state and city tax withheld against each, and the federal safe-harbor test with the $1,000 no-penalty rule and a penalty estimate at each quarter's IRS rate. Not covered: QBI deduction, AMT, EITC, the 2025–2028 deductions for tips, overtime and car-loan interest, education and energy credits, state credits, qualified-dividend rates (enter qualified dividends as capital gains), and the annualized-income method for uneven income (Form 2210 Schedule AI). Rates are {p.year} values; treat results as planning estimates and confirm with your return or a tax professional.</Note></Card>
    </div>
  </>
}
