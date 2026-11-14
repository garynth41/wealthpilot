import { create } from 'zustand'
import { isNative, publicUrl } from './native'
import { clearReminders } from './nativeReminders'
import type { Session, User } from '@supabase/supabase-js'
import type { Repo } from './data/repo'
import { emptyData, SETTINGS_DEFAULTS, type Collection, type Data, type Household, type MemberNotify, type Role, type RowOf, type Settings } from './data/types'
import { MemoryRepo } from './data/memoryRepo'
import { SupabaseRepo } from './data/supabaseRepo'
import { hasSupabase, sb } from './supabase'
import { LS, APP_VERSION, cmpVer } from './config'
import { canViewPath } from '../lib/access'
import { planDedupe, unpairPatch, type DTxn } from '../lib/dedupe'
import { paycheckOnFile } from '../lib/paySchedule'
import { post } from '../lib/ledger'
import { patchProblem, InputError, isInputError } from '../lib/validate'
import type { Account, Transaction } from './data/types'
import { leaveOut, unpairForLeavingOut, everyAccount } from '../lib/leftOut'
import { planAccountMerge, feedRemap } from '../lib/accountMerge'

/** Merged duplicates live in data.duplicates, everything else in data.transactions — so every page and engine sees each transaction once. */
export const splitDups = (d: Data): Data => { const all = [...d.transactions, ...(d.duplicates || [])]; return { ...d, transactions: all.filter(t => !t.duplicate_of), duplicates: all.filter(t => !!t.duplicate_of) } }
/** What every page reads (0.28.0): each transaction once, and nothing from an account left out of the figures (lib/leftOut.ts → data.off). */
export const toView = (d: Data): Data => leaveOut(splitDups(d))
/** writes run a few at a time: quick enough for a few dozen rows, gentle on the connection */
async function inChunks<T>(items: T[], run: (x: T) => Promise<unknown>, size = 6) { for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(run)) }

import { setErrorSink } from '../lib/errors'
import { testerCode } from '../lib/invite'
import { saveOffline, loadOffline, clearOffline, makeSnapshot, isNetworkError } from '../lib/offlineCache'
let signingOut = false   // set while signOut runs: a refresh finishing then must not write the offline copy back
export type Mode = 'db' | 'demo' | null
export interface Toast { id: number; text: string; err?: boolean; action?: { label: string; run: () => void } }
/** One reversible step (0.19.0): what it was, and how to put it back. */
export interface UndoEntry { label: string; run: () => Promise<void> }

interface State {
  mode: Mode; booting: boolean; user: User | null; session: Session | null
  repo: Repo | null; household: Household | null; data: Data; role: Role; readOnly: boolean; modules: string[] | null
  households: Array<{ id: string; name: string; role: Role }>
  latest: string | null; nativeMin: string | null; nativeLatest: string | null; loadError: string | null; toasts: Toast[]; busy: number; lastRefresh: number | null; mfaPending: boolean; recovering: boolean
  /** 0.25.0: set while showing the read-only offline copy (or once the connection drops): when that copy was saved */
  offlineAt: string | null
  /** 0.29.0: this account runs the app (app_admins) — sees Feedback & testers */
  /** the person runs Cresari (app_admins): true / false, or null while the check is still out */
  appAdmin: boolean | null
  requestDeletion: (confirm: string) => Promise<string>; cancelDeletion: () => Promise<void>
  accountDeletionPreview: () => Promise<AccountDeletionPlan>; deleteAccount: (password: string) => Promise<{ households_deleted: number }>
  settings: () => Settings
  canEdit: () => boolean; isOwner: () => boolean; canView: (path: string) => boolean; mustChangePassword: () => boolean
  boot: () => Promise<void>
  enterDemo: () => Promise<void>; exitDemo: () => void; resetDemo: () => void
  signIn: (email: string, password: string) => Promise<void>; signUp: (email: string, password: string) => Promise<string>; signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>; updatePassword: (pw: string) => Promise<void>; finishRecovery: (pw: string) => Promise<void>
  verifyMfa: (code: string) => Promise<void>
  /** 0.20.0: one of the ten single-use codes instead of the authenticator */
  verifyRecoveryCode: (code: string) => Promise<void>
  /** 0.20.0: passwordless sign-in with a passkey (device biometrics / PIN / security key) */
  signInWithPasskey: () => Promise<void>
  openHousehold: (id: string) => Promise<void>; createHousehold: (name: string) => Promise<void>
  refresh: () => Promise<void>
  insert: <C extends Collection>(coll: C, row: Partial<RowOf<C>>) => Promise<RowOf<C>>
  insertMany: <C extends Collection>(coll: C, rows: Partial<RowOf<C>>[]) => Promise<RowOf<C>[]>
  /** 0.25.1: log one paycheck (an income row with pay_schedule_id) and move the account balance — once. When that payday's deposit is
   *  already on file (see paycheckOnFile: logged before, from the bank feed or email, or typed by hand) nothing is written and the existing
   *  transaction comes back with existing = true; saves for the same schedule run one at a time, so a double click cannot slip through. */
  logPaycheck: (row: Partial<Transaction>) => Promise<{ txn: Transaction; existing: boolean }>
  update: <C extends Collection>(coll: C, id: string, patch: Partial<RowOf<C>>) => Promise<RowOf<C>>
  remove: (coll: Collection, id: string) => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  /** 0.25.1: one member's alert choices only (null = household default) — see Repo.saveMemberNotify */
  saveMemberNotify: (userId: string, patch: Partial<MemberNotify> | null) => Promise<void>
  toast: (text: string, err?: boolean, action?: { label: string; run: () => void }) => void
  /** last 10 reversible changes, newest last */
  undo: UndoEntry[]
  pushUndo: (e: UndoEntry) => void
  undoLast: () => Promise<void>
  /** the same patch on many rows, undone as one step — for fields that do not move balances (category, tags, memo, exclude_from_budget) */
  bulkUpdate: <C extends Collection>(coll: C, ids: string[], patch: Partial<RowOf<C>>) => Promise<number>
  bulkRemove: (coll: Collection, ids: string[]) => Promise<number>
  guarded: <T>(fn: () => Promise<T>, ok?: string) => Promise<T | undefined>
  /** merge every clear-cut duplicate (see lib/dedupe.ts); returns how many rows were merged */
  autoDedupe: (quiet?: boolean) => Promise<number>
  checkLatest: () => Promise<void>
  mergeDuplicates: (keeper: string, dups: string[], patch?: Partial<Transaction>) => Promise<void>
  restoreDuplicate: (id: string) => Promise<void>
  notDuplicates: (ids: string[]) => Promise<void>
  /** 0.28.0: switch an account out of (off = true) or back into the household's figures; returns how many paired transfers were taken apart */
  leaveAccountOut: (id: string, off: boolean) => Promise<number>
  /** 0.28.0: fold copies of one account into the copy to keep (lib/accountMerge.ts); returns how many rows moved */
  mergeAccounts: (keeperId: string, otherIds: string[]) => Promise<number>
}

