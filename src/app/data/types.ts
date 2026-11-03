// Row types — one per table in supabase/migrations/0001_init.sql. Keep in sync with the schema.
export type UUID = string
export type ISODate = string           // 'YYYY-MM-DD'
export type Role = 'owner' | 'editor' | 'viewer'

interface Stamped { id: UUID; household_id: UUID; created_at?: string; updated_at?: string; created_by?: UUID | null; updated_by?: UUID | null }

export type AccountKind = 'checking' | 'savings' | 'cash' | 'investment' | 'retirement' | 'credit_card' | 'store_card' | 'loan' | 'auto_loan' | 'student_loan' | 'mortgage' | 'bnpl' | 'line_of_credit' | 'medical' | 'collection' | 'other_asset' | 'other_liability'
export const ASSET_KINDS: AccountKind[] = ['checking', 'savings', 'cash', 'investment', 'retirement', 'other_asset']
export const LIABILITY_KINDS: AccountKind[] = ['credit_card', 'store_card', 'loan', 'auto_loan', 'student_loan', 'mortgage', 'bnpl', 'line_of_credit', 'medical', 'collection', 'other_liability']
export const REVOLVING_KINDS: AccountKind[] = ['credit_card', 'store_card', 'bnpl', 'line_of_credit']
export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = { checking: 'Checking', savings: 'Savings', cash: 'Cash', investment: 'Investment', retirement: 'Retirement', other_asset: 'Other asset', credit_card: 'Credit card', store_card: 'Store card', loan: 'Personal loan', auto_loan: 'Auto loan', student_loan: 'Student loan', mortgage: 'Mortgage', bnpl: 'Buy now pay later', line_of_credit: 'Line of credit', medical: 'Medical debt', collection: 'Collection', other_liability: 'Other debt' }
export interface Account extends Stamped {
  ref?: string | null; name: string; kind: AccountKind; institution?: string | null; last4?: string | null
  balance: number; balance_as_of?: ISODate | null
  /** what the institution last reported (bank feed, statement or reconciliation); null = no bank figure, the book balance is all there is */
  bank_balance?: number | null; bank_balance_as_of?: ISODate | null; last_reconciled_on?: ISODate | null; last_reconciled_balance?: number | null
  credit_limit?: number | null; apr: number
  statement_date?: ISODate | null; statement_balance?: number | null; minimum_payment: number; due_date?: ISODate | null; planned_payment?: number | null
  autopay: boolean; autopay_account_id?: UUID | null; last_paid_due?: ISODate | null
  include_in_cash: boolean; include_in_net_worth: boolean
  status: 'Active' | 'Paid off' | 'Closed' | 'Hidden'; color?: string | null; icon?: string | null; sort_order: number; notes?: string | null
}
export interface Statement extends Stamped { ref?: string | null; account_id: UUID; statement_date: ISODate; statement_balance: number; minimum_payment: number; due_date?: ISODate | null; paid_on?: ISODate | null; paid_amount?: number | null; source: string; notes?: string | null }

export type Priority = 'Essential' | 'Important' | 'Discretionary'
export type CostType = 'Fixed' | 'Variable' | 'Irregular'
export interface Category extends Stamped {
  ref?: string | null; name: string; group?: string | null; kind: 'expense' | 'income' | 'transfer'; priority: Priority; cost_type: CostType
  default_budget: number; budget_cadence: 'period' | 'monthly' | 'yearly'; rollover: boolean
  color?: string | null; icon?: string | null; sort_order: number; archived: boolean; notes?: string | null
}

