// Restoring a JSON backup (Settings → Backup & data → Restore), 0.25.1. One rulebook for both repos (SupabaseRepo and MemoryRepo pass a
// writer), so a merge behaves the same in the database and in the offline demo.
//
// Merge: every backup row is matched against what the household already holds — by id first, then by a natural key (a transaction's bank id,
// an account's name/kind/institution/last four, a budget line's period and category, …). A matched row is kept as it is, or updated in place
// when the backup holds a newer version (its updated_at is later); a row with no match is added, keeping its backup id when that id is free.
// Every child row (splits, lots, budget lines, occurrences, contributions, statements, …) is re-pointed at the surviving parent, so nothing
// ends up linked to a copy. Links to a row restored later in the order (a transaction's email item, a merged duplicate's keeper, an
// account's linked loan) are filled in after everything is written.
import type { Collection } from '../app/data/types'

type Row = Record<string, unknown>
/** Parents before children. */
export const RESTORE_ORDER: Collection[] = ['accounts', 'categories', 'scenarios', 'scores', 'estate', 'periods', 'lines', 'paySchedules', 'holdings', 'lots', 'recurring', 'insurance', 'goals',
  'statements', 'reconciliations', 'transactions', 'splits', 'comments', 'attachments', 'occurrences', 'contributions', 'planned', 'snapshots', 'hardship', 'emailItems']
/** Which columns point at which table (mirrors the foreign keys in supabase/migrations). */
export const REFS: Partial<Record<Collection, Record<string, Collection>>> = {
  accounts: { linked_account_id: 'accounts', autopay_account_id: 'accounts' },
  lines: { period_id: 'periods', category_id: 'categories' },
  paySchedules: { deposit_account_id: 'accounts', category_id: 'categories' },
  holdings: { account_id: 'accounts' }, lots: { holding_id: 'holdings' },
  recurring: { account_id: 'accounts', liability_account_id: 'accounts', category_id: 'categories' }, insurance: { recurring_id: 'recurring' },
  goals: { account_id: 'accounts' }, statements: { account_id: 'accounts' }, reconciliations: { account_id: 'accounts' },
  transactions: { account_id: 'accounts', to_account_id: 'accounts', category_id: 'categories', recurring_id: 'recurring', pay_schedule_id: 'paySchedules', goal_id: 'goals', email_item_id: 'emailItems', duplicate_of: 'transactions', reconciliation_id: 'reconciliations' },
  splits: { transaction_id: 'transactions', category_id: 'categories' }, comments: { transaction_id: 'transactions' }, attachments: { transaction_id: 'transactions', statement_id: 'statements' },
  occurrences: { recurring_id: 'recurring', transaction_id: 'transactions', email_item_id: 'emailItems' }, contributions: { goal_id: 'goals', transaction_id: 'transactions' },
  planned: { transaction_id: 'transactions' }, hardship: { account_id: 'accounts', recurring_id: 'recurring' },
  emailItems: { account_id: 'accounts', category_id: 'categories', recurring_id: 'recurring', transaction_id: 'transactions', statement_id: 'statements', bill_item_id: 'emailItems' },
}
/** Links a row cannot exist without (NOT NULL in the schema): when the parent is missing the row is left out. */
const REQUIRED: Partial<Record<Collection, string[]>> = { lines: ['period_id', 'category_id'], lots: ['holding_id'], statements: ['account_id'], reconciliations: ['account_id'], splits: ['transaction_id'], comments: ['transaction_id'], occurrences: ['recurring_id'], contributions: ['goal_id'] }
/** Never changed by a restore: completed reconciliations are immutable, and a comment can only be edited by its author. */
const NO_UPDATE = new Set<Collection>(['reconciliations', 'comments'])
const META = new Set(['id', 'household_id', 'created_at', 'updated_at', 'created_by', 'updated_by'])

