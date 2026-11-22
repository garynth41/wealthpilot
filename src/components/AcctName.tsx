import type { ReactNode } from 'react'
import { nameParts } from '../lib/accounts'

/** An account's name with its last four digits once, at the end, in brackets and in a lighter ink (0.38.1): "Adv Plus Banking (0224)".
 *  Plain elements with their text as children, because a Table's search and its CSV / Excel export read a cell through `props.children`
 *  — a component that took the name as a prop would export as an empty cell. The gap before the bracket is a margin, not a space, so the
 *  exported text is exactly "Name (1234)". */
export function acctNameNode(name: string | null | undefined, last4?: string | null): ReactNode {
  const { base, l4 } = nameParts(name, last4)
  return l4 ? <b>{base}<span style={{ color: 'var(--ink-3)', fontWeight: 400, marginLeft: '.3em' }}>{`(${l4})`}</span></b> : <b>{base}</b>
}
