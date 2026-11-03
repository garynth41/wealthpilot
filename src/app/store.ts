import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import type { Repo } from './data/repo'
import { emptyData, SETTINGS_DEFAULTS, type Collection, type Data, type Household, type Role, type RowOf, type Settings } from './data/types'
import { MemoryRepo } from './data/memoryRepo'
import { SupabaseRepo } from './data/supabaseRepo'
import { hasSupabase, sb } from './supabase'
import { LS, APP_VERSION, cmpVer } from './config'
import { canViewPath } from '../lib/access'
import { planDedupe, type DTxn } from '../lib/dedupe'
import type { Transaction } from './data/types'

/** Merged duplicates live in data.duplicates, everything else in data.transactions — so every page and engine sees each transaction once. */
export const splitDups = (d: Data): Data => { const all = [...d.transactions, ...(d.duplicates || [])]; return { ...d, transactions: all.filter(t => !t.duplicate_of), duplicates: all.filter(t => !!t.duplicate_of) } }

export type Mode = 'db' | 'demo' | null
export interface Toast { id: number; text: string; err?: boolean }

interface State {
  mode: Mode; booting: boolean; user: User | null; session: Session | null
  repo: Repo | null; household: Household | null; data: Data; role: Role; readOnly: boolean; modules: string[] | null
  households: Array<{ id: string; name: string; role: Role }>
  latest: string | null; loadError: string | null; toasts: Toast[]; busy: number; lastRefresh: number | null; mfaPending: boolean; recovering: boolean
  settings: () => Settings
  canEdit: () => boolean; isOwner: () => boolean; canView: (path: string) => boolean; mustChangePassword: () => boolean
  boot: () => Promise<void>
  enterDemo: () => Promise<void>; exitDemo: () => void; resetDemo: () => void
  signIn: (email: string, password: string) => Promise<void>; signUp: (email: string, password: string) => Promise<string>; signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>; updatePassword: (pw: string) => Promise<void>; finishRecovery: (pw: string) => Promise<void>
  verifyMfa: (code: string) => Promise<void>
  openHousehold: (id: string) => Promise<void>; createHousehold: (name: string) => Promise<void>
  refresh: () => Promise<void>
  insert: <C extends Collection>(coll: C, row: Partial<RowOf<C>>) => Promise<RowOf<C>>
  insertMany: <C extends Collection>(coll: C, rows: Partial<RowOf<C>>[]) => Promise<RowOf<C>[]>
  update: <C extends Collection>(coll: C, id: string, patch: Partial<RowOf<C>>) => Promise<RowOf<C>>
  remove: (coll: Collection, id: string) => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  toast: (text: string, err?: boolean) => void
  guarded: <T>(fn: () => Promise<T>, ok?: string) => Promise<T | undefined>
  /** merge every clear-cut duplicate (see lib/dedupe.ts); returns how many rows were merged */
  autoDedupe: (quiet?: boolean) => Promise<number>
  mergeDuplicates: (keeper: string, dups: string[], patch?: Partial<Transaction>) => Promise<void>
  restoreDuplicate: (id: string) => Promise<void>
  notDuplicates: (ids: string[]) => Promise<void>
}

