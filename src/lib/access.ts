// Member access: which modules (sections of the app) a member may see, what that is called, the invitation email, and password rules.
// The database enforces the same module map through row-level security (module_allowed in supabase/migrations/0003_member_access.sql);
// this file only decides what the UI shows and what the invitation says. Keep MODULES in step with the migration.
import type { Role } from '../app/data/types'

export interface Module { k: string; label: string; paths: string[]; tables: string[]; hint?: string }
/** Every page belongs to exactly one module. `overview`, `reports` and `settings` are always visible (they only show what the member can already see). */
export const MODULES: Module[] = [
  { k: 'overview', label: 'Dashboard & forecast', paths: ['/', '/forecast'], tables: [], hint: 'always on — shows only what the member can see' },
  { k: 'transactions', label: 'Transactions & insights', paths: ['/transactions', '/insights'], tables: ['transactions'] },
  { k: 'budget', label: 'Budget', paths: ['/budget'], tables: ['budget_periods', 'budget_lines', 'planned_items'] },
  { k: 'bills', label: 'Bills & subscriptions', paths: ['/bills'], tables: ['recurring', 'bill_occurrences'] },
  { k: 'income', label: 'Income & pay periods', paths: ['/income'], tables: ['pay_schedules'] },
  { k: 'accounts', label: 'Accounts & debts', paths: ['/accounts', '/debts'], tables: ['accounts', 'statements', 'net_worth_snapshots'], hint: 'account names on other pages need this too' },
  { k: 'connections', label: 'Bank connections & email capture', paths: ['/connections', '/email'], tables: ['email_items', 'email_ledger'] },
  { k: 'investments', label: 'Investments & retirement', paths: ['/investments'], tables: ['holdings'] },
  { k: 'tax', label: 'Tax planning', paths: ['/tax'], tables: [] },
  { k: 'goals', label: 'Savings goals', paths: ['/goals'], tables: ['goals', 'goal_contributions'] },
  { k: 'hardship', label: 'Hardship & creditor outreach', paths: ['/hardship'], tables: ['hardship_outreach'] },
  { k: 'reports', label: 'Reports & trends', paths: ['/reports', '/trends'], tables: [], hint: 'always on' },
  { k: 'settings', label: 'Settings', paths: ['/settings'], tables: [], hint: 'always on — members only see their own security and the categories' },
]
export const ALWAYS_ON = ['overview', 'reports', 'settings']
export const GRANTABLE = MODULES.filter(m => !ALWAYS_ON.includes(m.k))
export const moduleLabel = (k: string) => MODULES.find(m => m.k === k)?.label || k

export const moduleForPath = (path: string): string | null => MODULES.find(m => m.paths.includes(path))?.k ?? null
/** null modules = everything. Always-on modules are included whatever the list says; unknown keys are ignored. */
export function allowedModules(modules: string[] | null | undefined): string[] {
  if (!modules) return MODULES.map(m => m.k)
  const set = new Set([...ALWAYS_ON, ...modules.filter(k => MODULES.some(m => m.k === k))])
  return MODULES.map(m => m.k).filter(k => set.has(k))
}
export const canViewPath = (path: string, modules: string[] | null | undefined) => { const m = moduleForPath(path); return m == null ? true : allowedModules(modules).includes(m) }
export const allowedPaths = (modules: string[] | null | undefined) => MODULES.filter(m => allowedModules(modules).includes(m.k)).flatMap(m => m.paths)
/** Normalise a module list for storage: null when it covers every grantable module (= full), otherwise the sorted, de-duplicated, known keys without the always-on ones. */
export function normaliseModules(modules: string[] | null | undefined): string[] | null {
  if (!modules) return null
  const keep = [...new Set(modules)].filter(k => GRANTABLE.some(m => m.k === k)).sort()
  return keep.length === GRANTABLE.length ? null : keep
}