/** Captured before the Supabase client reads and clears the URL: a password-reset link lands with #access_token=…&type=recovery. */
const LANDED_ON_RECOVERY = typeof location !== 'undefined' && /type=recovery/.test(location.hash + location.search)
let deduping = false
/** paycheck saves still running, per pay schedule (logPaycheck) */
const paycheckSaves = new Map<string, Promise<{ txn: Transaction; existing: boolean }>>()
let toastSeq = 0, unsub: (() => void) | null = null, refreshTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<State>((set, get) => ({
  mode: null, booting: true, user: null, session: null, repo: null, household: null, data: emptyData(), role: 'viewer', readOnly: false, modules: null, households: [], latest: null, nativeMin: null, appAdmin: null, nativeLatest: null, offlineAt: null, loadError: null, toasts: [], undo: [], busy: 0, lastRefresh: null, mfaPending: false, recovering: LANDED_ON_RECOVERY,
  settings: () => ({ ...SETTINGS_DEFAULTS, ...(get().household?.settings || {}) }),
  // a household scheduled for deletion is read-only for everyone (0.25.0); so is an offline copy
  canEdit: () => { const s = get(); return (s.mode === 'demo' || (['owner', 'editor'].includes(s.role) && !s.readOnly)) && !s.household?.deletion_scheduled_for && !s.offlineAt },
  isOwner: () => get().mode === 'demo' || get().role === 'owner',
  canView: (path) => get().mode === 'demo' || canViewPath(path, get().modules),
  mustChangePassword: () => get().mode === 'db' && !!(get().user?.user_metadata as { must_change_password?: boolean } | undefined)?.must_change_password,

  async boot() {
    set({ booting: true })
    try {
      if (localStorage.getItem(LS('mode')) === 'demo') { await get().enterDemo(); return }
      if (!hasSupabase()) { set({ booting: false }); return }
      const { data: { session } } = await sb().auth.getSession()
      sb().auth.onAuthStateChange((e, s) => { if (e === 'PASSWORD_RECOVERY') set({ recovering: true }); set({ session: s, user: s?.user || null }); if (!s) { unsub?.(); unsub = null; set({ mode: null, repo: null, household: null, data: emptyData() }) } if (e === 'SIGNED_OUT') void clearOffline() })   // signed out anywhere (another tab, a revoked device): this device forgets its copy too
      set({ session, user: session?.user || null })
      // offline with an expired token: the session cannot be refreshed, but the copy this device kept can still be shown read-only
      if (!session && typeof navigator !== 'undefined' && navigator.onLine === false) { const u = cachedUser(); if (u && await openOffline(u)) { set({ user: u }); return } }
      if (session && get().recovering) { /* reset link: stay out of the household until the new password is saved */ }
      else if (session) { if (await needsMfa()) set({ mfaPending: true }); else await loadHouseholds(session.user) }
    } catch (e) { set({ loadError: (e as Error).message }) }
    finally { set({ booting: false }) }
  },
  async enterDemo() {
    const repo = new MemoryRepo(); localStorage.setItem(LS('mode'), 'demo')
    set({ mode: 'demo', repo, role: 'owner', readOnly: false, booting: false }); setErrorSink(async r => { console.warn('[demo] error captured', r.message) })
    await get().refresh(); attach(repo)
  },
  exitDemo() { localStorage.removeItem(LS('mode')); unsub?.(); unsub = null; set({ mode: null, repo: null, household: null, data: emptyData() }) },
  resetDemo() { const r = get().repo; if (r instanceof MemoryRepo) { r.reset(); get().refresh(); get().toast('Sample data restored') } },
  async signIn(email, password) { const { error } = await sb().auth.signInWithPassword({ email, password }); if (error) throw error; if (await needsMfa()) { set({ mfaPending: true }); return } const { data: { user } } = await sb().auth.getUser(); if (user) await loadHouseholds(user) },
  async verifyMfa(code) { const { data: f, error: e1 } = await sb().auth.mfa.listFactors(); if (e1) throw e1; const factor = f.totp.find(x => x.status === 'verified') || f.totp[0]; if (!factor) throw new Error('No authenticator is enrolled'); const { error } = await sb().auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.replace(/\s+/g, '') }); if (error) throw error; set({ mfaPending: false }); const { data: { user } } = await sb().auth.getUser(); if (user) await loadHouseholds(user) },
  async verifyRecoveryCode(code) { const { error } = await sb().auth.mfa.recoveryCodes.verify({ code: code.trim() }); if (error) throw new Error(authMessage(error)); set({ mfaPending: false }); const { data: { user } } = await sb().auth.getUser(); if (user) await loadHouseholds(user) },
  async signInWithPasskey() { const { data, error } = await sb().auth.signInWithPasskey(); if (error) throw new Error(authMessage(error)); const user = data?.user || (await sb().auth.getUser()).data.user; if (!user) throw new Error('The passkey was accepted but no session came back — try again'); set({ mfaPending: false }); await loadHouseholds(user) },
  async signUp(email, password) { const tester = testerCode(); const { data, error } = await sb().auth.signUp({ email, password, options: { emailRedirectTo: publicUrl(), ...(tester ? { data: { tester } } : {}) } }); if (error) throw new Error(signUpMessage(error)); if (data.session) { await loadHouseholds(data.user!); return 'ready' } return 'confirm' },
  // stop live updates first, so a refresh already on its way cannot write the offline copy back after it is cleared (0.25.1)
  // signing out here ends this device's session only (0.25.1 — the library's default also signed out every other device and the phone);
  // Settings → Security → Sign out everywhere does that on purpose
  async signOut() { signingOut = true; try { setErrorSink(null); unsub?.(); unsub = null; await clearOffline(); await clearReminders(); try { await sb().auth.signOut({ scope: 'local' }) } catch { /* offline: the local session is cleared below anyway */ } set({ mode: null, repo: null, household: null, data: emptyData(), households: [], mfaPending: false, offlineAt: null, appAdmin: null }); await clearOffline() } finally { signingOut = false } },
  async finishRecovery(pw) {
    await get().updatePassword(pw); set({ recovering: false })
    try { history.replaceState(null, '', location.pathname) } catch { /* */ }
    const { data: { user } } = await sb().auth.getUser(); if (user) { if (await needsMfa()) set({ mfaPending: true }); else await loadHouseholds(user) }
  },
  async resetPassword(email) { const { error } = await sb().auth.resetPasswordForEmail(email, { redirectTo: publicUrl() }); if (error) throw error },
  async updatePassword(pw) { const { data, error } = await sb().auth.updateUser({ password: pw, data: { must_change_password: false } }); if (error) throw error; if (data.user) set({ user: data.user }) },
  async openHousehold(id) {
    unsub?.(); const repo = new SupabaseRepo(id); localStorage.setItem(LS('household'), id)
    set({ mode: 'db', repo }); await get().refresh(); attach(repo)
    // error monitoring: browser errors go to app_errors for this household (migration 0009); the table missing is not itself an error
    setErrorSink(async r => { const uid = get().user?.id; if (!uid) return; const { error } = await sb().from('app_errors').insert({ household_id: id, user_id: uid, source: r.source, version: r.version, message: r.message, stack: r.stack || null, url: r.url, user_agent: r.user_agent, context: r.context || {} }); if (error && !/app_errors/.test(error.message)) throw error })
    void get().checkLatest(); startVersionWatch(get)
  },
  // deleting your own account (0.25.1, required by both app stores) — the delete-account function does the work, then this device forgets everything
  async accountDeletionPreview() { return fnCall<AccountDeletionPlan>('delete-account', { action: 'preview' }) },
  async deleteAccount(password) { const r = await fnCall<{ households_deleted: number }>('delete-account', { action: 'delete', password }); try { localStorage.removeItem(LS('household')) } catch { /* */ } await get().signOut(); return r },
  async requestDeletion(confirm) { const at = await need(get).requestDeletion(confirm); await get().refresh(); return at },
  async cancelDeletion() { await need(get).cancelDeletion(); await get().refresh() },
  // the website's release (reload to get it) and, for the phone apps (0.25.1), the newest build in the stores and the oldest still allowed
  async checkLatest() { try { const { data } = await sb().from('app_meta').select('key, value').in('key', ['latest_version', 'latest_native_version', 'min_native_version']); const v = (k: string) => (data || []).find(r => r.key === k)?.value || null; set({ latest: v('latest_version'), nativeLatest: v('latest_native_version'), nativeMin: v('min_native_version') }) } catch { /* optional */ } },
  async createHousehold(name) { const { data, error } = await sb().rpc('create_household', { p_name: name }); if (error) throw error; const { data: { user } } = await sb().auth.getUser(); if (user) await loadHouseholds(user); await get().openHousehold(data as string) },
  async refresh() {
    const repo = get().repo; if (!repo) return
    try { const r = await repo.loadAll(); set({ household: r.household, data: toView(r.data), role: r.role, readOnly: r.readOnly, modules: r.modules, loadError: null, lastRefresh: Date.now(), offlineAt: null }); if (get().canEdit()) void get().autoDedupe().catch(() => {})
      const uid = get().user?.id; if (repo.mode === 'db' && uid && !signingOut && get().repo === repo) void saveOffline(makeSnapshot(uid, r, APP_VERSION)) }
    catch (e) { if (repo.mode === 'db' && isNetworkError(e) && get().household) { set({ offlineAt: new Date(get().lastRefresh || Date.now()).toISOString() }); return }
      set({ loadError: (e as Error).message }); get().toast('Could not load: ' + (e as Error).message, true) }
  },
  async insert(coll, row) { const repo = need(get); refuseBad(coll, row as Record<string, unknown>); const r = await repo.insert(coll, row); set(s => ({ data: { ...s.data, [coll]: [...(s.data[coll] as unknown[]), r] } })); if (coll === 'transactions') void get().autoDedupe().catch(() => {}); return r },
  async insertMany(coll, rows) { const repo = need(get); for (const row of rows) refuseBad(coll, row as Record<string, unknown>); const r = await repo.insertMany(coll, rows); set(s => ({ data: { ...s.data, [coll]: [...(s.data[coll] as unknown[]), ...r] } })); if (coll === 'transactions') void get().autoDedupe().catch(() => {}); return r },
  async logPaycheck(row) {
    const ps = get().data.paySchedules.find(p => p.id === row.pay_schedule_id); const date = (row.date || '').slice(0, 10)
    if (!ps || !date) throw new Error('Pick the income source and the date of this paycheck')
    const prev = paycheckSaves.get(ps.id) || Promise.resolve()
    const run = prev.catch(() => undefined).then(async () => {
      const found = paycheckOnFile(get().data, ps, date, +(row.amount || 0)); if (found) return { txn: found, existing: true }
      const txn = await get().insert('transactions', { ...row, kind: 'income', date })
      await post(get().data, (id, p) => get().update('accounts', id, p), txn, 1, txn.date)
      return { txn, existing: false }
    })
    paycheckSaves.set(ps.id, run)
    try { return await run } finally { if (paycheckSaves.get(ps.id) === run) paycheckSaves.delete(ps.id) }
  },
  async mergeDuplicates(keeper, dups, patch) {
    const repo = need(get)
    if (patch && Object.keys(patch).length) { const k = await repo.update('transactions', keeper, patch); set(s => ({ data: { ...s.data, transactions: s.data.transactions.map(t => t.id === keeper ? k : t) } })) }
    for (const id of dups) { const d = await repo.update('transactions', id, { duplicate_of: keeper }); set(s => ({ data: { ...s.data, transactions: s.data.transactions.filter(t => t.id !== id), duplicates: [...s.data.duplicates.filter(t => t.id !== id), d] } })) }
  },
  async restoreDuplicate(id) {
    const repo = need(get); const dup = get().data.duplicates.find(t => t.id === id); const keeper = dup?.duplicate_of ? get().data.transactions.find(t => t.id === dup.duplicate_of) : undefined
    const r = await repo.update('transactions', id, { duplicate_of: null, dedupe_ok: true })
    set(s => ({ data: { ...s.data, duplicates: s.data.duplicates.filter(t => t.id !== id), transactions: [...s.data.transactions.filter(t => t.id !== id), r] } }))
    // the card or loan side of a paired payment (0.25.1): the kept checking or savings row goes back to the expense it arrived as
    const unpair = dup && keeper ? unpairPatch(keeper as unknown as DTxn, dup as unknown as DTxn) : null
    if (keeper && unpair) { const k = await repo.update('transactions', keeper.id, unpair as Partial<Transaction>); set(s => ({ data: { ...s.data, transactions: s.data.transactions.map(t => t.id === keeper.id ? k : t) } })) }
  },
  async notDuplicates(ids) { for (const id of ids) await get().update('transactions', id, { dedupe_ok: true }) },
  // Leaving an account out (0.28.0). The flag goes first, so nothing pairs across the line while the transfers are taken apart; the data is
  // then read again and split (toView), which is what actually takes the account off every page. If a write fails part-way the flag is
  // put back, so the account is counted as before and the engine re-pairs whatever was taken apart; and asking again for an account that
  // is already off finishes any pair an earlier attempt did not reach, so a retry always completes the job.
  async leaveAccountOut(id, off) {
    const repo = need(get); const d = get().data
    const a = everyAccount(d).find(x => x.id === id); if (!a) throw new Error('That account is no longer here — refresh and try again')
    const was = !!a.excluded; const pairs = off ? unpairForLeavingOut(d, id) : []
    if (was === off && !pairs.length) return 0
    if (was !== off) await repo.update('accounts', id, { excluded: off } as Partial<Account>)
    // restore the merged row first, change the keeper second: whatever stops in between, the keeper is still a paired transfer and the plan finds it again
    try { await inChunks(pairs, async u => { if (u.restore) await repo.update('transactions', u.restore, { duplicate_of: null }); await repo.update('transactions', u.keeper, u.patch) }) }
    catch (e) {
      if (was !== off) { try { await repo.update('accounts', id, { excluded: was } as Partial<Account>) } catch { /* the retry above finishes it */ } }
      await get().refresh().catch(() => {})
      throw new Error(`${a.name} could not be left out just now (${(e as Error).message}). Nothing is lost — try again.`)
    }
    void repo.logAudit('correction', off ? `${a.name} left out of the figures${pairs.length ? ` — ${pairs.length} transfer${pairs.length === 1 ? '' : 's'} with your other accounts now read as money in or out` : ''}` : `${a.name} counted again`, { excluded: off, unpaired: pairs.map(u => ({ keeper: u.keeper, restored: u.restore || null })) }, id).catch(() => {})
    await get().refresh()
    return pairs.length
  },
  async mergeAccounts(keeperId, otherIds) {
    const repo = need(get); const d = get().data
    const keeper = d.accounts.find(a => a.id === keeperId); const others = d.accounts.filter(a => otherIds.includes(a.id) && a.id !== keeperId)
    if (!keeper || !others.length) throw new Error('Those accounts are no longer here — refresh and try again')
    const plan = planAccountMerge(d, keeper, others, get().settings().finmail?.rules || null)
    // the bank feed's match (which bank account goes into which of ours) is kept by id: a copy that is matched hands its feed to the kept
    // account before anything else moves. The merge stops when that match cannot be read or — for a copy that is matched — cannot be saved
    // and read back: a member who may not open Bank connections cannot be shown it, and only an owner may change it.
    if (get().mode === 'db' && !get().canView('/connections')) throw new Error('Merging accounts needs to check the bank feed\'s matching, which your access does not include — ask an owner to merge them')
    const st = await repo.syncStatus(); if (get().mode === 'db' && !st.available) throw new Error('The bank feed\'s matching could not be checked just now — nothing was merged; try again')
    const gone = others.map(o => o.id); const nextMap = feedRemap(st.connection?.account_map || null, keeper.id, gone, keeper.name)
    if (nextMap) { if (!get().isOwner()) throw new Error(`A copy of ${keeper.name} is matched to the bank feed — ask an owner to merge them`)
      await repo.syncSetMap(nextMap); const after = (await repo.syncStatus()).connection?.account_map || {}
      if (Object.values(after).some(v => gone.includes(v))) throw new Error('The bank feed\'s matching could not be moved to the kept account — nothing was merged') }
    await inChunks(plan.moves, m => repo.update(m.coll, m.id, m.patch as never))
    if (Object.keys(plan.keeperPatch).length) await repo.update('accounts', keeper.id, plan.keeperPatch)
    if (plan.rules) await get().saveSettings({ finmail: { ...(get().settings().finmail || {}), rules: plan.rules } })
    for (const o of others) await repo.remove('accounts', o.id)
    void repo.logAudit('correction', `Merged ${others.length} cop${others.length === 1 ? 'y' : 'ies'} of ${keeper.name} into one account`, { keeper: keeper.id, removed: others.map(o => ({ id: o.id, ref: o.ref || null, balance: o.balance, status: o.status })), moved: plan.moved, keeperPatch: plan.keeperPatch, feed: !!nextMap }, keeper.id).catch(() => {})
    await get().refresh()
    return plan.moves.length
  },
  async autoDedupe(quiet) {
    if (deduping || !get().canEdit() || !get().repo) return 0
    deduping = true
    try {
      const plan = planDedupe(get().data.transactions as unknown as DTxn[], get().data.accounts, get().household?.settings?.dedupe); let n = 0
      for (const g of plan.auto) { await get().mergeDuplicates(g.keeper, g.dups, g.patch as Partial<Transaction>); n += g.dups.length }
      // every automatic merge leaves a line in the change history (0.27.0), so it can be found and undone later
      if (n) { const byId = new Map(get().data.duplicates.map(t => [t.id, t])); const what = plan.auto.flatMap(g => g.dups.map(d => { const t = byId.get(d); return t ? `${t.date} ${t.payee || ''} ${Number(t.amount).toFixed(2)}` : d })).slice(0, 12).join('; '); void get().repo?.logAudit('match', `Merged ${n} duplicate transaction${n === 1 ? '' : 's'}: ${what}${plan.auto.length > 12 ? ' …' : ''}`, { groups: plan.auto.map(g => ({ keeper: g.keeper, dups: g.dups, reason: g.reason })) }).catch(() => {}) }
      if (n && !quiet) get().toast(`Merged ${n} duplicate transaction${n === 1 ? '' : 's'} — one copy kept (the bank's when there is one). Review or undo in Transactions → Duplicates.`)
      return n
    } finally { deduping = false }
  },
  // 0.25.1: a value the database would refuse (an empty date, a negative amount — see lib/validate.ts) is refused here, before the
  // optimistic copy shows it: an empty transaction date used to reach every page and take the whole app down. A save that fails
  // anyway puts back just that row as it was, so other rows changed meanwhile are kept.
  async update(coll, id, patch) {
    const repo = need(get); refuseBad(coll, patch as Record<string, unknown>)
    const prev = (get().data[coll] as unknown as Array<{ id: string }>).find(x => x.id === id)
    const put = (row: { id: string } | undefined) => { if (row) set(s => ({ data: { ...s.data, [coll]: (s.data[coll] as unknown as Array<{ id: string }>).map(x => x.id === id ? row : x) } })) }
    put(prev && { ...prev, ...patch })   // optimistic
    try { const r = await repo.update(coll, id, patch); put(r as unknown as { id: string }); return r }
    catch (e) { put(prev); throw e }
  },
  async remove(coll, id) {
    const repo = need(get); const before = get().data
    set(s => ({ data: { ...s.data, [coll]: (s.data[coll] as unknown as Array<{ id: string }>).filter(x => x.id !== id) } }))
    try { await repo.remove(coll, id); if (repo.mode === 'demo') await get().refresh() } catch (e) { set({ data: before }); throw e }
  },
  // Undo (0.19.0): only handlers that know how to put balances back push entries (Transactions page edits, bulk edits); generic writes never do.
  pushUndo(e) { set(s => ({ undo: [...s.undo.slice(-9), e] })) },
  async undoLast() { const e = get().undo.at(-1); if (!e) { get().toast('Nothing to undo'); return } set(s => ({ undo: s.undo.slice(0, -1) })); const n = get().undo.length; await e.run(); set(s => ({ undo: s.undo.slice(0, n) })) },   // the undo's own write may push an entry: drop it so Ctrl-Z does not ping-pong
  async bulkUpdate(coll, ids, patch) {
    const repo = need(get); refuseBad(coll, patch as Record<string, unknown>); const before = get().data[coll] as unknown as Array<Record<string, unknown>>; let n = 0; const inverses: Array<{ id: string; inverse: Record<string, unknown> }> = []
    for (const id of ids) { const prev = before.find(x => x.id === id); if (!prev) continue; const inverse: Record<string, unknown> = {}; for (const k of Object.keys(patch)) inverse[k] = prev[k] ?? null; inverses.push({ id, inverse })
      const r = await repo.update(coll, id, patch); set(s => ({ data: { ...s.data, [coll]: (s.data[coll] as unknown as Array<{ id: string }>).map(x => x.id === id ? r : x) } })); n++ }
    if (n) get().pushUndo({ label: `edit ${n} ${coll}`, run: async () => { for (const { id, inverse } of inverses) { const r = await repo.update(coll, id, inverse as Partial<RowOf<typeof coll>>); set(s => ({ data: { ...s.data, [coll]: (s.data[coll] as unknown as Array<{ id: string }>).map(x => x.id === id ? r : x) } })) } } })
    return n
  },
  async bulkRemove(coll, ids) {
    const repo = need(get); const rows = (get().data[coll] as unknown as Array<Record<string, unknown>>).filter(x => ids.includes(String(x.id))); let n = 0
    for (const r of rows) { await repo.remove(coll, String(r.id)); n++ }
    set(s => ({ data: { ...s.data, [coll]: (s.data[coll] as unknown as Array<{ id: string }>).filter(x => !ids.includes(x.id)) } })); if (repo.mode === 'demo') await get().refresh()
    if (n) get().pushUndo({ label: `delete ${n} ${coll}`, run: async () => { const back = rows.map(({ id: _id, created_at: _c, updated_at: _u, created_by: _cb, updated_by: _ub, ref: _r, ...rest }) => { void _id; void _c; void _u; void _cb; void _ub; void _r; return rest }); const ins = await repo.insertMany(coll, back as Partial<RowOf<Collection>>[]); set(s => ({ data: { ...s.data, [coll]: [...(s.data[coll] as unknown[]), ...ins] } })) } })
    return n
  },
  async saveSettings(patch) { const repo = need(get); const settings = await repo.saveSettings(patch); set(s => ({ household: s.household ? { ...s.household, settings } : s.household })) },
  async saveMemberNotify(userId, patch) { const repo = need(get); const settings = await repo.saveMemberNotify(userId, patch); set(s => ({ household: s.household ? { ...s.household, settings } : s.household })) },
  toast(text, err, action) { const id = ++toastSeq; set(s => ({ toasts: [...s.toasts.slice(-3), { id, text, err, action }] })); setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), err ? 6500 : action ? 5000 : 2200) },
  async guarded(fn, ok) {
    if (get().busy > 2) return undefined
    set(s => ({ busy: s.busy + 1 }))
    const undoBefore = get().undo.length
    try { const r = await fn(); if (ok) { const grew = get().undo.length > undoBefore; get().toast(ok, false, grew ? { label: 'Undo', run: () => { void get().guarded(() => get().undoLast(), 'Undone') } } : undefined) } return r }
    catch (e) { if (!isInputError(e)) console.error(e); get().toast((e as Error).message || String(e), true); return undefined }
    finally { set(s => ({ busy: Math.max(0, s.busy - 1) })) }
  },
}))

