// Categories (0.36.0 — Gary, Nov 21): a copy of a category you edit before it is saved, and groups you can name, order and merge so
// that everything for one person or purpose sits together. The rules are in lib/categoryOrder.ts; Settings → Categories applies them.
import { useState } from 'react'
import type { Category } from '../app/data/types'
import { draftProblem, groupsOf, NO_GROUP, type CatDraft } from '../lib/categoryOrder'
import { fmtMoney, parseNum } from '../lib/money'
import { Btn, Field, MBody, MFoot, MHead, useModal } from './ui'

export const NEW_GROUP = '＋ New group…'
/** The groups a category can be put in: the household's own, in their order, then the usual ones it does not have yet. */
export const groupChoices = (cats: Category[]) => [...groupsOf(cats).map(g => g.name), 'Income', 'Housing', 'Transport', 'Food', 'Health', 'Bills', 'Debt', 'Personal', 'Savings', NO_GROUP].filter((v, i, a) => a.indexOf(v) === i)

/** A category about to be created — a copy of another, to change before it exists. Nothing is saved until Save; Cancel leaves no trace. */
export function CategoryEditor({ title, start, cats, saveLabel = 'Save', onSave }: { title: string; start: CatDraft; cats: Category[]; saveLabel?: string; onSave: (d: CatDraft) => Promise<unknown> }) {
  const { close } = useModal(); const [d, setD] = useState<CatDraft>(start); const [budget, setBudget] = useState(start.default_budget ? String(start.default_budget) : ''); const [tried, setTried] = useState(false); const [busy, setBusy] = useState(false)
  const amount = budget.trim() === '' ? 0 : parseNum(budget), draft: CatDraft = { ...d, name: d.name.trim(), group: (d.group || '').trim() || NO_GROUP, default_budget: amount ?? NaN }
  const problem = draftProblem(draft, cats), err = (f: string) => (tried && problem?.field === f ? problem.message : null)
  const set = <K extends keyof CatDraft>(k: K, v: CatDraft[K]) => setD(x => ({ ...x, [k]: v }))
  const save = async () => { setTried(true); if (problem || busy) return; setBusy(true); try { const r = await onSave(draft); if (r !== undefined) close() } finally { setBusy(false) } }
  const isNew = !!draft.group && !groupsOf(cats).some(g => g.name === draft.group)
  return <form onSubmit={e => { e.preventDefault(); void save() }} data-cat="editor">
    <MHead title={title} />
    <MBody>
      <div className="grid2">
        <Field label="Category name" error={err('name')}><input value={d.name} maxLength={80} autoFocus onFocus={e => e.currentTarget.select()} onChange={e => set('name', e.target.value)} data-cat="name" /></Field>
        <Field label="Group" error={err('group')} hint={isNew ? `New group — it will be added after the others` : 'Pick one or type a new name, such as a person'}><input value={d.group || ''} list="cat-groups" maxLength={60} onChange={e => set('group', e.target.value)} data-cat="group" /></Field>
      </div>
      <datalist id="cat-groups">{groupChoices(cats).map(g => <option key={g} value={g} />)}</datalist>
      <div className="grid3">
        <Field label="Kind"><select value={d.kind} onChange={e => set('kind', e.target.value as CatDraft['kind'])}><option value="expense">expense</option><option value="income">income</option><option value="transfer">transfer</option></select></Field>
        <Field label="Priority"><select value={d.priority} onChange={e => set('priority', e.target.value as CatDraft['priority'])}><option>Essential</option><option>Important</option><option>Discretionary</option></select></Field>
        <Field label="Cost type"><select value={d.cost_type} onChange={e => set('cost_type', e.target.value as CatDraft['cost_type'])}><option>Fixed</option><option>Variable</option><option>Irregular</option></select></Field>
      </div>
      <div className="grid3">
        <Field label="Default budget" error={err('default_budget')}><input inputMode="decimal" placeholder="0.00" value={budget} onChange={e => setBudget(e.target.value)} data-cat="budget" /></Field>
        <Field label="Cadence"><select value={d.budget_cadence} onChange={e => set('budget_cadence', e.target.value as CatDraft['budget_cadence'])}><option value="period">per period</option><option value="monthly">per month</option><option value="yearly">per year (sinking fund)</option></select></Field>
        <Field label="Rollover"><label className="gm-ign" style={{ fontSize: 13, minHeight: 36 }}><input type="checkbox" checked={d.rollover} onChange={e => set('rollover', e.target.checked)} /> Carry unspent money forward</label></Field>
      </div>
      <Field label="Notes"><input value={d.notes || ''} maxLength={200} onChange={e => set('notes', e.target.value || null)} /></Field>
      <p className="note" style={{ margin: 0 }}>The copy starts with no transactions, rules or budget history of its own. Nothing is created until you save.</p>
    </MBody>
    <MFoot><Btn onClick={close}>Cancel</Btn><Btn primary type="submit" disabled={busy}>{busy ? 'Saving…' : saveLabel}</Btn></MFoot>
  </form>
}

