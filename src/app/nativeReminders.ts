// Bill reminders on this phone (0.25.1): turned on per device in Settings → Notifications, scheduled with the phone's own
// notifications from whatever the app last loaded (so they still arrive offline), and rescheduled whenever the household's bills
// or payments change. Tapping one opens Bills. Browsers never reach this code.
import { isNative } from './native'
import { billReminders } from '../lib/reminders'
import { today } from '../lib/dates'
import type { Data } from './data/types'

const KEY = 'wealthpilot.reminders'
export const remindersOn = () => { try { return localStorage.getItem(KEY) === 'on' } catch { return false } }

async function ln() { return (await import('@capacitor/local-notifications')).LocalNotifications }

/** Turn reminders on or off on this phone. Turning on asks for permission; the result says whether the phone allowed it. */
export async function setReminders(on: boolean, data: Data): Promise<'on' | 'off' | 'denied'> {
  if (!isNative()) return 'off'
  const L = await ln()
  if (!on) { await clearReminders(); return 'off' }
  let p = await L.checkPermissions(); if (p.display !== 'granted') p = await L.requestPermissions()
  if (p.display !== 'granted') { try { localStorage.setItem(KEY, 'off') } catch { /* */ } return 'denied' }
  try { localStorage.setItem(KEY, 'on') } catch { /* */ }
  await rescheduleReminders(data); return 'on'
}

async function cancelAll() { const L = await ln(); const { notifications } = await L.getPending(); if (notifications.length) await L.cancel({ notifications: notifications.map(n => ({ id: n.id })) }) }

let last = ''
/** Switch reminders off on this phone and drop every pending one — from the switch, and on signing out or deleting the account (0.25.1),
 *  so nothing about a household stays on the lock screen and whoever signs in next starts with reminders off. */
export async function clearReminders() {
  last = ''   // forget what was scheduled, so turning reminders back on schedules them again
  if (!isNative()) return
  try { localStorage.setItem(KEY, 'off') } catch { /* */ }
  try { await cancelAll() } catch { /* the plugin is not there: nothing was scheduled */ }
}
/** Replace the pending reminders with the ones the current data calls for (no-op unless on). */
export async function rescheduleReminders(data: Data): Promise<number> {
  if (!isNative() || !remindersOn()) return 0
  const now = Date.now()
  const list = billReminders({ today: today(), recurring: data.recurring as never, occurrences: data.occurrences as never, transactions: data.transactions as never }).filter(r => new Date(r.at).getTime() > now + 60000)
  const sig = list.map(r => r.key + r.at + r.title + r.body).join('|'); if (sig === last) return list.length
  const L = await ln(); await cancelAll()
  // inexact on purpose: a 9 AM bill reminder may arrive a few minutes late, but asking for exact alarms would send Android 12+ users to the
  // "Alarms & reminders" settings screen every time the list changes (the plugin's default) — and the app does not hold that permission
  if (list.length) await L.schedule({ notifications: list.map(r => ({ id: r.id, title: r.title, body: r.body, schedule: { at: new Date(r.at), allowWhileIdle: true }, isExactNotification: false, extra: { url: r.url }, smallIcon: 'ic_stat_wealthpilot' })) })
  last = sig; return list.length
}

let wired = false
/** Tapping a reminder opens the page it is about. */
export async function wireReminderTaps(go: (url: string) => void) {
  if (!isNative() || wired) return; wired = true
  const L = await ln(); await L.addListener('localNotificationActionPerformed', a => { const url = (a.notification.extra as { url?: string } | undefined)?.url; if (url) go(url) })
}