const lc = (v: unknown) => String(v ?? '').trim().toLowerCase()
const money = (v: unknown) => (v == null || v === '' ? '' : String(Math.round(Number(v) * 100) / 100))
const d10 = (v: unknown) => String(v ?? '').slice(0, 10)
/** What makes two rows the same record when their ids differ. Keys starting with "!" are unique in the database itself. */
export const NATURAL_KEY: Partial<Record<Collection, (r: Row) => string | null>> = {
  accounts: r => `${r.kind}|${lc(r.name)}|${lc(r.institution)}|${lc(r.last4)}`,
  categories: r => `${r.kind}|${lc(r.group)}|${lc(r.name)}`,
  scenarios: r => `${r.kind}|${lc(r.name)}`,
  scores: r => `${lc(r.person)}|${d10(r.date)}|${lc(r.bureau)}|${lc(r.model)}`,
  estate: r => (r.key ? `!key:${r.key}` : `${lc(r.area)}|${lc(r.label)}`),
  periods: r => `!${d10(r.start_date)}|${d10(r.end_date)}`,
  lines: r => (r.period_id && r.category_id ? `!${r.period_id}|${r.category_id}` : null),
  paySchedules: r => `${r.kind}|${lc(r.name)}|${lc(r.payer)}`,
  holdings: r => `${r.account_id ?? ''}|${r.symbol ? 'symbol:' + lc(r.symbol) : 'name:' + lc(r.name)}`,
  lots: r => `${r.holding_id}|${d10(r.acquired_on)}|${money(r.quantity)}|${money(r.cost)}`,
  recurring: r => `${r.kind}|${lc(r.name)}|${lc(r.payee)}`,
  insurance: r => `${r.kind}|${lc(r.name)}|${lc(r.carrier)}`,
  goals: r => `${r.kind}|${lc(r.name)}`,
  statements: r => `${r.account_id}|${d10(r.statement_date)}`,
  reconciliations: r => `${r.account_id}|${d10(r.statement_date)}`,
  transactions: r => (r.external_id ? `!ext:${r.external_id}` : `${d10(r.date)}|${r.kind}|${money(r.amount)}|${r.account_id ?? ''}|${r.to_account_id ?? ''}|${lc(r.payee)}`),
  splits: r => `${r.transaction_id}|${r.category_id ?? ''}|${money(r.amount)}|${lc(r.memo)}`,
  comments: r => `${r.transaction_id}|${lc(r.body)}`,
  attachments: r => (r.path ? `!path:${r.path}` : null),
  occurrences: r => `!${r.recurring_id}|${d10(r.due_date)}`,
  contributions: r => `${r.goal_id}|${d10(r.date)}|${money(r.amount)}|${r.transaction_id ?? ''}`,
  planned: r => `${d10(r.date)}|${lc(r.label)}|${money(r.amount)}`,
  snapshots: r => `!${d10(r.date)}`,
  hardship: r => `${lc(r.entity)}|${lc(r.type)}`,
  emailItems: r => { const ev = Array.isArray(r.evidence) ? (r.evidence[0] as { msg_id?: string } | undefined) : undefined; return ev?.msg_id ? `${r.kind}|msg:${ev.msg_id}` : null },
}

export interface RestoreWriter {
  /** Add a row. `row.id` is the backup's id: keep it when it is free, else give the row a new one. Returns the id the row got. */
  insert(coll: Collection, row: Row): Promise<string>
  /** Change a row; false when the change was refused. */
  update(coll: Collection, id: string, patch: Row): Promise<boolean>
}
export interface RestoreSummary { added: number; updated: number; unchanged: number; skipped: number }
export interface RestoreOptions { /** attachments are files under this household's folder; rows pointing anywhere else cannot be re-linked and are left out */ attachmentPrefix?: string }

/** The rows of one collection in a backup file (merged duplicates may travel under their own key; they are transactions too). */
export function backupRows(json: Record<string, unknown>, coll: Collection): Row[] {
  const list = (k: string) => (Array.isArray(json[k]) ? (json[k] as unknown[]) : []).filter((r): r is Row => !!r && typeof r === 'object' && !Array.isArray(r))
  const rows = coll === 'transactions' ? [...list('transactions'), ...list('duplicates')] : list(coll)
  const seen = new Set<string>(); return rows.filter(r => { const id = typeof r.id === 'string' ? r.id : null; if (!id) return true; if (seen.has(id)) return false; seen.add(id); return true })
}
const blank = (v: unknown) => v === undefined || v === null || v === ''
const same = (a: unknown, b: unknown) => {
  if (blank(a) && blank(b)) return true; if (blank(a) || blank(b)) return false
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return String(a) === String(b)
}
const stamp = (v: unknown) => { const n = Date.parse(String(v ?? '')); return Number.isFinite(n) ? n : null }

