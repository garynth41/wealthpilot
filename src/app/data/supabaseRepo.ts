import type { Repo } from './repo'
import { TABLE, SETTINGS_DEFAULTS, emptyData, type Collection, type Data, type Household, type Member, type RowOf, type Settings, type EmailLedgerRow, type Role } from './types'
import { sb } from '../supabase'
import { APP_VERSION } from '../config'

const COLLECTIONS = Object.keys(TABLE) as Collection[]
const IMPORT_ORDER: Collection[] = ['accounts', 'categories', 'paySchedules', 'periods', 'lines', 'recurring', 'goals', 'transactions', 'statements', 'occurrences', 'contributions', 'planned', 'snapshots', 'hardship', 'emailItems']
const strip = <T extends object>(row: T) => { const r = { ...row } as Record<string, unknown>; for (const k of ['created_at', 'updated_at', 'created_by', 'updated_by', 'value']) delete r[k]; return r }   // 'value' is a generated column on holdings

export class SupabaseRepo implements Repo {
  readonly mode = 'db' as const
  private hh: string
  constructor(householdId: string) { this.hh = householdId }

  async loadAll() {
    const c = sb()
    const [hhRes, memRes, invRes, actRes, ledRes, ...rows] = await Promise.all([
      c.from('households').select('*').eq('id', this.hh).single(),
      c.from('household_members').select('*').eq('household_id', this.hh),
      c.from('household_invites').select('*').eq('household_id', this.hh).is('accepted_at', null),
      c.from('activity_log').select('*').eq('household_id', this.hh).order('created_at', { ascending: false }).limit(300),
      c.from('email_ledger').select('*').eq('household_id', this.hh),
      ...COLLECTIONS.map(k => c.from(TABLE[k]).select('*').eq('household_id', this.hh).limit(20000)),
    ])
    if (hhRes.error) throw hhRes.error
    const data: Data = emptyData()
    COLLECTIONS.forEach((k, i) => { const r = rows[i]; if (r.error) throw r.error; (data as unknown as Record<string, unknown[]>)[k] = (r.data || []).map(this.num) })
    data.members = (memRes.data || []) as Member[]; data.invites = invRes.data || []; data.activity = actRes.data || []; data.emailLedger = (ledRes.data || []) as EmailLedgerRow[]
    const { data: { user } } = await c.auth.getUser()
    const me = data.members.find(m => m.user_id === user?.id)
    const household: Household = { ...hhRes.data, settings: { ...SETTINGS_DEFAULTS, ...(hhRes.data.settings || {}) } }
    if (me) c.from('household_members').update({ last_seen_at: new Date().toISOString(), last_version: APP_VERSION }).eq('household_id', this.hh).eq('user_id', me.user_id).then(() => {})
    return { household, data, role: (me?.role || 'viewer') as Role, readOnly: !!me?.read_only }
  }
  // numeric columns arrive as strings from PostgREST when they are `numeric`; normalise once here
  private num = <T extends Record<string, unknown>>(row: T): T => { const out: Record<string, unknown> = { ...row }; for (const k of Object.keys(out)) { const v = out[k]; if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && NUMERIC.has(k)) out[k] = +v } return out as T }

  async insert<C extends Collection>(coll: C, row: Partial<RowOf<C>>) {
    const { data, error } = await sb().from(TABLE[coll]).insert({ ...strip(row), household_id: this.hh }).select('*').single(); if (error) throw error; return this.num(data) as RowOf<C>
  }
  async insertMany<C extends Collection>(coll: C, rows: Partial<RowOf<C>>[]) {
    if (!rows.length) return []
    const { data, error } = await sb().from(TABLE[coll]).insert(rows.map(r => ({ ...strip(r), household_id: this.hh }))).select('*'); if (error) throw error; return (data || []).map(this.num) as RowOf<C>[]
  }
  async update<C extends Collection>(coll: C, id: string, patch: Partial<RowOf<C>>) {
    const { data, error } = await sb().from(TABLE[coll]).update(strip(patch)).eq('id', id).eq('household_id', this.hh).select('*').single(); if (error) throw error; return this.num(data) as RowOf<C>
  }
  async remove(coll: Collection, id: string) { const { error } = await sb().from(TABLE[coll]).delete().eq('id', id).eq('household_id', this.hh); if (error) throw error }
  async saveSettings(patch: Partial<Settings>) {
    const { data: cur, error: e1 } = await sb().from('households').select('settings').eq('id', this.hh).single(); if (e1) throw e1
    const next = { ...SETTINGS_DEFAULTS, ...(cur?.settings || {}), ...patch }
    const { error } = await sb().from('households').update({ settings: next, updated_at: new Date().toISOString() }).eq('id', this.hh); if (error) throw error; return next
  }
  async renameHousehold(name: string) { const { error } = await sb().from('households').update({ name }).eq('id', this.hh); if (error) throw error }
  async startPeriod(type: string, start: string, end: string, label?: string) {
    const { data, error } = await sb().rpc('start_period', { p_household: this.hh, p_type: type, p_start: start, p_end: end, p_label: label ?? null }); if (error) throw error; return data as string
  }
  async ledger(rows: Omit<EmailLedgerRow, 'household_id'>[]) { if (!rows.length) return; const { error } = await sb().from('email_ledger').upsert(rows.map(r => ({ ...r, household_id: this.hh })), { onConflict: 'household_id,message_id' }); if (error) throw error }
  async invite(email: string, role: Role) { const { error } = await sb().from('household_invites').upsert({ household_id: this.hh, email: email.toLowerCase(), role }, { onConflict: 'household_id,email' }); if (error) throw error }
  async removeMember(userId: string) { const { error } = await sb().from('household_members').delete().eq('household_id', this.hh).eq('user_id', userId); if (error) throw error }
  async setMemberRole(userId: string, role: Role, readOnly: boolean) { const { error } = await sb().from('household_members').update({ role, read_only: readOnly }).eq('household_id', this.hh).eq('user_id', userId); if (error) throw error }
  async exportJson() { const all = await this.loadAll(); return { app: 'WealthPilot', exported_at: new Date().toISOString(), household: all.household, ...all.data } }
  async importJson(json: Record<string, unknown>, mode: 'merge' | 'replace') {
    let n = 0
    if (mode === 'replace') for (const k of [...IMPORT_ORDER].reverse()) { const { error } = await sb().from(TABLE[k]).delete().eq('household_id', this.hh); if (error) throw error }
    const idMap = new Map<string, string>()
    const remap = (row: Record<string, unknown>) => { const out: Record<string, unknown> = {}; for (const [k, v] of Object.entries(row)) { if (k === 'id' || k === 'household_id' || k === 'created_at' || k === 'updated_at' || k === 'created_by' || k === 'updated_by') continue; out[k] = typeof v === 'string' && idMap.has(v) ? idMap.get(v) : v } return out }
    for (const k of IMPORT_ORDER) {
      const rows = (json[k] as Record<string, unknown>[] | undefined) || []
      for (const r of rows) { const { data, error } = await sb().from(TABLE[k]).insert({ ...remap(r), household_id: this.hh }).select('id').single(); if (error) throw error; if (typeof r.id === 'string') idMap.set(r.id, data.id); n++ }
    }
    return n
  }
  subscribe(onChange: () => void) {
    const ch = sb().channel('hh-' + this.hh)
    for (const t of [...Object.values(TABLE), 'households', 'household_members']) ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: `household_id=eq.${this.hh}` }, onChange)
    ch.subscribe()
    return () => { sb().removeChannel(ch) }
  }
}
const NUMERIC = new Set(['quantity', 'cost_basis', 'price', 'value', 'expense_ratio', 'yield_pct', 'balance', 'credit_limit', 'apr', 'statement_balance', 'minimum_payment', 'planned_payment', 'default_budget', 'gross_amount', 'net_amount', 'hours_per_period', 'hourly_rate', 'expected_income', 'planned', 'rollover_in', 'amount', 'paid_amount', 'target_amount', 'starting_amount', 'monthly_contribution', 'cash', 'assets', 'liabilities', 'monthly_obligation', 'relief_monthly', 'min_due', 'fee', 'last_paid_amount'])
