import { useMemo, useState } from 'react'
import { useData } from '../app/hooks'
import { Card, KPI, Btn, Pill, Note, Field, Empty, AList, useConfirm } from '../components/ui'
import { Table, type Col } from '../components/Table'
import { Chart, C } from '../components/Chart'
import { estimateTax, mergedItems, withholdingToBreakEven, TAX_DEFAULTS, TAX_ITEM_LABEL, tableFor, type TaxItem, type TaxItemKind, type TaxProfile } from '../lib/tax'
import { FILING_LABEL, STATES, TAX_YEARS, type FilingStatus } from '../lib/taxTables'
import { fmtMoney, fm2, fmtPct, parseNum } from '../lib/money'
import { fmtDY, today, diffDays } from '../lib/dates'

const INCOME: TaxItemKind[] = ['w2', '1099', 'business', 'dividends', 'interest', 'capital_gains', 'rental', 'retirement_income', 'social_security', 'other']
const OTHER: TaxItemKind[] = ['pretax_deduction', 'adjustment', 'itemized', 'withholding', 'estimated_payment', 'credit']

export function TaxPage() {
  const { data, settings, saveSettings, guarded, canEdit } = useData(); const confirm = useConfirm(); const c = C()
  const saved: TaxProfile = { ...TAX_DEFAULTS, ...(settings.tax || {}) }
  const [p, setP] = useState<TaxProfile>(saved); const dirty = JSON.stringify(p) !== JSON.stringify(saved)
  const set = <K extends keyof TaxProfile>(k: K, v: TaxProfile[K]) => setP(x => ({ ...x, [k]: v }))
  const num = (k: keyof TaxProfile) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, (parseNum(e.target.value) ?? 0) as never)
  const e = useMemo(() => estimateTax(data, settings, p), [data, settings, p])
  const base = useMemo(() => estimateTax(data, settings, { ...p, extraWithholdingPerCheck: 0, plannedEstimates: 0 }), [data, settings, p])
  const breakEven = useMemo(() => withholdingToBreakEven(data, settings, p), [data, settings, p])
  const items = mergedItems(data, p)
  const save = () => guarded(() => saveSettings({ tax: p }), 'Tax profile saved')
  const T = tableFor(p.year); const t = today()
  const cal = T.calendar.map(x => ({ ...x, days: diffDays(x.date, t) })).filter(x => x.days > -60)
  const nextEstimate = cal.find(x => x.kind === 'estimate' && x.days >= 0)

  // risk monitor
  const risks: Array<{ c: string; t: string; m: string }> = []
  if (e.safeHarbor.met) risks.push({ c: 'good', t: 'Safe harbor met — no underpayment penalty expected', m: `paid / planned ${fmtMoney(e.paid.total)} vs required ${fmtMoney(e.safeHarbor.required)} (${e.safeHarbor.basis})` })
  else risks.push({ c: 'crit', t: `Under-withheld by ${fmtMoney(e.safeHarbor.shortfall)} against the safe harbor`, m: `required ${fmtMoney(e.safeHarbor.required)} (${e.safeHarbor.basis}); rough penalty if left unpaid ≈ ${fmtMoney(e.safeHarbor.penaltyEstimate)} at ${Math.round(T.underpaymentRate * 100)}%/yr` })
  if (e.income.se > 0 && e.paid.estimates + e.paid.plannedEstimates === 0) risks.push({ c: 'warn', t: 'Self-employment income with no estimated payments', m: `SE + income tax on ${fmtMoney(e.income.se)} is not withheld — estimated payments (1040-ES) of about ${fmtMoney(e.safeHarbor.quarterlyNeeded || e.federal.se / Math.max(1, e.safeHarbor.estimatesLeft))} per remaining deadline keep you clear` })
  if (e.due > 1000) risks.push({ c: 'warn', t: `Projected to owe ${fmtMoney(e.due)} at filing`, m: breakEven != null && breakEven > 0 ? `raise withholding by about ${fmtMoney(breakEven)} per paycheck for the ${e.paychecksLeft} paychecks left (new W-4, step 4c)` : 'make an estimated payment before the next deadline' })
  if (e.refund > 2000) risks.push({ c: 'info', t: `Projected refund of ${fmtMoney(e.refund)}`, m: 'over-withholding is an interest-free loan to the IRS — you could lower withholding and save the difference instead' })
  if (!p.priorYearTax) risks.push({ c: 'info', t: "Add last year's total tax", m: 'the safe harbor can be 100% (110% above $150k AGI) of last year — often easier to hit than 90% of this year' })
  if (items.some(i => i.note)) risks.push({ c: 'warn', t: 'Some income is estimated from net pay', m: 'set gross pay on Income & Pay Periods for an accurate W-2 figure' })

  const addItem = (kind: TaxItemKind) => setP(x => ({ ...x, items: [...x.items, { id: 'm' + Math.random().toString(36).slice(2, 9), kind, label: TAX_ITEM_LABEL[kind], amount: 0, source: 'manual' }] }))
  const cols: Col<TaxItem>[] = [
    { k: 'kind', label: 'Type', type: 'select', opts: [...INCOME, ...OTHER], labels: TAX_ITEM_LABEL, w: 220 },
    { k: 'label', label: 'Description', type: 'text', w: 240 },
    { k: 'amount', label: 'Amount (year)', type: 'money', cls: 'num' },
    { k: 'source', label: 'From', type: 'ro', fmt: r => r.source === 'auto' ? <Pill cls="info">auto</Pill> : <Pill cls="idle">manual</Pill> },
    { k: 'note', label: 'Note', type: 'ro', fmt: r => r.note ? <span style={{ color: 'var(--warn)' }}>{r.note}</span> : '' },
  ]
  const fed = e.federal
  const bars = [['Federal income tax', fed.ordinary + fed.ltcg - fed.credits], ['Self-employment tax', fed.se], ['Medicare surtax + NIIT', fed.additionalMedicare + fed.niit], [e.state.name.split(' (')[0] + ' tax', e.state.tax], ['Local (municipal + school)', e.local.total]] as Array<[string, number]>

  return <>
    <div className="kpis" style={{ marginBottom: 16 }}>
      <KPI l={`Total tax ${p.year}`} v={fmtMoney(e.totalTax)} cls="warn" s={`federal ${fmtMoney(fed.total)} · state ${fmtMoney(e.state.tax)} · local ${fmtMoney(e.local.total)}`} />
      <KPI l={e.refund > 0 ? 'Projected refund' : 'Projected amount due'} v={fmtMoney(e.refund > 0 ? e.refund : e.due)} cls={e.refund > 0 ? 'good' : e.due > 1000 ? 'crit' : 'warn'} s={`federal · paid / planned ${fmtMoney(e.paid.total)}`} />
      <KPI l="Effective rate" v={fmtPct(fed.effective, 1)} cls="info" s={`federal ÷ AGI · all taxes ÷ income ${fmtPct(e.effectiveAll, 1)}`} />
      <KPI l="Marginal rate" v={fmtPct(fed.marginal)} cls="info" s={`next dollar of ordinary income · + ${fmtPct(e.state.rate, 2)} state`} />
      <KPI l="Underpayment risk" v={e.safeHarbor.met ? 'Low' : fmtMoney(e.safeHarbor.shortfall)} cls={e.safeHarbor.met ? 'good' : 'crit'} s={e.safeHarbor.met ? 'safe harbor met' : `short of the ${e.safeHarbor.basis} safe harbor`} />
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

      <Card span={8} title="Income, deductions & payments" hint="auto rows come from the rest of the app; add W-2 box 2 / 1099 figures as you receive them" right={canEdit ? <span className="btnrow"><select className="inp" style={{ width: 150, maxWidth: '100%' }} value="" onChange={x => x.target.value && addItem(x.target.value as TaxItemKind)}><option value="">+ Add item…</option>{[...INCOME, ...OTHER].map(k => <option key={k} value={k}>{TAX_ITEM_LABEL[k]}</option>)}</select></span> : undefined}>
        {items.length === 0 ? <Empty>No income yet. Add pay schedules on Income &amp; Pay Periods or add items here.</Empty> :
          <Table rows={items} cols={cols} name="tax-items" editable={canEdit} search={false} pageSize={25}
            onChange={(r, k, v) => { if (r.source === 'auto') return; setP(x => ({ ...x, items: x.items.map(i => i.id === r.id ? { ...i, [k]: k === 'amount' ? (+(v as number) || 0) : v } : i) })) }}
            onDelete={async r => { if (r.source === 'auto') return; if (await confirm(`Remove "${r.label}"?`)) setP(x => ({ ...x, items: x.items.filter(i => i.id !== r.id) })) }}
            rowCls={r => r.source === 'auto' ? 'st-info' : ''} />}
        <Note>Auto rows are read-only here — change them at their source (gross pay, holdings yields). Remember to <b>Save</b> after editing; nothing below is filed anywhere.</Note>
      </Card>

      <Card span={6} title="Estimated tax" hint={`${p.year} · ${FILING_LABEL[p.filingStatus]}`}>
        <div className="tblwrap"><table className="tbl"><tbody>
          {([['Total income', e.income.total], ['− pre-tax deductions & adjustments', -(e.pretax + e.adjustments)], ['− half of self-employment tax', -e.seDeduction], ['Adjusted gross income (AGI)', e.agi, 1], [`− ${e.itemized > e.standard ? 'itemized' : 'standard'} deduction`, -e.deduction], ['Taxable income', e.taxableIncome, 1],
            ['Federal income tax (ordinary)', fed.ordinary], ['Long-term gains tax', fed.ltcg], ['− credits', -fed.credits], ['Self-employment tax', fed.se], ['Additional Medicare + NIIT', fed.additionalMedicare + fed.niit], ['Federal total', fed.total, 1],
            [`${e.state.name.split(' (')[0]} (taxable ${fmtMoney(e.state.taxable)})`, e.state.tax], ['Municipal', e.local.municipal], ['School district', e.local.schoolDistrict], ['All taxes', e.totalTax, 1]] as Array<[string, number, number?]>)
            .filter(([, v, b]) => b || Math.abs(v) > 0.005).map(([l, v, b]) => <tr key={l}><td style={b ? { fontWeight: 600 } : { color: 'var(--ink-2)' }}>{l}</td><td className="num" style={b ? { fontWeight: 600 } : undefined}>{fm2(v)}</td></tr>)}
        </tbody></table></div>
        {e.income.socialSecurity > 0 && <Note>{fmtMoney(e.income.taxableSS)} of {fmtMoney(e.income.socialSecurity)} Social Security is taxable at this income.</Note>}
      </Card>

      <Card span={6} title="Where it goes"><Chart title="Tax by type" data={[{ type: 'bar', orientation: 'h', x: bars.map(b => Math.max(0, b[1])).reverse(), y: bars.map(b => b[0]).reverse(), marker: { color: [c.blue, c.wait, c.soon, c.warn, c.accent].reverse() }, hovertemplate: '%{y}: $%{x:,.0f}<extra></extra>' }]} layout={{ showlegend: false, xaxis: { tickprefix: '$' }, yaxis: { automargin: true } }} height={230} />
        <h3 style={{ margin: '10px 0 6px' }}>Underpayment risk monitor</h3><AList items={risks} /></Card>

      <Card span={6} title="Tax provisioning" hint="what-if — save to keep it">
        <Field label={`Paychecks left this year: ${e.paychecksLeft}${p.paychecksLeft == null ? ' (from your pay schedule)' : ''}`}><input type="range" min={0} max={26} value={e.paychecksLeft} onChange={x => set('paychecksLeft', +x.target.value)} style={{ width: '100%' }} />{p.paychecksLeft != null && <button type="button" className="btn sm" onClick={() => set('paychecksLeft', null)}>Use pay schedule</button>}</Field>
        <Field label={`Extra withholding per paycheck: ${p.extraWithholdingPerCheck >= 0 ? '' : '−'}${fmtMoney(Math.abs(p.extraWithholdingPerCheck))}`} hint="negative = withhold less"><input type="range" min={-500} max={1500} step={10} value={p.extraWithholdingPerCheck} onChange={x => set('extraWithholdingPerCheck', +x.target.value)} style={{ width: '100%' }} /></Field>
        <Field label={`Estimated payments still planned: ${fmtMoney(p.plannedEstimates)}`}><input type="range" min={0} max={Math.max(5000, Math.ceil(base.due / 500) * 500 + 2000)} step={50} value={p.plannedEstimates} onChange={x => set('plannedEstimates', +x.target.value)} style={{ width: '100%' }} /></Field>
        <Field label={`Set aside from self-employment income: ${p.seSetAsidePct}%`}><input type="range" min={0} max={45} value={p.seSetAsidePct} onChange={x => set('seSetAsidePct', +x.target.value)} style={{ width: '100%' }} /></Field>
        <div className="kpis" style={{ marginTop: 6 }}>
          <KPI l="Before changes" v={base.refund > 0 ? `+${fmtMoney(base.refund)}` : `−${fmtMoney(base.due)}`} cls={base.refund > 0 ? 'good' : 'crit'} s="refund (+) / due (−)" />
          <KPI l="After changes" v={e.refund > 0 ? `+${fmtMoney(e.refund)}` : `−${fmtMoney(e.due)}`} cls={e.refund > 0 || e.due < 100 ? 'good' : 'warn'} s={breakEven != null ? `break-even: ${breakEven >= 0 ? '+' : '−'}${fmtMoney(Math.abs(breakEven))}/paycheck` : 'set paychecks left'} />
          <KPI l="Tax reserve to hold" v={fmtMoney(e.due)} cls="info" s={e.income.se > 0 ? `SE set-aside ${fmtMoney(e.seSetAside)} (${p.seSetAsidePct}% of ${fmtMoney(e.income.se)})` : 'cash to keep for the balance due'} />
        </div>
      </Card>

      <Card span={6} title="Tax calendar" hint={`${p.year} deadlines (federal and Ohio share the April date)`}>
        <div className="tblwrap"><table className="tbl"><thead><tr><th>Date</th><th>What</th><th className="num">When</th></tr></thead><tbody>
          {cal.map(x => <tr key={x.date + x.label} style={{ opacity: x.days < 0 ? 0.55 : 1 }}><td>{fmtDY(x.date)}</td><td><Pill cls={x.kind === 'estimate' ? 'warn' : x.kind === 'filing' ? 'crit' : x.kind === 'extension' ? 'info' : 'idle'}>{x.kind}</Pill> {x.label}</td><td className="num">{x.days < 0 ? `${-x.days} days ago` : x.days === 0 ? 'today' : `in ${x.days} days`}</td></tr>)}
        </tbody></table></div>
        {!e.safeHarbor.met && <Note>To reach the safe harbor with estimates alone: about <b>{fmtMoney(e.safeHarbor.quarterlyNeeded)}</b> {e.safeHarbor.estimatesLeft === 1 ? 'at the one quarterly deadline left' : `at each of the ${e.safeHarbor.estimatesLeft} quarterly deadlines left`} (IRS Direct Pay or EFTPS; Ohio IT-1040ES for state). Paying late in the year still accrues a penalty for the earlier quarters; extra W-4 withholding is treated as paid evenly through the year, which usually avoids that.</Note>}
      </Card>
      <Card span={12} title="What this covers"><Note>Federal ordinary brackets, standard / itemized deduction and the 65+ add-on, long-term capital gains rates stacked on ordinary income, self-employment tax (Social Security wage base, half deductible), Additional Medicare tax, NIIT, child and other-dependent credits, a simplified Social Security taxability rule, Ohio 2026 flat tax with personal exemptions, city and school-district income tax, and the federal safe-harbor test. Not covered: QBI deduction, AMT, EITC, education and energy credits, state credits, qualified-dividend rates (enter qualified dividends as capital gains), and quarter-by-quarter (annualised) penalty math. Rates are {p.year} values; treat results as planning estimates and confirm with your return or a tax professional.</Note></Card>
    </div>
  </>
}
