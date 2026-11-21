// "My default account" (0.36.0): the small control that marks an account as the one this person's pages open on, or takes the mark off.
// The rule itself is in lib/defaultAccount.ts; the pages that follow it use useDefaultAccount() from app/hooks.
import { useState } from 'react'
import { useDefaultAccount } from '../app/hooks'

/** ★ when this account is the default (click to clear), ☆ to make it the default. `id` empty: nothing is shown. */
export function DefaultAccountBtn({ id, name, compact }: { id?: string | null; name: string; compact?: boolean }) {
  const def = useDefaultAccount(); const [busy, setBusy] = useState(false)
  if (!id) return null
  const on = def.isDefault(id)
  const go = () => { if (busy) return; setBusy(true); void Promise.resolve(def.set(on ? null : id, name)).finally(() => setBusy(false)) }
  return <button type="button" className={`btn sm defacct${on ? ' on' : ''}`} disabled={busy} aria-pressed={on} onClick={go} data-default-account={on ? 'on' : 'off'}
    title={on ? `${name} is your default account: pages that start from an account open on it. Click to clear.` : `Make ${name} your default account: the pages that start from an account will open on it until you change it.`}
    aria-label={on ? `${name} is your default account — clear it` : `Make ${name} my default account`}>
    <span aria-hidden="true">{on ? '★' : '☆'}</span>{compact ? (on ? ' Default' : '') : on ? ' My default' : ' Make my default'}</button>
}
