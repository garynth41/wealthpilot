// Offline demo repo: the same contract as Supabase, kept in this browser (localStorage). Also the harness for the test suites.
import type { Repo } from './repo'
import { emptyData, SETTINGS_DEFAULTS, type Account, type Collection, type Data, type Household, type RowOf, type Settings, type EmailLedgerRow, type Role, type InviteRequest, type SyncStatus, type SyncResult, type ReconciliationInput, type Reconciliation, type AuditEvent, type AuditKind } from './types'
import { demoSeed, demoId } from './demoSeed'
import { LS } from '../config'
import { syncSlot, syncLimitMessage } from '../../lib/syncLimit'
import { monthKey, today } from '../../lib/dates'
import { genTempPassword } from '../../lib/access'
import { balanceFor, dropKnown } from '../../lib/simplefin'
import { verifiedBalance } from '../../lib/reconcile'

const KEY = LS('demo')
const PREFIX: Partial<Record<Collection, string>> = { reconciliations: 'K', transactions: 'T', accounts: 'A', recurring: 'R', goals: 'G', planned: 'X', hardship: 'H', emailItems: 'E', statements: 'S', paySchedules: 'P', categories: 'C', periods: 'B', holdings: 'I', scenarios: 'N', insurance: 'Y' }

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
  /** a copy of every array, so the store's state never aliases the repo's (an insert would otherwise appear twice until the next refresh) */
  async loadAll() { const data = Object.fromEntries(Object.entries(this.data).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v])) as unknown as Data; return { household: this.household, data, role: 'owner' as Role, readOnly: false, modules: null } }
  /** mirrors the database trigger record_balance_history (0.24.0): one row per account per day, book and bank figures */
  private recordBalance(a: Account, prev?: Account) {
    const bank = !prev || a.bank_balance !== prev.bank_balance || a.bank_balance_as_of !== prev.bank_balance_as_of, book = !prev || a.balance !== prev.balance || a.balance_as_of !== prev.balance_as_of
    if (!bank && !book) return
    const [d, source] = bank && a.bank_balance != null ? [a.bank_balance_as_of || today(), 'bank' as const] : a.kind === 'other_asset' && a.balance_as_of ? [a.balance_as_of, 'value' as const] : [today(), 'book' as const]
    const list = this.data.balances || (this.data.balances = []); const i = list.findIndex(x => x.account_id === a.id && x.as_of === d)
    if (i >= 0) list[i] = { ...list[i], balance: a.balance, bank_balance: a.bank_balance ?? list[i].bank_balance, source: source === 'book' ? list[i].source : source }
    else list.push({ id: demoId(), household_id: this.household.id, account_id: a.id, as_of: d, balance: a.balance, bank_balance: a.bank_balance ?? null, source })
  }
  private nextRef(coll: Collection) { const p = PREFIX[coll]; if (!p) return undefined; const rows = this.data[coll] as Array<{ ref?: string | null }>; const n = Math.max(0, ...rows.map(r => +String(r.ref || '').split('-')[1] || 0)) + 1; return `${p}-${String(n).padStart(3, '0')}` }
  async insert<C extends Collection>(coll: C, row: Partial<RowOf<C>>) {
    const r = { ...row, id: (row as { id?: string }).id || demoId(), household_id: this.household.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as RowOf<C> & { ref?: string | null }
    if ('ref' in r || PREFIX[coll]) { if (!r.ref) r.ref = this.nextRef(coll) }
    if (coll === 'holdings') { const h = r as unknown as { quantity: number; price: number; value?: number }; h.value = Math.round((+h.quantity || 0) * (+h.price || 0) * 100) / 100 }   // mirrors the DB's generated column
    if (coll === 'balances') throw new Error('Balance history is written by the database')
    ;(this.data[coll] as unknown as RowOf<C>[]).push(r); if (coll === 'accounts') this.recordBalance(r as unknown as Account); this.persist(); this.emit(); return r
  }
  async insertMany<C extends Collection>(coll: C, rows: Partial<RowOf<C>>[]) { const out: RowOf<C>[] = []; for (const r of rows) out.push(await this.insert(coll, r)); return out }
  async update<C extends Collection>(coll: C, id: string, patch: Partial<RowOf<C>>) {
    if ((coll as string) === 'audit' || (coll as string) === 'reconciliations') throw new Error('Audit events and completed reconciliations are immutable')
    const arr = this.data[coll] as unknown as RowOf<C>[]; const i = arr.findIndex(x => (x as { id: string }).id === id); if (i < 0) throw new Error('Row not found')
    const prev = arr[i]; arr[i] = { ...arr[i], ...patch, updated_at: new Date().toISOString() }; if (coll === 'accounts') this.recordBalance(arr[i] as unknown as Account, prev as unknown as Account)
    if (coll === 'holdings') { const h = arr[i] as unknown as { quantity: number; price: number; value?: number }; h.value = Math.round((+h.quantity || 0) * (+h.price || 0) * 100) / 100 }
    this.persist(); this.emit(); return arr[i]
  }
  async remove(coll: Collection, id: string) {
    const arr = this.data[coll] as Array<{ id: string }>; const i = arr.findIndex(x => x.id === id); if (i < 0) return; arr.splice(i, 1)
    // cascades mirroring the schema
    if (coll === 'periods') this.data.lines = this.data.lines.filter(l => l.period_id !== id)
    if (coll === 'transactions') { this.data.splits = (this.data.splits || []).filter(s => s.transaction_id !== id); this.data.attachments = (this.data.attachments || []).filter(a => a.transaction_id !== id); this.data.comments = (this.data.comments || []).filter(c => c.transaction_id !== id) }
    if (coll === 'accounts') this.data.balances = (this.data.balances || []).filter(b => b.account_id !== id)
    if (coll === 'holdings') this.data.lots = (this.data.lots || []).filter(l => l.holding_id !== id)
    if (coll === 'statements') this.data.attachments = (this.data.attachments || []).filter(a => a.statement_id !== id)
    if (coll === 'recurring') this.data.occurrences = this.data.occurrences.filter(o => o.recurring_id !== id)
    if (coll === 'goals') this.data.contributions = this.data.contributions.filter(c => c.goal_id !== id)
    if (coll === 'accounts') { this.data.statements = this.data.statements.filter(s => s.account_id !== id); this.data.transactions.forEach(x => { if (x.account_id === id) x.account_id = null; if (x.to_account_id === id) x.to_account_id = null }) }
    if (coll === 'categories') { this.data.lines = this.data.lines.filter(l => l.category_id !== id); this.data.transactions.forEach(x => { if (x.category_id === id) x.category_id = null }) }
    this.persist(); this.emit()
  }
  /** The demo mirrors request_household_deletion / cancel_household_deletion (the nightly purge is not simulated — Reset sample data starts over). */
  async requestDeletion(confirm: string) {
    if (this.household.deletion_scheduled_for) return this.household.deletion_scheduled_for
    if (confirm.trim().toLowerCase() !== this.household.name.trim().toLowerCase()) throw new Error("type the household's name exactly to confirm")
    const at = new Date(Date.now() + 7 * 86400000).toISOString(); this.household = { ...this.household, deletion_requested_at: new Date().toISOString(), deletion_requested_by: 'demo', deletion_scheduled_for: at }; this.persist(); this.emit(); return at }
  async cancelDeletion() { this.household = { ...this.household, deletion_requested_at: null, deletion_requested_by: null, deletion_scheduled_for: null }; this.persist(); this.emit() }
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
  // Bank sync is not available in the demo — except for the test harness, which sets localStorage['wealthpilot.simSync']='1' to exercise the whole screen against a pretend bank.
  private sim = { connected: false, map: {} as Record<string, string>, last: null as string | null, log: [] as SyncStatus['log'], failNext: null as string | null, lastError: null as string | null, requests: [] as string[] }
  /** test hook: make the next simulated sync fail like a disconnected institution */
  simFailNext(message: string) { this.sim.failNext = message }
  private simOn() { try { return localStorage.getItem(LS('simSync')) === '1' } catch { return false } }
  static readonly SIM_BANK = [{ id: 'S1', name: 'Total Checking (x4821)', org: 'Chase', last4: '4821', balance: 2310.55 }, { id: 'S2', name: 'Freedom Card ...7710', org: 'Chase', last4: '7710', balance: -640.12 }, { id: 'S3', name: 'Online Savings', org: 'Ally', last4: null, balance: 8000 }, { id: 'S4', name: 'Roth IRA', org: 'Fidelity', last4: null, balance: 21000 }]
  async syncStatus(): Promise<SyncStatus> {
    if (!this.simOn()) return { connection: null, log: [], available: false }
    if (!this.sim.connected) return { connection: null, log: this.sim.log, available: true }
    return { available: true, log: this.sim.log, requests: this.sim.requests, connection: { household_id: this.household.id, provider: 'simplefin', status: this.sim.lastError ? 'error' : 'connected', last_sync_at: this.sim.last, last_error: this.sim.lastError, account_map: this.sim.map, discovered: MemoryRepo.SIM_BANK } } }
  async syncConnect(): Promise<void> { if (!this.simOn()) throw new Error('Bank sync needs a real household — it is not available in the offline demo'); this.sim.connected = true }
  /** The 0.25.0 sync limit, simulated only when wealthpilot.simSyncLimit is set (so the smoke suite can sync freely otherwise). */
  private simClaim() { let on = false; try { on = localStorage.getItem(LS('simSyncLimit')) === '1' } catch { /* */ } if (!on) return
    const slot = syncSlot(this.sim.requests); if (!slot.ok) throw new Error(syncLimitMessage(slot)); this.sim.requests = [...this.sim.requests, new Date().toISOString()] }
  async syncNow(): Promise<SyncResult> {
    if (!this.simOn()) throw new Error('Bank sync is not available in the offline demo')
    this.simClaim()
    if (this.sim.failNext) {   // a disconnected institution: nothing changes, the failure is logged, the status shows it
      const m = this.sim.failNext; this.sim.failNext = null; this.sim.lastError = m; const at = new Date().toISOString()
      this.sim.log = [{ id: this.sim.log.length + 1, started_at: at, finished_at: at, trigger: 'manual' as const, ok: false, accounts: 0, added: 0, skipped: 0, message: m }, ...this.sim.log]
      await this.logAudit('sync_failure', 'Bank sync failed: ' + m, { error: m }); this.emit(); throw new Error(m)
    }
    this.sim.lastError = null
    let added = 0, skipped = 0, accounts = 0
    for (const b of MemoryRepo.SIM_BANK) {
      const id = this.sim.map[b.id]; const acct = this.data.accounts.find(a => a.id === id); if (!acct) continue
      accounts++; acct.bank_balance = balanceFor(b, acct.kind); acct.bank_balance_as_of = today(); acct.balance_as_of = today()
      const incoming = [{ date: today(), kind: 'expense', amount: 12.34, external_id: `sfin:${b.id}:a`, payee: 'SIM COFFEE' }, { date: today(), kind: 'income', amount: 100, external_id: `sfin:${b.id}:b`, payee: 'SIM DEPOSIT' }]
      const { fresh, skipped: sk } = dropKnown(incoming, id, this.data.transactions.map(t => ({ account_id: t.account_id ?? null, date: t.date, kind: t.kind, amount: t.amount, external_id: t.external_id ?? null })))
      skipped += sk; added += fresh.length
      for (const f of fresh) this.data.transactions.push({ id: demoId(), household_id: this.household.id, ref: this.nextRef('transactions'), date: f.date, kind: f.kind as 'expense' | 'income', amount: f.amount, account_id: id, to_account_id: null, category_id: null, payee: f.payee, memo: null, tags: [], status: 'cleared', source: 'import', external_id: f.external_id, exclude_from_budget: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as never)
    }
    for (const id of Object.values(this.sim.map)) { const acct = this.data.accounts.find(a => a.id === id); if (acct) acct.balance = verifiedBalance(acct, this.data.transactions) }
    await this.logAudit('sync', `Bank sync: ${accounts} accounts, ${added} new transactions`, { accounts, added, skipped })
    this.sim.last = new Date().toISOString(); const message = `${accounts} accounts synced · ${added} new transactions${skipped ? ` · ${skipped} already present` : ''}`
    this.sim.log = [{ id: this.sim.log.length + 1, started_at: this.sim.last, finished_at: this.sim.last, trigger: 'manual' as const, ok: true, accounts, added, skipped, message }, ...this.sim.log]; this.persist(); this.emit()
    return { ok: true, accounts, added, skipped, unmapped: 0, message } }
  async syncBackfill(from: string): Promise<SyncResult> { const r = await this.syncNow(); return { ...r, message: r.message + ` · history from ${from} requested; the simulated bank only has today` } }
  async syncSetMap(map: Record<string, string>): Promise<void> { if (this.simOn()) this.sim.map = map }
  async completeReconciliation(i: ReconciliationInput): Promise<Reconciliation> {
    const a = this.data.accounts.find(x => x.id === i.account_id); if (!a) throw new Error('Account not found')
    const at = new Date().toISOString(); const rec = await this.insert('reconciliations', { account_id: i.account_id, statement_date: i.statement_date, statement_balance: i.statement_balance, opening_balance: i.opening_balance, cleared_deposits: i.cleared_deposits, cleared_payments: i.cleared_payments, item_count: i.cleared_ids.length, book_balance: i.book_balance, outstanding_checks: i.outstanding_checks, deposits_in_transit: i.deposits_in_transit, reconciled_balance: i.reconciled_balance, variance: i.variance, adjustment: i.adjustment, adjustment_reason: i.adjustment_reason, status: i.adjustment ? 'completed_with_adjustment' : 'completed', notes: i.notes, completed_at: at, completed_by: null, completed_by_email: 'demo' })
    for (const t of this.data.transactions) if (i.cleared_ids.includes(t.id)) { t.reconciliation_id = rec.id; t.cleared_on = t.cleared_on || i.statement_date; if (t.status === 'pending') t.status = 'cleared' }
    a.bank_balance = i.statement_balance; a.bank_balance_as_of = i.statement_date; a.last_reconciled_on = i.statement_date; a.last_reconciled_balance = i.reconciled_balance; a.balance = verifiedBalance(a, this.data.transactions)
    await this.logAudit('reconciliation', `Reconciled ${a.name} to ${i.statement_date}: statement ${i.statement_balance}, ${i.cleared_ids.length} items`, { reconciliation_id: rec.id, variance: i.variance }, a.id)
    if (i.adjustment) await this.logAudit('override', `Adjustment of ${i.adjustment} accepted: ${i.adjustment_reason}`, { reconciliation_id: rec.id, adjustment: i.adjustment, reason: i.adjustment_reason }, a.id)
    this.persist(); this.emit(); return rec
  }
  async logAudit(kind: AuditKind, summary: string, detail?: Record<string, unknown>, accountId?: string | null): Promise<AuditEvent> {
    const e: AuditEvent = { id: demoId(), household_id: this.household.id, account_id: accountId ?? null, kind, summary, detail: detail ?? null, user_id: null, user_email: 'demo', created_at: new Date().toISOString() }
    this.data.audit = [e, ...(this.data.audit || [])]; this.persist(); return e
  }
  async syncDisconnect(): Promise<void> { this.sim = { connected: false, map: {}, last: null, log: [], failNext: null, lastError: null, requests: [] } }
  async removeMember(userId: string) { this.data.members = this.data.members.filter(m => m.user_id !== userId); this.persist(); this.emit() }
  async setMemberAccess(userId: string, role: Role, readOnly: boolean, modules: string[] | null) { this.data.members = this.data.members.map(m => m.user_id === userId ? { ...m, role, read_only: readOnly, modules } : m); this.persist(); this.emit() }
  /** Demo: no real account is created; a temporary password is generated locally so the invitation flow can be tried end to end. */
  async inviteWithPassword(req: InviteRequest) { const email = req.email.trim().toLowerCase(); const existing = this.data.members.find(m => m.email === email); const user_id = existing?.user_id || demoId(); const temp = existing ? null : genTempPassword()
    this.data.members = [...this.data.members.filter(m => m.user_id !== user_id), { household_id: this.household.id, user_id, email, display_name: req.display_name || null, role: req.role, read_only: req.read_only, modules: req.modules, joined_at: new Date().toISOString() }]; this.data.invites = this.data.invites.filter(i => i.email !== email); this.persist(); this.emit()
    return { user_id, existing: !!existing, temp_password: temp, sent: false, send_error: null, can_send: false } }
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
