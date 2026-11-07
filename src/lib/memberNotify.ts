import type { MemberNotify, NotifyPrefs } from '../app/data/types'

/** One member's alert choices set on the household's stored alert settings (0.25.1) — or, with null, removed so they follow the household
 *  switches again. Nothing else changes: not the other members' rows, and not the defaults the screen shows for switches nobody saved.
 *  That matters because the database lets anyone but an owner change only their own entry (households_guard, migration 0019). */
export function withMemberNotify(stored: NotifyPrefs | null | undefined, userId: string, patch: Partial<MemberNotify> | null): NotifyPrefs {
  const base: NotifyPrefs = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
  const members: Record<string, MemberNotify> = { ...(base.members && typeof base.members === 'object' ? base.members : {}) }
  if (patch == null) delete members[userId]
  else members[userId] = { ...(members[userId] || {}), ...patch }
  return { ...base, members }
}
