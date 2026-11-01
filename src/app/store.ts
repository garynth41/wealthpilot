import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import type { Repo } from './data/repo'
import { emptyData, SETTINGS_DEFAULTS, type Collection, type Data, type Household, type Role, type RowOf, type Settings } from './data/types'
import { MemoryRepo } from './data/memoryRepo'
import { SupabaseRepo } from './data/supabaseRepo'
import { hasSupabase, sb } from './supabase'
import { LS, APP_VERSION, cmpVer } from './config'

export type Mode = 'db' | 'demo' | null
export interface Toast { id: number; text: string; err?: boolean }

interface State {
  mode: Mode; booting: boolean; user: User | null; session: Session | null
  repo: Repo | null; household: Household | null; data: Data; role: Role; readOnly: boolean
  households: Array<{ id: string; name: string; role: Role }>
  latest: string | null; loadError: string | null; toasts: Toast[]; busy: number; lastRefresh: number | null
  settings: () => Settings
  canEdit: () => boolean; isOwner: () => boolean
  boot: () => Promise<void>
  enterDemo: () => Promise<void>; exitDemo: () => void; resetDemo: () => void
  signIn: (email: string, password: string) => Promise<void>; signUp: (email: string, password: string) => Promise<string>; signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>; updatePassword: (pw: string) => Promise<void>
  openHousehold: (id: string) => Promise<void>; createHousehold: (name: string) => Promise<void>
  refresh: () => Promise<void>
  insert: <C extends Collection>(coll: C, row: Partial<RowOf<C>>) => Promise<RowOf<C>>
  insertMany: <C extends Collection>(coll: C, rows: Partial<RowOf<C>>[]) => Promise<RowOf<C>[]>
  update: <C extends Collection>(coll: C, id: string, patch: Partial<RowOf<C>>) => Promise<RowOf<C>>
  remove: (coll: Collection, id: string) => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  toast: (text: string, err?: boolean) => void
  guarded: <T>(fn: () => Promise<T>, ok?: string) => Promise<T | undefined>
}

let toastSeq = 0, unsub: (() => void) | null = null, refreshTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<State>((set, get) => ({
  mode: null, booting: true, user: null, session: null, repo: null, household: null, data: emptyData(), role: 'viewer', readOnly: false, households: [], latest: null, loadError: null, toasts: [], busy: 0, lastRefresh: null,
  settings: () => ({ ...SETTINGS_DEFAULTS, ...(get().household?.settings || {}) }),
  canEdit: () => { const s = get(); return s.mode === 'demo' || (['owner', 'editor'].includes(s.role) && !s.readOnly) },
  isOwner: () => get().mode === 'demo' || get().role === 'owner',

  async boot() {
    set({ booting: true })
    try {
      if (localStorage.getItem(LS('mode')) === 'demo') { await get().enterDemo(); return }
      if (!hasSupabase()) { set({ booting: false }); return }
      const { data: { session } } = await sb().auth.getSession()
      sb().auth.onAuthStateChange((_e, s) => { set({ session: s, user: s?.user || null }); if (!s) { unsub?.(); unsub = null; set({ mode: null, repo: null, household: null, data: emptyData() }) } })
      set({ session, user: session?.user || null })
      if (session) await loadHouseholds(session.user)
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
  async signIn(email, password) { const { error } = await sb().auth.signInWithPassword({ email, password }); if (error) throw error; const { data: { user } } = await sb().auth.getUser(); if (user) await loadHouseholds(user) },
  async signUp(email, password) { const { data, error } = await sb().auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } }); if (error) throw error; if (data.session) { await loadHouseholds(data.user!); return 'ready' } return 'confirm' },
  async signOut() { await sb().auth.signOut(); unsub?.(); unsub = null; set({ mode: null, repo: null, household: null, data: emptyData(), households: [] }) },
  async resetPassword(email) { const { error } = await sb().auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); if (error) throw error },
  async updatePassword(pw) { const { error } = await sb().auth.updateUser({ password: pw }); if (error) throw error },
  async openHousehold(id) {
    unsub?.(); const repo = new SupabaseRepo(id); localStorage.setItem(LS('household'), id)
    set({ mode: 'db', repo }); await get().refresh(); attach(repo)
    try { const { data } = await sb().from('app_meta').select('value').eq('key', 'latest_version').maybeSingle(); if (data?.value) set({ latest: data.value }) } catch { /* optional */ }
  },
  async createHousehold(name) { const { data, error } = await sb().rpc('create_household', { p_name: name }); if (error) throw error; const { data: { user } } = await sb().auth.getUser(); if (user) await loadHouseholds(user); await get().openHousehold(data as string) },
  async refresh() {
    const repo = get().repo; if (!repo) return
    try { const r = await repo.loadAll(); set({ household: r.household, data: r.data, role: r.role, readOnly: r.readOnly, loadError: null, lastRefresh: Date.now() }) }
    catch (e) { set({ loadError: (e as Error).message }); get().toast('Could not load: ' + (e as Error).message, true) }
  },
  async insert(coll, row) { const repo = need(get); const r = await repo.insert(coll, row); set(s => ({ data: { ...s.data, [coll]: [...(s.data[coll] as unknown[]), r] } })); return r },
  async insertMany(coll, rows) { const repo = need(get); const r = await repo.insertMany(coll, rows); set(s => ({ data: { ...s.data, [coll]: [...(s.data[coll] as unknown[]), ...r] } })); return r },
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
