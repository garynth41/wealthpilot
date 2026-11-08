import { useRef, useState, useEffect } from 'react'
import { DeleteAccountCard } from './DeleteAccount'
import { remindersOn, setReminders, rescheduleReminders } from '../app/nativeReminders'
import { isNative, passkeysAvailable, webPushAvailable, saveFile, publicUrl } from '../app/native'
import { DeleteHouseholdCard } from './DeleteHousehold'
import { AboutCard } from './About'
import { offlineCopyOn, setOfflineCopy } from '../lib/offlineCache'
import { passwordProblems } from '../lib/access'
import { useData } from '../app/hooks'
import { useStore } from '../app/store'
import type { Category, PeriodType, Role } from '../app/data/types'
import { PAY_FREQ_LABEL } from '../app/data/types'
import { APP_NAME, APP_VERSION, APP_BUILD } from '../app/config'
import { Card, Btn, Pill, Note, Field, useConfirm, Seg, useModal, MHead, MBody, MFoot, PasswordInput } from '../components/ui'
import { Table, type Col } from '../components/Table'
import { MailSetup } from './Email'
import { fmtMoney, fm2, fmtNum, parseNum } from '../lib/money'
import { LOCALES, localePreference, setLocale, resolvedLocale, privacyOn, setPrivacy } from '../lib/display'
import { NOTIFY_DEFAULTS, computeAlerts, type Alert } from '../lib/notify'
import type { NotifyPrefs, MemberNotify } from '../app/data/types'
import { fmtDY, today, ago, fmtDT } from '../lib/dates'
import { hasSupabase, sb, authFeatures } from '../app/supabase'
import { authMessage } from '../app/store'
import { IDLE_CHOICES, idleMinutes, setIdleMinutes, lockNow } from '../components/IdleLock'
import { describeDevice } from '../lib/devices'
import { ruleHits, planAutoCategorise, type PayeeRule } from '../lib/rules'
import { logGoalLinks } from '../app/goalLinks'
import { restoreMessage } from '../lib/restore'
import { checkThresholds, type ThresholdKey } from '../lib/validate'
import { GRANTABLE, ACCESS_LABEL, accessLevel, accessToMember, describeAccess, normaliseModules, canEditAccess, inviteEmailDraft, mailtoLink, type AccessLevel } from '../lib/access'
import type { Member, InviteResult } from '../app/data/types'

