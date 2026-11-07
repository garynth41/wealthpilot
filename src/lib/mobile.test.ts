// 0.25.1 — the phone apps: on-device bill reminders, and the helpers that keep browsers working exactly as before.
import { describe, it, expect, vi } from 'vitest'
import { billReminders, reminderId, REMINDER_MAX } from './reminders'
import { isNative, passkeysAvailable, emailCaptureAvailable, printAvailable, saveFile, storeUrl } from '../app/native'
import { nativeUpdate, updateRequired, outdated, useStore } from '../app/store'

const bill = (o: Record<string, unknown> = {}) => ({ id: 'r1', name: 'Rent', payee: 'Landlord', kind: 'bill', amount: 1450, amount_varies: false, frequency: 'monthly', day_of_month: 1, next_due: '2026-12-01', status: 'Active', autopay: false, reminder_days: 3, ...o })

describe('bill reminders on the phone', () => {
  it('reminds the set number of days before and on the day, at 9 AM, soonest first', () => {
    const r = billReminders({ today: '2026-11-20', recurring: [bill() as never], occurrences: [], transactions: [], horizonDays: 20 })
    expect(r.map(x => [x.at, x.title])).toEqual([['2026-11-28T09:00', 'Rent is due in 3 days'], ['2026-12-01T09:00', 'Rent is due today']])
    expect(r[0].body).toBe('$1,450.00 on 2026-12-01'); expect(r[1].url).toBe('/bills')
  })
  it('skips a due date already paid — marked paid, or a payment near the date', () => {
    const base = { today: '2026-11-20', recurring: [bill() as never], horizonDays: 20 }
    expect(billReminders({ ...base, occurrences: [{ recurring_id: 'r1', due_date: '2026-12-01', status: 'paid' }], transactions: [] })).toEqual([])
    expect(billReminders({ ...base, occurrences: [], transactions: [{ id: 't', date: '2026-11-25', kind: 'expense', amount: 1450, payee: 'Landlord LLC', status: 'cleared' }] })).toEqual([])
    expect(billReminders({ ...base, occurrences: [], transactions: [{ id: 't', date: '2026-11-25', kind: 'expense', amount: 1450, payee: 'Landlord LLC', status: 'void' }] })).toHaveLength(2)
  })
  it('autopay wording; no early reminder when Remind is 0 or already past; income never reminds', () => {
    const a = billReminders({ today: '2026-11-30', recurring: [bill({ autopay: true }) as never, bill({ id: 'r2', name: 'Pay', kind: 'income' }) as never], occurrences: [], transactions: [], horizonDays: 5 })
    expect(a.map(x => x.title)).toEqual(['Rent is charged today'])   // the early one (Nov 28) is already past
    expect(a[0].body).toBe('$1,450.00 by autopay')
    expect(billReminders({ today: '2026-11-20', recurring: [bill({ reminder_days: 0 }) as never], occurrences: [], transactions: [], horizonDays: 20 }).map(x => x.title)).toEqual(['Rent is due today'])
  })
  it('stays under the phone limit and gives each reminder a stable whole-number id', () => {
    const many = Array.from({ length: 40 }, (_, i) => bill({ id: 'w' + i, name: 'Weekly ' + i, frequency: 'weekly', next_due: '2026-11-21', day_of_month: null }))
    const r = billReminders({ today: '2026-11-20', recurring: many as never, occurrences: [], transactions: [] })
    expect(r).toHaveLength(REMINDER_MAX); expect(r.every((x, i) => i === 0 || r[i - 1].at <= x.at)).toBe(true)
    expect(new Set(r.map(x => x.id)).size).toBe(r.length)
    expect(reminderId('rem:r1:2026-12-01:day')).toBe(reminderId('rem:r1:2026-12-01:day')); expect(reminderId('x')).toBeGreaterThan(0); expect(reminderId('x')).toBeLessThan(2 ** 31)
  })
})

describe('in a browser nothing changes', () => {
  it('is not the app, so passkeys, email capture and printing stay available', () => {
    expect(isNative()).toBe(false); expect(emailCaptureAvailable()).toBe(true); expect(printAvailable()).toBe(true); expect(storeUrl()).toBe('')
    expect(passkeysAvailable()).toBe('PublicKeyCredential' in window)
  })
  it('saves files as a download', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}); const url = vi.fn(() => 'blob:x'); (URL as unknown as { createObjectURL: unknown }).createObjectURL = url
    await saveFile('wealthpilot-backup.json', '{"a":1}', 'application/json')
    expect(click).toHaveBeenCalledTimes(1); expect(url).toHaveBeenCalledTimes(1); click.mockRestore()
  })
  it('the store-update prompts never show in a browser; the reload bar still does', () => {
    useStore.setState({ latest: '99.0.0', nativeLatest: '99.0.0', nativeMin: '99.0.0' })
    expect(outdated()).toBe(true); expect(nativeUpdate()).toBe(false); expect(updateRequired()).toBe(false)
    useStore.setState({ latest: null, nativeLatest: null, nativeMin: null })
  })
})
