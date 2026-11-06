// 0.23.0 — experience: locale-aware formatting and parsing, privacy mode, the getting-started checklist, dashboard arrangement,
// empty charts, and runway for an empty household.
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { setToday } from './dates'
import { fmtMoney, fm2, fmtNum, parseNum } from './money'
import { fmtDY } from './dates'
import { setLocale, setPrivacy, unmasked, separators, isPrivate, resolvedLocale } from './display'
import { setupSteps, setupProgress, hasMoneyData } from './onboarding'
import { normalizeLayout, moveCard, toggleCard, visibleCards } from './dashLayout'
import { noData } from './visuals'
import { runwayProjection } from './forecast'
import { HELP } from './help'
import { demoSeed } from '../app/data/demoSeed'
import { SETTINGS_DEFAULTS, emptyData, type Settings } from '../app/data/types'

beforeAll(() => setToday('2026-11-04'))
afterEach(() => { setLocale('auto'); setPrivacy(false) })

describe('locale-aware formatting', () => {
  it('US format is unchanged', () => {
    expect(resolvedLocale()).toBe('en-US'); expect(fmtMoney(1234.4)).toBe('$1,234'); expect(fmtMoney(-1234.6)).toBe('−$1,235'); expect(fm2(1234.5)).toBe('$1,234.50'); expect(fm2(-0.5)).toBe('−$0.50'); expect(fm2(null)).toBe('—')
    expect(fmtNum(1234.56, 1)).toBe('1,234.6'); expect(separators()).toEqual({ group: ',', decimal: '.' })
  })
  it('German format groups with dots and uses a decimal comma; dates follow', () => {
    setLocale('de-DE'); expect(separators()).toEqual({ group: '.', decimal: ',' })
    expect(fm2(1234.5)).toMatch(/^1\.234,50\s\$$/); expect(fmtMoney(-1234)).toMatch(/^−1\.234\s\$$/); expect(fmtDY('2026-11-06')).toMatch(/6\. Nov\.? 2026/)
  })
  it('parsing what people type: a comma is a decimal point only where the locale says so; both separators: the last one is the decimal', () => {
    expect(parseNum('1,234.56')).toBe(1234.56); expect(parseNum('12,5')).toBe(125); expect(parseNum('$-45')).toBe(-45); expect(parseNum('(120)')).toBe(-120)
    setLocale('de-DE'); expect(parseNum('12,5')).toBe(12.5); expect(parseNum('1.234,56')).toBe(1234.56); expect(parseNum('1234.50')).toBe(1234.5); expect(parseNum('0.012')).toBe(0.012); expect(parseNum('1,234.56')).toBe(1234.56)
    setLocale('fr-FR'); expect(parseNum('1 234,56')).toBe(1234.56); expect(parseNum('1 234,56 €')).toBe(1234.56)
  })
})

describe('privacy mode', () => {
  it('masks every formatted amount, and exports run unmasked', () => {
    setPrivacy(true); expect(isPrivate()).toBe(true); expect(fmtMoney(5000)).toBe('$•••'); expect(fm2(12.34)).toBe('$•••'); expect(fmtNum(5000, 0, true)).toBe('•••'); expect(fmtNum(42)).toBe('42')
    expect(unmasked(() => fmtMoney(5000))).toBe('$5,000'); expect(fmtMoney(5000)).toBe('$•••')
    expect(() => unmasked(() => { throw new Error('x') })).toThrow(); expect(fmtMoney(1)).toBe('$•••')   // unmasking never leaks past an error
    setPrivacy(false); expect(fmtMoney(5000)).toBe('$5,000')
  })
})

describe('getting-started checklist', () => {
  const S = SETTINGS_DEFAULTS as Settings
  it('an empty household starts at zero, with "Add your accounts" first', () => {
    const steps = setupSteps(emptyData(), S); const p = setupProgress(steps)
    expect(p.done).toBe(0); expect(p.total).toBe(7); expect(p.next?.key).toBe('accounts'); expect(steps.filter(x => x.optional).map(x => x.key)).toEqual(['goal', 'alerts', 'household'])
    expect(hasMoneyData(emptyData())).toBe(false)
  })
  it('the demo household has done the required steps from its own data', () => {
    const s = demoSeed(); const steps = setupSteps(s.data, { ...S, ...s.household.settings }); const by = Object.fromEntries(steps.map(x => [x.key, x.done]))
    expect(by.accounts && by.balances && by.income && by.bills && by.transactions && by.budget && by.goal).toBe(true); expect(hasMoneyData(s.data)).toBe(true)
  })
})

describe('dashboard arrangement', () => {
  const all = ['setup', 'paycheck', 'attention', 'cash', 'runway']
  it('keeps the saved order, drops cards that are gone and slots new ones in their default place', () => {
    expect(normalizeLayout(null, all)).toEqual({ order: all, hidden: [] })
    expect(normalizeLayout({ order: ['cash', 'attention', 'old'], hidden: ['old', 'cash'] }, all)).toEqual({ order: ['setup', 'paycheck', 'cash', 'runway', 'attention'], hidden: ['cash'] })   // runway follows cash, its default neighbour
  })
  it('moves within bounds and hides or shows a card', () => {
    const l = normalizeLayout(null, all); expect(moveCard(l, 'cash', -1).order).toEqual(['setup', 'paycheck', 'cash', 'attention', 'runway']); expect(moveCard(l, 'setup', -1)).toBe(l)
    const h = toggleCard(l, 'runway', false); expect(visibleCards(h)).toEqual(['setup', 'paycheck', 'attention', 'cash']); expect(visibleCards(toggleCard(h, 'runway', true))).toEqual(all)
  })
})

describe('empty states', () => {
  it('a chart with only zeros (or nothing) has no data; one non-zero value is enough', () => {
    expect(noData([{ type: 'bar', x: ['a', 'b'], y: [0, 0] }, { type: 'scatter', y: [] }])).toBe(true); expect(noData([{ type: 'pie', values: [0] }])).toBe(true)
    expect(noData([{ type: 'bar', y: [0, 3] }])).toBe(false); expect(noData([{ type: 'bar', orientation: 'h', y: ['Rent'], x: [1200] }])).toBe(false); expect(noData([{ type: 'heatmap', z: [[0, 0], [0, 1]] }])).toBe(false)
  })
  it('an empty household has no runway to run out of', () => {
    const p = runwayProjection(emptyData(), SETTINGS_DEFAULTS as Settings); expect(p.zeroAt).toBeNull()
  })
  it('every page in the app has help', () => {
    for (const path of ['/', '/forecast', '/insights', '/transactions', '/budget', '/bills', '/income', '/accounts', '/debts', '/connections', '/reconcile', '/email', '/investments', '/tax', '/plan', '/goals', '/protection', '/hardship', '/reports', '/trends', '/settings']) { expect(HELP[path]?.intro, path).toBeTruthy(); expect(HELP[path].sections.length, path).toBeGreaterThan(0) }
  })
})
