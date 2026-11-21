// 0.36.0 — categories kept together by group, moved, renamed, merged and copied.
import { describe, it, expect } from 'vitest'
import type { Category } from '../app/data/types'
import { groupsOf, orderCategories, moveCategory, moveGroup, setGroup, renameGroup, copyDraft, draftProblem, placeNew, groupOf, type CatChange } from './categoryOrder'
import { demoSeed } from '../app/data/demoSeed'

let n = 0
const cat = (name: string, group: string | null, sort_order: number, extra: Partial<Category> = {}): Category => ({ id: 'c' + (++n), household_id: 'h', name, group, kind: 'expense', priority: 'Important', cost_type: 'Variable', default_budget: 100, budget_cadence: 'period', rollover: false, sort_order, archived: false, ...extra } as Category)
const apply = (cats: Category[], ch: CatChange[]) => cats.map(c => ({ ...c, ...(ch.find(x => x.id === c.id)?.patch || {}) }))
const names = (cats: Category[]) => orderCategories(cats).map(c => `${groupOf(c)}/${c.name}`)
// Gary's case: the starter groups, then categories added later for two people — numbered at the end, in the order they were typed
const base = () => [cat('Rent', 'Housing', 1), cat('Power', 'Housing', 2), cat('Groceries', 'Food', 3), cat('Eating out', 'Food', 4),
  cat('Rent', 'Gavionne', 5), cat('Gym', 'Gary', 6), cat('Phone', 'Gavionne', 7), cat('Golf', 'Gary', 8), cat('Flex', 'Gavionne', 9), cat('Misc', null, 10)]