/** Captured before the Supabase client reads and clears the URL: a password-reset link lands with #access_token=…&type=recovery. */
const LANDED_ON_RECOVERY = typeof location !== 'undefined' && /type=recovery/.test(location.hash + location.search)
let deduping = false
let toastSeq = 0, unsub: (() => void) | null = null, refreshTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<State>((set, get) => ({
  mode: null, booting: true, user: null, session: null, repo: null, household: null, data: emptyData(), role: 'viewer', readOnly: false, modules: null, households: [], latest: null, loadError: null, toasts: [], busy: 0, lastRefresh: null, mfaPending: false, recovering: LANDED_ON_RECOVERY,
  settings: () => ({ ...SETTINGS_DEFAULTS, ...(get().household?.settings || {}) }),
  canEdit: () => { const s = get(); return s.mode === 'demo' || (['owner', 'editor'].includes(s.role) && !s.readOnly) },
  isOwner: () => get().mode === 'demo' || get().role === 'owner',
  canView: (path) => get().mode === 'demo' || canViewPath(path, get().modules),
  mustChangePassword: () => get().mode === 'db' && !!(get().user?.user_metadata as { must_change_password?: boolean } | undefined)?.must_change_password,

  async boot() {
    set({ booting: true })
    try {
      if (localStorage.getItem(LS('mode')) === 'demo') { await get().enterDemo(); return }
      if (!hasSupabase()) { set({ booting: false }); return }
      const { data: { session } } = await sb().auth.getSession()
      sb().auth.onAuthStateChange((e, s) => { if (e === 'PASSWORD_RECOVERY') set({ recovering: true }); set({ session: s, user: s?.user || null }); if (!s) { unsub?.(); unsub = null; set({ mode: null, repo: null, household: null, data: emptyData() }) } })
      set({ session, user: session?.user || null })
      if (session && get().recovering) { /* reset link: stay out of the household until the new password is saved */ }
      else if (session) { if (await needsMfa()) set({ mfaPending: true }); else await loadHouseholds(session.user) }
    } catch (e) { set({ loadError: (e as Error).message }) }
    finally { set({ booting: false }) }
  },
  async enterDemo() {
    const repo = new MemoryRepo(); localStorage.setItem(LS('mode'), 'demo')
    set({ mode: 'demo', repo, role: 'owner', readOnly: false, booting: false })
    await get().refresh(); attach(repo)
  },
  exitDemo() { localStorage.removeItem(LS('mode')); unsub?.(); unsub = null; set({ mode: null, repo: null, household: null, data: emptyData() }) },
  resetDemo() { const r = get().repo; if (r instanceof MemoryRepo) { r.reset(); get().refresh(); get().toast('Sample data restored') } },
  async signIn(email, password) { const { error } = await sb().auth.signInWithPassword({ email, password }); if (error) throw error; if (await needsMfa()) { set({ mfaPending: true }); return } const { data: { user } } = await sb().auth.getUser(); if (user) await loadHouseholds(user) },
  async verifyMfa(code) { const { data: f, error: e1 } = await sb().auth.mfa.listFactors(); if (e1) throw e1; const factor = f.totp.find(x => x.status === 'verified') || f.totp[0]; if (!factor) throw new Error('No authenticator is enrolled'); const { error } = await sb().auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.replace(/\s+/g, '') }); if (error) throw error; set({ mfaPending: false }); const { data: { user } } = await sb().auth.getUser(); if (user) await loadHouseholds(user) },
  async signUp(email, password) { const { data, error } = await sb().auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } }); if (error) throw error; if (data.session) { await loadHouseholds(data.user!); return 'ready' } return 'confirm' },
  async signOut() { await sb().auth.signOut(); unsub?.(); unsub = null; set({ mode: null, repo: null, household: null, data: emptyData(), households: [], mfaPending: false }) },
  async finishRecovery(pw) {
    await get().updatePassword(pw); set({ recovering: false })
    try { history.replaceState(null, '', location.pathname) } catch { /* */ }
    const { data: { user } } = await sb().auth.getUser(); if (user) { if (await needsMfa()) set({ mfaPending: true }); else await loadHouseholds(user) }
  },
  async resetPassword(email) { const { error } = await sb().auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); if (error) throw error },
  async updatePassword(pw) { const { data, error } = await sb().auth.updateUser({ password: pw, data: { must_change_password: false } }); if (error) throw error; if (data.user) set({ user: data.user }) },
  async openHousehold(id) {
    unsub?.(); const repo = new SupabaseRepo(id); localStorage.setItem(LS('household'), id)
    set({ mode: 'db', repo }); await get().refresh(); attach(repo)
    try { const { data } = await sb().from('app_meta').select('value').eq('key', 'latest_version').maybeSingle(); if (data?.value) set({ latest: data.value }) } catch { /* optional */ }
  },
  async createHousehold(name) { const { data, error } = await sb().rpc('create_household', { p_name: name }); if (error) throw error; const { data: { user } } = await sb().auth.getUser(); if (user) await loadHouseholds(user); await get().openHousehold(data as string) },
  async refresh() {
    const repo = get().repo; if (!repo) return
    try { const r = await repo.loadAll(); set({ household: r.household, data: splitDups(r.data), role: r.role, readOnly: r.readOnly, modules: r.modules, loadError: null, lastRefresh: Date.now() }); if (get().canEdit()) void get().autoDedupe().catch(() => {}) }
    catch (e) { set({ loadError: (e as Error).message }); get().toast('Could not load: ' + (e as Error).message, true) }
  },
  async insert(coll, row) { const repo = need(get); const r = await repo.insert(coll, row); set(s => ({ data: { ...s.data, [coll]: [...(s.data[coll] as unknown[]), r] } })); if (coll === 'transactions') void get().autoDedupe().catch(() => {}); return r },
  async insertMany(coll, rows) { const repo = need(get); const r = await repo.insertMany(coll, rows); set(s => ({ data: { ...s.data, [coll]: [...(s.data[coll] as unknown[]), ...r] } })); if (coll === 'transactions') void get().autoDedupe().catch(() => {}); return r },
  async mergeDuplicates(keeper, dups, patch) {
    const repo = need(get)
    if (patch && Object.keys(patch).length) { const k = await repo.update('transactions', keeper, patch); set(s => ({ data: { ...s.data, transactions: s.data.transactions.map(t => t.id === keeper ? k : t) } })) }
    for (const id of dups) { const d = await repo.update('transactions', id, { duplicate_of: keeper }); set(s => ({ data: { ...s.data, transactions: s.data.transactions.filter(t => t.id !== id), duplicates: [...s.data.duplicates.filter(t => t.id !== id), d] } })) }
  },
  async restoreDuplicate(id) {
    const repo = need(get); const r = await repo.update('transactions', id, { duplicate_of: null, dedupe_ok: true })
    set(s => ({ data: { ...s.data, duplicates: s.data.duplicates.filter(t => t.id !== id), transactions: [...s.data.transactions.filter(t => t.id !== id), r] } }))
  },
  async notDuplicates(ids) { for (const id of ids) await get().update('transactions', id, { dedupe_ok: true }) },
  async autoDedupe(quiet) {
    if (deduping || !get().canEdit() || !get().repo) return 0
    deduping = true
    try {
      const plan = planDedupe(get().data.transactions as unknown as DTxn[]); let n = 0
      for (const g of plan.auto) { await get().mergeDuplicates(g.keeper, g.dups, g.patch as Partial<Transaction>); n += g.dups.length }
      if (n && !quiet) get().toast(`Merged ${n} duplicate transaction${n === 1 ? '' : 's'} — one copy kept (the bank's when there is one). Review or undo in Transactions → Duplicates.`)
      return n
    } finally { deduping = false }
  },
  async update(coll, id, patch) {
    const repo = need(get); const before = get().data[coll] as unknown as Array<{ id: string }>
    set(s => ({ data: { ...s.data, [coll]: (s.data[coll] as unknown as Array<{ id: string }>).map(x => x.id === id ? { ...x, ...patch } : x) } }))   // optimistic
    try { const r = await repo.update(coll, id, patch); set(s => ({ data: { ...s.data, [coll]: (s.data[coll] as unknown as Array<{ id: string }>).map(x => x.id === id ? r : x) } })); return r }
    catch (e) { set(s => ({ data: { ...s.data, [coll]: before } })); throw e }
  },
  async remove(coll, id) {
    const repo = need(get); const before = get().data
    set(s => ({ data: { ...s.data, [coll]: (s.data[coll] as unknown as Array<{ id: string }>).filter(x => x.id !== id) } }))
    try { await repo.remove(coll, id); if (repo.mode === 'demo') await get().refresh() } catch (e) { set({ data: before }); throw e }
  },
  async saveSettings(patch) { const repo = need(get); const settings = await repo.saveSettings(patch); set(s => ({ household: s.household ? { ...s.household, settings } : s.household })) },
  toast(text, err) { const id = ++toastSeq; set(s => ({ toasts: [...s.toasts.slice(-3), { id, text, err }] })); setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), err ? 6500 : 2200) },
  async guarded(fn, ok) {
    if (get().busy > 2) return undefined
    set(s => ({ busy: s.busy + 1 }))
    try { const r = await fn(); if (ok) get().toast(ok); return r }
    catch (e) { console.error(e); get().toast((e as Error).message || String(e), true); return undefined }
    finally { set(s => ({ busy: Math.max(0, s.busy - 1) })) }
  },
}))

