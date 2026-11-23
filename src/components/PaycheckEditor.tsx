// The paycheck breakdown editor (0.39.0): what comes out of one paycheck, entered once from a pay stub. Saved with the household
// (Settings.payStubs); the Tax page, the contribution limits and the retirement planner read it. Engine: lib/paycheck.ts.
import { useMemo, useState } from 'react'
import { useData } from '../app/hooks'
import type { PaySchedule, PayStub } from '../app/data/types'
import { Btn, Field, MBody, MFoot, MHead, Note, Pill } from './ui'
import { STUB_FIELDS, STUB_LABEL, ficaOf, grossOf, matchOf, stubOf, stubYear, takeHome, type StubField } from '../lib/paycheck'
import { investAccounts } from '../lib/allocation'
import { acctTypeOf } from '../lib/contrib'
import { tableFor } from '../lib/tax'
import { fm2, fmtMoney, parseNum } from '../lib/money'
import { fmtDY, today } from '../lib/dates'

const HINT: Partial<Record<StubField, string>> = { k401: 'your own pre-tax money', roth401k: 'after tax, grows tax-free', hsa: 'pre-tax, taken by payroll', sec125: 'premiums, FSA, commuter', fed: 'federal income tax only', state: 'state income tax', local: 'city and school district', afterTax: 'union dues, garnishments, after-tax insurance' }
const YTD: Array<[keyof NonNullable<PayStub['ytd']>, string]> = [['gross', 'Gross pay'], ['fed', 'Federal tax withheld'], ['state', 'State tax withheld'], ['local', 'City / school tax withheld'], ['k401', '401(k), pre-tax'], ['roth401k', 'Roth 401(k)'], ['hsa', 'HSA'], ['sec125', 'Health and other pre-tax']]

