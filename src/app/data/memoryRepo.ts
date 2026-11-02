// Offline demo repo: the same contract as Supabase, kept in this browser (localStorage). Also the harness for the test suites.
import type { Repo } from './repo'
import { emptyData, SETTINGS_DEFAULTS, type Collection, type Data, type Household, type RowOf, type Settings, type EmailLedgerRow, type Role } from './types'
import { demoSeed, demoId } from './demoSeed'
import { LS } from '../config'
import { monthKey, today } from '../../lib/dates'

const KEY = LS('demo')
const PREFIX: Partial<Record<Collection, string>> = { transactions: 'T', accounts: 'A', recurring: 'R', goals: 'G', planned: 'X', hardship: 'H', emailItems: 'E', statements: 'S', paySchedules: 'P', categories: 'C', periods: 'B', holdings: 'I' }

export class MemoryRepo implements Repo {
  readonly mode = 'demo' as const
  household: Household
  data: Data
  private listeners = new Set<() => void>()
  constructor(seed?: { household: Household; data: Data }) {
    const saved = seed ? null : this.load()
    const s = seed || saved || demoSeed()
    this.household = s.household; this.data = s.data
    if (!saved && !seed) this.persist()
  }
  private load(): { household: Household; data: Data } | null { try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); if (j && j.data && j.household) return { household: j.household, data: { ...emptyData(), ...j.data } } } catch { /* ignore */ } return null }
  private persist() { try { localStorage.setItem(KEY, JSON.stringify({ household: this.household, data: this.data })) } catch { /* quota or private mode */ } }
  reset() { const s = demoSeed(); this.household = s.household; this.data = s.data; this.persist(); this.emit() }
  private emit() { this.listeners.forEach(f => f()) }
  async loadAll() { return { household: this.household, data: this.data, role: 'owner' as Role, readOnly: false } }
  private nextRef(coll: Collection) { const p = PREFIX[coll]; if (!p) return undefined; const rows = this.data[coll] as Array<{ ref?: string | null }>; const n = Math.max(0, ...rows.map(r => +String(r.ref || '').split('-')[1] || 0)) + 1; return `${p}-${String(n).padStart(3, '0')}` }
  async insert<C extends Collection>(coll: C, row: Partial<RowOf<C>>) {
    const r = { ...row, id: (row as { id?: string }).id || demoId(), household_id: this.household.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as RowOf<C> & { ref?: string | null }
    if ('ref' in r || PREFIX[coll]) { if (!r.ref) r.ref = this.nextRef(coll) }
    if (coll === 'holdings') { const h = r as unknown as { quantity: number; price: number; value?: number }; h.value = Math.round((+h.quantity || 0) * (+h.price || 0) * 100) / 100 }   // mirrors the DB's generated column
    ;(this.data[coll] as unknown as RowOf<C>[]).push(r); this.persist(); this.emit(); return r
  }
  async insertMany<C extends Collection>(coll: C, rows: Partial<RowOf<C>>[]) { const out: RowOf<C>[] = []; for (const r of rows) out.push(await this.insert(coll, r)); return out }
  async update<C extends Collection>(coll: C, id: string, patch: Partial<RowOf<C>>) {
    const arr = this.data[coll] as unknown as RowOf<C>[]; const i = arr.findIndex(x => (x as { id: string }).id === id); if (i < 0) throw new Error('Row not found')
    arr[i] = { ...arr[i], ...patch, updated_at: new Date().toISOString() }
    if (coll === 'holdings') { const h = arr[i] as unknown as { quantity: number; price: number; value?: number }; h.value = Math.round((+h.quantity || 0) * (+h.price || 0) * 100) / 100 }
    this.persist(); this.emit(); return arr[i]
  }
  async remove(coll: Collection, id: string) {
    const arr = this.data[coll] as Array<{ id: string }>; const i = arr.findIndex(x => x.id === id); if (i < 0) return; arr.splice(i, 1)
    // cascades mirroring the schema
    if (coll === 'periods') this.data.lines = this.data.lines.filter(l => l.period_id !== id)
    if (coll === 'recurring') this.data.occurrences = this.data.occurrences.filter(o => o.recurring_id !== id)
    if (coll === 'goals') this.data.contributions = this.data.contributions.filter(c => c.goal_id !== id)
    if (coll === 'accounts') { this.data.statements = this.data.statements.filter(s => s.account_id !== id); this.data.transactions.forEach(x => { if (x.account_id === id) x.account_id = null; if (x.to_account_id === id) x.to_account_id = null }) }
    if (coll === 'categories') { this.data.lines = this.data.lines.filter(l => l.category_id !== id); this.data.transactions.forEach(x => { if (x.category_id === id) x.category_id = null }) }
    this.persist(); this.emit()
  }
  async saveSettings(patch: Partial<Settings>) { this.household = { ...this.household, settings: { ...SETTINGS_DEFAULTS, ...this.household.settings, ...patch } }; this.persist(); this.emit(); return this.household.settings }
  async renameHousehold(name: string) { this.household = { ...this.household, name }; this.persist(); this.emit() }
  async startPeriod(type: string, start: string, end: string, label?: string) {
    const ex = this.data.periods.find(p => p.start_date === start && p.end_date === end); if (ex) return ex.id
    const p = await this.insert('periods', { period_type: type as RowOf<'periods'>['period_type'], start_date: start, end_date: end, label: label ?? null, status: start > today() ? 'planned' : 'open', expected_income: 0 })
    const prev = this.data.periods.filter(x => x.id !== p.id && x.start_date < start).sort((a, b) => b.start_date.localeCompare(a.start_date))[0]
    if (prev) {
      for (const bl of this.data.lines.filter(l => l.period_id === prev.id)) { const c = this.data.categories.find(x => x.id === bl.category_id); if (!c || c.archived) continue
        const spent = this.data.transactions.filter(t => t.category_id === c.id && t.kind === 'expense' && t.status !== 'void' && !t.exclude_from_budget && t.date >= prev.start_date && t.date <= prev.end_date).reduce((s, t) => s + t.amount, 0)
        await this.insert('lines', { period_id: p.id, category_id: c.id, planned: bl.planned, rollover_in: c.rollover ? Math.max(0, bl.planned + bl.rollover_in - spent) : 0 }) }
    } else for (const c of this.data.categories.filter(c => !c.archived && c.kind !== 'transfer')) await this.insert('lines', { period_id: p.id, category_id: c.id, planned: c.default_budget, rollover_in: 0 })
    return p.id
  }
  async ledger(rows: Omit<EmailLedgerRow, 'household_id'>[]) { for (const r of rows) { const i = this.data.emailLedger.findIndex(x => x.message_id === r.message_id); const row = { ...r, household_id: this.household.id, decided_at: new Date().toISOString() }; if (i >= 0) this.data.emailLedger[i] = row; else this.data.emailLedger.push(row) } this.persist() }
  async invite(email: string, role: Role) { this.data.invites.push({ id: demoId(), household_id: this.household.id, email, role }); this.persist(); this.emit() }
  async removeMember(userId: string) { this.data.members = this.data.members.filter(m => m.user_id !== userId); this.persist(); this.emit() }
  async setMemberRole(userId: string, role: Role, readOnly: boolean) { this.data.members = this.data.members.map(m => m.user_id === userId ? { ...m, role, read_only: readOnly } : m); this.persist(); this.emit() }
  async exportJson() { return { app: 'WealthPilot', exported_at: new Date().toISOString(), household: this.household, ...this.data } }
  async importJson(json: Record<string, unknown>, mode: 'merge' | 'replace') {
    let n = 0; if (mode === 'replace') this.data = emptyData()
    for (const k of Object.keys(emptyData()) as Collection[]) { const rows = json[k]; if (Array.isArray(rows)) { for (const r of rows) { (this.data[k] as unknown[]).push({ ...(r as object), household_id: this.household.id }); n++ } } }
    this.persist(); this.emit(); return n
  }
  subscribe(onChange: () => void) { this.listeners.add(onChange); return () => { this.listeners.delete(onChange) } }
  /** helper for tests: month key of a date */
  static mk = monthKey
}