export type AccessLevel = 'owner' | 'full' | 'readonly' | 'limited'
export interface Access { role: Role; read_only: boolean; modules: string[] | null }
export const ACCESS_LABEL: Record<AccessLevel, string> = { owner: 'Owner', full: 'Full access', readonly: 'Read-only', limited: 'Limited' }
/** Owner → owner; everything granted → full or read-only; a module list → limited. */
export function accessLevel(a: Access): AccessLevel {
  if (a.role === 'owner') return 'owner'
  if (normaliseModules(a.modules) != null) return 'limited'
  return a.role === 'viewer' || a.read_only ? 'readonly' : 'full'
}
export const canEditAccess = (a: Access) => a.role !== 'viewer' && !a.read_only
/** Role + read-only flag + module list for an access choice made in the UI. */
export function accessToMember(level: AccessLevel, modules: string[] | null, editWithin: boolean): Access {
  if (level === 'owner') return { role: 'owner', read_only: false, modules: null }
  if (level === 'full') return { role: 'editor', read_only: false, modules: null }
  if (level === 'readonly') return { role: 'viewer', read_only: true, modules: null }
  return { role: editWithin ? 'editor' : 'viewer', read_only: !editWithin, modules: normaliseModules(modules) ?? [] }
}
/** One line a person understands: "Full access — can add and change everything", "Read-only — can see everything", "Limited — Transactions & insights, Budget (read-only)". */
export function describeAccess(a: Access): string {
  const lv = accessLevel(a)
  if (lv === 'owner') return 'Owner — full control, including members and settings'
  if (lv === 'full') return 'Full access — can add and change everything'
  if (lv === 'readonly') return 'Read-only — can see everything, change nothing'
  const names = (normaliseModules(a.modules) || []).map(moduleLabel)
  return `Limited — ${names.length ? names.join(', ') : 'no modules yet'} (${canEditAccess(a) ? 'can add and change there' : 'read-only'})`
}

// ---------------- temporary passwords ----------------
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'   // no 0/O/1/l/I
/** `WP-xxxx-xxxx-xxxx` from a 0..1 random source (crypto in the app and the edge function; a seeded rng in tests). 12 symbols from a 54-symbol alphabet ≈ 69 bits. */
export function genTempPassword(rnd: () => number = Math.random): string {
  const g = () => [...Array(4)].map(() => ALPHABET[Math.floor(rnd() * ALPHABET.length)]).join('')
  return `WP-${g()}-${g()}-${g()}`
}
export const isTempPassword = (pw: string) => /^WP-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(pw)

/** First-sign-in password rules. Returns the problems (empty = acceptable). */
export function passwordProblems(pw: string, opts: { email?: string; temp?: string | null; confirm?: string } = {}): string[] {
  const p: string[] = []
  if (pw.length < 10) p.push('at least 10 characters')
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) p.push('upper- and lower-case letters')
  if (!/\d/.test(pw)) p.push('a number')
  if (opts.temp && pw === opts.temp) p.push('different from the temporary password')
  if (isTempPassword(pw)) p.push('not in the temporary-password format')
  const local = (opts.email || '').split('@')[0].toLowerCase()
  if (local.length >= 4 && pw.toLowerCase().includes(local)) p.push('not contain your email name')
  if (/^(.)\1+$/.test(pw) || /^(?:0123456789|1234567890|abcdefghij|qwertyuiop)/i.test(pw)) p.push('not a simple sequence')
  if (opts.confirm !== undefined && opts.confirm !== pw) p.push('the two entries must match')
  return p
}

// ---------------- the invitation email ----------------
export interface InviteDraftInput {
  appName: string; household: string; inviter: string; email: string; displayName?: string | null
  access: Access; siteUrl: string; tempPassword?: string | null; existing?: boolean; note?: string | null
}
export const TEMP_PLACEHOLDER = '{{TEMP_PASSWORD}}'
/** Subject + plain-text body. The temporary password is the only secret in it; nothing from the household's data goes in. */
export function inviteEmailDraft(i: InviteDraftInput): { subject: string; body: string } {
  const name = (i.displayName || '').trim() || i.email.split('@')[0]
  const subject = `You're invited to "${i.household}" on ${i.appName}`
  const lines = [
    `Hi ${name},`,
    '',
    `${i.inviter} has invited you to the "${i.household}" household on ${i.appName}.`,
    `Your access: ${describeAccess(i.access)}.`,
    '',
    `Sign in: ${i.siteUrl}`,
    `Email: ${i.email}`,
  ]
  if (i.existing) lines.push('Password: the one you already use for ' + i.appName + ' — the household will appear when you sign in.')
  else {
    lines.push(`Temporary password: ${i.tempPassword || TEMP_PLACEHOLDER}`, '', 'This temporary password is for your first sign-in only — you will be asked to choose your own password straight away. Please do not forward this message.')
  }
  if (i.note && i.note.trim()) lines.push('', i.note.trim())
  lines.push('', 'Thanks,', i.inviter)
  return { subject, body: lines.join('\n') }
}
export const mailtoLink = (to: string, subject: string, body: string) => `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
