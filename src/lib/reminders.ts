// Bill reminders on the phone (0.25.1). The apps schedule these as on-device notifications, so they arrive even with no connection and
// need no push service. Each active bill, subscription, debt payment or transfer gets up to two reminders per due date within the
// horizon: `reminder_days` before (the bill's own "Remind me" setting, 3 by default) and on the day, at 9 AM local time. A due date
// already paid gets none: marked paid or skipped, linked to its payment, or covered by a payment one to one — the same list the alerts
// use (unpaidDuesN in ./notify), so the phone, the alerts and the Bills page agree on what is still unpaid.
// iOS keeps at most 64 pending notifications per app, so the soonest MAX are kept.
import { unpaidDuesN, addDaysN, type NRecurring, type NOccurrence, type NTxn } from './notify'

export interface Reminder { id: number; key: string; at: string; title: string; body: string; url: string }
export interface ReminderInput { today: string; recurring: Array<NRecurring & { reminder_days?: number | null }>; occurrences: NOccurrence[]; transactions: NTxn[]; hour?: number; horizonDays?: number; max?: number }
export const REMINDER_MAX = 48

const money = (n: number) => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** A stable positive 31-bit id for a reminder key (Android and iOS both want an integer id). */
export function reminderId(key: string): number { let h = 2166136261; for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) } return (h >>> 1) || 1 }

export function billReminders(inp: ReminderInput): Reminder[] {
  const hour = inp.hour ?? 9, horizon = inp.horizonDays ?? 35, max = inp.max ?? REMINDER_MAX, t = inp.today
  const at = (d: string) => `${d}T${String(hour).padStart(2, '0')}:00`
  const out: Reminder[] = []
  for (const { r, due } of unpaidDuesN(inp, t, addDaysN(t, horizon))) {
    const lead = Math.max(0, Math.min(30, Math.round(Number(r.reminder_days ?? 3))))
    const amount = r.amount_varies ? 'amount varies' : money(+r.amount || 0)
    const early = addDaysN(due, -lead)
    if (lead > 0 && early >= t) out.push({ id: reminderId(`rem:${r.id}:${due}:early`), key: `rem:${r.id}:${due}:early`, at: at(early), title: `${r.name} is due in ${lead} day${lead === 1 ? '' : 's'}`, body: `${amount} on ${due}${r.autopay ? ' · autopay — make sure the account covers it' : ''}`, url: '/bills' })
    out.push({ id: reminderId(`rem:${r.id}:${due}:day`), key: `rem:${r.id}:${due}:day`, at: at(due), title: r.autopay ? `${r.name} is charged today` : `${r.name} is due today`, body: r.autopay ? `${amount} by autopay` : `${amount} — mark it paid in WealthPilot once it is done`, url: '/bills' })
  }
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key)).slice(0, max)
}
