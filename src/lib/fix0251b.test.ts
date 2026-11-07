// 0.25.1 fixes (batch b): restore → merge duplicated rows (2), a new statement overwrote a newer balance (3),
// the first reconciliation always balanced (5), and the Ohio tax under / at / over the $26,050 threshold (8).
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// A stand-in for the Supabase client: just enough of PostgREST (select / insert / update / delete with eq filters) over in-memory tables,
// with the same primary-key and unique rules as the schema, so SupabaseRepo.importJson can run in a unit test.
const fake = vi.hoisted(() => {
  type Row = Record<string, unknown>
  const tables: Record<string, Row[]> = {}
  let seq = 0
  const UNIQUE: Record<string, string[][]> = { transactions: [['household_id', 'external_id']], budget_periods: [['household_id', 'start_date', 'end_date']], budget_lines: [['period_id', 'category_id']], bill_occurrences: [['recurring_id', 'due_date']], net_worth_snapshots: [['household_id', 'date']] }
  const err = (message: string, code = '23505') => ({ data: null, error: { code, message } })
  class Q {
    private op: 'select' | 'insert' | 'update' | 'delete' = 'select'; private payload: unknown = null; private filters: Array<[string, unknown]> = []; private one = false
    private t: string
    constructor(t: string) { this.t = t }
    select() { return this } limit() { return this } order() { return this } is() { return this } gte() { return this }
    insert(p: unknown) { this.op = 'insert'; this.payload = p; return this }
    update(p: unknown) { this.op = 'update'; this.payload = p; return this }
    delete() { this.op = 'delete'; return this }
    eq(k: string, v: unknown) { this.filters.push([k, v]); return this }
    single() { this.one = true; return this } maybeSingle() { this.one = true; return this }
    private match = (r: Row) => this.filters.every(([k, v]) => r[k] === v)
    private run() {
      const rows = (tables[this.t] ||= [])
      if (this.op === 'select') { const hit = rows.filter(this.match).map(r => ({ ...r })); return { data: this.one ? hit[0] ?? null : hit, error: null } }
      if (this.op === 'delete') { tables[this.t] = rows.filter(r => !this.match(r)); return { data: null, error: null } }
      if (this.op === 'update') { const hit = rows.filter(this.match); for (const r of hit) Object.assign(r, this.payload, { updated_at: new Date().toISOString() }); if (this.one && hit.length !== 1) return err('JSON object requested, multiple (or no) rows returned', 'PGRST116'); return { data: this.one ? { ...hit[0] } : hit.map(r => ({ ...r })), error: null } }
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[]; const out: Row[] = []
      for (const p of list) {
        if (p.id && rows.some(r => r.id === p.id)) return err(`duplicate key value violates unique constraint "${this.t}_pkey"`)
        for (const cols of UNIQUE[this.t] || []) if (cols.every(c => p[c] != null) && rows.some(r => cols.every(c => r[c] === p[c]))) return err(`duplicate key value violates unique constraint "${this.t}_${cols.join('_')}_key"`)
        const r = { ...p, id: (p.id as string) || `db-${++seq}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; rows.push(r); out.push({ ...r })
      }
      return { data: this.one ? out[0] : out, error: null }
    }
    then<A, B>(ok: (v: unknown) => A, bad?: (e: unknown) => B) { return Promise.resolve(this.run()).then(ok, bad) }
  }
  const client = { from: (t: string) => new Q(t), auth: { getUser: async () => ({ data: { user: { id: 'u-1', email: 'owner@example.com' } } }) }, rpc: async () => ({ data: null, error: null }) }
  return { tables, client, reset: () => { for (const k of Object.keys(tables)) delete tables[k]; seq = 0 } }
})
vi.mock('../app/supabase', () => ({ sb: () => fake.client, hasSupabase: () => true, authFeatures: async () => null }))

import { setToday } from './dates'
import { emptyData, SETTINGS_DEFAULTS, TABLE, type Account, type Collection, type Data, type Household } from '../app/data/types'
import { MemoryRepo } from '../app/data/memoryRepo'
import { SupabaseRepo } from '../app/data/supabaseRepo'
import { demoSeed } from '../app/data/demoSeed'
import { useStore } from '../app/store'
import { ModalHost } from '../components/ui'
import { StatementModal } from '../pages/Accounts'
import { ReconcilePage } from '../pages/Reconcile'
import { statementUpdate } from './statements'
import { reconcileStatement, type RAccount, type RTxn } from './reconcile'
import { extract, type Fact } from './email/extract'
import { propose } from './email/propose'
import { applyMany, type Ctx } from './email/apply'
import { estimateTax, ohioTax, type TaxItem } from './tax'
import { OHIO } from './taxTables'

beforeAll(() => setToday('2026-11-04'))
afterEach(() => cleanup())

// ======================================================================================================
// Bug 2 — Settings → Backup & data → Restore → "Merge into this household" duplicated what was already there
// ======================================================================================================
const HH = 'hh-1'
const STAMP_OLD = '2026-10-25T12:00:00.000Z', STAMP_NOW = '2026-11-01T12:00:00.000Z', STAMP_NEWER = '2026-11-03T12:00:00.000Z'
type Rows = Partial<Record<Collection | 'duplicates', Array<Record<string, unknown>>>>
/** What the household already holds (ids a-…, c-…, t-…, p-…). */
const existingRows = (): Rows => ({
  accounts: [{ id: 'a-chk', name: 'Everyday Checking', kind: 'checking', institution: 'Huntington', last4: '4410', balance: 1000, balance_as_of: '2026-11-01', apr: 0, minimum_payment: 0, autopay: false, include_in_cash: true, include_in_net_worth: true, status: 'Active', sort_order: 1, updated_at: STAMP_NOW }],
  categories: [{ id: 'c-groc', name: 'Groceries', group: 'Food', kind: 'expense', priority: 'Essential', cost_type: 'Variable', default_budget: 400, budget_cadence: 'period', rollover: false, sort_order: 1, archived: false, updated_at: STAMP_NOW }],
  periods: [{ id: 'p-nov', period_type: 'month', start_date: '2026-11-01', end_date: '2026-11-30', status: 'open', expected_income: 0, updated_at: STAMP_NOW }],
  transactions: [{ id: 't-bank', date: '2026-10-20', kind: 'expense', amount: 82.5, account_id: 'a-chk', category_id: 'c-groc', payee: 'KROGER', tags: [], status: 'cleared', source: 'import', external_id: 'sfin:ACT-1:abc', exclude_from_budget: false, updated_at: STAMP_NOW }],
})
/** A backup of the same records taken elsewhere (every id differs), plus records the household does not have yet. */
const backupRows = (): Rows => ({
  accounts: [
    { id: 'old-chk', name: 'Everyday Checking', kind: 'checking', institution: 'Huntington', last4: '4410', balance: 900, balance_as_of: '2026-10-25', apr: 0, minimum_payment: 0, autopay: false, include_in_cash: true, include_in_net_worth: true, status: 'Active', sort_order: 1, updated_at: STAMP_OLD },
    { id: 'old-sav', name: 'Rainy Day Savings', kind: 'savings', institution: 'Ally', balance: 5000, apr: 0, minimum_payment: 0, autopay: false, include_in_cash: true, include_in_net_worth: true, status: 'Active', sort_order: 2, linked_account_id: 'old-chk', updated_at: STAMP_OLD },
  ],
  categories: [
    { id: 'old-groc', name: 'Groceries', group: 'Food', kind: 'expense', priority: 'Essential', cost_type: 'Variable', default_budget: 400, budget_cadence: 'period', rollover: false, sort_order: 1, archived: false, updated_at: STAMP_OLD },
    { id: 'old-fun', name: 'Fun money', group: 'Personal', kind: 'expense', priority: 'Discretionary', cost_type: 'Variable', default_budget: 50, budget_cadence: 'period', rollover: false, sort_order: 2, archived: false, updated_at: STAMP_OLD },
  ],
  periods: [{ id: 'old-nov', period_type: 'month', start_date: '2026-11-01', end_date: '2026-11-30', status: 'open', expected_income: 0, updated_at: STAMP_OLD }],
  lines: [{ id: 'old-line', period_id: 'old-nov', category_id: 'old-groc', planned: 400, rollover_in: 0, updated_at: STAMP_OLD }],
  transactions: [
    { id: 'old-bank', date: '2026-10-20', kind: 'expense', amount: 82.5, account_id: 'old-chk', category_id: 'old-groc', payee: 'KROGER', tags: [], status: 'cleared', source: 'import', external_id: 'sfin:ACT-1:abc', exclude_from_budget: false, updated_at: STAMP_OLD },
    { id: 'old-cash', date: '2026-10-22', kind: 'expense', amount: 20, account_id: 'old-sav', category_id: 'old-fun', payee: 'Movie night', tags: [], status: 'cleared', source: 'manual', external_id: null, email_item_id: 'old-em', exclude_from_budget: false, updated_at: STAMP_OLD },
  ],
  // merged duplicates travel in the backup under their own key in some exports
  duplicates: [{ id: 'old-dup', date: '2026-10-22', kind: 'expense', amount: 20, account_id: 'old-sav', category_id: 'old-fun', payee: 'MOVIE NIGHT', tags: [], status: 'cleared', source: 'email', external_id: null, duplicate_of: 'old-cash', exclude_from_budget: false, updated_at: STAMP_OLD }],
  splits: [{ id: 'old-split', transaction_id: 'old-bank', category_id: 'old-fun', amount: 10, sort_order: 1, updated_at: STAMP_OLD }],
  statements: [{ id: 'old-st', account_id: 'old-chk', statement_date: '2026-10-31', statement_balance: 950, minimum_payment: 0, source: 'manual', updated_at: STAMP_OLD }],
  recurring: [{ id: 'old-rent', name: 'Rent', kind: 'bill', amount: 1200, amount_varies: false, frequency: 'monthly', account_id: 'old-chk', category_id: 'old-fun', autopay: false, reminder_days: 3, status: 'Active', sort_order: 1, updated_at: STAMP_OLD }],
  occurrences: [{ id: 'old-occ', recurring_id: 'old-rent', due_date: '2026-11-01', amount: 1200, status: 'due', updated_at: STAMP_OLD }],
  goals: [{ id: 'old-goal', name: 'Trip', kind: 'savings', target_amount: 2000, account_id: 'old-sav', starting_amount: 0, monthly_contribution: 100, priority: 1, status: 'Active', sort_order: 1, updated_at: STAMP_OLD }],
  contributions: [{ id: 'old-gc', goal_id: 'old-goal', date: '2026-10-22', amount: 20, transaction_id: 'old-cash', updated_at: STAMP_OLD }],
  emailItems: [{ id: 'old-em', kind: 'paid', payee: 'Movie night', amount: 20, autopay: false, transaction_id: 'old-cash', evidence: [{ msg_id: 'm-77', src: 'gmail', subject: 'Receipt', date: '2026-10-22' }], updated_at: STAMP_OLD }],
})
const asBackup = (rows: Rows) => ({ app: 'WealthPilot', exported_at: STAMP_OLD, household: { id: 'hh-old', name: 'Old' }, ...rows })
const household = (): Household => ({ id: HH, name: 'Test', currency: 'USD', settings: { ...SETTINGS_DEFAULTS } })
const memoryWith = (rows: Rows) => { const d = emptyData() as unknown as Record<string, unknown[]>; for (const [k, v] of Object.entries(rows)) d[k] = v.map(r => ({ ...r, household_id: HH })); return new MemoryRepo({ household: household(), data: d as unknown as Data }) }
const supabaseWith = (rows: Rows) => { fake.reset(); for (const [k, v] of Object.entries(rows)) fake.tables[TABLE[(k === 'duplicates' ? 'transactions' : k) as Collection]] = [...(fake.tables[TABLE[(k === 'duplicates' ? 'transactions' : k) as Collection]] || []), ...v.map(r => ({ ...r, household_id: HH }))]; return new SupabaseRepo(HH) }
/** Every restorable table as the repo now holds it (transactions include merged duplicates). */
const contents = async (repo: MemoryRepo | SupabaseRepo): Promise<Record<string, Array<Record<string, unknown>>>> => {
  if (repo instanceof MemoryRepo) { const d = repo.data as unknown as Record<string, Array<Record<string, unknown>>>; return { ...d, transactions: [...d.transactions, ...(d.duplicates || [])] } }
  const out: Record<string, Array<Record<string, unknown>>> = {}; for (const [k, t] of Object.entries(TABLE)) out[k] = (fake.tables[t] || []).filter(r => r.household_id === HH); return out
}
/** The household described without ids — so two repos (whose new ids differ) can be compared, and so every link is checked by what it points at. */
async function describeHousehold(repo: MemoryRepo | SupabaseRepo) {
  const d = await contents(repo); const by = (k: string) => new Map((d[k] || []).map(r => [r.id as string, r]))
  const A = by('accounts'), C = by('categories'), P = by('periods'), Tx = by('transactions'), R = by('recurring'), G = by('goals'), E = by('emailItems')
  const name = (m: Map<string, Record<string, unknown>>, id: unknown, f = 'name') => (id == null ? null : (m.get(id as string)?.[f] as string) ?? `MISSING(${String(id)})`)
  return {
    accounts: d.accounts.map(r => `${r.name}|${r.balance}|linked:${name(A, r.linked_account_id)}`).sort(),
    categories: d.categories.map(r => `${r.group}/${r.name}`).sort(),
    periods: d.periods.map(r => `${r.start_date}..${r.end_date}`).sort(),
    lines: d.lines.map(r => `${name(P, r.period_id, 'start_date')}|${name(C, r.category_id)}|${r.planned}`).sort(),
    transactions: d.transactions.map(r => `${r.payee}|${name(A, r.account_id)}|${name(C, r.category_id)}|dup:${name(Tx, r.duplicate_of, 'payee')}|email:${name(E, r.email_item_id, 'payee')}`).sort(),
    splits: d.splits.map(r => `${name(Tx, r.transaction_id, 'payee')}|${name(C, r.category_id)}|${r.amount}`).sort(),
    statements: d.statements.map(r => `${name(A, r.account_id)}|${r.statement_date}|${r.statement_balance}`).sort(),
    recurring: d.recurring.map(r => `${r.name}|${name(A, r.account_id)}|${name(C, r.category_id)}`).sort(),
    occurrences: d.occurrences.map(r => `${name(R, r.recurring_id)}|${r.due_date}`).sort(),
    goals: d.goals.map(r => `${r.name}|${name(A, r.account_id)}`).sort(),
    contributions: d.contributions.map(r => `${name(G, r.goal_id)}|${name(Tx, r.transaction_id, 'payee')}|${r.amount}`).sort(),
    emailItems: d.emailItems.map(r => `${r.payee}|${name(Tx, r.transaction_id, 'payee')}`).sort(),
  }
}
const EXPECTED_AFTER_MERGE = {
  accounts: ['Everyday Checking|1000|linked:null', 'Rainy Day Savings|5000|linked:Everyday Checking'],   // the household's own, newer checking row wins over the backup's
  categories: ['Food/Groceries', 'Personal/Fun money'],
  periods: ['2026-11-01..2026-11-30'],
  lines: ['2026-11-01|Groceries|400'],
  transactions: ['KROGER|Everyday Checking|Groceries|dup:null|email:null', 'MOVIE NIGHT|Rainy Day Savings|Fun money|dup:Movie night|email:null', 'Movie night|Rainy Day Savings|Fun money|dup:null|email:Movie night'],
  splits: ['KROGER|Fun money|10'],
  statements: ['Everyday Checking|2026-10-31|950'],
  recurring: ['Rent|Everyday Checking|Fun money'],
  occurrences: ['Rent|2026-11-01'],
  goals: ['Trip|Rainy Day Savings'],
  contributions: ['Trip|Movie night|20'],
  emailItems: ['Movie night|Movie night'],
}

describe('bug 2 — restore → merge matches what is already there', () => {
  it('merging a household\'s own backup back into it adds nothing (demo household)', async () => {
    const repo = new MemoryRepo(demoSeed()); const before = await contents(repo)
    const counts = (d: Record<string, unknown[]>) => Object.fromEntries(Object.keys(TABLE).filter(k => k !== 'balances').map(k => [k, (d[k] || []).length]))
    const backup = await repo.exportJson()
    await repo.importJson(JSON.parse(JSON.stringify(backup)), 'merge')
    expect(counts(await contents(repo))).toEqual(counts(before))
    const ids = (await contents(repo)).transactions.map(t => t.id); expect(new Set(ids).size).toBe(ids.length)
  })
  it('in-browser repo: matches by id first, then by natural key (external id, names, dates); children point at the surviving parents', async () => {
    const repo = memoryWith(existingRows())
    const sum = await repo.importJson(asBackup(backupRows()), 'merge')
    expect(await describeHousehold(repo)).toEqual(EXPECTED_AFTER_MERGE)
    expect((await contents(repo)).transactions.find(t => t.external_id === 'sfin:ACT-1:abc')!.id).toBe('t-bank')
    expect(sum).toMatchObject({ added: 12, updated: 0 })
    // the same file again changes nothing
    const again = await repo.importJson(asBackup(backupRows()), 'merge')
    expect(await describeHousehold(repo)).toEqual(EXPECTED_AFTER_MERGE); expect(again).toMatchObject({ added: 0, updated: 0 })
  })
  it('database repo: the same merge gives the same household', async () => {
    const repo = supabaseWith(existingRows())
    const sum = await repo.importJson(asBackup(backupRows()), 'merge')
    expect(await describeHousehold(repo)).toEqual(EXPECTED_AFTER_MERGE)
    expect(sum).toMatchObject({ added: 12, updated: 0 })
    const again = await repo.importJson(asBackup(backupRows()), 'merge')
    expect(await describeHousehold(repo)).toEqual(EXPECTED_AFTER_MERGE); expect(again).toMatchObject({ added: 0, updated: 0 })
  })
  it('a record the backup holds in a newer version is updated in place (both repos); an older one is left alone', async () => {
    const newer = backupRows(); newer.accounts![0] = { ...newer.accounts![0], balance: 1111, updated_at: STAMP_NEWER }
    for (const repo of [memoryWith(existingRows()), supabaseWith(existingRows())]) {
      const sum = await repo.importJson(asBackup(newer), 'merge')
      const d = await contents(repo); const chk = d.accounts.filter(a => a.name === 'Everyday Checking')
      expect(chk).toHaveLength(1); expect(chk[0].id).toBe('a-chk'); expect(chk[0].balance).toBe(1111); expect(sum.updated).toBe(1)
    }
  })
  it('database repo: a backup id already used by another household gets a new id, and its children follow it', async () => {
    const repo = supabaseWith(existingRows())
    for (const r of backupRows().accounts!) (fake.tables.accounts ||= []).push({ ...r, household_id: 'hh-other' })   // the household the backup came from still exists
    await repo.importJson(asBackup(backupRows()), 'merge')
    expect(await describeHousehold(repo)).toEqual(EXPECTED_AFTER_MERGE)
    const sav = fake.tables.accounts.find(a => a.household_id === HH && a.name === 'Rainy Day Savings')!; expect(sav.id).not.toBe('old-sav')
    expect(fake.tables.goals.find(g => g.household_id === HH)!.account_id).toBe(sav.id)
  })
  it('replace still loads the whole backup (both repos)', async () => {
    for (const repo of [memoryWith(existingRows()), supabaseWith(existingRows())]) {
      const sum = await repo.importJson(asBackup(backupRows()), 'replace'); const d = await describeHousehold(repo)
      expect(d.accounts).toEqual(['Everyday Checking|900|linked:null', 'Rainy Day Savings|5000|linked:Everyday Checking']); expect(d.transactions).toHaveLength(3); expect(d.lines).toEqual(['2026-11-01|Groceries|400'])
      expect(sum.added).toBe(16); expect(sum.unchanged).toBe(0)
    }
  })
  it('a backup row whose id already exists here is matched by id even when its details changed', async () => {
    const own = existingRows(); const backup: Rows = { accounts: [{ ...own.accounts![0], name: 'Checking (renamed later)', updated_at: STAMP_OLD }] }
    for (const repo of [memoryWith(existingRows()), supabaseWith(existingRows())]) {
      await repo.importJson(asBackup(backup), 'merge'); const d = await contents(repo)
      expect(d.accounts).toHaveLength(1); expect(d.accounts[0].name).toBe('Everyday Checking')
    }
  })
})

// ======================================================================================================
// Bug 3 — a new statement replaced a newer or bank-fed balance
// ======================================================================================================
const card = (p: Partial<Account> = {}): Account => ({ id: 'cc', household_id: HH, name: 'Visa', kind: 'credit_card', balance: 500, balance_as_of: '2026-11-03', bank_balance: null, apr: 22, statement_date: '2026-10-03', statement_balance: 400, minimum_payment: 25, due_date: '2026-10-28', planned_payment: 100, autopay: false, include_in_cash: false, include_in_net_worth: true, status: 'Active', sort_order: 1, last_paid_due: '2026-10-28', ...p } as Account)
const NOV = { statement_date: '2026-11-01', statement_balance: 450, minimum_payment: 30, due_date: '2026-11-26' }

describe('bug 3 — a statement is a snapshot as of its statement date', () => {
  it('keeps a balance dated after the statement, but records the statement fields', () => {
    const r = statementUpdate(card(), NOV)
    expect(r.balanceMoved).toBe(false); expect(r.patch).not.toHaveProperty('balance'); expect(r.patch).not.toHaveProperty('balance_as_of')
    expect(r.patch).toMatchObject({ statement_date: '2026-11-01', statement_balance: 450, minimum_payment: 30, due_date: '2026-11-26', last_paid_due: null, planned_payment: 100 })
  })
  it('keeps a bank-feed balance even when it is older than the statement', () => {
    const r = statementUpdate(card({ balance_as_of: '2026-10-15', bank_balance: 520, bank_balance_as_of: '2026-10-15' }), NOV)
    expect(r.balanceMoved).toBe(false); expect(r.patch).not.toHaveProperty('balance'); expect(r.patch.statement_balance).toBe(450)
  })
  it('moves the balance when the statement is the newest information (older or same-day balance, no bank feed)', () => {
    for (const asOf of ['2026-10-20', '2026-11-01', null]) {
      const r = statementUpdate(card({ balance_as_of: asOf }), NOV)
      expect(r.balanceMoved, String(asOf)).toBe(true); expect(r.patch).toMatchObject({ balance: 450, balance_as_of: '2026-11-01', statement_balance: 450 })
    }
  })
  it('an older statement than the one on file goes into the history only', () => {
    const r = statementUpdate(card({ balance_as_of: '2026-09-01' }), { ...NOV, statement_date: '2026-09-03' })
    expect(r.patch).toEqual({}); expect(r.balanceMoved).toBe(false); expect(r.newest).toBe(false)
  })
  it('Accounts → New statement saves the statement and keeps a bank-feed balance', async () => {
    const seed = demoSeed(); const chase = seed.data.accounts.find(a => a.name === 'Chase Freedom')!
    Object.assign(chase, { balance: 1500, bank_balance: 1500, bank_balance_as_of: '2026-11-04', balance_as_of: '2026-11-04' })
    const repo = new MemoryRepo(seed); useStore.setState({ mode: 'demo', repo, role: 'owner', readOnly: false, offlineAt: null }); await useStore.getState().refresh()
    const n0 = repo.data.statements.length
    render(createElement(ModalHost, null, createElement(StatementModal, { a: repo.data.accounts.find(a => a.id === chase.id)!, onDone: () => {} })))
    fireEvent.change(screen.getByLabelText('Statement date'), { target: { value: '2026-11-02' } })
    fireEvent.change(screen.getByLabelText('Statement balance'), { target: { value: '1450.00' } })
    fireEvent.change(screen.getByLabelText(/Minimum payment/), { target: { value: '45.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save statement' }))
    await waitFor(() => expect(repo.data.statements.length).toBe(n0 + 1))
    await waitFor(() => expect(repo.data.accounts.find(a => a.id === chase.id)!.statement_balance).toBe(1450))
    const after = repo.data.accounts.find(a => a.id === chase.id)!
    expect(after.balance).toBe(1500); expect(after.balance_as_of).toBe('2026-11-04'); expect(after.minimum_payment).toBe(45); expect(after.statement_date).toBe('2026-11-02')
  })
  it('a statement filed from email follows the same rule', async () => {
    const seed = demoSeed(); const chase = seed.data.accounts.find(a => a.name === 'Chase Freedom')!
    Object.assign(chase, { balance: 1500, bank_balance: 1500, bank_balance_as_of: '2026-11-04', balance_as_of: '2026-11-04' })
    const repo = new MemoryRepo(seed); const ctx: Ctx = { data: () => repo.data, settings: () => repo.household.settings, insert: (c, r) => repo.insert(c, r), update: (c, id, p) => repo.update(c, id, p), saveSettings: async p => { await repo.saveSettings(p) }, ledger: r => repo.ledger(r) }
    const f = { ...(extract({ id: 'e1', date: new Date('2026-11-03T12:00:00'), from: { name: '', email: 'alerts@chase.com' }, subject: 'Your statement is ready', body: 'Chase Freedom account ending in 4821. New balance: $1,410.20. Minimum payment due: $44.00. Payment due date: 12/02/2026. Statement date: 11/03/2026.', sent: false }) as Fact), ev: [{ msg_id: 'e1', src: 'gmail', subject: 'Your statement is ready', date: '2026-11-03' }] }
    await applyMany(ctx, propose(repo.data, repo.household.settings, [f]).filter(p => p.kind === 'item' && p.checked))
    const after = repo.data.accounts.find(a => a.id === chase.id)!
    expect(after.statement_balance).toBe(1410.2); expect(after.minimum_payment).toBe(44); expect(after.balance).toBe(1500); expect(after.balance_as_of).toBe('2026-11-04')
  })
})

// ======================================================================================================
// Bug 5 — the first reconciliation of an account always balanced
// ======================================================================================================
const CHK: RAccount = { id: 'chk', kind: 'checking', balance: 1000, bank_balance: null }
const pay = (p: Partial<RTxn>): RTxn => ({ id: 'x', date: '2026-10-20', kind: 'expense', amount: 50, account_id: 'chk', payee: 'Store', source: 'import', external_id: 'sfin:A:1', status: 'cleared', ...p })

describe('bug 5 — the first reconciliation needs the statement\'s beginning balance', () => {
  it('without a beginning balance it cannot be verified, so it never claims to balance', () => {
    const r = reconcileStatement({ account: CHK, txns: [pay({ id: 'p1' })], statementDate: '2026-10-31', statementBalance: 940, clearedIds: ['p1'], previous: null })
    expect(r.firstTime).toBe(true); expect(r.openingKnown).toBe(false); expect(r.balanced).toBe(false); expect(r.variance).toBeNull(); expect(r.openingBalance).toBeNull()
  })
  it('with the beginning balance the difference is real: it balances only when the statement adds up', () => {
    const base = { account: CHK, txns: [pay({ id: 'p1' })], statementDate: '2026-10-31', clearedIds: ['p1'], previous: null, openingBalance: 1000 }
    const ok = reconcileStatement({ ...base, statementBalance: 950 }); expect(ok.openingKnown).toBe(true); expect(ok.openingBalance).toBe(1000); expect(ok.computedEnding).toBe(950); expect(ok.variance).toBe(0); expect(ok.balanced).toBe(true)
    const off = reconcileStatement({ ...base, statementBalance: 940 }); expect(off.variance).toBe(10); expect(off.balanced).toBe(false)
  })
  it('after the first, the previous statement\'s ending balance is the opening (a typed beginning balance is ignored)', () => {
    const r = reconcileStatement({ account: CHK, txns: [pay({ id: 'p1' })], statementDate: '2026-11-30', statementBalance: 900, clearedIds: ['p1'], previous: { statement_date: '2026-10-31', statement_balance: 950 }, openingBalance: 5 })
    expect(r.firstTime).toBe(false); expect(r.openingBalance).toBe(950); expect(r.balanced).toBe(true)
  })
  it('the Reconcile page asks for "Beginning balance on this statement" on the first reconciliation and will not complete without it', async () => {
    const repo = new MemoryRepo(demoSeed()); repo.data.reconciliations = []
    useStore.setState({ mode: 'demo', repo, role: 'owner', readOnly: false, offlineAt: null }); await useStore.getState().refresh()
    render(createElement(MemoryRouter, null, createElement(ModalHost, null, createElement(ReconcilePage))))
    fireEvent.click(screen.getByRole('button', { name: 'Reconcile a statement' }))
    fireEvent.change(screen.getByLabelText(/Ending balance on the statement/), { target: { value: '1234.56' } })
    const begin = screen.getByLabelText(/Beginning balance on this statement/)
    const complete = () => screen.getByRole('button', { name: /^Complete/ })
    expect(complete()).toBeDisabled()
    fireEvent.change(begin, { target: { value: '1000' } })
    await waitFor(() => expect(complete()).not.toBeDisabled())
  })
})

// ======================================================================================================
// Bug 8 — Ohio: no tax up to $26,050; above it the schedule's base amount plus 2.75% of the excess (2025 top bracket 3.125%)
// ======================================================================================================
const TI = (kind: TaxItem['kind'], amount: number): TaxItem => ({ id: kind + amount, kind, label: kind, amount, source: 'manual' })
const blank = () => ({ ...demoSeed().data, paySchedules: [], holdings: [], transactions: [], recurring: [] })
/** Ohio tax for a single filer whose W-2 wages leave exactly `ohioTaxable` after the personal exemption. */
const ohioOn = (ohioTaxable: number, year: number) => {
  const exempt = ohioTaxable + 2400 <= 40000 ? 2400 : ohioTaxable + 2150 <= 80000 ? 2150 : 1900
  const e = estimateTax(blank(), SETTINGS_DEFAULTS, { year, filingStatus: 'single', state: 'OH', autoAggregate: false, items: [TI('w2', ohioTaxable + exempt)] })
  expect(e.state.taxable).toBe(ohioTaxable); return e.state.tax
}

describe('bug 8 — Ohio income tax brackets (ORC 5747.02 as amended by HB 96; Ohio Department of Taxation annual rates)', () => {
  it('the tables: $26,050 threshold, $332.00 + 2.75% for 2026, $342.00 + 2.75% and $2,394.32 + 3.125% over $100,000 for 2025', () => {
    expect(OHIO[2026].threshold).toBe(26050); expect(OHIO[2026].brackets).toEqual([{ over: 26050, base: 332, rate: 0.0275 }])
    expect(OHIO[2025].threshold).toBe(26050); expect(OHIO[2025].brackets).toEqual([{ over: 26050, base: 342, rate: 0.0275 }, { over: 100000, base: 2394.32, rate: 0.03125 }])
  })
  it('below the threshold: no tax', () => { expect(ohioOn(20000, 2026)).toBe(0); expect(ohioOn(20000, 2025)).toBe(0); expect(ohioTax(1, 2026)).toBe(0) })
  it('at the threshold: no tax', () => { expect(ohioOn(26050, 2026)).toBe(0); expect(ohioOn(26050, 2025)).toBe(0) })
  it('just above the threshold the base amount applies at once', () => { expect(ohioTax(26051, 2026)).toBeCloseTo(332.03, 2); expect(ohioTax(26051, 2025)).toBeCloseTo(342.03, 2) })
  it('above the threshold: base + 2.75% of the amount over $26,050', () => {
    expect(ohioOn(30000, 2026)).toBe(440.63)     // 332 + 3,950 × 2.75% = 440.625 → to the cent
    expect(ohioOn(30000, 2025)).toBe(450.63)     // 342 + 3,950 × 2.75%
    expect(ohioOn(150000, 2026)).toBe(3740.63)   // flat for 2026: 332 + 123,950 × 2.75% = 3,740.625
    expect(ohioOn(100000, 2025)).toBe(2375.63)   // 2025 at the top of the 2.75% bracket: 342 + 73,950 × 2.75%
  })
  it('2025 over $100,000: $2,394.32 + 3.125% of the excess', () => { expect(ohioOn(150000, 2025)).toBe(3956.82); expect(ohioTax(100001, 2025)).toBe(2394.35) })
  it('personal exemptions: none at $500,000 of income or more for 2026; the 2025 limit was $750,000', () => {
    const at = (w2: number, year: number) => estimateTax(blank(), SETTINGS_DEFAULTS, { year, filingStatus: 'single', state: 'OH', autoAggregate: false, items: [TI('w2', w2)] }).state.taxable
    expect(at(600000, 2026)).toBe(600000); expect(at(600000, 2025)).toBe(598100)
  })
})