describe('kept together', () => {
  it('each group\'s categories sit together, whatever order they were added in; a group stands where its first category stands', () => {
    expect(names(base())).toEqual(['Housing/Rent', 'Housing/Power', 'Food/Groceries', 'Food/Eating out', 'Gavionne/Rent', 'Gavionne/Phone', 'Gavionne/Flex', 'Gary/Gym', 'Gary/Golf', 'Other/Misc'])
    expect(groupsOf(base()).map(g => [g.name, g.cats.length, g.budget])).toEqual([['Housing', 2, 200], ['Food', 2, 200], ['Gavionne', 3, 300], ['Gary', 2, 200], ['Other', 1, 100]])
  })
  it('an archived category does not hold its group\'s place, and is not counted — but stays in the group', () => {
    const cats = [cat('Old', 'Gary', 1, { archived: true }), cat('Rent', 'Housing', 2), cat('Gym', 'Gary', 3), cat('Paycheck', 'Gary', 4, { kind: 'income' })]
    const gs = groupsOf(cats); expect(gs.map(g => g.name)).toEqual(['Housing', 'Gary']); expect(gs[1]).toMatchObject({ active: 2, budget: 100 }); expect(gs[1].cats.map(c => c.name)).toEqual(['Old', 'Gym', 'Paycheck'])
    expect(groupsOf([cat('Old', 'Gone', 1, { archived: true }), cat('Rent', 'Housing', 2)]).map(g => g.name)).toEqual(['Gone', 'Housing'])
  })
  it('ties and missing numbers still give one steady order', () => {
    const cats = [cat('B', 'X', 0), cat('A', 'X', 0), cat('C', 'Y', 0)]; expect(names(cats)).toEqual(['X/A', 'X/B', 'Y/C']); expect(names(cats.slice().reverse())).toEqual(['X/A', 'X/B', 'Y/C'])
  })
  it('the sample household\'s starter categories keep the order they always had', () => {
    const { data } = demoSeed(); const before = data.categories.slice().sort((a, b) => a.sort_order - b.sort_order).map(c => c.id)
    expect(orderCategories(data.categories).map(c => c.id)).toEqual(before)
  })
})
describe('moving', () => {
  it('a category moves inside its own group and stops at the ends', () => {
    const cats = base(), phone = cats.find(c => c.name === 'Phone')!
    const up = apply(cats, moveCategory(cats, phone.id, -1)); expect(names(up).slice(4, 7)).toEqual(['Gavionne/Phone', 'Gavionne/Rent', 'Gavionne/Flex'])
    expect(moveCategory(up, phone.id, -1)).toEqual([])                                             // already first in Gavionne: it does not climb into Food
    const down = apply(up, moveCategory(up, phone.id, 1)); expect(names(down)).toEqual(names(cats))
    expect(moveCategory(cats, cats.find(c => c.name === 'Flex')!.id, 1)).toEqual([]); expect(moveCategory(cats, 'nope', 1)).toEqual([])
  })
  it('the first move numbers everything 1…n in the order shown; after that a move changes two rows', () => {
    const cats = base(), phone = cats.find(c => c.name === 'Phone')!, first = moveCategory(cats, phone.id, -1), after = apply(cats, first)
    expect(orderCategories(after).map(c => c.sort_order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); expect(first.length).toBeGreaterThan(2)
    expect(moveCategory(after, phone.id, 1)).toHaveLength(2)
  })
  it('a whole group moves past its neighbour, taking its categories with it', () => {
    const cats = base(), up = apply(cats, moveGroup(cats, 'Gary', -1))
    expect(groupsOf(up).map(g => g.name)).toEqual(['Housing', 'Food', 'Gary', 'Gavionne', 'Other']); expect(names(up).slice(4, 6)).toEqual(['Gary/Gym', 'Gary/Golf'])
    const top = apply(apply(up, moveGroup(up, 'Gary', -1)), moveGroup(apply(up, moveGroup(up, 'Gary', -1)), 'Gary', -1)); expect(groupsOf(top)[0].name).toBe('Gary')
    expect(moveGroup(top, 'Gary', -1)).toEqual([]); expect(moveGroup(cats, 'Other', 1)).toEqual([]); expect(moveGroup(cats, 'Nobody', 1)).toEqual([])
  })
})
describe('groups', () => {
  it('a category put in another group joins the end of it; a new group goes last', () => {
    const cats = base(), golf = cats.find(c => c.name === 'Golf')!
    const a = apply(cats, setGroup(cats, golf.id, 'Gavionne')); expect(names(a).slice(4, 9)).toEqual(['Gavionne/Rent', 'Gavionne/Phone', 'Gavionne/Flex', 'Gavionne/Golf', 'Gary/Gym'])
    const b = apply(cats, setGroup(cats, golf.id, ' Hobbies ')); expect(names(b).slice(-2)).toEqual(['Other/Misc', 'Hobbies/Golf']); expect(b.find(c => c.id === golf.id)!.group).toBe('Hobbies')
    expect(setGroup(cats, golf.id, 'Gary')).toEqual([]); expect(apply(cats, setGroup(cats, golf.id, '')).find(c => c.id === golf.id)!.group).toBe('Other')
  })
  it('renaming a group renames every category in it and keeps its place', () => {
    const cats = base(), r = apply(cats, renameGroup(cats, 'Gavionne', 'Gav')); expect(groupsOf(r).map(g => g.name)).toEqual(['Housing', 'Food', 'Gav', 'Gary', 'Other']); expect(r.filter(c => c.group === 'Gav')).toHaveLength(3)
    expect(renameGroup(cats, 'Gavionne', 'Gavionne')).toEqual([]); expect(renameGroup(cats, 'Gavionne', '  ')).toEqual([]); expect(renameGroup(cats, 'Nobody', 'X')).toEqual([])
  })
  it('renaming a group to one that exists merges them: the renamed categories follow the ones already there', () => {
    const cats = base(), r = apply(cats, renameGroup(cats, 'Gary', 'Gavionne'))
    expect(groupsOf(r).map(g => g.name)).toEqual(['Housing', 'Food', 'Gavionne', 'Other']); expect(groupsOf(r)[2].cats.map(c => c.name)).toEqual(['Rent', 'Phone', 'Flex', 'Gym', 'Golf'])
    const misc = apply(cats, renameGroup(cats, 'Other', 'Gary')); expect(misc.find(c => c.name === 'Misc')!.group).toBe('Gary')   // a category with no group at all is renamed too
  })
})
describe('a copy', () => {
  it('starts as the same category under a name that is free in its group', () => {
    const cats = base(), rent = cats[0]; expect(copyDraft(rent, cats)).toEqual({ name: 'Rent (copy)', group: 'Housing', kind: 'expense', priority: 'Important', cost_type: 'Variable', default_budget: 100, budget_cadence: 'period', rollover: false, notes: null })
    expect(copyDraft(rent, [...cats, cat('rent (COPY)', 'Housing', 11)]).name).toBe('Rent (copy 2)')
  })
  it('cannot be saved without a name, or as a second category of the same kind and name in one group — the same name in another group is fine', () => {
    const cats = base(), d = copyDraft(cats[0], cats)
    expect(draftProblem(d, cats)).toBeNull(); expect(draftProblem({ ...d, name: '  ' }, cats)).toMatchObject({ field: 'name' }); expect(draftProblem({ ...d, name: 'x'.repeat(61) }, cats)).toMatchObject({ field: 'name' })
    expect(draftProblem({ ...d, name: ' rent ' }, cats)).toMatchObject({ field: 'name', message: expect.stringContaining('Housing already has an expense category called Rent') })
    expect(draftProblem({ ...d, name: 'Rent', group: 'Gary' }, cats)).toBeNull()                    // Rent under Gary, beside Rent under Gavionne and Housing
    expect(draftProblem({ ...d, name: 'Rent', kind: 'income' }, cats)).toBeNull()
    expect(draftProblem({ ...d, default_budget: -1 }, cats)).toMatchObject({ field: 'default_budget' }); expect(draftProblem({ ...d, group: 'g'.repeat(41) }, cats)).toMatchObject({ field: 'group' })
    expect(draftProblem({ ...d, name: 'Misc', group: '' }, cats)).toMatchObject({ field: 'name' })   // no group is the group "Other"
  })
  it('is placed straight after its original; in another group it goes to the end of that group; a new group goes last', () => {
    const cats = base(), rentG = cats.find(c => c.name === 'Rent' && c.group === 'Gavionne')!
    const put = (group: string) => { const p = placeNew(cats, { name: 'Copy', group }, rentG.id); return names([...apply(cats, p.changes), cat('Copy', group, p.sort_order)]) }
    expect(put('Gavionne').slice(4, 8)).toEqual(['Gavionne/Rent', 'Gavionne/Copy', 'Gavionne/Phone', 'Gavionne/Flex'])
    expect(put('Gary').slice(7, 10)).toEqual(['Gary/Gym', 'Gary/Golf', 'Gary/Copy']); expect(put('Trips').slice(-1)).toEqual(['Trips/Copy'])
    const p = placeNew(cats, { name: 'Copy', group: 'Gavionne' }, rentG.id); expect(new Set([...apply(cats, p.changes).map(c => c.sort_order), p.sort_order]).size).toBe(11)   // no two share a number
    expect(placeNew([], { name: 'First', group: '' }).sort_order).toBe(1)
  })
})
