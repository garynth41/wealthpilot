// Insurance & Estate (0.22.0): the insurance register with coverage gaps, beneficiaries on accounts and policies, and the estate checklist.
// Engines: lib/insurance.ts, lib/estate.ts. Nothing here stores a document — only what exists, who is named and where the original is kept.
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../app/hooks'
import type { Account, EstateItem, InsurancePolicy } from '../app/data/types'
import { INSURANCE_KIND_LABEL } from '../app/data/types'
import { Card, KPI, Btn, Pill, Note, AList, useConfirm } from '../components/ui'
import { Table, type Col } from '../components/Table'
import { insuranceSummary, annualPremium, premiumBill } from '../lib/insurance'
import { estateStatus, templateRows, templateFor, reviewDue, AREA_LABEL, BENEFICIARY_KINDS } from '../lib/estate'
import { fmtMoney } from '../lib/money'
import { fmtDY, today } from '../lib/dates'
import { acctLabel } from '../lib/accounts'

const FREQ: Record<InsurancePolicy['premium_frequency'], string> = { monthly: 'Monthly', quarterly: 'Quarterly', semiannual: 'Every 6 months', yearly: 'Yearly' }
const STATUS_LABEL: Record<EstateItem['status'], string> = { todo: 'To do', in_progress: 'In progress', done: 'Done', na: 'Not needed' }
const STATUS_PILL: Record<EstateItem['status'], string> = { todo: 'warn', in_progress: 'wait', done: 'good', na: 'idle' }