export type PayFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'quarterly' | 'yearly' | 'irregular'
export const PAY_FREQ_LABEL: Record<PayFrequency, string> = { weekly: 'Weekly', biweekly: 'Every 2 weeks', semimonthly: 'Twice a month', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly', irregular: 'Irregular' }
export interface PaySchedule extends Stamped {
  ref?: string | null; name: string; payer?: string | null; kind: 'salary' | 'hourly' | 'benefit' | 'severance' | 'side' | 'rental' | 'investment' | 'support' | 'other'
  frequency: PayFrequency; anchor_date: ISODate; semimonthly_days?: number[] | null
  gross_amount?: number | null; net_amount: number; hours_per_period?: number | null; hourly_rate?: number | null
  deposit_account_id?: UUID | null; category_id?: UUID | null; starts_on?: ISODate | null; ends_on?: ISODate | null
  status: 'Active' | 'Paused' | 'Ended'; notes?: string | null
}

export type PeriodType = 'month' | 'week' | 'biweekly' | 'semimonthly' | 'pay' | 'custom'
export interface BudgetPeriod extends Stamped { ref?: string | null; period_type: PeriodType; start_date: ISODate; end_date: ISODate; label?: string | null; status: 'planned' | 'open' | 'closed'; expected_income: number; notes?: string | null }
export interface BudgetLine extends Stamped { period_id: UUID; category_id: UUID; planned: number; rollover_in: number; notes?: string | null }

export type TxnKind = 'expense' | 'income' | 'transfer'
export type TxnSource = 'manual' | 'email' | 'import' | 'recurring' | 'statement' | 'adjustment'
export interface Transaction extends Stamped {
  ref?: string | null; date: ISODate; kind: TxnKind; amount: number
  account_id?: UUID | null; to_account_id?: UUID | null; category_id?: UUID | null
  payee?: string | null; memo?: string | null; tags: string[]
  status: 'pending' | 'cleared' | 'void'; source: TxnSource
  recurring_id?: UUID | null; pay_schedule_id?: UUID | null; goal_id?: UUID | null; email_item_id?: UUID | null; external_id?: string | null
  exclude_from_budget: boolean
  /** set when this row is a duplicate of another transaction (the keeper): it stays in the database but out of every total */
  duplicate_of?: UUID | null
  /** the owner said this row is not a duplicate — never merge it automatically */
  dedupe_ok?: boolean
  /** check register: the check number; cleared_on = the bank date it cleared; reconciliation_id = the completed reconciliation it was ticked in */
  check_number?: string | null; cleared_on?: ISODate | null; reconciliation_id?: UUID | null
}

/** One completed statement reconciliation for an account (immutable once completed). */
export interface Reconciliation extends Stamped {
  ref?: string | null; account_id: UUID; statement_date: ISODate; statement_balance: number; opening_balance: number
  cleared_deposits: number; cleared_payments: number; item_count: number; book_balance: number; outstanding_checks: number; deposits_in_transit: number; reconciled_balance: number; variance: number
  adjustment: number; adjustment_reason?: string | null; status: 'completed' | 'completed_with_adjustment'; notes?: string | null; completed_at: string; completed_by?: UUID | null; completed_by_email?: string | null
}
export interface ReconciliationInput { account_id: UUID; statement_date: ISODate; statement_balance: number; opening_balance: number; cleared_ids: UUID[]; book_balance: number; cleared_deposits: number; cleared_payments: number; outstanding_checks: number; deposits_in_transit: number; reconciled_balance: number; variance: number; adjustment: number; adjustment_reason: string | null; notes: string | null }
export type AuditKind = 'import' | 'sync' | 'sync_failure' | 'adjustment' | 'override' | 'reconciliation' | 'correction' | 'balance_change' | 'match' | 'unmatch' | 'register'
/** Immutable audit trail (cash operations): never updated or deleted. */
export interface AuditEvent { id: UUID; household_id: UUID; account_id?: UUID | null; kind: AuditKind; summary: string; detail?: Record<string, unknown> | null; user_id?: UUID | null; user_email?: string | null; created_at: string }

export type RecurringKind = 'bill' | 'subscription' | 'debt_payment' | 'income' | 'transfer' | 'savings'
export type RecurringFreq = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'every_2_months' | 'quarterly' | 'every_6_months' | 'yearly' | 'irregular'
export const REC_FREQ_LABEL: Record<RecurringFreq, string> = { weekly: 'Weekly', biweekly: 'Every 2 weeks', semimonthly: 'Twice a month', monthly: 'Monthly', every_2_months: 'Every 2 months', quarterly: 'Quarterly', every_6_months: 'Every 6 months', yearly: 'Yearly', irregular: 'Irregular' }
export interface Recurring extends Stamped {
  ref?: string | null; name: string; payee?: string | null; kind: RecurringKind; amount: number; amount_varies: boolean
  frequency: RecurringFreq; day_of_month?: number | null; next_due?: ISODate | null
  account_id?: UUID | null; liability_account_id?: UUID | null; category_id?: UUID | null
  autopay: boolean; reminder_days: number; starts_on?: ISODate | null; ends_on?: ISODate | null
  status: 'Active' | 'Paused' | 'Cancelled'; last_paid_on?: ISODate | null; last_paid_amount?: number | null; notes?: string | null; sort_order: number
}
export interface BillOccurrence extends Stamped { recurring_id: UUID; due_date: ISODate; amount: number; status: 'due' | 'scheduled' | 'paid' | 'skipped' | 'overdue'; paid_on?: ISODate | null; transaction_id?: UUID | null; email_item_id?: UUID | null; notes?: string | null }

export interface Goal extends Stamped {
  ref?: string | null; name: string; kind: 'savings' | 'emergency_fund' | 'debt_payoff' | 'sinking_fund' | 'purchase' | 'other'
  target_amount: number; target_date?: ISODate | null; account_id?: UUID | null; starting_amount: number; monthly_contribution: number; priority: number
  status: 'Active' | 'Paused' | 'Reached' | 'Cancelled'; color?: string | null; icon?: string | null; notes?: string | null; sort_order: number
}
export interface GoalContribution extends Stamped { goal_id: UUID; date: ISODate; amount: number; transaction_id?: UUID | null; notes?: string | null }

export type AssetClass = 'stock' | 'etf' | 'mutual_fund' | 'bond' | 'real_estate' | 'cash' | 'crypto' | 'alternative' | 'other'
export const ASSET_CLASS_LABEL: Record<AssetClass, string> = { stock: 'Stocks', etf: 'ETFs', mutual_fund: 'Mutual funds', bond: 'Bonds', real_estate: 'Real estate', cash: 'Cash', crypto: 'Crypto', alternative: 'Alternatives', other: 'Other' }
export interface Holding extends Stamped {
  ref?: string | null; account_id?: UUID | null; symbol?: string | null; name: string; asset_class: AssetClass; sector?: string | null; risk: 'low' | 'medium' | 'high'
  quantity: number; cost_basis: number; price: number; price_as_of?: ISODate | null; value?: number; expense_ratio?: number | null; yield_pct?: number | null; notes?: string | null; sort_order: number
}
export interface PlannedItem extends Stamped { ref?: string | null; date: ISODate; label: string; category: string; amount: number; status: 'Planned' | 'Done' | 'Cancelled'; transaction_id?: UUID | null; notes?: string | null }
export interface NetWorthSnapshot extends Stamped { date: ISODate; cash: number; assets: number; liabilities: number; by_account: Record<string, number>; notes?: string | null }
export interface Hardship extends Stamped {
  ref?: string | null; entity: string; type: string; account_id?: UUID | null; recurring_id?: UUID | null; monthly_obligation?: number | null
  phone?: string | null; contact_name?: string | null; status: string; program?: string | null; relief_monthly?: number | null; relief_start?: ISODate | null; relief_end?: ISODate | null
  last_contact?: ISODate | null; next_followup?: ISODate | null; reference?: string | null; outcome?: string | null; notes?: string | null; sort_order: number
}

export type EmailKind = 'paid' | 'income' | 'bill' | 'scheduled' | 'pastdue' | 'declined' | 'alert' | 'balance'
export interface EmailEvidence { msg_id: string; thread_id?: string; src: string; url?: string; subject: string; date: ISODate }
export interface EmailItem extends Stamped {
  ref?: string | null; kind: EmailKind; payee?: string | null; last4?: string | null
  amount?: number | null; min_due?: number | null; balance?: number | null; fee?: number | null; due_date?: ISODate | null; txn_date?: ISODate | null; status?: string | null; autopay: boolean
  account_id?: UUID | null; category_id?: UUID | null; recurring_id?: UUID | null; transaction_id?: UUID | null; statement_id?: UUID | null; bill_item_id?: UUID | null
  src?: string | null; evidence: EmailEvidence[]; notes?: string | null
}
export interface EmailLedgerRow { household_id: UUID; message_id: string; src: string; decision: 'applied' | 'ignored'; subject?: string | null; message_at?: string | null; decided_at?: string }

export interface Household { id: UUID; name: string; currency: string; settings: Settings; created_at?: string }
export interface Member { household_id: UUID; user_id: UUID; email: string; display_name?: string | null; role: Role; read_only: boolean; modules?: string[] | null; joined_at?: string; last_seen_at?: string | null; last_version?: string | null }   // modules: null = every module (see lib/access.ts)
export interface Invite { id: UUID; household_id: UUID; email: string; role: Role; read_only?: boolean; modules?: string[] | null; display_name?: string | null; created_at?: string; accepted_at?: string | null; temp_password_issued_at?: string | null; sent_at?: string | null }
/** Automatic bank sync (SimpleFIN) — the connection row and its recent runs. The access URL itself never reaches the browser. */
export interface SyncConnection { household_id: UUID; provider: string; status: 'connected' | 'error'; last_sync_at: string | null; last_error: string | null; account_map: Record<string, string>; discovered: Array<{ id: string; name: string; org: string; last4: string | null; balance: number }> }
export interface SyncLogRow { id: number; started_at: string; finished_at: string | null; trigger: 'manual' | 'daily' | 'connect' | 'backfill'; ok: boolean; accounts: number; added: number; skipped: number; message: string | null }
export interface SyncStatus { connection: SyncConnection | null; log: SyncLogRow[]; available: boolean }
export interface SyncResult { ok: boolean; accounts: number; added: number; skipped: number; unmapped: number; message: string; merged?: number; review?: number; earliest?: Record<string, string> }
/** What an owner asks for when inviting; the server issues the temporary password and returns it once. */
export interface InviteRequest { email: string; display_name?: string | null; role: Role; read_only: boolean; modules: string[] | null; subject: string; body: string }
export interface InviteResult { user_id: UUID; existing: boolean; temp_password: string | null; sent: boolean; send_error?: string | null; can_send: boolean }
export interface ActivityRow { id: number; household_id: UUID; user_email?: string | null; action: string; table_name: string; record_id?: string | null; summary?: string | null; created_at: string }

/** Household-level settings stored in households.settings (merged over SETTINGS_DEFAULTS). */
export interface Settings {
  periodType: PeriodType            // how the budget is sliced: month, pay period, …
  periodAnchor?: ISODate | null     // for biweekly/custom: a known period start
  semimonthlyDays?: number[]        // e.g. [1,15]
  reserveFloor: number              // cash you will not go below
  runwayGreen: number; runwayYellow: number   // months
  dueSoonDays: number
  budgetCritPct: number             // over budget by more than this % = red
  savingsTargetPct: number          // target savings rate
  includeRetirementInCash: boolean
  payFrequencyDefault: PayFrequency
  gmail?: { clientId?: string; account?: string; since?: string; lastRun?: string | null; lastSummary?: string }
  outlook?: { clientId?: string; tenant?: string; account?: string; since?: string; lastRun?: string | null; lastSummary?: string }
  finmail?: { since?: string; auto?: boolean; rules?: Record<string, { account?: string; category?: string; recurring?: string; none?: boolean }> }
  playbook?: string[]
  imports?: ImportLog[]             // statement-import history (newest first, capped at 50)
  rules?: PayeeRule[]               // payee auto-categorisation rules (see lib/rules.ts)
  retirement?: RetirementInputs     // planner inputs (see lib/retirement.ts)
  tax?: Partial<import('../../lib/tax').TaxProfile>   // tax planner profile and manual items (see lib/tax.ts)
  learnRules?: boolean              // create a rule when a category is set by hand (default true)
}
export interface RetirementInputs { currentAge: number; retireAge: number; lifeExpectancy: number; annualContribution: number; expectedReturn: number; inflation: number; returnStdDev: number; desiredIncome: number; socialSecurity: number; currentIncome: number }
export interface PayeeRule { id: string; pattern: string; match: 'contains' | 'starts' | 'exact' | 'regex'; category_id?: string | null; account_id?: string | null; rename?: string | null; exclude_from_budget?: boolean; kind?: 'expense' | 'income' | null; enabled: boolean; hits?: number; created_at?: string; source?: 'manual' | 'learned' }
export interface ImportLog { at: string; file: string; format: 'csv' | 'ofx'; account_id: string; rows: number; added: number; skipped: number; balance?: number | null }
export const SETTINGS_DEFAULTS: Settings = { periodType: 'month', periodAnchor: null, semimonthlyDays: [1, 15], reserveFloor: 0, runwayGreen: 6, runwayYellow: 3, dueSoonDays: 7, budgetCritPct: 10, savingsTargetPct: 20, includeRetirementInCash: false, payFrequencyDefault: 'biweekly' }

export type Collection = 'accounts' | 'statements' | 'categories' | 'paySchedules' | 'periods' | 'lines' | 'transactions' | 'recurring' | 'occurrences' | 'goals' | 'contributions' | 'planned' | 'snapshots' | 'hardship' | 'emailItems' | 'holdings' | 'reconciliations'
export const TABLE: Record<Collection, string> = { accounts: 'accounts', statements: 'statements', categories: 'categories', paySchedules: 'pay_schedules', periods: 'budget_periods', lines: 'budget_lines', transactions: 'transactions', recurring: 'recurring', occurrences: 'bill_occurrences', goals: 'goals', contributions: 'goal_contributions', planned: 'planned_items', snapshots: 'net_worth_snapshots', hardship: 'hardship_outreach', emailItems: 'email_items', holdings: 'holdings', reconciliations: 'reconciliations' }
export interface Data {
  accounts: Account[]; statements: Statement[]; categories: Category[]; paySchedules: PaySchedule[]; periods: BudgetPeriod[]; lines: BudgetLine[]
  transactions: Transaction[]; recurring: Recurring[]; occurrences: BillOccurrence[]; goals: Goal[]; contributions: GoalContribution[]
  planned: PlannedItem[]; snapshots: NetWorthSnapshot[]; hardship: Hardship[]; emailItems: EmailItem[]; holdings: Holding[]; reconciliations: Reconciliation[]
  /** immutable cash-operations audit trail, newest first */
  audit: AuditEvent[]
  emailLedger: EmailLedgerRow[]; members: Member[]; invites: Invite[]; activity: ActivityRow[]
  /** transactions merged into another one (duplicate_of set) — kept for review and undo, excluded from all calculations */
  duplicates: Transaction[]
}
export const emptyData = (): Data => ({ duplicates: [], reconciliations: [], audit: [], accounts: [], statements: [], categories: [], paySchedules: [], periods: [], lines: [], transactions: [], recurring: [], occurrences: [], goals: [], contributions: [], planned: [], snapshots: [], hardship: [], emailItems: [], holdings: [], emailLedger: [], members: [], invites: [], activity: [] })
export type RowOf<C extends Collection> = Data[C][number]
