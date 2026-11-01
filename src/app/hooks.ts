import { useMemo } from 'react'
import { useStore } from './store'
import type { Category, Account } from './data/types'
import { acctLabel } from '../lib/accounts'

/** Everything a page needs: the data, settings, write actions and lookup helpers. */
export function useData() {
  const s = useStore()
  const { data, household } = s
  const settings = useMemo(() => s.settings(), [household, s])
  const helpers = useMemo(() => {
    const catById = new Map(data.categories.map(c => [c.id, c])); const accById = new Map(data.accounts.map(a => [a.id, a]))
    const catName = (id?: string | null) => (id && catById.get(id)?.name) || '—'
    const acctName = (id?: string | null) => { const a = id ? accById.get(id) : null; return a ? acctLabel(a, data.accounts) : '—' }
    const cats = data.categories.filter(c => !c.archived).sort((a, b) => a.sort_order - b.sort_order)
    const catOpts = (kind?: Category['kind'] | Category['kind'][]) => cats.filter(c => !kind || ([] as string[]).concat(kind).includes(c.kind))
    const catLabels = Object.fromEntries(cats.map(c => [c.id, (c.group ? c.group + ' › ' : '') + c.name]))
    const accts = data.accounts.filter(a => a.status === 'Active').sort((a, b) => a.sort_order - b.sort_order)
    const acctLabels = Object.fromEntries(data.accounts.map(a => [a.id, acctLabel(a, data.accounts)]))
    const groups = [...new Set(cats.map(c => c.group || 'Other'))]
    const acc = (id?: string | null): Account | undefined => (id ? accById.get(id) : undefined)
    const cat = (id?: string | null): Category | undefined => (id ? catById.get(id) : undefined)
    return { catName, acctName, cats, catOpts, catLabels, accts, acctLabels, groups, acc, cat }
  }, [data])
  return { ...s, data, settings, ...helpers, canEdit: s.canEdit(), isOwner: s.isOwner() }
}