export function PaycheckEditor({ ps, onDone }: { ps: PaySchedule; onDone: () => void }) {
  const { data, settings, saveSettings, update, guarded, canEdit, acctLabels } = useData()
  const [st, setSt] = useState<PayStub>(() => ({ ...stubOf(settings, ps.id) })); const [gross, setGross] = useState(ps.gross_amount != null && +ps.gross_amount > 0 ? String(ps.gross_amount) : '')
  const [showYtd, setShowYtd] = useState(!!st.ytd)
  const year = +today().slice(0, 4), T = tableFor(year); const p: PaySchedule = { ...ps, gross_amount: parseNum(gross) ?? ps.gross_amount }
  const g = grossOf(p), th = takeHome(p, st, T), fica = ficaOf(p, st, T), m = matchOf(p, st), y = useMemo(() => stubYear(p, st, year), [p.gross_amount, st, year])   // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof PayStub, v: string) => setSt(x => ({ ...x, [k]: v.trim() === '' ? undefined : Math.max(0, parseNum(v) ?? 0) }))
  const setY = (k: string, v: string) => setSt(x => ({ ...x, ytd: { asOf: x.ytd?.asOf || today(), ...(x.ytd || {}), [k]: k === 'asOf' ? v : v.trim() === '' ? null : Math.max(0, parseNum(v) ?? 0) } }))
  const num = (k: StubField) => <Field key={k} label={STUB_LABEL[k]} hint={g > 0 && +(st[k] || 0) > 0 ? `${HINT[k]} · ${(+(st[k] || 0) / g * 100).toFixed(1)}% of gross` : HINT[k]}><input className="inp" inputMode="decimal" defaultValue={st[k] != null ? String(st[k]) : ''} placeholder="0.00" disabled={!canEdit} onBlur={e => set(k, e.target.value)} /></Field>
  const inv = investAccounts(data), plans = inv.filter(a => ['k401', 'roth401k'].includes(acctTypeOf(settings, a))), hsas = inv.filter(a => acctTypeOf(settings, a) === 'hsa')
  const off = Math.abs(th.unexplained), ok = off <= Math.max(2, th.net * 0.005)
  const save = () => guarded(async () => {
    const clean: PayStub = { ...st }; for (const k of Object.keys(clean) as Array<keyof PayStub>) if (clean[k] == null || clean[k] === 0) delete clean[k]
    if (!showYtd || !clean.ytd?.asOf) delete clean.ytd
    const all = { ...(settings.payStubs || {}) }; if (Object.keys(clean).length) all[ps.id] = clean; else delete all[ps.id]
    const gn = parseNum(gross); if (gn != null && gn > 0 && gn !== +(ps.gross_amount || 0)) await update('paySchedules', ps.id, { gross_amount: gn })
    await saveSettings({ payStubs: all }); onDone()
  }, 'Paycheck breakdown saved')
  return <><MHead title={`Paycheck breakdown · ${ps.name}`} /><MBody>
    <Note>Copy one recent pay stub. Enter each amount <b>per paycheck</b>. The app then knows your taxable pay, what has been withheld and what you are saving, and keeps every figure current as paydays pass.</Note>
    <div className="grid3" style={{ marginTop: 8 }}>
      <Field label="Gross pay per paycheck" hint="before anything comes out"><input className="inp" inputMode="decimal" value={gross} placeholder="0.00" disabled={!canEdit} onChange={e => setGross(e.target.value)} /></Field>
      <Field label="Take-home per paycheck" hint="set on Income & Pay Periods"><input className="inp" value={fm2(+ps.net_amount || 0)} disabled readOnly /></Field>
      <Field label="Paychecks this year" hint={`${y.paid} paid · ${y.left} to come`}><input className="inp" value={String(y.paid + y.left)} disabled readOnly /></Field>
    </div>
    <h3 style={{ margin: '10px 0 2px', fontSize: 14 }}>Before tax</h3><div className="grid3">{(['k401', 'hsa', 'sec125'] as StubField[]).map(num)}</div>
    <h3 style={{ margin: '10px 0 2px', fontSize: 14 }}>Tax withheld</h3><div className="grid3">{(['fed', 'state', 'local'] as StubField[]).map(num)}</div>
    <h3 style={{ margin: '10px 0 2px', fontSize: 14 }}>After tax</h3><div className="grid3">{(['roth401k', 'afterTax'] as StubField[]).map(num)}<Field label="Social Security and Medicare" hint="worked out: 7.65% of pay after health and HSA"><input className="inp" value={fm2(fica.total)} disabled readOnly /></Field></div>
    <h3 style={{ margin: '10px 0 2px', fontSize: 14 }}>What your employer adds</h3>
    <div className="grid3">
      <Field label="Employer matches %" hint="e.g. 50 = 50 cents on the dollar"><input className="inp" inputMode="decimal" defaultValue={st.matchPct != null ? String(st.matchPct) : ''} placeholder="0" disabled={!canEdit} onBlur={e => set('matchPct', e.target.value)} /></Field>
      <Field label="…on the first % of pay" hint={m.full > 0 ? `full match ${fm2(m.full)} a paycheck · you collect ${fm2(m.perCheck)}` : 'e.g. 6'}><input className="inp" inputMode="decimal" defaultValue={st.matchUpToPct != null ? String(st.matchUpToPct) : ''} placeholder="0" disabled={!canEdit} onBlur={e => set('matchUpToPct', e.target.value)} /></Field>
      <Field label="Employer HSA money per paycheck" hint="counts toward the HSA limit"><input className="inp" inputMode="decimal" defaultValue={st.hsaEmployer != null ? String(st.hsaEmployer) : ''} placeholder="0.00" disabled={!canEdit} onBlur={e => set('hsaEmployer', e.target.value)} /></Field>
    </div>
    <div className="grid2">
      <Field label="401(k) money goes into" hint={plans.length ? 'for contributions by account and performance' : 'add the account on Account Balances first'}><select className="inp" value={st.k401Account || ''} disabled={!canEdit} onChange={e => setSt(x => ({ ...x, k401Account: e.target.value || null }))}><option value="">{plans.length === 1 ? `${acctLabels[plans[0].id]} (your only workplace plan)` : '—'}</option>{inv.map(a => <option key={a.id} value={a.id}>{acctLabels[a.id]}</option>)}</select></Field>
      <Field label="HSA money goes into"><select className="inp" value={st.hsaAccount || ''} disabled={!canEdit} onChange={e => setSt(x => ({ ...x, hsaAccount: e.target.value || null }))}><option value="">{hsas.length === 1 ? `${acctLabels[hsas[0].id]} (your only HSA)` : '—'}</option>{inv.map(a => <option key={a.id} value={a.id}>{acctLabels[a.id]}</option>)}</select></Field>
    </div>
    <div className={`msg ${ok ? 'good' : 'warn'}`} style={{ marginTop: 10 }} data-pc="check">
      <b>{fm2(th.gross)}</b> gross − <b>{fm2(th.deductions)}</b> entered − <b>{fm2(th.fica)}</b> Social Security and Medicare = <b>{fm2(th.computed)}</b> · your take-home is <b>{fm2(th.net)}</b>{' '}
      {ok ? <Pill cls="good">adds up</Pill> : th.unexplained > 0 ? <Pill cls="warn">{fm2(off)} more comes out than you have entered</Pill> : <Pill cls="warn">{fm2(off)} too much entered, or take-home is out of date</Pill>}
    </div>
    <label style={{ display: 'block', margin: '12px 0 4px' }}><input type="checkbox" checked={showYtd} disabled={!canEdit} onChange={e => { setShowYtd(e.target.checked); if (e.target.checked && !st.ytd) setSt(x => ({ ...x, ytd: { asOf: today() } })) }} /> My pay changed during the year — use the year-to-date figures from my latest pay stub</label>
    {showYtd && <><div className="grid3">
      <Field label="Pay stub dated" hint="the pay date on the stub"><input className="inp" type="date" value={st.ytd?.asOf || today()} max={today()} disabled={!canEdit} onChange={e => setY('asOf', e.target.value)} /></Field>
      {YTD.map(([k, l]) => <Field key={k} label={`${l}, year to date`}><input className="inp" inputMode="decimal" defaultValue={st.ytd?.[k] != null ? String(st.ytd[k]) : ''} placeholder="leave blank to work it out" disabled={!canEdit} onBlur={e => setY(k, e.target.value)} /></Field>)}
    </div><Note>Up to {fmtDY(st.ytd?.asOf || today())} the year-to-date figures are used as they are; after it, each paycheck adds the per-paycheck amounts above. A line left blank is worked out from the paychecks so far.</Note></>}
    <Note>This year so far: {fmtMoney(y.by.fed.ytd)} federal, {fmtMoney(y.by.state.ytd)} state and {fmtMoney(y.by.local.ytd)} city tax withheld; {fmtMoney(y.by.k401.ytd + y.by.roth401k.ytd)} into your workplace plan{y.match.ytd > 0 ? ` plus ${fmtMoney(y.match.ytd)} from your employer` : ''}. Still to come over {y.left} paycheck{y.left === 1 ? '' : 's'}: {fmtMoney(y.by.fed.rest)} federal tax and {fmtMoney(y.by.k401.rest + y.by.roth401k.rest)} of savings.</Note>
  </MBody><MFoot><Btn onClick={onDone}>Cancel</Btn>{canEdit && <Btn primary onClick={save}>Save breakdown</Btn>}</MFoot></>
}
/** One line per payroll job for a card: what comes out before tax, what is withheld, and whether the breakdown adds up. */
export function stubSummary(ps: PaySchedule, st: PayStub, year = +today().slice(0, 4)) {
  const T = tableFor(year), th = takeHome(ps, st, T), pre = (+(st.k401 || 0) || 0) + (+(st.hsa || 0) || 0) + (+(st.sec125 || 0) || 0)
  return { gross: th.gross, pretax: pre, fed: +(st.fed || 0) || 0, state: +(st.state || 0) || 0, local: +(st.local || 0) || 0, net: th.net, unexplained: th.unexplained, ok: Math.abs(th.unexplained) <= Math.max(2, th.net * 0.005), y: stubYear(ps, st, year), fields: STUB_FIELDS }
}