export function SettingsPage() {
  const { data, household, settings, saveSettings, insert, update, remove, guarded, canEdit, isOwner, repo, refresh, mode, user, groups } = useData(); const confirm = useConfirm(); const { open, close } = useModal()
  const [tab, setTab] = useState<'general' | 'categories' | 'rules' | 'members' | 'notifications' | 'security' | 'data' | 'activity'>('general')
  const [name, setName] = useState(household?.name || ''); const [s, setS] = useState({ ...settings }); const fileRef = useRef<HTMLInputElement>(null)
  // 0.25.1: the thresholds are kept as typed until Save. A 0 is saved as 0 where it means something (no reserve floor, no savings target,
  // reminders only on the due day, any overspending is red, never red); green needs at least a month and a box that is empty or not a
  // number says so under it — nothing is replaced by a default behind your back (lib/validate.ts checkThresholds).
  const [th, setTh] = useState<Record<ThresholdKey, string>>(() => ({ reserveFloor: String(settings.reserveFloor ?? 0), savingsTargetPct: String(settings.savingsTargetPct ?? 20), runwayGreen: String(settings.runwayGreen ?? 6), runwayYellow: String(settings.runwayYellow ?? 3), budgetCritPct: String(settings.budgetCritPct ?? 10), dueSoonDays: String(settings.dueSoonDays ?? 7) }))
  const [thErr, setThErr] = useState<Partial<Record<ThresholdKey, string>>>({})
  const setT = (k: ThresholdKey) => (e: React.ChangeEvent<HTMLInputElement>) => { setTh(x => ({ ...x, [k]: e.target.value })); if (thErr[k]) setThErr(x => ({ ...x, [k]: undefined })) }
  const saveGeneral = () => { const chk = checkThresholds(th); setThErr(chk.errors); const t = chk.value
    if (!t) { useStore.getState().toast('Some planning thresholds need a fix — the message is under each one. Nothing was saved.', true); requestAnimationFrame(() => document.querySelector<HTMLElement>('.field.has-error input')?.focus()); return }
    guarded(async () => { if (name !== household?.name) await repo!.renameHousehold(name); await saveSettings({ periodType: s.periodType, periodAnchor: s.periodAnchor || null, semimonthlyDays: s.semimonthlyDays, reserveFloor: t.reserveFloor, runwayGreen: t.runwayGreen, runwayYellow: t.runwayYellow, dueSoonDays: t.dueSoonDays, budgetCritPct: t.budgetCritPct, savingsTargetPct: t.savingsTargetPct, includeRetirementInCash: !!s.includeRetirementInCash, payFrequencyDefault: s.payFrequencyDefault }); await refresh() }, 'Settings saved') }
  const catCols: Col<Category>[] = [{ k: 'group', label: 'Group', type: 'select', opts: [...groups, 'Income', 'Housing', 'Transport', 'Food', 'Health', 'Bills', 'Debt', 'Personal', 'Savings', 'Other'].filter((v, i, a) => a.indexOf(v) === i), w: 110 }, { k: 'name', label: 'Category', type: 'text', w: 160 }, { k: 'kind', label: 'Kind', type: 'select', opts: ['expense', 'income', 'transfer'], w: 100 }, { k: 'priority', label: 'Priority', type: 'select', opts: ['Essential', 'Important', 'Discretionary'], w: 120 }, { k: 'cost_type', label: 'Cost type', type: 'select', opts: ['Fixed', 'Variable', 'Irregular'], w: 100 }, { k: 'default_budget', label: 'Default budget', type: 'money', cls: 'num' }, { k: 'budget_cadence', label: 'Cadence', type: 'select', opts: ['period', 'monthly', 'yearly'], labels: { period: 'per period', monthly: 'per month', yearly: 'per year (sinking fund)' }, w: 150 }, { k: 'rollover', label: 'Rollover', type: 'bool' }, { k: 'sort_order', label: 'Order', type: 'int', w: 60 }, { k: 'archived', label: 'Archived', type: 'bool' }, { k: 'notes', label: 'Notes', type: 'text', w: 160 }, { k: 'ref', label: 'ID', type: 'ro', cls: 'id' }]
  const exportJson = () => guarded(async () => { const j = await repo!.exportJson(); await saveFile(`cresari-backup-${today()}.json`, JSON.stringify(j, null, 2), 'application/json') }, isNative() ? 'Backup ready' : 'Backup downloaded')
  const exportCsv = () => { const rows = data.transactions.map(t => [t.date, t.kind, t.amount, t.payee || '', data.categories.find(c => c.id === t.category_id)?.name || '', data.accounts.find(a => a.id === t.account_id)?.name || '', data.accounts.find(a => a.id === t.to_account_id)?.name || '', t.status, t.source, (t.memo || '').replace(/"/g, '""')]); const csv = ['date,kind,amount,payee,category,account,to_account,status,source,memo', ...rows.map(r => r.map(v => `"${String(v)}"`).join(','))].join('\n'); void saveFile(`cresari-transactions-${today()}.csv`, csv, 'text/csv') }
  const importJson = (modeI: 'merge' | 'replace') => { const f = fileRef.current?.files?.[0]; if (!f) return useStore.getState().toast('Choose a backup file first', true); const r = new FileReader(); r.onload = () => guarded(async () => { const j = JSON.parse(String(r.result)); if (modeI === 'replace' && !(await confirm('Replace EVERYTHING in this household with the backup? This cannot be undone.', 'Replace'))) return; const n = await repo!.importJson(j, modeI); await refresh(); useStore.getState().toast(restoreMessage(n)) }); r.readAsText(f) }
  const tabs: Array<[typeof tab, string]> = [['general', 'General'], ['categories', 'Categories'], ['rules', 'Payee rules'], ['members', 'Members'], ['notifications', 'Notifications'], ['security', 'Security'], ['data', 'Backup & data'], ['activity', 'Activity log']]
  return <>
    <div style={{ marginBottom: 14 }}><Seg value={tab} options={tabs} onChange={setTab} /></div>
    {tab === 'general' && <div className="grid g12">
      <Card span={6} title="Household"><Field label="Name"><input className="inp" value={name} onChange={e => setName(e.target.value)} disabled={!isOwner} /></Field><Note>Signed in as {mode === 'demo' ? 'demo' : user?.email} · {APP_NAME} v{APP_VERSION} · build {APP_BUILD}</Note></Card>
      <Card span={6} title="Budget cadence" hint="how the Budget page slices time"><Field label="Budget by"><select className="inp" value={s.periodType} onChange={e => setS({ ...s, periodType: e.target.value as PeriodType })}><option value="month">Calendar month</option><option value="pay">Pay period (from your primary income source)</option><option value="biweekly">Every 2 weeks (from an anchor date)</option><option value="semimonthly">Twice a month</option><option value="week">Week (Mon–Sun)</option></select></Field>
        {s.periodType === 'biweekly' && <Field label="A period start date (anchor)"><input className="inp" type="date" value={s.periodAnchor || ''} onChange={e => setS({ ...s, periodAnchor: e.target.value })} /></Field>}
        {s.periodType === 'semimonthly' && <Field label="Period start days" hint="e.g. 1 and 15"><div className="grid2"><input className="inp" inputMode="numeric" value={s.semimonthlyDays?.[0] ?? 1} onChange={e => setS({ ...s, semimonthlyDays: [+e.target.value || 1, s.semimonthlyDays?.[1] ?? 15] })} /><input className="inp" inputMode="numeric" value={s.semimonthlyDays?.[1] ?? 15} onChange={e => setS({ ...s, semimonthlyDays: [s.semimonthlyDays?.[0] ?? 1, +e.target.value || 15] })} /></div></Field>}
        <Field label="Default pay frequency for new income sources"><select className="inp" value={s.payFrequencyDefault} onChange={e => setS({ ...s, payFrequencyDefault: e.target.value as typeof s.payFrequencyDefault })}>{Object.entries(PAY_FREQ_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Note>Changing the cadence does not touch existing periods; the Budget page simply starts offering the new slices.</Note></Card>
      <Card span={6} title="Planning thresholds"><div className="grid2"><Field label="Reserve floor" hint="cash you will not go below · 0 for none" error={thErr.reserveFloor}><input className="inp" inputMode="decimal" value={th.reserveFloor} onChange={setT('reserveFloor')} /></Field><Field label="Savings-rate target %" hint="0 for none" error={thErr.savingsTargetPct}><input className="inp" inputMode="decimal" value={th.savingsTargetPct} onChange={setT('savingsTargetPct')} /></Field><Field label="Runway green at (months)" hint="1 or more" error={thErr.runwayGreen}><input className="inp" inputMode="decimal" value={th.runwayGreen} onChange={setT('runwayGreen')} /></Field><Field label="Runway yellow at (months)" hint="below green · 0 = never red" error={thErr.runwayYellow}><input className="inp" inputMode="decimal" value={th.runwayYellow} onChange={setT('runwayYellow')} /></Field><Field label="Over budget is red above %" hint="0 = any overspending" error={thErr.budgetCritPct}><input className="inp" inputMode="decimal" value={th.budgetCritPct} onChange={setT('budgetCritPct')} /></Field><Field label="Bill reminder window (days)" hint="0 = on the due day" error={thErr.dueSoonDays}><input className="inp" inputMode="numeric" value={th.dueSoonDays} onChange={setT('dueSoonDays')} /></Field></div>
        <label className="gm-ign" style={{ fontSize: 13 }}><input type="checkbox" checked={!!s.includeRetirementInCash} onChange={e => setS({ ...s, includeRetirementInCash: e.target.checked })} /> count retirement accounts as cash (last resort)</label></Card>
      {isNative() ? <Card span={12} title="Email capture (Gmail / Outlook)" hint="let the app read the bills and payments in your mailbox"><Note>Set up email capture on the Cresari website — Google and Microsoft do not allow their sign-in inside apps. Items it files show up in this app.</Note></Card> : <Card span={12} title="Email capture (Gmail / Outlook)" hint="let the app read the bills and payments in your mailbox"><div className="btnrow"><Pill cls={settings.gmail?.clientId ? 'good' : 'idle'}>Gmail {settings.gmail?.clientId ? 'set up' : 'not set up'}</Pill><Pill cls={settings.outlook?.clientId ? 'good' : 'idle'}>Outlook {settings.outlook?.clientId ? 'set up' : 'not set up'}</Pill><Btn primary onClick={() => open(<MailSetup onDone={close} />, { wide: true })} disabled={!canEdit}>Open email capture settings</Btn></div><Note>Choose which mailboxes to read, how far back, and whether clear matches are filed without review. The first time, Google or Microsoft needs a one-time setup — the box has the steps for whoever manages your Google or Microsoft account. The same box opens from <b>Email Money Capture → Set up Gmail</b>.</Note></Card>}
      <DeviceDisplay />
      <Card span={6} title="Save"><Btn primary onClick={saveGeneral} disabled={!canEdit}>Save settings</Btn><Note>Settings are shared by everyone in the household.</Note></Card>
      <DeleteHouseholdCard />
      <AboutCard />
    </div>}
    {tab === 'categories' && <Card title="Categories" hint="group · priority (Essential / Important / Discretionary) · fixed or variable · default budget copied into each new period · rollover carries unspent money forward" right={canEdit ? <Btn primary sm onClick={() => guarded(() => insert('categories', { name: 'New category', group: 'Other', kind: 'expense', priority: 'Important', cost_type: 'Variable', default_budget: 0, budget_cadence: 'period', rollover: false, sort_order: data.categories.length + 1, archived: false }), 'Added')}>+ Add category</Btn> : undefined}>
      <Table rows={data.categories.slice().sort((a, b) => a.sort_order - b.sort_order)} cols={catCols} editable={canEdit} onChange={(c, k, v) => guarded(() => update('categories', c.id, { [k]: v } as Partial<Category>))} onDelete={async c => { if (await confirm(`Delete ${c.name}? Transactions in it become uncategorized. Archive instead to keep history.`)) guarded(() => remove('categories', c.id), 'Deleted') }} rowCls={c => c.archived ? 'st-idle ex-off' : c.kind === 'income' ? 'st-good' : ''} />
      <Note>Total default budget: <b>{fmtMoney(data.categories.filter(c => !c.archived && c.kind === 'expense').reduce((n, c) => n + c.default_budget, 0))}</b>/period · income {fmtMoney(data.categories.filter(c => !c.archived && c.kind === 'income').reduce((n, c) => n + c.default_budget, 0))}</Note></Card>}
    {tab === 'rules' && <RulesTab />}
    {tab === 'security' && <SecurityTab />}
    {tab === 'notifications' && <NotificationsTab />}
    {tab === 'members' && <MembersTab />}
    {tab === 'data' && <div className="grid g12">
      <Card span={6} title="Backup" hint="everything in this household as one JSON file"><div className="btnrow"><Btn primary onClick={exportJson}>Download JSON backup</Btn><Btn onClick={exportCsv}>Transactions as CSV</Btn></div><Note>Keep a backup before big changes. The JSON restores into any household; merging it where its records already are does not copy them.</Note></Card>
      <NightlyBackups />
      <Card span={6} title="Restore" hint="from a JSON backup"><input type="file" ref={fileRef} accept="application/json" className="inp" /><div className="btnrow" style={{ marginTop: 8 }}><Btn onClick={() => importJson('merge')} disabled={!canEdit}>Merge into this household</Btn><Btn danger onClick={() => importJson('replace')} disabled={!canEdit}>Replace everything</Btn></div></Card>
      <Card span={12} title="Where your data is kept" hint="what is stored, where, and who can see it"><Note>{mode === 'demo' ? <>The offline demo keeps its sample data in this browser only — nothing is sent anywhere, and clearing the browser's site data removes it.</> : <>Everything in this household — accounts, transactions, budgets, bills, goals and files you add — is kept in Cresari's online database, encrypted where it is stored and on its way to you. Only the people listed under <b>Members</b> can see it, each with the access you gave them; the database itself enforces that, not just the app. Emails are never kept: only the amount, date and payee of what you file from them.</>}</Note></Card>
    </div>}
    {tab === 'activity' && <Card title="Activity log" hint="who changed what · newest first">{data.activity.length ? <div className="tblwrap" style={{ maxHeight: 520 }}><table className="tbl"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Table</th><th>Summary</th></tr></thead><tbody>{data.activity.map(a => <tr key={a.id}><td>{fmtDT(a.created_at)}</td><td>{a.user_email || '—'}</td><td><Pill cls={a.action === 'delete' ? 'crit' : a.action === 'insert' ? 'good' : 'info'}>{a.action}</Pill></td><td>{a.table_name}</td><td>{a.summary || a.record_id}</td></tr>)}</tbody></table></div> : <div className="empty">{mode === 'demo' ? 'The activity log is kept by the database and is not available in the offline demo.' : 'No activity yet.'}</div>}</Card>}
  </>
}

/** Payee rules: pattern → category / account / rename / exclude. Learned automatically when you categorise by hand; editable here. */
function RulesTab() {
  const { data, settings, saveSettings, update, guarded, canEdit, catOpts, catLabels, accts, acctLabels } = useData(); const confirm = useConfirm()
  const rules = settings.rules || []; type Row = PayeeRule & { hitsNow: number }
  const rows: Row[] = rules.map(r => ({ ...r, hitsNow: ruleHits(data, r) }))
  const save = (next: PayeeRule[]) => guarded(() => saveSettings({ rules: next }))
  const goalOpts = data.goals.filter(g => g.status === 'Active' && g.kind !== 'debt_payoff')
  const cols: Col<Row>[] = [
    { k: 'enabled', label: 'On', type: 'bool', w: 40 },
    { k: 'pattern', label: 'Payee pattern', type: 'text', w: 180, placeholder: 'kroger' },
    { k: 'match', label: 'Match', type: 'select', opts: ['contains', 'starts', 'exact', 'regex'], labels: { contains: 'contains', starts: 'starts with', exact: 'is exactly', regex: 'regex' }, w: 110 },
    { k: 'kind', label: 'Applies to', type: 'select', opts: ['', 'expense', 'income'], labels: { '': 'any', expense: 'expenses', income: 'income' }, w: 100 },
    { k: 'category_id', label: 'Set category', type: 'select', opts: ['', ...catOpts(['expense', 'income']).map(c => c.id)], labels: { '': '—', ...catLabels }, w: 190 },
    { k: 'account_id', label: 'Set account', type: 'select', opts: ['', ...accts.map(a => a.id)], labels: { '': '—', ...acctLabels }, w: 160 },
    { k: 'rename', label: 'Rename payee to', type: 'text', w: 140, placeholder: 'Kroger' },
    { k: 'exclude_from_budget', label: 'Not in budget', type: 'bool', w: 70 },
    { k: 'tags', label: 'Add tags', type: 'text', w: 130, placeholder: 'tag, tag', sortVal: r => (r.tags || []).join(',') || null },
    { k: 'review', label: 'Flag for review', type: 'bool', w: 70 },
    { k: 'goal_id', label: 'Count toward goal', type: 'select', opts: ['', ...goalOpts.map(g => g.id)], labels: { '': '—', ...Object.fromEntries(goalOpts.map(g => [g.id, g.name])) }, w: 160 },
    { k: 'hitsNow', label: 'Matches', type: 'ro', cls: 'num', fmt: r => String(r.hitsNow) },
    { k: 'source', label: 'From', type: 'ro', fmt: r => <Pill cls={r.source === 'learned' ? 'info' : 'idle'}>{r.source === 'learned' ? 'learned' : 'manual'}</Pill> },
  ]
  const plan = planAutoCategorise(data, settings)
  const runAll = () => { if (!plan.length) return; guarded(async () => { for (const p of plan) await update('transactions', p.t.id, p.patch); await logGoalLinks(plan.map(p => p.t.id)) }, `Rules applied to ${plan.length} transaction${plan.length === 1 ? '' : 's'}`) }
  // re-run (0.21.0): every rule over every matching transaction, already-categorized ones included — after editing a rule
  const rerun = async () => { const all = planAutoCategorise(data, settings, { onlyUncategorised: false }).filter(p => p.how === 'rule'); if (!all.length) return useStore.getState().toast('Every matching transaction already follows your rules')
    if (!(await confirm(`Re-apply your rules to ${all.length} matching transaction${all.length === 1 ? '' : 's'}? Categories, renames, tags and goals set by a rule replace what is there now. One undo puts them back.`, 'Re-run rules'))) return
    guarded(async () => { const before = all.map(p => { const inv: Record<string, unknown> = {}; for (const k of Object.keys(p.patch)) inv[k] = (p.t as unknown as Record<string, unknown>)[k] ?? null; return { id: p.t.id, inv } })
      for (const p of all) await update('transactions', p.t.id, p.patch); await logGoalLinks(all.map(p => p.t.id))
      useStore.getState().pushUndo({ label: 're-run rules', run: async () => { for (const b of before) await update('transactions', b.id, b.inv) } }) }, `Rules re-applied to ${all.length}`) }
  return <div className="grid g12">
    <Card span={12} title="Payee rules" hint="first matching rule wins (longest pattern first) · applied to manual entries, statement imports and email capture" right={canEdit ? <span className="btnrow"><Btn sm onClick={runAll} disabled={!plan.length} title="Fill in what is missing: uncategorized rows, and tags or goals a rule adds">Apply to {plan.length} transaction{plan.length === 1 ? '' : 's'}</Btn><Btn sm onClick={rerun} title="Re-apply every rule to every match, replacing what is there">Re-run on all matches</Btn><Btn primary sm onClick={() => save([...rules, { id: 'r' + Math.random().toString(36).slice(2, 10), pattern: '', match: 'contains', enabled: true, created_at: new Date().toISOString(), source: 'manual' }])}>+ Add rule</Btn></span> : undefined}>
      <Table rows={rows} cols={cols} editable={canEdit} defaultSort={{ k: 'pattern', dir: 1 }} empty="No rules yet. Rules are learned when you set a category on a transaction, or add one here."
        onChange={(r, k, v) => save(rules.map(x => x.id === r.id ? { ...x, [k]: k === 'tags' ? String(v ?? '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : v === '' ? null : v } : x))}
        onDelete={async r => { if (await confirm(`Delete the rule "${r.pattern}"?`)) save(rules.filter(x => x.id !== r.id)) }} />
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <label><input type="checkbox" checked={settings.learnRules !== false} onChange={e => guarded(() => saveSettings({ learnRules: e.target.checked }))} disabled={!canEdit} /> Learn a rule whenever I set a category by hand</label>
        <span className="note" style={{ margin: 0 }}>{Object.keys(settings.finmail?.rules || {}).length} remembered email payees are also used (Email → review).</span>
      </div>
      <Note>Order of precedence when a transaction has no category: your rules → payees remembered from email review → the category you used most for that merchant before (2+ times). Nothing already categorized is changed unless you re-run the rules from this page. A rule can also add tags, flag matches for review (they show on the Dashboard and under #review in the ledger) and count matches toward a goal (a contribution is logged for each).</Note>
    </Card>
  </div>
}

/** Security Center: two-factor (TOTP), sessions, password, what is stored, observability counters. */
function SecurityTab() {
  const { data, settings, mode, user, guarded, updatePassword, signOut } = useData(); const confirm = useConfirm(); const toast = useStore.getState().toast
  type Factor = { id: string; friendly_name?: string; status: string; created_at: string; factor_type: string }
  const [factors, setFactors] = useState<Factor[]>([]); const [enrol, setEnrol] = useState<{ id: string; qr: string; secret: string } | null>(null); const [code, setCode] = useState(''); const [aal, setAal] = useState<string>('')
  const [pw1, setPw1] = useState(''); const [pw2, setPw2] = useState('')
  const live = mode === 'db' && hasSupabase()
  const load = async () => { if (!live) return; const { data: f } = await sb().auth.mfa.listFactors(); setFactors((f?.totp || []) as Factor[]); const { data: a } = await sb().auth.mfa.getAuthenticatorAssuranceLevel(); setAal(a?.currentLevel || '') }
  useEffect(() => { load() /* eslint-disable-line */ }, [live])
  const startEnrol = () => guarded(async () => { const { data: e, error } = await sb().auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Cresari authenticator' }); if (error) throw error; setEnrol({ id: e.id, qr: e.totp.qr_code, secret: e.totp.secret }); setCode('') })
  const finishEnrol = () => guarded(async () => { if (!enrol) return; const { error } = await sb().auth.mfa.challengeAndVerify({ factorId: enrol.id, code: code.replace(/\s+/g, '') }); if (error) throw error; setEnrol(null); setCode(''); await load() }, 'Two-factor authentication is on')
  const cancelEnrol = () => guarded(async () => { if (enrol) await sb().auth.mfa.unenroll({ factorId: enrol.id }); setEnrol(null); await load() })
  const remove = (f: Factor) => guarded(async () => { if (!(await confirm('Turn off two-factor authentication? Anyone with your password could then sign in.'))) return; const { error } = await sb().auth.mfa.unenroll({ factorId: f.id }); if (error) throw error; await load() }, 'Two-factor authentication is off')
  const signOutOthers = () => guarded(async () => { const { error } = await sb().auth.signOut({ scope: 'others' }); if (error) throw error }, 'Other devices were signed out')
  const signOutAll = () => guarded(async () => { if (!(await confirm('Sign out everywhere, including here?'))) return; await sb().auth.signOut({ scope: 'global' }); await signOut() })
  const changePw = () => { const probs = passwordProblems(pw1, { email: user?.email, confirm: pw2 }); if (probs.length) return toast('The new password needs to be: ' + probs.join(', '), true); guarded(async () => { await updatePassword(pw1); setPw1(''); setPw2('') }, 'Password changed') }
  const verified = factors.filter(f => f.status === 'verified')
  const imports = settings.imports || []; const actions = data.activity.length; const emailApplied = data.emailLedger.filter(e => e.decision === 'applied').length, emailIgnored = data.emailLedger.filter(e => e.decision === 'ignored').length
  const stored: Array<[string, string]> = [['Your sign-in', `${user?.email || '—'} — the sign-in service keeps your password only in a scrambled, one-way form that nobody can read back`], ['Gmail', settings.gmail?.clientId ? `set up${settings.gmail.account ? ` for ${settings.gmail.account}` : ''}` : 'not set up'], ['Outlook', settings.outlook?.clientId ? `set up${settings.outlook.account ? ` for ${settings.outlook.account}` : ''}` : 'not set up'], ['Mailbox access', 'read-only, only while this tab is open, and never saved'], ['Account numbers', `the last 4 digits only (${data.accounts.filter(a => a.last4).length} accounts)`], ['Emails', 'never kept — only the amount, date and payee of each one you file, and a note that it was read'], ['Who can see it', 'the members of this household, each with the access an owner gave them; it is encrypted where it is stored and on its way to you']]
  if (!live) return <div className="grid g12"><Card span={12} title="Security"><Note>Security settings apply to a real account. The offline demo has no sign-in.</Note></Card></div>
  return <div className="grid g12">
    <Card span={6} title="Two-factor authentication (TOTP)" hint="an authenticator app code at every sign-in" right={verified.length ? <Pill cls="good">on · AAL {aal || '—'}</Pill> : <Pill cls="warn">off</Pill>}>
      {verified.map(f => <div key={f.id} className="banner good" style={{ marginBottom: 8 }}><b>{f.friendly_name || 'Authenticator'}</b> · enrolled {fmtDY(f.created_at.slice(0, 10))} <Btn sm danger onClick={() => remove(f)}>Turn off</Btn></div>)}
      {!enrol && !verified.length && <><Note>Works with Google Authenticator, Microsoft Authenticator, 1Password, Authy or any TOTP app. Once on, the app asks for the 6-digit code after your password.</Note><Btn primary onClick={startEnrol}>Set up two-factor</Btn></>}
      {enrol && <div><p className="note" style={{ marginTop: 0 }}>Scan this with your authenticator app, then enter the code it shows.</p><img src={enrol.qr} alt="TOTP QR code" style={{ width: 180, height: 180, background: '#fff', borderRadius: 8, padding: 6 }} /><div className="note">Can't scan? Secret: <code style={{ userSelect: 'all' }}>{enrol.secret}</code></div>
        <Field label="6-digit code"><input className="inp" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} style={{ maxWidth: 160 }} /></Field><div className="btnrow"><Btn primary onClick={finishEnrol} disabled={code.replace(/\D/g, '').length < 6}>Verify & turn on</Btn><Btn onClick={cancelEnrol}>Cancel</Btn></div></div>}
    </Card>
    <Passkeys />
    <RecoveryCodes hasTotp={verified.length > 0} />
    <Devices onSignOutOthers={signOutOthers} onSignOutAll={signOutAll} />
    <Card span={6} title="Password & idle lock">
      <h3 style={{ margin: '0 0 6px' }}>Change password</h3>
      <div className="grid2"><Field label="New password" hint="8+ characters"><PasswordInput autoComplete="new-password" value={pw1} onChange={e => setPw1(e.target.value)} /></Field><Field label="Repeat"><PasswordInput autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} /></Field></div>
      <Btn primary onClick={changePw} disabled={!pw1}>Update password</Btn>
      <h3 style={{ margin: '16px 0 6px' }}>Lock this device when idle</h3>
      <IdleChoice />
    </Card>
    <Card span={6} title="What is stored, and where" hint="what Cresari keeps about you, and who can see it">
      <div className="tblwrap"><table className="tbl"><tbody>{stored.map(([k, v]) => <tr key={k}><td style={{ color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{k}</td><td>{v}</td></tr>)}</tbody></table></div>
    </Card>
    <Card span={6} title="Activity at a glance" hint="what has been recorded for this household">
      <div className="kpis"><KPIs items={[['Changes recorded', String(actions), 'in the activity log, which cannot be edited'], ['Statement imports', String(imports.length), `${imports.reduce((a, i) => a + i.added, 0)} rows added · ${imports.reduce((a, i) => a + i.skipped, 0)} skipped`], ['Email items reviewed', String(emailApplied + emailIgnored), `${emailApplied} applied · ${emailIgnored} ignored`], ['Last loaded', useStore.getState().lastRefresh ? ago(useStore.getState().lastRefresh!) : '—', 'when this device last loaded the household (not the bank feed)']]} /></div>
      <Note>Every insert, update and delete on household data is written to the activity log by a database trigger — including balance edits, goal changes and import batches — and cannot be edited from the app.</Note>
    </Card>
    <ErrorsPanel />
    <DeleteAccountCard />
  </div>
}
function KPIs({ items }: { items: Array<[string, string, string]> }) { return <>{items.map(([l, v, s]) => <div key={l} className="kpi info"><div className="l">{l}</div><div className="v">{v}</div><div className="s">{s}</div></div>)}</> }

// ---------------- Members: who is in the household and what each can see ----------------
type AccessPick = { level: AccessLevel; modules: string[]; editWithin: boolean }
const pickFrom = (m: { role: Role; read_only: boolean; modules?: string[] | null }): AccessPick => { const lv = accessLevel({ role: m.role, read_only: m.read_only, modules: m.modules ?? null }); return { level: lv, modules: normaliseModules(m.modules) || [], editWithin: canEditAccess({ role: m.role, read_only: m.read_only, modules: m.modules ?? null }) } }
function AccessPicker({ v, onChange, allowOwner }: { v: AccessPick; onChange: (p: AccessPick) => void; allowOwner?: boolean }) {
  const opts: Array<[AccessLevel, string]> = [['full', 'Full'], ['readonly', 'Read-only'], ['limited', 'Limited'], ...(allowOwner ? [['owner', 'Owner'] as [AccessLevel, string]] : [])]
  return <>
    <Field label="Access"><Seg value={v.level} options={opts} onChange={level => onChange({ ...v, level })} /></Field>
    <Note>{describeAccess(accessToMember(v.level, v.modules, v.editWithin))}</Note>
    {v.level === 'limited' && <div style={{ marginTop: 8 }}>
      <div className="note" style={{ marginTop: 0 }}>Sections this person can open (Dashboard, Reports and Settings are always available and show only what they can see):</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '4px 12px', margin: '6px 0 10px' }}>{GRANTABLE.map(m => <label key={m.k} title={m.hint}><input type="checkbox" checked={v.modules.includes(m.k)} onChange={e => onChange({ ...v, modules: e.target.checked ? [...v.modules, m.k] : v.modules.filter(k => k !== m.k) })} /> {m.label}</label>)}</div>
      <label><input type="checkbox" checked={v.editWithin} onChange={e => onChange({ ...v, editWithin: e.target.checked })} /> Can add and change things in those sections (otherwise read-only)</label>
    </div>}
  </>
}
function MembersTab() {
  const { data, household, guarded, isOwner, repo, refresh, mode, user } = useData(); const confirm = useConfirm(); const { open, close } = useModal()
  const [email, setEmail] = useState(''); const [dname, setDname] = useState(''); const [note, setNote] = useState(''); const [pick, setPick] = useState<AccessPick>({ level: 'readonly', modules: [], editWithin: false }); const [busy, setBusy] = useState(false)
  const siteUrl = (import.meta.env.VITE_SITE_URL as string | undefined) || publicUrl()
  const inviter = mode === 'demo' ? 'The demo household' : (user?.email || 'A household owner')
  const access = accessToMember(pick.level, pick.modules, pick.editWithin)
  const draft = inviteEmailDraft({ appName: APP_NAME, household: household?.name || 'Household', inviter, email: email.trim().toLowerCase(), displayName: dname, access, siteUrl, note })
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && (pick.level !== 'limited' || pick.modules.length > 0) && email.trim().toLowerCase() !== (user?.email || '').toLowerCase()
  const showResult = (r: InviteResult, to: string, dn: string, a: typeof access, n: string) => {
    const d = inviteEmailDraft({ appName: APP_NAME, household: household?.name || 'Household', inviter, email: to, displayName: dn, access: a, siteUrl, note: n, })
    const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => useStore.getState().toast('Copied'))
    open(<><MHead title="Invitation ready" /><MBody>
      {r.sent ? <div className="msg good">The invitation was emailed to {to}.</div> : r.send_error ? <div className="msg warn">Automatic email failed ({r.send_error}) — send it yourself below.</div> : <div className="msg info">{r.can_send ? 'Send the invitation below.' : 'Automatic sending is not set up, so send this email yourself — copy it or open it in your email app.'}</div>}
      <Note>{to} joins the household the next time they sign in with that address — or as soon as they sign up with it and confirm it. Until then they are listed under Waiting to sign up.</Note>
      <div className="field"><label>Subject</label><input className="inp" readOnly value={d.subject} /></div>
      <div className="field"><label>Message</label><textarea className="inp" readOnly rows={14} value={d.body} style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }} /></div>
    </MBody><MFoot><Btn onClick={() => copy(`Subject: ${d.subject}\n\n${d.body}`)}>Copy email</Btn><a className="btn primary" href={mailtoLink(to, d.subject, d.body)}>Open in email app</a><Btn onClick={close}>Done</Btn></MFoot></>)
  }
  const invite = async () => {
    if (!valid || !repo) return; setBusy(true)
    const to = email.trim().toLowerCase(), dn = dname.trim(), a = access, n = note
    try { const r = await repo.inviteWithPassword({ email: to, display_name: dn || null, role: a.role, read_only: a.read_only, modules: a.modules, note: n, send: true }); setEmail(''); setDname(''); setNote(''); await refresh(); showResult(r, to, dn, a, n) }
    catch (e) { useStore.getState().toast((e as Error).message, true) } finally { setBusy(false) }
  }
  const editAccess = (m: Member) => { let p = pickFrom(m); const Body = () => { const [v, setV] = useState(p); return <><MHead title={`Access for ${m.email}`} /><MBody><AccessPicker v={v} onChange={x => { p = x; setV(x) }} allowOwner /></MBody><MFoot><Btn onClick={close}>Cancel</Btn><Btn primary onClick={() => { const a = accessToMember(p.level, p.modules, p.editWithin); if (p.level === 'limited' && !p.modules.length) { useStore.getState().toast('Pick at least one section', true); return } close(); guarded(() => repo!.setMemberAccess(m.user_id, a.role, a.read_only, a.modules).then(refresh), 'Access updated') }}>Save</Btn></MFoot></> }; open(<Body />) }
  const lvCls: Record<AccessLevel, string> = { owner: 'good', full: 'info', readonly: 'idle', limited: 'warn' }
  return <div className="grid g12">
    <Card span={7} title="Members" hint="what each person can see and change — owners manage members, settings and categories"><div className="tblwrap"><table className="tbl"><thead><tr><th>Who</th><th>Access</th><th>Last seen</th><th></th></tr></thead><tbody>{data.members.map(m => { const lv = accessLevel({ role: m.role, read_only: m.read_only, modules: m.modules ?? null }); const me = m.user_id === user?.id
      return <tr key={m.user_id}><td>{m.display_name ? <><b>{m.display_name}</b><br /></> : null}{m.email}{me ? ' (you)' : ''}</td><td><Pill cls={lvCls[lv]}>{ACCESS_LABEL[lv]}</Pill>{lv === 'limited' && <div className="note" style={{ margin: '3px 0 0' }}>{describeAccess({ role: m.role, read_only: m.read_only, modules: m.modules ?? null }).replace(/^Limited — /, '')}</div>}</td><td>{m.last_seen_at ? fmtDY(m.last_seen_at.slice(0, 10)) : '—'}{m.last_version ? ` · v${m.last_version}` : ''}</td>
        <td style={{ whiteSpace: 'nowrap' }}>{isOwner && !me && <><Btn sm onClick={() => editAccess(m)}>Change</Btn> <button type="button" className="del" title="Remove from household" onClick={async () => { if (await confirm(`Remove ${m.email} from this household? Their sign-in stays; they just lose access here.`, 'Remove')) guarded(() => repo!.removeMember(m.user_id).then(refresh), 'Removed') }}>✕</button></>}</td></tr> })}</tbody></table></div>
      {data.invites.filter(i => !i.accepted_at).length > 0 && <Note>Waiting to sign up: {data.invites.filter(i => !i.accepted_at).map(i => `${i.email} (${ACCESS_LABEL[accessLevel({ role: i.role, read_only: !!i.read_only, modules: i.modules ?? null })]})`).join(', ')}</Note>}</Card>
    <Card span={5} title="Invite someone" hint="records the invitation and drafts the email — they join by signing in with that address">{isOwner ? <>
      <Field label="Email"><input className="inp" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" /></Field>
      <Field label="Name (optional)"><input className="inp" value={dname} onChange={e => setDname(e.target.value)} placeholder="how the email greets them" /></Field>
      <AccessPicker v={pick} onChange={setPick} />
      <Field label="Personal note (optional)"><textarea className="inp" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="added to the end of the email" /></Field>
      <Btn primary onClick={invite} disabled={!valid || busy}>{busy ? 'Inviting…' : 'Invite & draft email'}</Btn>
      <Note>They join the next time they sign in to {APP_NAME} with that address. Someone new signs up with it first — signing up asks them to confirm the address, which is what proves it is theirs.{mode === 'demo' ? ' In the demo nobody is emailed.' : ''}</Note>
      <details style={{ marginTop: 8 }}><summary className="note" style={{ cursor: 'pointer', marginTop: 0 }}>Preview the email</summary><pre className="note" style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)', fontSize: 12 }}>{`Subject: ${draft.subject}\n\n${draft.body}`}</pre></details>
    </> : <Note>Only owners can invite people or change access.</Note>}</Card>
  </div>
}

/** Recent uncaught errors for this household (app_errors, migration 0009): what failed, where, in which build. */
function ErrorsPanel() {
  const { mode, household } = useData(); type Row = { id: string; at: string; source: string; version: string | null; message: string; stack: string | null; url: string | null; context: Record<string, unknown> }
  const [rows, setRows] = useState<Row[] | null>(null); const [err, setErr] = useState(''); const [open, setOpen] = useState<string | null>(null)
  const load = async () => { if (mode !== 'db' || !household) return; const { data, error } = await sb().from('app_errors').select('id, at, source, version, message, stack, url, context').eq('household_id', household.id).order('at', { ascending: false }).limit(50); if (error) { setErr(/app_errors/.test(error.message) ? 'Error records are not available for this household yet.' : error.message); return } setRows((data || []) as Row[]) }
  useEffect(() => { void load() }, [mode, household?.id])   // eslint-disable-line react-hooks/exhaustive-deps
  if (mode !== 'db') return null
  return <Card span={6} title="Errors" hint="uncaught errors from the app, the bank sync and the nightly backup — last 50, kept 90 days" right={<Btn sm onClick={load}>Refresh</Btn>}>
    {err && <div className="msg warn">{err}</div>}
    {rows && rows.length === 0 && <div className="empty">No errors recorded.</div>}
    {rows && rows.length > 0 && <div className="tblwrap" style={{ maxHeight: 320 }}><table className="tbl"><caption className="sr-only">Recent errors</caption><thead><tr><th>When</th><th>Source</th><th>Version</th><th>Message</th></tr></thead><tbody>
      {rows.map(r => <tr key={r.id} onClick={() => setOpen(open === r.id ? null : r.id)} style={{ cursor: 'pointer' }}><td style={{ whiteSpace: 'nowrap' }}>{fmtDT(r.at)}</td><td><Pill cls={r.source === 'browser' ? 'info' : 'warn'}>{r.source}</Pill></td><td className="id">{r.version || '—'}</td><td>{r.message}{open === r.id && <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: 'var(--ink-3)', margin: '6px 0 0' }}>{r.url}{'\n'}{r.stack || ''}{'\n'}{JSON.stringify(r.context)}</pre>}</td></tr>)}
    </tbody></table></div>}
    <Note>Click a row for the technical details to pass on to support. Errors are the app's own messages only — never transaction data. Reporting is capped at 20 per session.</Note>
  </Card>
}
/** Nightly backups (migration 0009): list the last 30 days in the private backups bucket, download one, or back up now. */
function NightlyBackups() {
  const { mode, household, guarded, canEdit } = useData(); const limited = useStore(st => st.role !== 'owner' && !!st.modules); type F = { name: string; updated_at?: string; metadata?: { size?: number } }
  const [files, setFiles] = useState<F[] | null>(null); const [err, setErr] = useState('')
  const load = async () => { if (mode !== 'db' || !household) return; const { data, error } = await sb().storage.from('backups').list(household.id, { limit: 60, sortBy: { column: 'name', order: 'desc' } }); if (error) { setErr(/not found|bucket/i.test(error.message) ? 'Nightly backups are not switched on for this household yet.' : error.message); return } setFiles((data || []).filter(f => f.name.endsWith('.json')) as F[]) }
  useEffect(() => { if (!limited) void load() }, [mode, household?.id, limited])   // eslint-disable-line react-hooks/exhaustive-deps
  const download = (name: string) => guarded(async () => { const { data, error } = await sb().storage.from('backups').download(`${household!.id}/${name}`); if (error) throw error; await saveFile(`cresari-backup-${name}`, data, 'application/json') })
  const now = () => guarded(async () => { const { data, error } = await sb().functions.invoke('backup-household', { body: { action: 'backup', household_id: household!.id } }); if (error) throw error; if (!data?.ok) throw new Error(data?.message || 'Backup failed'); await load() }, 'Backed up')
  if (mode !== 'db') return null
  // a backup holds every section, so members limited to some sections do not get one (the database enforces it too — 0.25.1)
  if (limited) return <Card span={6} title="Nightly backups" hint="automatic every night, kept 30 days, private to this household"><Note>Nightly backups hold the whole household, so they are available to owners and members with full access.</Note></Card>
  return <Card span={6} title="Nightly backups" hint="automatic every night, kept 30 days, private to this household" right={canEdit ? <Btn sm primary onClick={now}>Back up now</Btn> : undefined}>
    {err && <div className="msg warn">{err}</div>}
    {files && files.length === 0 && <div className="empty">No backups yet — the first one is taken tonight.</div>}
    {files && files.length > 0 && <div className="tblwrap" style={{ maxHeight: 240 }}><table className="tbl"><caption className="sr-only">Backups</caption><thead><tr><th>Date</th><th className="num">Size</th><th /></tr></thead><tbody>
      {files.map(f => <tr key={f.name}><td>{f.name.replace('.json', '')}</td><td className="num">{f.metadata?.size ? Math.round(f.metadata.size / 1024) + ' KB' : '—'}</td><td><Btn sm onClick={() => download(f.name)}>Download</Btn></td></tr>)}
    </tbody></table></div>}
    <Note>A backup is the same file as Download JSON backup above and loads back through Restore. Backups are kept in this household's private, encrypted online storage; only owners and members with full access can download them, and nobody can change them from the app.</Note>
  </Card>
}

const b64ToBytes = (b64: string) => { const pad = '='.repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, c => c.charCodeAt(0)) }
/** Settings → Notifications (0.19.0): push on this device, email, which rules fire, the weekly digest, a test button, what was sent. */
function NotificationsTab() {
  const { data, settings, mode, household, user, guarded, saveSettings, isOwner, modules } = useData(); const canEdit = isOwner /* 0.25.1: the household alert settings are the owners' (the database enforces it) */; const toast = useStore.getState().toast
  const limited = !isOwner && modules != null   // 0.25.1: Limited access gets only the deletion notice, and the notify function refuses its test
  const prefs: NotifyPrefs = { push: true, email: false, digest: true, ...NOTIFY_DEFAULTS, ...(settings.notify || {}) }
  const set = (patch: Partial<NotifyPrefs>) => guarded(() => saveSettings({ notify: { ...prefs, ...patch } }), 'Saved')
  const [sub, setSub] = useState<'checking' | 'on' | 'off' | 'unsupported' | 'denied'>('checking'); const [recent, setRecent] = useState<Array<{ id: string; at: string; kind: string; title: string; channel: string; status: string; detail: string | null }> | null>(null)
  const [preview, setPreview] = useState<Alert[] | null>(null)
  const supported = webPushAvailable()
  const reg = async () => (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.ready)
  const check = async () => { if (!supported) return setSub('unsupported'); if (Notification.permission === 'denied') return setSub('denied'); try { const r = await reg(); const s = await r.pushManager.getSubscription(); setSub(s ? 'on' : 'off') } catch { setSub('off') } }
  const loadRecent = async () => { if (mode !== 'db' || !household) return; const { data: rows } = await sb().from('notifications').select('id, at, kind, title, channel, status, detail').eq('household_id', household.id).order('at', { ascending: false }).limit(25); setRecent((rows || []) as typeof recent) }
  useEffect(() => { void check(); void loadRecent() }, [mode, household?.id])   // eslint-disable-line react-hooks/exhaustive-deps
  const enablePush = () => guarded(async () => {
    if (!supported) throw new Error('This browser does not support push notifications'); if (mode !== 'db' || !household || !user) throw new Error('Sign in to a household first')
    const perm = await Notification.requestPermission(); if (perm !== 'granted') { setSub(perm === 'denied' ? 'denied' : 'off'); throw new Error('Notifications were not allowed in the browser') }
    const { data: meta } = await sb().from('app_meta').select('value').eq('key', 'vapid_public').maybeSingle(); if (!meta?.value) throw new Error('Push is not set up on the server yet (vapid_public missing)')
    const r = await reg(); const s = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(meta.value) }); const j = s.toJSON()
    const { error } = await sb().from('push_subscriptions').upsert({ household_id: household.id, user_id: user.id, endpoint: s.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, user_agent: navigator.userAgent.slice(0, 200) }, { onConflict: 'endpoint' }); if (error) throw new Error(/push_subscriptions/.test(error.message) ? 'Push needs migration 0011' : error.message)
    setSub('on'); if (prefs.push === false) await saveSettings({ notify: { ...prefs, push: true } }) }, 'Push notifications are on for this device')
  const disablePush = () => guarded(async () => { const r = await reg(); const s = await r.pushManager.getSubscription(); if (s) { await sb().from('push_subscriptions').delete().eq('endpoint', s.endpoint); await s.unsubscribe() } setSub('off') }, 'Push is off on this device')
  const test = () => guarded(async () => { const { data: r, error } = await sb().functions.invoke('notify', { body: { action: 'test', household_id: household!.id } }); if (error) throw error; toast(`Push: ${r.push.sent ? 'sent to ' + r.push.sent + ' device(s)' : r.push.detail} · Email: ${r.email.detail}`, !r.push.sent && !r.email.ok); await loadRecent() })
  const runPreview = () => guarded(async () => { const t = today(); const alerts = computeAlerts({ today: t, now: new Date().toISOString(), accounts: data.accounts, recurring: data.recurring, occurrences: data.occurrences, transactions: data.transactions, paySchedules: data.paySchedules, sync: null, reserveFloor: +settings.reserveFloor || 0, includeRetirementInCash: !!settings.includeRetirementInCash, prefs }); setPreview(alerts) })
  const Toggle = ({ k, label, hint }: { k: keyof NotifyPrefs; label: string; hint?: string }) => <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 0', cursor: 'pointer' }}><input type="checkbox" checked={!!prefs[k]} onChange={e => set({ [k]: e.target.checked } as Partial<NotifyPrefs>)} disabled={!canEdit} className="cb-top" /><span><b style={{ fontWeight: 500 }}>{label}</b>{hint && <span className="note" style={{ display: 'block', margin: 0 }}>{hint}</span>}</span></label>
  return <div className="grid g12">
    {isNative() ? <PhoneReminders /> : <Card span={6} title="Push notifications" hint="to this phone or computer, even when the app is closed" right={<Pill cls={sub === 'on' ? 'good' : sub === 'denied' ? 'crit' : 'idle'}>{sub === 'checking' ? '…' : sub === 'on' ? 'on here' : sub === 'denied' ? 'blocked' : sub === 'unsupported' ? 'not supported' : 'off here'}</Pill>}>
      {mode !== 'db' ? <Note>Push and email alerts work for a signed-in household; the offline demo only shows the rules below.</Note> : <>
        <div className="btnrow">{sub === 'on' ? <Btn onClick={disablePush}>Turn off on this device</Btn> : <Btn primary onClick={enablePush} disabled={sub === 'unsupported' || sub === 'denied'}>Enable on this device</Btn>}<Btn onClick={test} disabled={limited || (sub !== 'on' && !prefs.email)}>Send a test</Btn></div>
        {limited && <Note>With Limited access you get only the notice if the household is scheduled for deletion: other alerts and the Monday digest show money from sections you cannot open, so there is no test to send.</Note>}
        {sub === 'denied' && <div className="msg warn" style={{ marginTop: 8 }}>Notifications are blocked for this site in the browser settings — allow them there, then try again.</div>}
        {sub === 'unsupported' && <div className="msg warn" style={{ marginTop: 8 }}>On iPhone, install the app first (Share → Add to Home Screen) and open it from the home screen; push works from the installed app on iOS 16.4 and later.</div>}
        <Note>Alerts are checked every morning at 7:30 am Eastern (8:30 am during daylight saving time). Each device opts in separately; turn one off here or in the browser.</Note></>}
    </Card>}
    <Card span={6} title="Email" hint="the same alerts and the Monday digest by email">
      <Toggle k="email" label="Email me" hint={prefs.email_to || user?.email ? `to ${prefs.email_to || user?.email}` : 'set an address below'} />
      <Field label="Send to" hint="leave blank for the household owner's address"><input className="inp" type="email" defaultValue={prefs.email_to || ''} placeholder={user?.email || 'you@example.com'} onBlur={e => { const v = e.target.value.trim() || null; if (v !== (prefs.email_to || null)) set({ email_to: v }) }} disabled={!canEdit} /></Field>
      <Note>Email needs the Resend key on the server (Settings → Security → Errors shows "email not configured" until it is there). Push works without it.</Note>
    </Card>
    <Card span={6} title="What to alert on" hint="each rule has a stable key, so the same thing is never sent twice">
      <Toggle k="bills" label="Bills due today or tomorrow, and anything overdue" hint="overdue items repeat every 3 days until paid; autopay items are informational" />
      <Toggle k="low_cash" label="Cash below the reserve floor, or bills this week exceed cash" hint={`floor ${fmtMoney(settings.reserveFloor || 0)} — change it under General`} />
      <label style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0' }}><input type="checkbox" checked={!!prefs.large} onChange={e => set({ large: e.target.checked ? NOTIFY_DEFAULTS.large : 0 })} disabled={!canEdit} /><span><b style={{ fontWeight: 500 }}>Large charges at or above</b></span><input className="inp" inputMode="decimal" style={{ width: 110 }} defaultValue={prefs.large || ''} onBlur={e => { const v = parseNum(e.target.value) || 0; if (v !== (prefs.large || 0)) set({ large: v }) }} disabled={!canEdit || !prefs.large} aria-label="Large charge threshold" /></label>
      <Toggle k="paycheck" label="A paycheck that did not arrive on its pay date" />
      <Toggle k="sync" label="Bank sync failed, or no sync for 3 days" />
      <Toggle k="price_rise" label="A bill or subscription charged more than usual" hint="more than $1 and 5% over the amount on the Bills page" />
      <Toggle k="new_recurring" label="A new repeating charge" hint="the same merchant three months running at a similar amount, not yet on the Bills page" />
      <Toggle k="reconcile" label="An account is due for reconciling" hint="5 weeks since the last reconciliation, repeated weekly" />
      <Toggle k="revalue" label="A property or vehicle value is a quarter old" hint="once each quarter until you type a new value on Accounts" />
      <Toggle k="digest" label="Monday digest: the week ahead, last week's spending, what is overdue" hint="email, plus a short push" />
      <div className="btnrow" style={{ marginTop: 8 }}><Btn sm onClick={runPreview}>Preview today's alerts</Btn></div>
      {preview && (preview.length === 0 ? <div className="msg good" style={{ marginTop: 8 }}>Nothing would be sent right now.</div> : <ul className="alist" style={{ marginTop: 8 }}>{preview.map(a => <li key={a.key}><span className={`dot ${a.severity}`} /><span><span className="t">{a.title}</span><div className="m">{a.body}</div></span></li>)}</ul>)}
    </Card>
    <Card span={6} title="Sent recently" hint="the last 25 — push and email, with why one was skipped" right={mode === 'db' ? <Btn sm onClick={loadRecent}>Refresh</Btn> : undefined}>
      {mode !== 'db' ? <div className="empty">Sign in to see the log.</div> : !recent ? <div className="empty">Loading…</div> : recent.length === 0 ? <div className="empty">Nothing sent yet.</div> : <div className="tblwrap" style={{ maxHeight: 320 }}><table className="tbl"><caption className="sr-only">Notifications</caption><thead><tr><th scope="col">When</th><th scope="col">Channel</th><th scope="col">Status</th><th scope="col">What</th></tr></thead><tbody>
        {recent.map(r => <tr key={r.id}><td style={{ whiteSpace: 'nowrap' }}>{fmtDT(r.at)}</td><td>{r.channel}</td><td><Pill cls={r.status === 'sent' ? 'good' : r.status === 'failed' ? 'crit' : 'idle'}>{r.status}</Pill></td><td>{r.title}{r.status !== 'sent' && r.detail ? <div className="note" style={{ margin: 0 }}>{r.detail}</div> : null}</td></tr>)}
      </tbody></table></div>}
    </Card>
    <MemberRouting prefs={prefs} />
  </div>
}

/** This device (0.23.0): the number and date format and privacy mode — stored in this browser, like the theme. */
/** The phone apps (0.25.1): bill reminders scheduled on the phone itself (see src/app/nativeReminders.ts). */
function PhoneReminders() {
  const data = useStore(s => s.data); const [on, setOn] = useState(remindersOn()); const [n, setN] = useState<number | null>(null); const [msg, setMsg] = useState('')
  useEffect(() => { if (on) void rescheduleReminders(data).then(setN) }, [on, data])
  const toggle = async (v: boolean) => { const r = await setReminders(v, data); setOn(r === 'on'); setMsg(r === 'denied' ? 'Notifications are turned off for Cresari in this phone\'s Settings. Allow them there, then turn this on again.' : ''); setN(r === 'on' ? await rescheduleReminders(data) : null) }
  return <Card span={6} title="Reminders on this phone" hint="bill reminders from the phone itself, even with no connection" right={<Pill cls={on ? 'good' : 'idle'}>{on ? 'on' : 'off'}</Pill>}>
    <label style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', cursor: 'pointer', minHeight: 44 }}><input type="checkbox" checked={on} onChange={e => void toggle(e.target.checked)} /><span><b style={{ fontWeight: 500 }}>Remind me about bills on this phone</b></span></label>
    {msg && <div className="msg warn" role="alert" style={{ marginTop: 8 }}>{msg}</div>}
    {on && n != null && <Note>{n ? `${n} reminder${n === 1 ? '' : 's'} scheduled for the next five weeks.` : 'Nothing due in the next five weeks needs a reminder.'}</Note>}
    <Note>Each reminder arrives at 9 AM: as many days before each bill as its Remind (days) column on Bills says (3 unless you change it), and again on the due day. Bills already paid are skipped, and the list is redone whenever bills or payments change. Low cash, large charges and bank-sync problems still come by email when Email me is on.</Note>
  </Card>
}

function DeviceDisplay() {
  const { settings, saveSettings, guarded, canEdit } = useData()
  const [loc, setLoc] = useState(localePreference()); const [priv, setPriv] = useState(privacyOn()); const [offline, setOffline] = useState(offlineCopyOn())
  const sample = `${fm2(1234567.89)} · ${fmtNum(1234.5, 1)} · ${fmtDY(today())}`
  return <Card span={6} title="This device" hint="saved in this browser only">
    <Field label="Numbers and dates" hint={`now: ${sample}`}><select className="inp" value={loc} onChange={e => { setLoc(e.target.value); setLocale(e.target.value) }} aria-label="Number and date format">{LOCALES.map(([v, l]) => <option key={v} value={v}>{l}{v === 'auto' ? ` (${resolvedLocale()})` : ''}</option>)}</select></Field>
    <label className="gm-ign" style={{ fontSize: 13, display: 'block', marginTop: 8 }}><input type="checkbox" checked={priv} onChange={e => { setPriv(e.target.checked); setPrivacy(e.target.checked) }} /> Privacy mode — hide amounts on screen (keyboard <kbd>H</kbd>); exports keep real figures</label>
    <label className="gm-ign" style={{ fontSize: 13, display: 'block', marginTop: 8 }}><input type="checkbox" checked={offline} onChange={e => { setOffline(e.target.checked); setOfflineCopy(e.target.checked) }} /> Keep a read-only copy for offline use — the app opens with your data when there is no connection. Turn off on a shared computer; signing out always clears it.</label>
    {settings.setupDismissed && canEdit && <div style={{ marginTop: 8 }}><Btn sm onClick={() => guarded(() => saveSettings({ setupDismissed: false }), 'The checklist is back on the Dashboard')}>Show the getting-started checklist again</Btn></div>}
    <Note>Amounts stay in US dollars; the format changes how they are written (1,234.56 or 1.234,56) and how dates read. Typing "12,5" counts as 12.5 where the comma is the decimal mark.</Note></Card>
}
const ALERT_KINDS: Array<[string, string]> = [['bill_due', 'Bills due'], ['bill_overdue', 'Overdue bills'], ['low_cash', 'Low cash'], ['large_charge', 'Large charges'], ['paycheck', 'Missed paychecks'], ['sync', 'Bank sync'], ['price_rise', 'Price rises'], ['new_recurring', 'New repeating charges'], ['reconcile', 'Reconcile reminders'], ['revalue', 'Property & vehicle values']]
/** Who gets what (0.21.0): per member, push to their devices, email to their own address, the Monday digest, and which alerts.
 *  Unset rows follow the household switches above; when nobody picks email for themselves, the household address gets it. */
function MemberRouting({ prefs }: { prefs: NotifyPrefs }) {
  const { data, guarded, saveMemberNotify, canEdit, isOwner, user } = useData(); const members = data.members
  const mm = prefs.members || {}
  // one member's row onto the stored settings, nothing else (0.25.1): an editor may save their own row, and the screen's defaults stay unsaved
  const setM = (uid: string, patch: Partial<MemberNotify>) => guarded(() => saveMemberNotify(uid, patch), 'Saved')
  const reset = (uid: string) => guarded(() => saveMemberNotify(uid, null), 'Back to the household default')
  return <Card span={12} title="Who gets what" hint="each member's own channels · unset rows follow the household switches">
    {!members.length ? <div className="empty">Members appear here once the household has them (Settings → Members).</div> : <div className="tblwrap"><table className="tbl"><caption className="sr-only">Notification routing by member</caption><thead><tr><th scope="col">Member</th><th scope="col">Push</th><th scope="col">Email</th><th scope="col">Email to</th><th scope="col">Monday digest</th><th scope="col">Alerts</th><th scope="col" /></tr></thead><tbody>
      {members.map(m => { const p = mm[m.user_id] || {}; const custom = !!mm[m.user_id]; const kinds = p.kinds || null; const who = m.display_name || m.email; const rowEdit = isOwner || (canEdit && m.user_id === user?.id)   // owners set anyone's; others only their own (0.25.1)
        return <tr key={m.user_id}><td>{who}{m.user_id === user?.id ? <span className="note" style={{ margin: 0 }}> (you)</span> : null}<div className="note" style={{ margin: 0 }}>{m.role}{custom ? '' : ' · household default'}</div></td>
          <td><input type="checkbox" checked={p.push ?? (prefs.push !== false)} onChange={e => setM(m.user_id, { push: e.target.checked })} disabled={!rowEdit} aria-label={`Push for ${who}`} /></td>
          <td><input type="checkbox" checked={p.email === true} onChange={e => setM(m.user_id, { email: e.target.checked })} disabled={!rowEdit} aria-label={`Email for ${who}`} /></td>
          <td><input className="inp" type="email" defaultValue={p.email_to || ''} placeholder={m.email} style={{ minWidth: 180 }} onBlur={e => { const v = e.target.value.trim() || null; if (v !== (p.email_to || null)) setM(m.user_id, { email_to: v }) }} disabled={!rowEdit || p.email !== true} aria-label={`Email address for ${who}`} /></td>
          <td><input type="checkbox" checked={p.digest !== false} onChange={e => setM(m.user_id, { digest: e.target.checked })} disabled={!rowEdit} aria-label={`Monday digest for ${who}`} /></td>
          <td><details><summary style={{ cursor: 'pointer' }}>{kinds ? `${kinds.length} of ${ALERT_KINDS.length}` : 'All'}</summary><div style={{ display: 'grid', gap: 2, padding: '6px 0' }}>{ALERT_KINDS.map(([k, l]) => <label key={k} style={{ fontSize: 13 }}><input type="checkbox" checked={!kinds || kinds.includes(k)} disabled={!rowEdit} onChange={e => { const cur = kinds || ALERT_KINDS.map(x => x[0]); const next = e.target.checked ? [...new Set([...cur, k])] : cur.filter(x => x !== k); setM(m.user_id, { kinds: next.length === ALERT_KINDS.length ? null : next }) }} /> {l}</label>)}</div></details></td>
          <td>{custom && canEdit && <Btn sm onClick={() => reset(m.user_id)}>Reset</Btn>}</td></tr> })}
    </tbody></table></div>}
    <Note>Push goes to every device the member turned on (each device opts in from the Push card). Email to a member goes to their own address; the household "Email me" address above is used only when no member has email on. The household switches under "What to alert on" still decide which alerts exist at all.</Note>
  </Card>
}

/** Idle-lock minutes for this device (0.20.0). Stored in this browser only: a shared computer can lock fast while your phone does not. */
function IdleChoice() {
  const { mode } = useData(); const [m, setM] = useState(() => idleMinutes(mode))
  return <><div className="btnrow" style={{ flexWrap: 'wrap', alignItems: 'center' }}><select className="inp" style={{ width: 'auto' }} value={m} onChange={e => { const n = +e.target.value; setM(n); setIdleMinutes(n) }} aria-label="Lock after">{IDLE_CHOICES.map(([v, l]) => <option key={v} value={v}>{v ? `after ${l}` : l}</option>)}</select><Btn onClick={lockNow}>🔒 Lock now</Btn></div>
    <Note>This device only. Locking hides every figure until you unlock with your password (plus the authenticator code when two-factor is on) or a passkey. The lock survives closing and reopening the tab. Keyboard: <kbd>L</kbd>.</Note></>
}

/** Passkeys (0.20.0): passwordless sign-in with the phone's or laptop's own lock — Face ID, fingerprint, Windows Hello or a security key. */
function Passkeys() {
  const { guarded } = useData(); const confirm = useConfirm()
  type PK = { id: string; friendly_name?: string; created_at: string; last_used_at?: string }
  const [list, setList] = useState<PK[] | null>(null); const [on, setOn] = useState<boolean | null>(null); const [err, setErr] = useState('')
  const supported = passkeysAvailable()
  const load = async () => { const f = await authFeatures(); setOn(f ? f.passkeys : null); if (f && !f.passkeys) { setList([]); return } const { data, error } = await sb().auth.passkey.list(); if (error) { setErr(authMessage(error)); setList([]) } else { setErr(''); setList((data || []) as PK[]) } }
  useEffect(() => { load() /* eslint-disable-line */ }, [])
  const add = () => guarded(async () => { const { error } = await sb().auth.registerPasskey(); if (error) throw new Error(authMessage(error)); await load() }, 'Passkey added — next time choose “Sign in with a passkey”')
  const rename = (p: PK, name: string) => guarded(async () => { const n = name.trim().slice(0, 120); if (!n || n === p.friendly_name) return; const { error } = await sb().auth.passkey.update({ passkeyId: p.id, friendlyName: n }); if (error) throw new Error(authMessage(error)); await load() })
  const drop = async (p: PK) => { if (!(await confirm(`Remove the passkey “${p.friendly_name || 'Passkey'}”? That device will need the password again.`, 'Remove'))) return; guarded(async () => { const { error } = await sb().auth.passkey.delete({ passkeyId: p.id }); if (error) throw new Error(authMessage(error)); await load() }, 'Passkey removed') }
  return <Card span={6} title="Passkeys" hint="sign in with Face ID, a fingerprint, Windows Hello or a security key — no password to type or steal" right={on === false ? <Pill cls="warn">off for this app</Pill> : list && list.length ? <Pill cls="good">{list.length} added</Pill> : <Pill cls="idle">none yet</Pill>}>
    {!supported && <Note>{isNative() ? 'Passkeys work on the Cresari website. In this app, unlock with Face ID or your fingerprint instead — set the lock under This device.' : 'This browser does not support passkeys.'}</Note>}
    {on === false && <div className="banner warn" style={{ marginBottom: 8 }}>Passkeys are not switched on for Cresari yet, so one cannot be added. Your password and two-factor code keep working; this card offers passkeys as soon as they are available.</div>}
    {list && list.length > 0 && <div className="tblwrap"><table className="tbl"><caption className="sr-only">Passkeys</caption><thead><tr><th scope="col">Name</th><th scope="col">Added</th><th scope="col">Last used</th><th scope="col" /></tr></thead><tbody>{list.map(p => <tr key={p.id}><td><input className="inp" defaultValue={p.friendly_name || 'Passkey'} aria-label="Passkey name" onBlur={e => rename(p, e.target.value)} style={{ maxWidth: 220 }} /></td><td>{fmtDY(p.created_at.slice(0, 10))}</td><td>{p.last_used_at ? ago(p.last_used_at) : '—'}</td><td><button type="button" className="del" onClick={() => drop(p)} aria-label={`Remove passkey ${p.friendly_name || ''}`}>✕</button></td></tr>)}</tbody></table></div>}
    {err && <div className="msg warn">{err}</div>}
    <div className="btnrow" style={{ marginTop: 8 }}><Btn primary onClick={add} disabled={!supported || on === false}>+ Add a passkey on this device</Btn></div>
    <Note>A passkey is already two factors — the device you hold and its fingerprint, face or PIN — so signing in with one skips the authenticator code. Your password and two-factor keep working on every other device.</Note>
  </Card>
}

/** Recovery codes (0.20.0): ten single-use codes for when the authenticator phone is lost. Shown once; only a count is kept afterwards. */
function RecoveryCodes({ hasTotp }: { hasTotp: boolean }) {
  const { guarded } = useData(); const confirm = useConfirm()
  const [st, setSt] = useState<{ total: number; remaining: number } | null>(null); const [codes, setCodes] = useState<string[] | null>(null); const [err, setErr] = useState('')
  const load = async () => { if (!hasTotp) return; try { const { data, error } = await sb().auth.mfa.recoveryCodes.getStatus(); if (error) { if (!/not found|no recovery/i.test(error.message)) setErr(authMessage(error)); setSt(null) } else { setErr(''); setSt(data ? { total: data.total, remaining: data.remaining } : null) } } catch (e) { setErr((e as Error).message) } }
  useEffect(() => { load() /* eslint-disable-line */ }, [hasTotp])
  const make = (again: boolean) => guarded(async () => { if (again && !(await confirm('Make a new set? The old codes stop working at once.', 'Make new codes'))) return; const r = again ? await sb().auth.mfa.recoveryCodes.regenerate() : await sb().auth.mfa.recoveryCodes.generate({ friendlyName: 'Cresari recovery codes' }); if (r.error) throw new Error(authMessage(r.error)); setCodes(r.data.codes); await load() })
  const text = codes ? `Cresari recovery codes — ${new Date().toLocaleDateString()}\nEach code works once, instead of the authenticator app.\n\n${codes.join('\n')}\n` : ''
  const download = () => { void saveFile('cresari-recovery-codes.txt', text, 'text/plain') }
  return <Card span={6} title="Recovery codes" hint="for when the phone with the authenticator app is lost" right={st ? <Pill cls={st.remaining <= 2 ? 'warn' : 'good'}>{st.remaining} of {st.total} left</Pill> : <Pill cls="idle">{hasTotp ? 'not made' : 'needs two-factor'}</Pill>}>
    {!hasTotp ? <Note>Turn on two-factor authentication first — recovery codes back up the authenticator app and cannot replace it.</Note> : <>
      {codes ? <><div className="banner good" style={{ marginBottom: 8 }}><b>Save these now — they are shown only once.</b> Each works one time, in place of the 6-digit code.</div>
        <div className="codes" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, fontFamily: 'var(--mono)', fontSize: 14, userSelect: 'all', marginBottom: 8 }}>{codes.map(c => <span key={c} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '6px 8px' }}>{c}</span>)}</div>
        <div className="btnrow"><Btn onClick={() => { navigator.clipboard?.writeText(text); useStore.getState().toast('Copied') }}>Copy</Btn><Btn onClick={download}>Download .txt</Btn><Btn primary onClick={() => setCodes(null)}>I saved them</Btn></div></>
        : <div className="btnrow">{st ? <Btn onClick={() => make(true)}>Make a new set</Btn> : <Btn primary onClick={() => make(false)}>Make 10 recovery codes</Btn>}</div>}
      {err && <div className="msg warn">{err}</div>}
      <Note>Keep them somewhere you can reach without your phone — a password manager or a printed copy at home. At sign-in, choose “Lost your phone? Use a recovery code”.</Note></>}
  </Card>
}