/** True when the user has a verified TOTP factor but this session is still at AAL1 — the app then asks for the code before opening any household. */
async function needsMfa() { try { const { data } = await sb().auth.mfa.getAuthenticatorAssuranceLevel(); return !!data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2' } catch { return false } }
const need = (get: () => State) => { const r = get().repo; if (!r) throw new Error('Not signed in'); return r }
function attach(repo: Repo) { unsub?.(); unsub = repo.subscribe(() => { if (refreshTimer) clearTimeout(refreshTimer); refreshTimer = setTimeout(() => useStore.getState().refresh(), repo.mode === 'demo' ? 0 : 700) }) }
async function loadHouseholds(user: User) {
  try { await sb().rpc('accept_invites') } catch { /* no invites */ }
  const { data, error } = await sb().from('household_members').select('household_id, role, households(name)').eq('user_id', user.id)
  if (error) throw error
  const list = (data || []).map(r => ({ id: r.household_id as string, name: ((r as unknown as { households: { name: string } | null }).households?.name) || 'Household', role: r.role as Role }))
  useStore.setState({ households: list })
  const want = localStorage.getItem(LS('household'))
  const pick = list.find(h => h.id === want) || list[0]
  if (pick) await useStore.getState().openHousehold(pick.id)
}
export const outdated = () => { const l = useStore.getState().latest; return !!l && cmpVer(APP_VERSION, l) < 0 }
