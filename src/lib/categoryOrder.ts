// Categories kept together (0.36.0 — Gary, Nov 21): "everything for Gavionne, or Gary, together".
// A category's group is its heading (Housing, Food — or a person). Everywhere the app lists categories — the budget, the pickers, the
// reports, Settings — the groups come one after another and each group's categories sit together, in the order set here. That holds
// whatever the stored numbers are: a group's place is its first category's `sort_order`, and inside a group the categories follow
// their own. The moves below (a category up or down inside its group, a whole group up or down, a category into another group, a
// group renamed or merged, a copy placed after its original) answer with the smallest set of changes that leaves the numbers 1…n
// in that order, so the next move is a simple swap. Pure functions — the page applies the changes.
import type { Category } from '../app/data/types'

export const NO_GROUP = 'Other'
/** The group a category sits under ("Other" when it has none). */
export const groupOf = (c: Pick<Category, 'group'>) => (c.group || '').trim() || NO_GROUP
const byPlace = (a: Category, b: Category) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name) || String(a.created_at || '').localeCompare(String(b.created_at || '')) || a.id.localeCompare(b.id)

export interface CatGroup { name: string; cats: Category[]; active: number; budget: number }
/** The groups in order, each with its categories in order. A group stands where its first category in use stands (an archived one
 *  does not hold a place for it, unless the whole group is archived). */
export function groupsOf(cats: Category[]): CatGroup[] {
  const m = new Map<string, Category[]>()
  for (const c of cats) { const g = groupOf(c); m.set(g, [...(m.get(g) || []), c]) }
  const place = (list: Category[]) => { const live = list.filter(c => !c.archived); return Math.min(...(live.length ? live : list).map(c => c.sort_order || 0)) }
  return [...m.entries()].map(([name, list]) => ({ name, cats: list.slice().sort(byPlace), at: place(list) }))
    .sort((a, b) => a.at - b.at || a.name.localeCompare(b.name))
    .map(({ name, cats: list }) => ({ name, cats: list, active: list.filter(c => !c.archived).length, budget: list.filter(c => !c.archived && c.kind === 'expense').reduce((n, c) => n + (+c.default_budget || 0), 0) }))
}
/** Every category in the order the app lists them: group after group, each group's categories together. */
export const orderCategories = (cats: Category[]): Category[] => groupsOf(cats).flatMap(g => g.cats)

export interface CatChange { id: string; patch: Partial<Pick<Category, 'sort_order' | 'group'>> }
/** The changes that number `ordered` 1…n (with any group changes in `groups`), leaving out what is already right. */
function numbered(ordered: Category[], groups: Map<string, string> = new Map()): CatChange[] {
  const out: CatChange[] = []
  ordered.forEach((c, i) => { const patch: CatChange['patch'] = {}; if ((c.sort_order || 0) !== i + 1) patch.sort_order = i + 1; const g = groups.get(c.id); if (g !== undefined && g !== (c.group || '')) patch.group = g; if (Object.keys(patch).length) out.push({ id: c.id, patch }) })
  return out
}
/** Move a category one place up (−1) or down (+1) among the categories of its own group. Nothing when it is already at that end. */
export function moveCategory(cats: Category[], id: string, dir: -1 | 1): CatChange[] {
  const gs = groupsOf(cats), g = gs.find(x => x.cats.some(c => c.id === id)); if (!g) return []
  const i = g.cats.findIndex(c => c.id === id), j = i + dir; if (j < 0 || j >= g.cats.length) return []
  const list = g.cats.slice(); [list[i], list[j]] = [list[j], list[i]]
  return numbered(gs.flatMap(x => (x === g ? list : x.cats)))
}
/** Move a whole group one place up or down among the groups. */
export function moveGroup(cats: Category[], group: string, dir: -1 | 1): CatChange[] {
  const gs = groupsOf(cats), i = gs.findIndex(g => g.name === group), j = i + dir; if (i < 0 || j < 0 || j >= gs.length) return []
  const list = gs.slice(); [list[i], list[j]] = [list[j], list[i]]
  return numbered(list.flatMap(g => g.cats))
}
/** Put a category in another group (a new one goes last): it joins the end of that group. */
export function setGroup(cats: Category[], id: string, group: string): CatChange[] {
  const to = group.trim() || NO_GROUP, c = cats.find(x => x.id === id); if (!c || groupOf(c) === to) return []
  const gs = groupsOf(cats.filter(x => x.id !== id)), tgt = gs.find(g => g.name === to)
  const ordered = tgt ? gs.flatMap(g => (g === tgt ? [...g.cats, c] : g.cats)) : [...gs.flatMap(g => g.cats), c]
  return numbered(ordered, new Map([[id, to]]))
}
/** Rename a group. If the new name is a group that already exists, the two become one: the renamed categories follow the ones already there. */
export function renameGroup(cats: Category[], from: string, to: string): CatChange[] {
  const name = to.trim(); if (!name || name === from) return []
  const gs = groupsOf(cats), src = gs.find(g => g.name === from); if (!src) return []
  const tgt = gs.find(g => g.name === name), moved = new Map(src.cats.map(c => [c.id, name]))
  const ordered = tgt ? gs.filter(g => g !== src).flatMap(g => (g === tgt ? [...g.cats, ...src.cats] : g.cats)) : gs.flatMap(g => g.cats)
  return numbered(ordered, moved)
}