/** Write a backup into a household that already holds `existing` (merge; for replace, pass what is left after clearing — usually nothing). */
export async function restoreBackup(existing: Partial<Record<Collection, Row[]>>, json: Record<string, unknown>, w: RestoreWriter, opts: RestoreOptions = {}): Promise<RestoreSummary> {
  const sum: RestoreSummary = { added: 0, updated: 0, unchanged: 0, skipped: 0 }
  const idMap = Object.fromEntries(RESTORE_ORDER.map(k => [k, new Map<string, string>()])) as Record<Collection, Map<string, string>>
  const have = Object.fromEntries(RESTORE_ORDER.map(k => [k, new Map((existing[k] || []).filter(r => typeof r.id === 'string').map(r => [r.id as string, r]))])) as Record<Collection, Map<string, Row>>
  const later: Array<{ coll: Collection; id: string; field: string; value: string; parent: Collection }> = []
  const pos = (k: Collection) => RESTORE_ORDER.indexOf(k)

  for (const coll of RESTORE_ORDER) {
    const refs = REFS[coll] || {}; const keyOf = NATURAL_KEY[coll]
    let rows = backupRows(json, coll)
    if (coll === 'attachments' && opts.attachmentPrefix != null) { const n = rows.length; rows = rows.filter(r => String(r.path || '').startsWith(opts.attachmentPrefix!)); sum.skipped += n - rows.length }
    // 1. re-point every link at the surviving parent
    const prepared: Array<{ src: Row; out: Row; deferred: Array<{ field: string; value: string; parent: Collection }>; unresolved: Set<string> }> = []
    for (const src of rows) {
      const out: Row = {}; for (const [k, v] of Object.entries(src)) if (!META.has(k)) out[k] = v
      const deferred: Array<{ field: string; value: string; parent: Collection }> = []; const unresolved = new Set<string>(); let drop = false
      for (const [field, parent] of Object.entries(refs)) {
        const v = src[field]; if (blank(v)) { out[field] = null; continue }
        const id = String(v)
        if (pos(parent) >= pos(coll)) { deferred.push({ field, value: id, parent }); out[field] = null; continue }   // restored later (or this same table): linked afterwards
        const to = idMap[parent].get(id) ?? (have[parent].has(id) ? id : null)
        if (to == null) { unresolved.add(field); out[field] = null; if (REQUIRED[coll]?.includes(field)) drop = true } else out[field] = to
      }
      if (REQUIRED[coll]?.some(f => blank(out[f]))) drop = true
      if (coll === 'attachments' && blank(out.transaction_id) && blank(out.statement_id)) drop = true
      if (coll === 'snapshots' && out.by_account && typeof out.by_account === 'object') out.by_account = Object.fromEntries(Object.entries(out.by_account as Record<string, unknown>).map(([k, v]) => [idMap.accounts.get(k) ?? k, v]))
      if (drop) { sum.skipped++; continue }
      prepared.push({ src, out, deferred, unresolved })
    }
    // 2. find each row's match: the same id first (claimed before any natural key), then an unclaimed row with the same natural key
    const claimed = new Set<string>(); const match = new Map<Row, Row>()
    for (const p of prepared) { const id = typeof p.src.id === 'string' ? p.src.id : null; const m = id ? have[coll].get(id) : undefined; if (m && !claimed.has(id!)) { claimed.add(id!); match.set(p.src, m) } }
    const byKey = new Map<string, Row[]>()
    if (keyOf) for (const r of have[coll].values()) { const k = keyOf(r); if (k) byKey.set(k, [...(byKey.get(k) || []), r]) }
    for (const p of prepared) {
      if (match.has(p.src) || !keyOf) continue
      const k = keyOf(p.out); if (!k) continue; const cands = byKey.get(k) || []
      const m = cands.find(r => !claimed.has(r.id as string)) ?? (k.startsWith('!') ? cands[0] : undefined)   // a database-unique key can only ever be one row
      if (m) { claimed.add(m.id as string); match.set(p.src, m) }
    }
    // 3. write: keep, update in place (the backup's version is newer), or add
    const usedRefs = new Set([...have[coll].values()].map(r => r.ref).filter(Boolean) as string[])
    for (const p of prepared) {
      const m = match.get(p.src); const srcId = typeof p.src.id === 'string' ? p.src.id : null
      if (m) {
        if (srcId) idMap[coll].set(srcId, m.id as string)
        const patch: Row = {}
        for (const [k, v] of Object.entries(p.out)) { if (k === 'ref' || (coll === 'holdings' && k === 'value') || p.unresolved.has(k) || p.deferred.some(d => d.field === k)) continue; if (!same(m[k], v)) patch[k] = v }
        const newer = (() => { const a = stamp(p.src.updated_at), b = stamp(m.updated_at); return a != null && b != null && a > b })()
        if (Object.keys(patch).length && newer && !NO_UPDATE.has(coll) && await w.update(coll, m.id as string, patch)) { sum.updated++; for (const d of p.deferred) later.push({ coll, id: m.id as string, ...d }) }
        else sum.unchanged++
        continue
      }
      const row: Row = { ...p.out }; if (srcId) row.id = srcId
      if (typeof row.ref === 'string' && usedRefs.has(row.ref)) delete row.ref   // another record here already shows that ID: let a new one be given
      const id = await w.insert(coll, row); if (srcId) idMap[coll].set(srcId, id); if (typeof row.ref === 'string') usedRefs.add(row.ref)
      sum.added++; for (const d of p.deferred) later.push({ coll, id, ...d })
    }
  }
  // 4. links to rows restored after their child (or in the same table)
  const patches = new Map<string, { coll: Collection; id: string; patch: Row }>()
  for (const l of later) {
    const to = idMap[l.parent].get(l.value) ?? (have[l.parent].has(l.value) ? l.value : null); if (to == null) continue
    const cur = have[l.coll].get(l.id); if (cur && same(cur[l.field], to)) continue
    const k = l.coll + ':' + l.id; const e = patches.get(k) || { coll: l.coll, id: l.id, patch: {} }; e.patch[l.field] = to; patches.set(k, e)
  }
  for (const e of patches.values()) await w.update(e.coll, e.id, e.patch)
  return sum
}

/** The message shown when a restore finishes. */
export function restoreMessage(s: RestoreSummary): string {
  const n = (k: number, one: string, many = one) => `${k} ${k === 1 ? one : many}`
  return `Restore finished: ${n(s.added, 'record')} added, ${s.updated} updated, ${s.unchanged} already here` + (s.skipped ? `; ${n(s.skipped, 'record was', 'records were')} left out because what ${s.skipped === 1 ? 'it belongs' : 'they belong'} to is not in the file or not in this household.` : '.')
}