/** Devices (0.20.0): every place this account is signed in, with last activity; sign any one of them out. */
function Devices({ onSignOutOthers, onSignOutAll }: { onSignOutOthers: () => void; onSignOutAll: () => void }) {
  const { guarded } = useData(); const confirm = useConfirm()
  type S = { id: string; created_at: string; updated_at: string; user_agent: string | null; ip: string | null; is_current: boolean }
  const [rows, setRows] = useState<S[] | null>(null); const [err, setErr] = useState('')
  const load = async () => { const { data, error } = await sb().rpc('my_sessions'); if (error) { setErr(/my_sessions|schema cache|does not exist/i.test(error.message) ? 'The device list is not available for this household yet.' : error.message); setRows([]) } else { setErr(''); setRows((data || []) as S[]) } }
  useEffect(() => { load() /* eslint-disable-line */ }, [])
  const revoke = async (r: S) => { if (!(await confirm(`Sign out ${describeDevice(r.user_agent).label}? It will need to sign in again.`, 'Sign out'))) return; guarded(async () => { const { error } = await sb().rpc('revoke_session', { p_id: r.id }); if (error) throw error; await load() }, 'Device signed out') }
  return <Card span={6} title="Devices" hint="everywhere this account is signed in" right={rows ? <Pill cls="info">{rows.length} active</Pill> : undefined}>
    {rows && rows.length > 0 && <div className="tblwrap"><table className="tbl"><caption className="sr-only">Signed-in devices</caption><thead><tr><th scope="col">Device</th><th scope="col">Last active</th><th scope="col">Signed in</th><th scope="col" /></tr></thead><tbody>{rows.map(r => { const d = describeDevice(r.user_agent); return <tr key={r.id} className={r.is_current ? 'st-good' : ''}><td><span aria-hidden>{d.icon}</span> {d.label}{r.is_current && <> <Pill cls="good">this device</Pill></>}{r.ip && <div className="note" style={{ margin: 0 }}>{r.ip}</div>}</td><td>{ago(r.updated_at)}</td><td>{fmtDY(r.created_at.slice(0, 10))}</td><td>{!r.is_current && <Btn sm onClick={() => revoke(r)}>Sign out</Btn>}</td></tr> })}</tbody></table></div>}
    {err && <div className="msg warn">{err}</div>}
    <div className="btnrow" style={{ marginTop: 8 }}><Btn onClick={() => { onSignOutOthers(); setTimeout(load, 800) }}>Sign out all other devices</Btn><Btn danger onClick={onSignOutAll}>Sign out everywhere</Btn></div>
    <Note>Signing a device out stops it refreshing its session; anything it already has open stops working within the hour.</Note>
  </Card>
}