export type CatDraft = Pick<Category, 'name' | 'group' | 'kind' | 'priority' | 'cost_type' | 'default_budget' | 'budget_cadence' | 'rollover' | 'notes'>
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
/** A copy of a category to edit before it is saved: everything the same, under a name that is not taken in its group. Nothing is stored yet. */
export function copyDraft(src: Category, cats: Category[]): CatDraft {
  const taken = (n: string) => cats.some(c => c.kind === src.kind && groupOf(c) === groupOf(src) && same(c.name, n))
  let name = `${src.name} (copy)`; for (let i = 2; taken(name) && i < 100; i++) name = `${src.name} (copy ${i})`
  return { name, group: groupOf(src), kind: src.kind, priority: src.priority, cost_type: src.cost_type, default_budget: +src.default_budget || 0, budget_cadence: src.budget_cadence, rollover: !!src.rollover, notes: src.notes || null }
}
/** Why a draft cannot be saved (null: it can). Two categories of the same kind may share a name only in different groups — "Rent" under Gary and under Gavionne. */
export function draftProblem(d: CatDraft, cats: Category[]): { field: 'name' | 'group' | 'default_budget'; message: string } | null {
  const name = d.name.trim(), group = (d.group || '').trim()
  if (!name) return { field: 'name', message: 'Give the category a name.' }
  if (name.length > 60) return { field: 'name', message: 'Keep the name to 60 characters.' }
  if (group.length > 40) return { field: 'group', message: 'Keep the group name to 40 characters.' }
  if (!isFinite(+d.default_budget) || +d.default_budget < 0) return { field: 'default_budget', message: 'The default budget is an amount of zero or more.' }
  const clash = cats.find(c => c.kind === d.kind && groupOf(c) === (group || NO_GROUP) && same(c.name, name))
  if (clash) return { field: 'name', message: `${group || NO_GROUP} already has ${clash.kind === 'income' ? 'an income' : clash.kind === 'transfer' ? 'a transfer' : 'an expense'} category called ${clash.name}${clash.archived ? ' (archived)' : ''}. Change the name, or put the copy in another group.` }
  return null
}
/** Where a new category goes, and what has to move to make room: straight after `afterId` when it stays in that category's group,
 *  otherwise at the end of its own group (a new group goes last). Answers the new row's `sort_order` and the changes to the others. */
export function placeNew(cats: Category[], d: Pick<CatDraft, 'group' | 'name'>, afterId?: string | null): { sort_order: number; changes: CatChange[] } {
  const group = (d.group || '').trim() || NO_GROUP, ghost = { id: '\u0000new', name: d.name, group, sort_order: 0, archived: false } as Category
  const gs = groupsOf(cats), src = afterId ? cats.find(c => c.id === afterId) : undefined, tgt = gs.find(g => g.name === group)
  let ordered: Category[]
  if (src && groupOf(src) === group) ordered = gs.flatMap(g => g.cats.flatMap(c => (c.id === src.id ? [c, ghost] : [c])))
  else if (tgt) ordered = gs.flatMap(g => (g === tgt ? [...g.cats, ghost] : g.cats))
  else ordered = [...gs.flatMap(g => g.cats), ghost]
  return { sort_order: ordered.indexOf(ghost) + 1, changes: ordered.flatMap((c, i) => (c === ghost || (c.sort_order || 0) === i + 1 ? [] : [{ id: c.id, patch: { sort_order: i + 1 } }])) }
}
