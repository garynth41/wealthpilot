// 0.25.1 — user-interface fixes from the phone and accessibility audit: a cleared required field is never saved (an empty transaction
// date took the whole app down), amounts that must be positive refuse a minus sign, the planning thresholds keep a meaningful 0, date-only
// values count local calendar days, dialogs are a stack the phone's Back button closes from the top, and hand-written tables become
// labelled cards on phones.
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createElement, useEffect } from 'react'
import { render, act, cleanup } from '@testing-library/react'
import { setToday, ago } from './dates'
import { patchProblem, amountProblem, rangeProblem, checkThresholds, InputError, isInputError } from './validate'
import { MemoryRepo } from '../app/data/memoryRepo'
import { demoSeed } from '../app/data/demoSeed'
import { useStore } from '../app/store'
import { hasAppHistory } from '../app/native'
import { ModalHost, useModal, useConfirm, closeTopDialog, hasOpenLayer, MHead, MBody } from '../components/ui'
import { labelTable } from '../components/tableCards'

beforeAll(() => setToday('2026-11-07'))
afterEach(() => cleanup())

describe('date-only values are local calendar days', () => {
  it('today, yesterday and whole days — never hours from a UTC midnight', () => {
    expect(ago('2026-11-07')).toBe('today')
    expect(ago('2026-11-06')).toBe('yesterday')
    expect(ago('2026-07-26')).toBe('104d ago')   // the Dashboard says 104 days for the same car value
    expect(ago('2026-11-09')).toBe('in 2d')
  })
  it('timestamps still read in minutes and hours', () => {
    expect(ago(Date.now() - 5 * 60000)).toBe('5m ago')
    expect(ago(new Date(Date.now() - 3 * 3600000).toISOString())).toBe('3h ago')
  })
})

describe('a change the database would refuse is refused first, in plain words', () => {
  it('an empty required field', () => {
    expect(patchProblem('transactions', { date: null })).toMatch(/A transaction needs a date/)
    expect(patchProblem('transactions', { date: '' })).toMatch(/needs a date/)
    expect(patchProblem('paySchedules', { anchor_date: null })).toMatch(/An income source needs a known pay date/)
    expect(patchProblem('planned', { date: null })).toMatch(/A planned item needs a date/)
    expect(patchProblem('accounts', { name: '  ' })).toMatch(/An account needs a name/)
    expect(patchProblem('recurring', { amount: NaN })).toMatch(/needs an amount/)
  })
  it('a negative transaction amount', () => { expect(patchProblem('transactions', { amount: -25 })).toMatch(/always positive/) })
  it('leaves good changes, optional fields and keys that are not part of the change alone', () => {
    expect(patchProblem('transactions', { date: '2026-11-07', amount: 12.5, memo: '' })).toBeNull()
    expect(patchProblem('paySchedules', { ends_on: null, starts_on: null })).toBeNull()
    expect(patchProblem('transactions', { date: undefined })).toBeNull()
    expect(patchProblem('accounts', { credit_limit: null, statement_balance: null, balance: -40 })).toBeNull()   // a balance may go below zero
  })
})

describe('the store never shows a value it will not save', () => {
  const start = async () => { const repo = new MemoryRepo(demoSeed()); useStore.setState({ mode: 'demo', repo, role: 'owner', readOnly: false, offlineAt: null }); await useStore.getState().refresh(); return repo }
  it('an empty date is refused before the optimistic copy changes, with an InputError', async () => {
    await start(); const t = useStore.getState().data.transactions[0]
    const p = useStore.getState().update('transactions', t.id, { date: null as unknown as string })
    expect(useStore.getState().data.transactions.find(x => x.id === t.id)!.date).toBe(t.date)   // never applied, not even for a moment
    await expect(p).rejects.toSatisfy((e: unknown) => isInputError(e) && /needs a date/.test((e as Error).message))
  })
  it('a save that fails puts back only that row; a change to another row made meanwhile stays', async () => {
    const repo = await start(); const [a, b] = useStore.getState().data.transactions
    const real = repo.update.bind(repo); let fail = true
    repo.update = (async (coll: never, id: string, patch: never) => { if (fail && id === a.id) { await new Promise(r => setTimeout(r, 5)); throw new Error('network down') } return real(coll, id, patch) }) as typeof repo.update
    const p = useStore.getState().update('transactions', a.id, { payee: 'Changed' })
    expect(useStore.getState().data.transactions.find(x => x.id === a.id)!.payee).toBe('Changed')   // optimistic
    fail = false; await useStore.getState().update('transactions', b.id, { memo: 'kept' }); fail = true
    await expect(p).rejects.toThrow('network down')
    const now = useStore.getState().data.transactions
    expect(now.find(x => x.id === a.id)!.payee).toBe(a.payee); expect(now.find(x => x.id === b.id)!.memo).toBe('kept')
  })
  it('guarded() shows an input problem as a message without logging an error', async () => {
    await start(); const t = useStore.getState().data.transactions[0]
    await useStore.getState().guarded(() => useStore.getState().update('transactions', t.id, { amount: -3 }))
    expect(useStore.getState().toasts.at(-1)).toMatchObject({ err: true }); expect(useStore.getState().toasts.at(-1)!.text).toMatch(/always positive/)
    expect(new InputError('x').name).toBe('InputError')
  })
})

