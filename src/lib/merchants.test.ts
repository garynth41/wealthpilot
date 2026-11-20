// 0.31.0 — the built-in merchant library: what it makes of real bank descriptions, and how its answers land on a household's own categories.
import { describe, it, expect } from 'vitest'
import { demoSeed, STARTER_CATEGORIES } from '../app/data/demoSeed'
import { libraryMatch, libraryCategory, resolveCategory, librarySize, plain, type Concept } from './merchants'
import { suggest, planAutoCategorise } from './rules'
import { SETTINGS_DEFAULTS, type Category } from '../app/data/types'

const { data } = demoSeed()
const cats = data.categories
const name = (payee: string, kind: 'expense' | 'income' = 'expense') => libraryCategory(cats, payee, kind)?.category.name ?? null

describe('bank descriptions', () => {
  it('knows well over a thousand merchants', () => { expect(librarySize()).toBeGreaterThan(1500) })
  it.each([
    ['KROGER #1234 COLUMBUS OH', 'Groceries'], ['WHOLEFDS MKT 10230', 'Groceries'], ['ALDI 61054', 'Groceries'],
    ['MCDONALD\'S F12345', 'Dining out'], ['TST* CONDADO TACOS', 'Dining out'], ['UBER *EATS', 'Dining out'], ['DOORDASH*CHIPOTLE', 'Dining out'],
    ['STARBUCKS STORE 08812', 'Coffee & snacks'], ['DUNKIN #345678', 'Coffee & snacks'],
    ['SHELL OIL 574433', 'Fuel'], ['SPEEDWAY 09876', 'Fuel'], ['COSTCO GAS #0344', 'Fuel'], ['KROGER FUEL 1234', 'Fuel'],
    ['UBER TRIP HELP.UBER.COM', 'Parking / tolls / transit'], ['E-ZPASS REBILL', 'Parking / tolls / transit'],
    ['NETFLIX.COM', 'Subscriptions & streaming'], ['PAYPAL *NETFLIX', 'Subscriptions & streaming'], ['APPLE.COM/BILL', 'Subscriptions & streaming'], ['GOOGLE *YouTubePremium', 'Subscriptions & streaming'],
    ['CVS/PHARMACY #08123', 'Pharmacy'], ['WALMART PHARMACY 10-22', 'Pharmacy'], ['EXPRESS SCRIPTS', 'Pharmacy'],
    ['AEP OHIO', 'Electric'], ['COLUMBIA GAS OF OHIO', 'Gas'], ['SPECTRUM 855-707-7328', 'Internet'], ['VERIZON WIRELESS', 'Phone'], ['AT&T *BILL PAYMENT', 'Phone'],
    ['THE HOME DEPOT #3811', 'Home maintenance'], ['PLANET FITNESS', 'Gym & fitness'], ['PETSMART # 1234', 'Pets'], ['DELTA AIR 0062', 'Travel'],
    ['GEICO *AUTO', 'Car insurance'], ['JIFFY LUBE #2211', 'Maintenance & repairs'], ['OHIOHEALTH PHYSICIAN GRP', 'Medical & dental'], ['DELTA DENTAL', 'Health insurance'],
    ['AMC THEATRES 0432', 'Entertainment'], ['GREAT CLIPS', 'Personal care'], ['IRS USATAXPYMT', 'Taxes & fees'], ['KINDERCARE', 'Education / childcare'],
  ])('%s → %s', (payee, want) => { expect(name(payee)).toBe(want); expect(libraryMatch(payee)!.confidence).toBe('high') })
  it.each([
    ['ADP PAYROLL DEP', 'Paycheck'], ['ACME CORP DIRECT DEP', 'Paycheck'], ['SSA TREAS 310 XXSOC SEC', 'Benefits'], ['INTEREST PAID', 'Other income'], ['IRS TREAS 310 TAX REF', 'Other income'], ['UPWORK ESCROW', 'Side income'],
  ])('money in: %s → %s', (payee, want) => { expect(name(payee, 'income')).toBe(want) })
  it('a merchant that sells across several budget lines, or only a telling word, is a likely answer — never a confident one', () => {
    for (const p of ['WM SUPERCENTER #2551', 'COSTCO WHSE #344', 'AMZN Mktp US*2K4', 'TARGET 00012345', 'JOES PIZZA', 'SQ *BLUE DOOR CAFE', 'DR SMITH DDS', 'BP#8817', 'TST* SOME PLACE'])
      expect([p, libraryMatch(p)?.confidence]).toEqual([p, 'medium'])
  })
  it('the longer, more specific name wins', () => {
    expect(libraryMatch('UBER EATS')!.concept).toBe('dining'); expect(libraryMatch('UBER')!.concept).toBe('transit')
    expect(libraryMatch('WALMART PHARMACY')!.concept).toBe('pharmacy'); expect(libraryMatch('AMAZON PRIME VIDEO')!.concept).toBe('subscriptions')
  })
  it('says nothing about what it does not know: people, checks, cash, and an income name on a purchase', () => {
    for (const p of ['Never Seen Before LLC', 'ZELLE TO JOHN', 'VENMO PAYMENT', 'CHECK 1042', 'ATM WITHDRAWAL', 'Gavionne', '', null]) expect([p, libraryMatch(p)]).toEqual([p, null])
    expect(libraryMatch('ADP PAYROLL DEP', 'expense')).toBeNull(); expect(libraryMatch('KROGER', 'income')).toBeNull()
  })
  it('matches whole words only', () => { expect(libraryMatch('SHELLEY DESIGN STUDIO')).toBeNull(); expect(libraryMatch('GAPINGVOID LLC')).toBeNull(); expect(plain('POS DEBIT KROGER #12')).toBe(' kroger 12 ') })
})

