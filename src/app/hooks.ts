import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from './store'
import type { Category, Account } from './data/types'
import { acctLabel } from '../lib/accounts'
import { defaultAccountOf, withDefaultAccount, localKey } from '../lib/defaultAccount'
import { orderCategories } from '../lib/categoryOrder'

/** Everything a page needs: the data, settings, write actions and lookup helpers. */
export function useData() {
  const s = useStore()
  // 0.36.0: categories are handed to every page group by group, each group's together (lib/categoryOrder.ts) — the budget, the pickers and the reports all follow it
  const { household } = s; const raw = s.data; const data = useMemo(() => ({ ...raw, categories: orderCategories(raw.categories) }), [raw])
  const settings = useMemo(() => s.settings(), [household, s])
  const helpers = useMemo(() => {
    const catById = new Map(data.categories.map(c => [c.id, c])); const accById = new Map(data.accounts.map(a => [a.id, a]))
    const catName = (id?: string | null) => (id && catById.get(id)?.name) || '—'
    // an account left out of the figures (0.28.0) still has a name where a transfer to or from it is listed
    const offById = new Map((data.off?.accounts || []).map(a => [a.id, a]))
    const acctName = (id?: string | null) => { const a = id ? accById.get(id) : null; if (a) return acctLabel(a, data.accounts); const o = id ? offById.get(id) : null; return o ? `${o.name} (left out)` : '—' }
    const cats = data.categories.filter(c => !c.archived)   // already in order: group by group
    const catOpts = (kind?: Category['kind'] | Category['kind'][]) => cats.filter(c => !kind || ([] as string[]).concat(kind).includes(c.kind))
    const catLabels = Object.fromEntries(cats.map(c => [c.id, (c.group ? c.group + ' › ' : '') + c.name]))
    const accts = data.accounts.filter(a => a.status === 'Active').sort((a, b) => a.sort_order - b.sort_order)
    const acctLabels = Object.fromEntries([...(data.off?.accounts || []).map(a => [a.id, `${a.name} (left out)`] as [string, string]), ...data.accounts.map(a => [a.id, acctLabel(a, data.accounts)] as [string, string])])
    const groups = [...new Set(cats.map(c => c.group || 'Other'))]
    const acc = (id?: string | null): Account | undefined => (id ? accById.get(id) : undefined)
    const cat = (id?: string | null): Category | undefined => (id ? catById.get(id) : undefined)
    return { catName, acctName, cats, catOpts, catLabels, accts, acctLabels, groups, acc, cat }
  }, [data])
  return { ...s, data, settings, ...helpers, canEdit: s.canEdit(), isOwner: s.isOwner() }
}

/** "My default account" (0.36.0, lib/defaultAccount.ts): the account this person's pages open on, and how to change it.
 *  Saved with the household (under the person's own id) for someone who can edit it; on this device for someone who cannot. */
export function useDefaultAccount() {
  const { data, settings, saveSettings, canEdit, guarded } = useData()
  const who = useStore(s => (s.mode === 'demo' ? 'demo' : s.user?.id || '')), hh = useStore(s => s.household?.id || '')
  const key = localKey(hh, who); const [local, setLocal] = useState<string | null>(() => { try { return localStorage.getItem(key) } catch { return null } })
  useEffect(() => { try { setLocal(localStorage.getItem(key)) } catch { setLocal(null) } }, [key])
  const account = useMemo(() => defaultAccountOf(settings, who, data.accounts, canEdit ? null : local), [settings, who, data.accounts, canEdit, local])
  const set = useCallback((id: string | null, name?: string) => {
    if (!who) return Promise.resolve(undefined)
    if (!canEdit) { try { if (id) localStorage.setItem(key, id); else localStorage.removeItem(key) } catch { /* private mode: it lasts until the page is closed */ } setLocal(id); return Promise.resolve(true) }
    return guarded(async () => { await saveSettings(withDefaultAccount(useStore.getState().settings(), who, id)); return true }, id ? `${name || 'That account'} is now your default account` : 'Default account cleared')
  }, [who, canEdit, key, guarded, saveSettings])
  return { account, id: account?.id || null, set, isDefault: (id?: string | null) => !!id && id === account?.id }
}