/** True when the user has a verified TOTP factor but this session is still at AAL1 — the app then asks for the code before opening any household. */
/** A second factor is owed when the account has one and this session has not used it. A passkey sign-in already is two factors
 *  (the device you hold + its fingerprint, face or PIN), so it is not asked for a code on top. */
async function needsMfa() { try { const { data } = await sb().auth.mfa.getAuthenticatorAssuranceLevel(); if (!data || data.nextLevel !== 'aal2' || data.currentLevel === 'aal2') return false; return !(data.currentAuthenticationMethods || []).some(m => /passkey|webauthn/i.test(typeof m === 'string' ? m : String(m.method))) } catch { return false } }
/** Sign-up errors in plain words (0.29.0). Until the app sends email through its own provider, Supabase's built-in sender reaches only
 *  the project's own team ("email address not authorized") and two emails an hour ("email rate limit exceeded"): say what to do instead. */
export function signUpMessage(e: { message?: string; code?: string } | null | undefined): string {
  const m = String(e?.message || ''), c = String(e?.code || '')
  if (c === 'email_address_not_authorized' || /not authorized/i.test(m)) return 'Cresari cannot send the confirmation email to this address yet — new sign-ups open soon. Meanwhile, try the offline demo below, or ask whoever invited you.'
  if (c === 'over_email_send_rate_limit' || /rate limit/i.test(m)) return 'Too many sign-ups in the last hour — please try again in an hour, or look around the offline demo meanwhile.'
  if (c === 'user_already_exists' || /already registered|already exists/i.test(m)) return 'There is already an account with this email — sign in instead, or use Forgot password?'
  if (c === 'weak_password' || /password/i.test(m)) return m || 'Choose a longer password.'
  return m || 'Something went wrong — try again.'
}
/** Plain-language messages for the auth errors people actually hit with passkeys and recovery codes. */
export function authMessage(e: { message?: string; code?: string; name?: string } | null | undefined): string {
  const m = String(e?.message || ''), c = String(e?.code || '')
  if (/ERROR_CEREMONY_ABORTED|NotAllowedError|abort|cancel|timed out/i.test(c + ' ' + m + ' ' + (e?.name || ''))) return 'The passkey prompt was closed or timed out — try again.'
  if (/passkey.*(disabled|not enabled)|webauthn.*(disabled|not enabled)|feature.*disabled/i.test(m) || /passkey.*disabled/i.test(c)) return 'Passkeys are not switched on for Cresari yet — use your password for now.'
  if (c === 'mfa_recovery_codes_enroll_not_enabled' || c === 'mfa_recovery_codes_verify_not_enabled') return 'Recovery codes are not switched on for Cresari yet — the authenticator app still works.'
  if (c === 'mfa_recovery_codes_sole_factor') return 'Set up the authenticator app first — recovery codes back it up and cannot be the only second step.'
  if (c === 'mfa_recovery_codes_locked') return 'Too many wrong recovery codes — wait a few minutes, then try again or use the authenticator app.'
  if (c === 'mfa_verification_failed' || /invalid.*code|code.*invalid/i.test(m)) return 'That code did not match. Each recovery code works once; check for typos.'
  if (/credential.*not found|unknown credential|no passkey/i.test(m)) return 'This device has no passkey for Cresari. Sign in with your password, then add one under Settings → Security.'
  return m || 'Something went wrong — try again.'
}
const need = (get: () => State) => { const r = get().repo; if (!r) throw new Error('Not signed in'); return r }
/** Throw a plain-language InputError when a write would put an empty or negative value where the database refuses one. */
function refuseBad(coll: Collection, patch: Record<string, unknown>) { const p = patchProblem(coll, patch || {}); if (p) throw new InputError(p) }
function attach(repo: Repo) { unsub?.(); unsub = repo.subscribe(() => { if (refreshTimer) clearTimeout(refreshTimer); refreshTimer = setTimeout(() => useStore.getState().refresh(), repo.mode === 'demo' ? 0 : 700) }) }
async function loadHouseholds(user: User) {
  try { await sb().rpc('accept_invites') } catch { /* no invites */ }
  let res; try { res = await sb().from('household_members').select('household_id, role, households(name)').eq('user_id', user.id) } catch (e) { res = { data: null, error: e as Error } }
  const { data, error } = res
  if (error) { if (isNetworkError(error) && await openOffline(user)) return; throw error }
  const list = (data || []).map(r => ({ id: r.household_id as string, name: ((r as unknown as { households: { name: string } | null }).households?.name) || 'Household', role: r.role as Role }))
  useStore.setState({ households: list })
  const want = localStorage.getItem(LS('household'))
  const pick = list.find(h => h.id === want) || list[0]
  if (pick) await useStore.getState().openHousehold(pick.id)
}
/** The user from the last saved sign-in in this browser (no network needed) — only used to find the offline copy. */
function cachedUser(): User | null { try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i) || ''; if (/^sb-.*-auth-token$/.test(k)) { const v = JSON.parse(localStorage.getItem(k) || 'null'); if (v?.user?.id) return v.user as User } } } catch { /* */ } return null }
/** No connection at start-up: open the read-only copy this device kept (0.25.0); reload once the connection is back. */
async function openOffline(user: User): Promise<boolean> {
  const snap = await loadOffline(user.id, localStorage.getItem(LS('household'))); if (!snap) return false
  useStore.setState({ households: [{ id: snap.householdId, name: snap.household.name, role: snap.role }], mode: 'db', repo: new SupabaseRepo(snap.householdId), household: snap.household, data: toView(snap.data), role: snap.role, readOnly: snap.readOnly, modules: snap.modules, offlineAt: snap.savedAt, lastRefresh: Date.parse(snap.savedAt), loadError: null })
  window.addEventListener('online', () => location.reload(), { once: true })
  return true
}
// once loaded, a dropped connection makes the app read-only until it is back, then reloads the data
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => { const s = useStore.getState(); if (s.mode === 'db' && s.household && !s.offlineAt) useStore.setState({ offlineAt: new Date(s.lastRefresh || Date.now()).toISOString() }) })
  window.addEventListener('online', () => { const s = useStore.getState(); if (s.mode === 'db' && s.offlineAt && s.repo) void s.refresh() })
}
// A tab left open across a release keeps running the old bundle (hash navigation never reloads), so re-check the registered version every 10 minutes and whenever the tab comes back into view; Layout shows the reload banner.
let versionTimer: number | null = null
function startVersionWatch(get: () => { checkLatest: () => Promise<void>; mode: Mode }) {
  if (versionTimer != null || typeof window === 'undefined') return
  versionTimer = window.setInterval(() => { if (get().mode === 'db' && document.visibilityState === 'visible') void get().checkLatest() }, 10 * 60 * 1000)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && get().mode === 'db') void get().checkLatest() })
}
export interface AccountDeletionPlan { solo: Array<{ id: string; name: string }>; shared: Array<{ id: string; name: string; role: string }>; blocked: Array<{ id: string; name: string }> }
/** Call an edge function and surface its own error message (a non-2xx reply carries { error } in the body). */
async function fnCall<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().functions.invoke(name, { body })
  if (error) { let msg = error.message; try { const ctx = (error as { context?: Response }).context; if (ctx && typeof ctx.json === 'function') { const j = await ctx.json(); if (j?.error || j?.message) msg = j.error || j.message } } catch { /* keep message */ } throw new Error(msg) }
  return data as T
}
export const outdated = () => { const l = useStore.getState().latest; return !isNative() && !!l && cmpVer(APP_VERSION, l) < 0 }
/** Phone apps: a newer build is in the store (a gentle note) / this build is too old to keep using (a full-screen notice). */
export const nativeUpdate = () => { const l = useStore.getState().nativeLatest; return isNative() && !!l && cmpVer(APP_VERSION, l) < 0 }
export const updateRequired = () => { const m = useStore.getState().nativeMin; return isNative() && !!m && cmpVer(APP_VERSION, m) < 0 }