export function ProtectionPage() {
  const { data, settings, insert, update, remove, guarded, canEdit, catOpts, accts } = useData(); const confirm = useConfirm()
  const ins = useMemo(() => insuranceSummary(data, settings), [data, settings]); const est = useMemo(() => estateStatus(data), [data])
  const deps = (settings.tax?.dependentsUnder17 || 0) + (settings.tax?.otherDependents || 0)
  const addPolicy = () => guarded(() => insert('insurance', { kind: 'term_life', name: 'New policy', premium: 0, premium_frequency: 'monthly', through_employer: false, status: 'Active', sort_order: data.insurance.length + 1 }), 'Added — fill in the row')
  const toBills = (p: InsurancePolicy) => guarded(async () => { const cat = catOpts('expense').find(c => /insurance/i.test(c.name) && (p.kind === 'auto' ? /auto|car/i.test(c.name) : p.kind === 'health' ? /health/i.test(c.name) : true)) || catOpts('expense').find(c => /insurance/i.test(c.name))
    const r = await insert('recurring', premiumBill(p, accts.find(a => a.kind === 'checking')?.id || null, cat?.id || null)); await update('insurance', p.id, { recurring_id: r.id }) }, 'Premium added to Bills')
  const cols: Col<InsurancePolicy>[] = [
    { k: 'kind', label: 'Type', type: 'select', opts: Object.keys(INSURANCE_KIND_LABEL), labels: INSURANCE_KIND_LABEL, w: 140 }, { k: 'name', label: 'Policy', type: 'text', w: 160 }, { k: 'carrier', label: 'Carrier', type: 'text', w: 130 },
    { k: 'insured', label: 'Who is covered', type: 'text', w: 130 }, { k: 'policy_last4', label: 'Policy # (last 4)', type: 'text', w: 80, placeholder: '1234' },
    { k: 'coverage', label: 'Coverage', type: 'money', cls: 'num', w: 110 }, { k: 'deductible', label: 'Deductible', type: 'money', cls: 'num', w: 100 },
    { k: 'premium', label: 'Premium', type: 'money', cls: 'num', w: 100 }, { k: 'premium_frequency', label: 'Paid', type: 'select', opts: Object.keys(FREQ), labels: FREQ, w: 120 },
    { k: '_y', label: 'Per year', type: 'ro', cls: 'num', fmt: p => fmtMoney(annualPremium(p)), sortVal: p => annualPremium(p) },
    { k: 'renews_on', label: 'Renews', type: 'date' }, { k: 'beneficiary', label: 'Beneficiary', type: 'text', w: 150 }, { k: 'through_employer', label: 'Through work', type: 'bool', w: 60 },
    { k: '_b', label: 'On Bills', type: 'ro', fmt: p => p.recurring_id ? <Link to="/bills"><Pill cls="good">yes</Pill></Link> : p.through_employer ? <Pill cls="idle">payroll</Pill> : canEdit && +p.premium > 0 ? <Btn sm onClick={() => toBills(p)}>Add to Bills</Btn> : '—' },
    { k: 'status', label: 'Status', type: 'select', opts: ['Active', 'Lapsed', 'Cancelled'], w: 100 }, { k: 'notes', label: 'Notes', type: 'text', w: 160 }, { k: 'ref', label: 'ID', type: 'ro', cls: 'id' }]
  const onPolicy = (p: InsurancePolicy, k: string, v: unknown) => { if (k === 'policy_last4') { const s = String(v ?? '').replace(/[^0-9A-Za-z]/g, '').slice(-4); v = s || null }
    guarded(() => update('insurance', p.id, { [k]: v === '' ? null : v } as Partial<InsurancePolicy>)) }
  const benefAccts = data.accounts.filter(a => a.status === 'Active' && (BENEFICIARY_KINDS.includes(a.kind) || a.kind === 'checking' || a.kind === 'savings'))
  const startChecklist = () => guarded(async () => { const rows = templateRows(data, deps); for (const r of rows) await insert('estate', r) }, 'Checklist started')
  const setItem = (e: EstateItem, patch: Partial<EstateItem>) => guarded(() => update('estate', e.id, { ...patch, ...(patch.status === 'done' && !e.done_on ? { done_on: today() } : {}) }))
  const areas = [...new Set(est.items.map(e => e.area))]
  return <>
    <div className="kpis" style={{ marginBottom: 16 }}>
      <KPI l="Premiums" v={fmtMoney(ins.monthly) + '/mo'} cls="info" s={`${fmtMoney(ins.annual)} a year · ${ins.active.length} active polic${ins.active.length === 1 ? 'y' : 'ies'}${ins.shareOfIncome != null ? ` · ${Math.round(ins.shareOfIncome * 100)}% of income` : ''}`} />
      <KPI l="Coverage gaps" v={String(ins.gaps.filter(g => g.severity !== 'info').length)} cls={ins.gaps.some(g => g.severity === 'crit') ? 'crit' : ins.gaps.some(g => g.severity === 'warn') ? 'warn' : 'good'} s={ins.gaps.length ? `${ins.gaps.filter(g => g.severity === 'info').length} more worth a look` : 'nothing obvious missing'} />
      <KPI l="Life insurance" v={fmtMoney(ins.life.have)} cls={ins.life.income === 0 ? 'idle' : ins.life.gap > 0 ? 'warn' : 'good'} s={ins.life.income ? `rough need ${fmtMoney(ins.life.need)}${ins.life.gap > 0 ? ` · ${fmtMoney(ins.life.gap)} short` : ''}` : 'no income on file'} />
      <KPI l="Renewing in 60 days" v={String(ins.renewals.length)} cls={ins.renewals.length ? 'info' : 'idle'} s={ins.renewals[0] ? `${ins.renewals[0].name} · ${fmtDY(ins.renewals[0].renews_on!)}` : 'none'} />
      <KPI l="Estate checklist" v={est.started ? `${est.done} of ${est.total}` : '—'} cls={!est.started ? 'idle' : est.pct >= 1 ? 'good' : est.pct >= 0.5 ? 'info' : 'warn'} s={est.started ? `${Math.round(est.pct * 100)}% done${est.overdue.length ? ` · ${est.overdue.length} due for review` : ''}` : 'not started'} />
      <KPI l="Missing beneficiaries" v={String(est.accountGaps.length + est.policyGaps.length)} cls={est.accountGaps.length + est.policyGaps.length ? 'warn' : 'good'} s="retirement, brokerage and life policies" />
    </div>
    <div className="grid g12">
      <Card span={5} title="Coverage gaps" hint="rules of thumb — prompts to check, not advice"><AList items={ins.gaps.length ? ins.gaps.map(g => ({ c: g.severity, t: g.title, m: g.detail })) : [{ c: 'good', t: 'Nothing obvious missing', m: 'health, life, disability, home or renters, auto and umbrella all look covered for what is on file' }]} /></Card>
      <Card span={7} title="Life insurance need" hint="a rough DIME-style estimate">
        <div className="tblwrap"><table className="tbl"><caption className="sr-only">Life insurance need</caption><tbody>
          <tr><td>Debts to pay off</td><td className="num">{fmtMoney(ins.life.debts)}</td></tr><tr><td>Income to replace · {ins.life.years} years</td><td className="num">{fmtMoney(ins.life.income * ins.life.years)}</td></tr>
          <tr><td>Less savings outside retirement accounts</td><td className="num">−{fmtMoney(ins.life.liquid)}</td></tr><tr><td><b>Rough need</b></td><td className="num"><b>{fmtMoney(ins.life.need)}</b></td></tr>
          <tr><td>Coverage on file</td><td className="num">{fmtMoney(ins.life.have)}</td></tr><tr className={ins.life.gap > 0 ? 'st-warn' : 'st-good'}><td>{ins.life.gap > 0 ? 'Gap' : 'Covered'}</td><td className="num">{fmtMoney(ins.life.gap)}</td></tr></tbody></table></div>
        <Note>Add a college fund or final expenses on top if they apply; subtract what a surviving spouse earns. A term policy that runs until the youngest child is grown or the mortgage is paid is the usual fit.</Note></Card>
      <Card span={12} title="Policies" hint="one row per policy · only the last four characters of a policy number are kept" right={canEdit ? <Btn primary sm onClick={addPolicy}>+ Add policy</Btn> : undefined}>
        <Table rows={data.insurance} cols={cols} editable={canEdit} name="insurance" onChange={onPolicy} onDelete={async p => { if (await confirm(`Delete ${p.name}? Its Bills row, if any, stays.`)) guarded(() => remove('insurance', p.id), 'Deleted') }} rowCls={p => p.status !== 'Active' ? 'st-idle ex-off' : ''} empty="No policies yet — add health, life, disability, auto, home or renters and umbrella coverage." />
        <Note>"Add to Bills" creates the premium as a bill so the forecast, budget and alerts count it. Employer plans paid from your paycheck can be marked "through work" instead.</Note></Card>
      <Card span={12} title="Beneficiaries" hint="beneficiary forms override a will — review them every few years and after any life event">
        <div className="tblwrap"><table className="tbl"><caption className="sr-only">Beneficiaries</caption><thead><tr><th scope="col">Account or policy</th><th scope="col">Beneficiary</th><th scope="col">Last checked</th><th scope="col" /></tr></thead><tbody>
          {benefAccts.map((a: Account) => { const need = BENEFICIARY_KINDS.includes(a.kind); const missing = need && !String(a.beneficiary || '').trim()
            return <tr key={a.id} className={missing ? 'st-warn' : ''}><td>{acctLabel(a, data.accounts)}<div className="note" style={{ margin: 0 }}>{need ? 'beneficiary form' : 'payable-on-death (optional)'}</div></td>
              <td>{canEdit ? <input className="inp" defaultValue={a.beneficiary || ''} placeholder={need ? 'Primary; contingent' : 'POD — optional'} aria-label={`Beneficiary for ${a.name}`} onBlur={e => { const v = e.target.value.trim() || null; if (v !== (a.beneficiary || null)) guarded(() => update('accounts', a.id, { beneficiary: v, beneficiary_reviewed_on: v ? today() : null })) }} /> : a.beneficiary || '—'}</td>
              <td>{a.beneficiary_reviewed_on ? fmtDY(a.beneficiary_reviewed_on) : '—'}</td><td>{canEdit && a.beneficiary && <Btn sm onClick={() => guarded(() => update('accounts', a.id, { beneficiary_reviewed_on: today() }), 'Marked as checked today')}>Checked today</Btn>}</td></tr> })}
          {ins.active.filter(p => p.kind === 'life' || p.kind === 'term_life').map(p => <tr key={p.id} className={!String(p.beneficiary || '').trim() ? 'st-warn' : ''}><td>{p.name}<div className="note" style={{ margin: 0 }}>{INSURANCE_KIND_LABEL[p.kind]}{p.coverage ? ` · ${fmtMoney(+p.coverage)}` : ''}</div></td><td>{p.beneficiary || <span style={{ color: 'var(--warn-ink)' }}>none recorded</span>}</td><td>—</td><td /></tr>)}
          {!benefAccts.length && !ins.active.some(p => p.kind === 'life' || p.kind === 'term_life') && <tr><td colSpan={4}><div className="empty">No retirement, brokerage or bank accounts yet.</div></td></tr>}
        </tbody></table></div>
        {est.staleBeneficiaries.length > 0 && <Note>{est.staleBeneficiaries.length} beneficiar{est.staleBeneficiaries.length === 1 ? 'y has' : 'ies have'} not been checked in three years.</Note>}</Card>
      <Card span={12} title="Estate checklist" hint="what exists, when it was done, where the original is — not legal advice" right={canEdit && est.started && templateRows(data, deps).length > 0 ? <Btn sm onClick={startChecklist}>Add {templateRows(data, deps).length} missing item{templateRows(data, deps).length === 1 ? '' : 's'}</Btn> : undefined}>
        {!est.started ? <div className="empty"><p>A short list of the documents and decisions most households need: a will, powers of attorney, health-care directive, guardians, beneficiaries and where everything is kept.</p>{canEdit && <Btn primary onClick={startChecklist}>Start the checklist</Btn>}</div> : <>
          <div className="mix" style={{ height: 8, marginBottom: 12 }}><span style={{ width: Math.round(est.pct * 100) + '%', background: 'var(--good)' }} /></div>
          {areas.map(area => <div key={area} style={{ marginBottom: 14 }}><h3 style={{ margin: '4px 0 6px', fontSize: 14 }}>{AREA_LABEL[area as keyof typeof AREA_LABEL] || area}</h3>
            <div className="tblwrap"><table className="tbl"><caption className="sr-only">{area}</caption><thead><tr><th scope="col">Item</th><th scope="col">Status</th><th scope="col">Done</th><th scope="col">Where the original is</th><th scope="col">Review by</th><th scope="col" /></tr></thead><tbody>
              {est.items.filter(e => e.area === area).map(e => { const t = templateFor(e.key); const due = reviewDue(e); const late = !!due && due <= today()
                return <tr key={e.id} className={e.status === 'done' ? (late ? 'st-warn' : 'st-good') : e.status === 'na' ? 'st-idle' : ''}><td>{!e.key && canEdit ? <input className="inp" defaultValue={e.label} aria-label="Item" onBlur={x => { const v = x.target.value.trim(); if (v && v !== e.label) setItem(e, { label: v }) }} /> : <b style={{ fontWeight: 500 }}>{e.label}</b>}{t && <div className="note" style={{ margin: 0 }}>{t.why}</div>}</td>
                  <td>{canEdit ? <select className="inp" value={e.status} onChange={x => setItem(e, { status: x.target.value as EstateItem['status'] })} aria-label={`Status of ${e.label}`} style={{ width: 'auto' }}>{(Object.keys(STATUS_LABEL) as EstateItem['status'][]).map(k => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}</select> : <Pill cls={STATUS_PILL[e.status]}>{STATUS_LABEL[e.status]}</Pill>}</td>
                  <td>{canEdit ? <input className="inp" type="date" defaultValue={e.done_on || ''} aria-label={`Date ${e.label} was done`} onBlur={x => { const v = x.target.value || null; if (v !== (e.done_on || null)) setItem(e, { done_on: v }) }} /> : e.done_on ? fmtDY(e.done_on) : '—'}</td>
                  <td>{canEdit ? <input className="inp" defaultValue={e.location || ''} placeholder="e.g. fire safe, attorney's office" aria-label={`Where ${e.label} is kept`} onBlur={x => { const v = x.target.value.trim() || null; if (v !== (e.location || null)) setItem(e, { location: v }) }} /> : e.location || '—'}</td>
                  <td>{due ? <span style={{ color: late ? 'var(--warn-ink)' : undefined }}>{fmtDY(due)}{late ? ' · due' : ''}</span> : '—'}</td>
                  <td>{canEdit && <button className="del" aria-label={`Remove ${e.label}`} onClick={async () => { if (await confirm(`Remove "${e.label}" from the checklist?`, 'Remove')) guarded(() => remove('estate', e.id)) }}>✕</button>}</td></tr> })}
            </tbody></table></div></div>)}
          {canEdit && <Btn sm onClick={() => guarded(() => insert('estate', { label: 'New item', area: 'documents', status: 'todo', sort_order: est.items.length + 1 }))}>+ Add your own item</Btn>}
          <Note>Record where an original is kept, never the document or account numbers. A finished item comes up for review three years after it was done — sooner after a marriage, divorce, birth, death or move.</Note></>}
      </Card>
    </div>
  </>
}
