import type { RestoreSummary } from '../../lib/restore'
import type { Collection, Data, Household, RowOf, Settings, EmailLedgerRow, Role, InviteRequest, InviteResult, SyncStatus, SyncResult, Reconciliation, ReconciliationInput, AuditEvent, AuditKind } from './types'

/** Every read and write goes through a Repo. Two implementations: Supabase (real) and Memory (offline demo + tests). */
export interface Repo {
  readonly mode: 'db' | 'demo'
  loadAll(): Promise<{ household: Household; data: Data; role: Role; readOnly: boolean; modules: string[] | null }>
  insert<C extends Collection>(coll: C, row: Partial<RowOf<C>>): Promise<RowOf<C>>
  insertMany<C extends Collection>(coll: C, rows: Partial<RowOf<C>>[]): Promise<RowOf<C>[]>
  update<C extends Collection>(coll: C, id: string, patch: Partial<RowOf<C>>): Promise<RowOf<C>>
  remove(coll: Collection, id: string): Promise<void>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  renameHousehold(name: string): Promise<void>
  startPeriod(type: string, start: string, end: string, label?: string): Promise<string>
  ledger(rows: Omit<EmailLedgerRow, 'household_id'>[]): Promise<void>
  invite(email: string, role: Role): Promise<void>
  /** Create or find the account, add the membership, issue a temporary password (new accounts) — see supabase/functions/invite-member. */
  inviteWithPassword(req: InviteRequest): Promise<InviteResult>
  removeMember(userId: string): Promise<void>
  setMemberAccess(userId: string, role: Role, readOnly: boolean, modules: string[] | null): Promise<void>
  /** Automatic bank sync (SimpleFIN). `available` is false in the offline demo or before the database is upgraded. */
  syncStatus(): Promise<SyncStatus>
  syncConnect(setupToken: string): Promise<void>
  syncNow(): Promise<SyncResult>
  /** re-read bank history back to `from` (SimpleFIN keeps about 90 days); duplicates are merged afterwards */
  syncBackfill(from: string): Promise<SyncResult>
  syncSetMap(map: Record<string, string>): Promise<void>
  syncDisconnect(): Promise<void>
  /** complete a statement reconciliation atomically: record it, tick the items, set the account's bank/book balances, write the audit event */
  completeReconciliation(input: ReconciliationInput): Promise<Reconciliation>
  /** append to the immutable audit trail */
  logAudit(kind: AuditKind, summary: string, detail?: Record<string, unknown>, accountId?: string | null): Promise<AuditEvent>
  exportJson(): Promise<Record<string, unknown>>
  /** 0.25.0: schedule the household's permanent deletion in 7 days (owner; `confirm` must be its name) — returns the date — or cancel it. */
  requestDeletion(confirm: string): Promise<string>
  cancelDeletion(): Promise<void>
  /** Restore a JSON backup (lib/restore.ts): merge matches what is already here instead of adding copies; replace clears the household's data first. */
  importJson(json: Record<string, unknown>, mode: 'merge' | 'replace'): Promise<RestoreSummary>
  /** Called with a change notification (realtime); returns an unsubscribe. */
  subscribe(onChange: () => void): () => void
}
