// Saved scenarios (0.20.0): a strip above a planner's sliders — load a saved what-if, save the current sliders under a name, pin, delete,
// and compare several side by side. Loading only moves the sliders; nothing here writes real data.
import { useMemo, useState } from 'react'
import { useData } from '../app/hooks'
import type { ScenarioKind, Scenario } from '../app/data/types'
import { Btn, Note, MHead, MBody, MFoot, useModal, useConfirm } from './ui'
import { scenariosOf, sameAssumptions, metrics, compare, normalize, SCENARIO_LABEL } from '../lib/scenarios'

export function ScenarioBar({ kind, current, onLoad, goalId, compact }: { kind: ScenarioKind; current: Record<string, unknown>; onLoad: (a: Record<string, unknown>) => void; goalId?: string; compact?: boolean }) {
  const { data, insert, update, remove, guarded, canEdit, mode } = useData(); const { open, close } = useModal(); const confirm = useConfirm()
  const list = scenariosOf(data, kind, goalId); const active = list.find(x => sameAssumptions(kind, x.assumptions, current))
  const [naming, setNaming] = useState(false); const [name, setName] = useState(''); const [lastId, setLastId] = useState<string | null>(null)
  const load = (x: Scenario) => { setLastId(x.id); onLoad(normalize(kind, x.assumptions) as Record<string, unknown>) }
  const last = !active && lastId ? list.find(x => x.id === lastId) : undefined
  const save = () => { const n = name.trim().slice(0, 60); if (!n) return
    guarded(async () => { const a = normalize(kind, { ...current, ...(goalId ? { goalId } : {}) }) as Record<string, unknown>
      try { await insert('scenarios', { name: n, kind, assumptions: a, pinned: false, sort_order: list.length + 1 }) } catch (e) { throw new Error(/scenarios|schema cache|does not exist/i.test((e as Error).message) && mode === 'db' ? 'Saved scenarios need database migration 0013' : (e as Error).message) }
      setNaming(false); setName('') }, `Saved “${n}”`) }
  const overwrite = (x: Scenario) => guarded(() => update('scenarios', x.id, { assumptions: normalize(kind, { ...current, ...(goalId ? { goalId } : {}) }) as Record<string, unknown> }), `Updated “${x.name}”`)
  const drop = async (x: Scenario) => { if (await confirm(`Delete the scenario “${x.name}”? Nothing else changes.`)) guarded(() => remove('scenarios', x.id), 'Scenario deleted') }
  const pin = (x: Scenario) => guarded(() => update('scenarios', x.id, { pinned: !x.pinned }))
  const openCompare = () => open(<CompareModal kind={kind} current={current} goalId={goalId} onLoad={a => { onLoad(a); close() }} />, { wide: true })
  return <div className={`scenbar${compact ? ' compact' : ''}`} role="group" aria-label={`${SCENARIO_LABEL[kind]} scenarios`}>
    <span className="l">Scenarios</span>
    {list.length === 0 && !naming && <span className="note" style={{ margin: 0 }}>none saved yet</span>}
    {list.map(x => <span key={x.id} className={`schip${active?.id === x.id ? ' on' : ''}`}>
      <button className="go" onClick={() => load(x)} title={x.notes || `Load “${x.name}”`} aria-pressed={active?.id === x.id}>{x.pinned ? '★ ' : ''}{x.name}</button>
      {canEdit && <><button className="mini" onClick={() => pin(x)} aria-label={x.pinned ? `Unpin ${x.name}` : `Pin ${x.name}`} title={x.pinned ? 'Unpin' : 'Pin to the front'}>{x.pinned ? '☆' : '★'}</button><button className="mini" onClick={() => drop(x)} aria-label={`Delete scenario ${x.name}`} title="Delete">✕</button></>}
    </span>)}
    {canEdit && (naming ? <span className="schip naming"><input className="inp" autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setNaming(false) }} placeholder="e.g. Job change in March" aria-label="Scenario name" maxLength={60} /><Btn sm primary onClick={save} disabled={!name.trim()}>Save</Btn><Btn sm onClick={() => setNaming(false)}>Cancel</Btn></span>
      : <><Btn sm onClick={() => { setName(''); setNaming(true) }}>{active ? 'Save a copy…' : 'Save as scenario…'}</Btn>{last && <Btn sm onClick={() => overwrite(last)} title={`Replace “${last.name}” with these sliders`}>Update “{last.name}”</Btn>}</>)}
    {list.length > 0 && <Btn sm onClick={openCompare}>Compare…</Btn>}
  </div>
}

function CompareModal({ kind, current, goalId, onLoad }: { kind: ScenarioKind; current: Record<string, unknown>; goalId?: string; onLoad: (a: Record<string, unknown>) => void }) {
  const { data, settings } = useData(); const { close } = useModal(); const list = scenariosOf(data, kind, goalId)
  const [pick, setPick] = useState<string[]>(list.slice(0, 3).map(x => x.id))
  const cols = useMemo(() => [{ id: '_now', name: 'Sliders now', a: { ...current, ...(goalId ? { goalId } : {}) } }, ...list.filter(x => pick.includes(x.id)).map(x => ({ id: x.id, name: x.name, a: x.assumptions }))], [list, pick, current, goalId])
  const rows = useMemo(() => compare(cols.map(c => metrics(kind, data, settings, c.a))), [cols, kind, data, settings])
  return <><MHead title={`Compare ${SCENARIO_LABEL[kind].toLowerCase()} scenarios`} /><MBody>
    <div className="btnrow" style={{ marginBottom: 10, flexWrap: 'wrap' }}>{list.map(x => <label key={x.id} className="gm-ign" style={{ fontSize: 13 }}><input type="checkbox" checked={pick.includes(x.id)} onChange={e => setPick(p => e.target.checked ? [...p, x.id].slice(-4) : p.filter(y => y !== x.id))} /> {x.name}</label>)}</div>
    <div className="tblwrap"><table className="tbl cmp"><caption className="sr-only">Scenario comparison</caption><thead><tr><th scope="col">Measure</th>{cols.map(c => <th key={c.id} scope="col" className="num">{c.name}</th>)}</tr></thead>
      <tbody>{rows.map(r => <tr key={r.k}><th scope="row" style={{ fontWeight: 500 }}>{r.label}</th>{r.cells.map((c, i) => <td key={i} className={`num${c.best ? ' best' : ''}`}>{c.text}{c.best && <span className="sr-only"> (best)</span>}</td>)}</tr>)}
        <tr><td /> {cols.map(c => <td key={c.id} className="num">{c.id !== '_now' && <Btn sm onClick={() => onLoad(normalize(kind, c.a) as Record<string, unknown>)}>Load</Btn>}</td>)}</tr></tbody></table></div>
    <Note>Every column is computed against today's balances and schedules, so the comparison stays current as your data changes. The best value in each row is highlighted.</Note>
  </MBody><MFoot><Btn onClick={close}>Close</Btn></MFoot></>
}