describe('typed amounts say what is wrong', () => {
  it('Add transaction: minus, zero, letters, scientific notation and nothing', () => {
    expect(amountProblem('-25', { negative: 'Amounts are always positive' })).toBe('Amounts are always positive')
    expect(amountProblem('0')).toMatch(/more than \$0\.00/)
    expect(amountProblem('abc')).toMatch(/“abc” is not an amount/)
    expect(amountProblem('1e3')).toMatch(/“1e3” is not an amount/)
    expect(amountProblem('  ')).toBe('Enter the amount.')
    expect(amountProblem('42.50')).toBeNull(); expect(amountProblem('$1,234.56')).toBeNull(); expect(amountProblem('0', { allowZero: true })).toBeNull()
  })
  it('table cells name the column and the range', () => {
    expect(rangeProblem('Amount', -1, 0)).toBe('Amount cannot be negative.')
    expect(rangeProblem('Day', 40, 1, 31)).toBe('Day must be between 1 and 31.')
    expect(rangeProblem('Priority', 0, 1)).toBe('Priority must be at least 1.')
    expect(rangeProblem('Amount', 12, 0)).toBeNull()
  })
})

describe('Settings → Planning thresholds keep a 0 that means something', () => {
  const ok = { reserveFloor: '0', savingsTargetPct: '0', runwayGreen: '6', runwayYellow: '0', budgetCritPct: '0', dueSoonDays: '0' }
  it('0 is saved as 0 for the floor, the savings target, yellow, the red line and the reminder window', () => {
    expect(checkThresholds(ok)).toEqual({ value: { reserveFloor: 0, savingsTargetPct: 0, runwayGreen: 6, runwayYellow: 0, budgetCritPct: 0, dueSoonDays: 0 }, errors: {} })
  })
  it('refuses what cannot work, with a reason, instead of saving a default', () => {
    expect(checkThresholds({ ...ok, runwayGreen: '0' }).errors.runwayGreen).toMatch(/at least 1 month/)
    expect(checkThresholds({ ...ok, runwayGreen: '3', runwayYellow: '4' }).errors.runwayYellow).toMatch(/below green/)
    expect(checkThresholds({ ...ok, savingsTargetPct: '' }).errors.savingsTargetPct).toMatch(/Enter/)
    expect(checkThresholds({ ...ok, budgetCritPct: 'lots' }).errors.budgetCritPct).toMatch(/not a number/)
    expect(checkThresholds({ ...ok, dueSoonDays: '2.5' }).errors.dueSoonDays).toMatch(/whole number/)
    expect(checkThresholds({ ...ok, savingsTargetPct: '120' }).errors.savingsTargetPct).toMatch(/100 or less/)
    expect(checkThresholds({ ...ok, runwayGreen: '0' }).value).toBeNull()
  })
})

describe('Back inside the app', () => {
  it('knows whether the app navigated here itself (react-router numbers its history entries)', () => {
    history.replaceState({ idx: 0 }, ''); expect(hasAppHistory()).toBe(false)
    history.replaceState({ idx: 3 }, ''); expect(hasAppHistory()).toBe(true)
    history.replaceState(null, ''); expect(hasAppHistory()).toBe(false)
  })
})