describe('landing on the household\'s own categories', () => {
  const all = ['groceries', 'dining', 'coffee', 'fuel', 'transit', 'auto_service', 'auto_insurance', 'rent', 'electric', 'gas_utility', 'water', 'internet', 'phone', 'subscriptions', 'pharmacy', 'medical', 'health_insurance', 'gym', 'shopping', 'home', 'personal_care', 'entertainment', 'travel', 'pets', 'kids', 'education', 'gifts', 'insurance', 'taxes', 'fees', 'loan', 'paycheck', 'benefits', 'interest_income', 'side_income', 'other_income'] as Concept[]
  it('every concept has a line among the starter categories, on the right side', () => {
    expect(STARTER_CATEGORIES.length).toBeGreaterThan(30)
    for (const c of all) { const hit = resolveCategory(cats, c); expect([c, !!hit]).toEqual([c, true]); expect(hit!.kind).toBe(['paycheck', 'benefits', 'interest_income', 'side_income', 'other_income'].includes(c) ? 'income' : 'expense') }
  })
  it('"Gas" under Housing is the utility; fuel goes to the Transport line', () => { expect(resolveCategory(cats, 'gas_utility')!.name).toBe('Gas'); expect(resolveCategory(cats, 'fuel')!.name).toBe('Fuel') })
  const mk = (n: string, group = 'X', kind: Category['kind'] = 'expense', extra: Partial<Category> = {}) => ({ ...cats[0], id: 'c-' + n, name: n, group, kind, archived: false, ...extra }) as Category
  it('follows renamed categories, falls back to the nearest line, and gives no answer when there is none', () => {
    const mine = [mk('Supermarket runs'), mk('Restaurants'), mk('Utilities'), mk('Gas', 'Auto'), mk('Fun money')]
    expect(resolveCategory(mine, 'groceries')!.name).toBe('Supermarket runs'); expect(resolveCategory(mine, 'coffee')!.name).toBe('Restaurants')
    expect(resolveCategory(mine, 'electric')!.name).toBe('Utilities'); expect(resolveCategory(mine, 'fuel')!.name).toBe('Gas'); expect(resolveCategory(mine, 'gas_utility')!.name).toBe('Utilities')
    expect(resolveCategory(mine, 'pets')).toBeNull(); expect(libraryCategory(mine, 'PETSMART', 'expense')).toBeNull()
  })
  it('never picks an archived category or one on the wrong side', () => {
    expect(resolveCategory([mk('Groceries', 'Food', 'expense', { archived: true })], 'groceries')).toBeNull()
    expect(resolveCategory([mk('Groceries', 'Food', 'income')], 'groceries')).toBeNull()
  })
})

describe('the suggestion engine uses the library last', () => {
  const s = { ...SETTINGS_DEFAULTS, rules: [] }
  const cat = (n: string) => cats.find(c => c.name === n)!.id
  it('a merchant the household has never filed gets the library\'s answer', () => {
    const sg = suggest(data, s, { payee: 'WHOLEFDS MKT 10230', kind: 'expense' }); expect(sg).toMatchObject({ how: 'library', confidence: 'high', category_id: cat('Groceries'), matched: 'wholefds' })
  })
  it('a rule or the household\'s own history is believed over the library', () => {
    const rule = { id: 'r1', pattern: 'wholefds', match: 'contains' as const, category_id: cat('Dining out'), enabled: true, hits: 0 }
    expect(suggest(data, { ...s, rules: [rule] }, { payee: 'WHOLEFDS MKT 10230', kind: 'expense' })).toMatchObject({ how: 'rule', category_id: cat('Dining out'), confidence: 'high' })
    const t0 = data.transactions.find(t => t.kind === 'expense')!
    const d2 = { ...data, transactions: [...data.transactions, ...[1, 2, 3].map(i => ({ ...t0, id: 'h' + i, payee: 'Zorblat Market', category_id: cat('Entertainment') }))] }
    expect(libraryCategory(cats, 'ZORBLAT MARKET #4', 'expense')!.category.name).toBe('Groceries')
    expect(suggest(d2, s, { payee: 'ZORBLAT MARKET #4', kind: 'expense' })).toMatchObject({ how: 'history', category_id: cat('Entertainment'), confidence: 'high' })
  })
  it('auto-categorize files confident library answers and leaves likely ones for review', () => {
    const t0 = data.transactions.find(t => t.kind === 'expense')!
    const add = (id: string, payee: string) => ({ ...t0, id, payee, category_id: null })
    const d2 = { ...data, transactions: [...data.transactions, add('n1', 'WHOLEFDS MKT 10230'), add('n2', 'JOES PIZZA'), add('n3', 'ZELLE TO JOHN')] }
    const plan = planAutoCategorise(d2, s); const ids = plan.map(p => p.t.id)
    expect(ids).toContain('n1'); expect(ids).not.toContain('n2'); expect(ids).not.toContain('n3')
    expect(planAutoCategorise(d2, s, { onlyUncategorised: true, likely: true }).map(p => p.t.id)).toContain('n2')
  })
})
