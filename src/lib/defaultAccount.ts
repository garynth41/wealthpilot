// "My default account" (0.36.0 — Gary, Nov 21): one account a person marks as theirs, which the pages that start from an account open
// on until the default is changed — the ledger's account filter, a new transaction's "Paid from", Reconcile, the cash calendar's
// one-account view and a statement import's "Into account". Picking something else on a page lasts for that visit only.
// It is each person's own: kept in the household's settings under their user id (so it follows them to every device) when they can
// edit the household, and on the device for someone who cannot. An account that has been closed, left out or deleted is not a default.
import type { Account, Settings } from '../app/data/types'

/** The default account for this person, if it still exists and is in use.
 *  `local` is what this device holds for someone who cannot save to the household (a viewer, or an editor working from an offline copy):
 *  an account id is their choice here, '' means they cleared it here, and null/undefined means nothing was chosen on this device —
 *  only then does the household's entry for them apply. */
export function defaultAccountOf(settings: Pick<Settings, 'defaultAccounts'>, who: string, accounts: Account[], local?: string | null): Account | null {
  const inUse = (id: string) => accounts.find(a => a.id === id && a.status === 'Active' && !a.excluded) || null
  if (local === '') return null
  if (local) { const a = inUse(local); if (a) return a }
  const id = (who && settings.defaultAccounts?.[who]) || ''
  return id ? inUse(id) : null
}
/** The settings change that makes `accountId` this person's default (null: no default). Everyone else's stays as it is. */
export function withDefaultAccount(settings: Pick<Settings, 'defaultAccounts'>, who: string, accountId: string | null): Pick<Settings, 'defaultAccounts'> {
  const next = { ...(settings.defaultAccounts || {}) }
  if (accountId) next[who] = accountId; else delete next[who]
  return { defaultAccounts: next }
}
/** The default when it is one of the accounts this page offers; otherwise whatever the page would have opened on. */
export const openOn = <T extends { id: string }>(def: Account | null, offered: T[], fallback: string): string => (def && offered.some(a => a.id === def.id) ? def.id : fallback)
/** Where a non-editor's choice is kept on this device. */
export const localKey = (household: string, who: string) => `cresari.defaultAccount.${household}.${who}`