describe('dialogs are a stack', () => {
  it('a confirmation opens on top, the dialog underneath keeps what was typed, and closeTopDialog closes from the top', async () => {
    let answer: boolean | null = null
    function Thread() { const confirm = useConfirm(); return createElement('div', null, createElement(MHead, { title: 'Comments' }), createElement(MBody, null, createElement('textarea', { id: 'reply', defaultValue: '' }), createElement('button', { type: 'button', id: 'del', onClick: async () => { answer = await confirm('Delete this comment?') } }, 'Delete'))) }
    function Page() { const { open } = useModal(); useEffect(() => { open(createElement(Thread)) }, []); return null }   // eslint-disable-line react-hooks/exhaustive-deps
    render(createElement(ModalHost, null, createElement(Page)))
    const reply = document.getElementById('reply') as HTMLTextAreaElement; reply.value = 'half-written reply'
    await act(async () => { (document.getElementById('del') as HTMLButtonElement).click() })
    const modals = [...document.querySelectorAll('.modal')]
    expect(modals).toHaveLength(2); expect(modals[1].getAttribute('role')).toBe('alertdialog'); expect(modals[0].getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(modals[0].getAttribute('aria-labelledby')!)?.textContent).toBe('Comments')   // named by its title
    expect(modals[0].closest('[inert]')).not.toBeNull(); expect(document.querySelector('.modal-under')!.hasAttribute('inert')).toBe(true)
    await act(async () => { expect(closeTopDialog()).toBe(true) })   // the phone's Back button: the confirmation goes, the thread stays
    expect(document.querySelectorAll('.modal')).toHaveLength(1); expect((document.getElementById('reply') as HTMLTextAreaElement).value).toBe('half-written reply'); expect(answer).toBe(false)
    await act(async () => { expect(closeTopDialog()).toBe(true) })
    expect(document.querySelectorAll('.modal')).toHaveLength(0); expect(hasOpenLayer()).toBe(false); expect(closeTopDialog()).toBe(false)
  })
})

describe('phone cards for hand-written tables', () => {
  it('labels every cell with its column heading, marks fields and group headings, and leaves small tables alone', () => {
    document.body.innerHTML = `<div class="tblwrap"><table class="tbl"><thead><tr><th>Category</th><th></th><th class="num">Planned</th><th>Spent</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody><tr><td colspan="5">Housing</td></tr><tr><td>Rent / mortgage</td><td>Essential</td><td><input class="num" inputmode="decimal"></td><td>$1,850.00</td><td><button>Log</button></td></tr></tbody></table></div>
      <table class="tbl" id="small"><thead><tr><th>Level</th><th>Amount</th></tr></thead><tbody><tr><td>Floor</td><td>$3,000</td></tr></tbody></table>`
    const t = document.querySelector('table') as HTMLTableElement; labelTable(t)
    expect(t.hasAttribute('data-cards')).toBe(true); expect(t.parentElement!.hasAttribute('data-cards-wrap')).toBe(true)
    const [head, row] = Array.from(t.tBodies[0].rows)
    expect(head.hasAttribute('data-head')).toBe(true)
    expect(Array.from(row.cells).map(c => c.getAttribute('data-label'))).toEqual(['Category', '', 'Planned', 'Spent', ''])   // screen-reader-only text is not a label
    expect(row.cells[2].getAttribute('data-ctl')).toBe('num'); expect(row.cells[0].hasAttribute('data-title')).toBe(true)
    const small = document.getElementById('small') as HTMLTableElement; labelTable(small); expect(small.hasAttribute('data-cards')).toBe(false)
  })
  it('a short name is still the card title; a bare number keeps its label', () => {
    document.body.innerHTML = `<table class="tbl"><thead><tr><th>Category</th><th>Planned</th><th>Spent</th><th>Left</th></tr></thead>
      <tbody><tr><td>Gas</td><td>$60</td><td>$0</td><td>$60</td></tr><tr><td>12</td><td>$1</td><td>$2</td><td>$3</td></tr></tbody></table>`
    const t = document.querySelector('table') as HTMLTableElement; labelTable(t)
    const [gas, num] = Array.from(t.tBodies[0].rows)
    expect(gas.cells[0].hasAttribute('data-title')).toBe(true); expect(num.cells[0].hasAttribute('data-title')).toBe(false)
  })
})
