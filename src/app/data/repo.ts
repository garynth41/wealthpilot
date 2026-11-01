import type { Collection, Data, Household, RowOf, Settings, EmailLedgerRow, Role } from './types'

/** Every read and write goes through a Repo. Two implementations: Supabase (real) and Memory (offline demo + tests). */
export interface Repo {
  readonly mode: 'db' | 'demo'
  loadAll(): Promise<{ household: Household; data: Data; role: Role; readOnly: boolean }>
  insert<C extends Collection>(coll: C, row: Partial<RowOf<C>>): Promise<RowOf<C>>
  insertMany<C extends Collection>(coll: C, rows: Partial<RowOf<C>>[]): Promise<RowOf<C>[]>
  update<C extends Collection>(coll: C, id: string, patch: Partial<RowOf<C>>): Promise<RowOf<C>>
  remove(coll: Collection, id: string): Promise<void>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  renameHousehold(name: string): Promise<void>
  startPeriod(type: string, start: string, end: string, label?: string): Promise<string>
  ledger(rows: Omit<EmailLedgerRow, 'household_id'>[]): Promise<void>
  invite(email: string, role: Role): Promise<void>
  removeMember(userId: string): Promise<void>
  setMemberRole(userId: string, role: Role, readOnly: boolean): Promise<void>
  exportJson(): Promise<Record<string, unknown>>
  importJson(json: Record<string, unknown>, mode: 'merge' | 'replace'): Promise<number>
  /** Called with a change notification (realtime); returns an unsubscribe. */
  subscribe(onChange: () => void): () => void
}