/** Name a group: a new one for a category, or a new name for an existing group (typing a name that exists merges the two). */
export function GroupNameDialog({ title, start = '', cats, renaming, okLabel = 'Save', onSave }: { title: string; start?: string; cats: Category[]; /** the group being renamed, if any */ renaming?: string; okLabel?: string; onSave: (name: string) => Promise<unknown> }) {
  const { close } = useModal(); const [name, setName] = useState(start); const [tried, setTried] = useState(false); const [busy, setBusy] = useState(false)
  const v = name.trim(), existing = groupsOf(cats).find(g => g.name === v && g.name !== renaming)
  const error = !v ? 'Give the group a name.' : v.length > 40 ? 'Keep the name to 40 characters.' : v === NEW_GROUP ? 'Pick a different name.' : null
  const save = async () => { setTried(true); if (error || busy) return; if (renaming && v === renaming) { close(); return } setBusy(true); try { const r = await onSave(v); if (r !== undefined) close() } finally { setBusy(false) } }
  return <form onSubmit={e => { e.preventDefault(); void save() }} data-cat="group-name">
    <MHead title={title} />
    <MBody>
      <Field label="Group name" error={tried ? error : null} hint="A group is the heading its categories sit under — a kind of spending, or a person."><input value={name} maxLength={60} autoFocus onFocus={e => e.currentTarget.select()} onChange={e => setName(e.target.value)} data-cat="group-input" /></Field>
      {existing && <div className="msg info" role="status">{renaming ? <><b>{v}</b> already exists with {existing.cats.length} {existing.cats.length === 1 ? 'category' : 'categories'}. Saving puts the two groups together under that name.</> : <><b>{v}</b> already exists — the category will join it.</>}</div>}
    </MBody>
    <MFoot><Btn onClick={close}>Cancel</Btn><Btn primary type="submit" disabled={busy}>{busy ? 'Saving…' : existing && renaming ? 'Merge the groups' : okLabel}</Btn></MFoot>
  </form>
}

/** The groups in the order the app lists them, each with how many categories it holds; move one up or down, or rename it. */
export function CategoryGroups({ cats, canEdit, busy, onMove, onRename }: { cats: Category[]; canEdit: boolean; busy: boolean; onMove: (group: string, dir: -1 | 1) => void; onRename: (group: string) => void }) {
  const gs = groupsOf(cats)
  if (gs.length < 2 && !gs.some(g => g.cats.length > 1)) return null
  return <div className="catgroups" data-cat="groups" role="group" aria-label="Category groups, in order">
    <div className="catgroups-h"><b>Groups</b><span>A group's categories stay together everywhere — the budget, the pickers, the reports. Move a group to change where it appears.</span></div>
    <ol>{gs.map((g, i) => <li key={g.name} data-group={g.name}>
      <span className="cg-n" aria-hidden="true">{i + 1}</span>
      <span className="cg-name"><b>{g.name}</b><small>{g.active} {g.active === 1 ? 'category' : 'categories'}{g.cats.length > g.active ? ` · ${g.cats.length - g.active} archived` : ''}{g.budget > 0 ? ` · ${fmtMoney(g.budget)} budget` : ''}</small></span>
      {canEdit && <span className="btnrow">
        <button type="button" className="btn sm" disabled={busy || i === 0} onClick={() => onMove(g.name, -1)} aria-label={`Move the ${g.name} group up`} title="Move this group up">↑</button>
        <button type="button" className="btn sm" disabled={busy || i === gs.length - 1} onClick={() => onMove(g.name, 1)} aria-label={`Move the ${g.name} group down`} title="Move this group down">↓</button>
        <button type="button" className="btn sm" disabled={busy} onClick={() => onRename(g.name)} aria-label={`Rename the ${g.name} group`}>Rename</button>
      </span>}
    </li>)}</ol>
  </div>
}
