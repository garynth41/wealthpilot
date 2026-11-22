// "Check your money in and out" (0.37.0 — Gary, Nov 21): the rows that are probably counted wrong, each with the fix one press away.
// What is listed, and why, comes from lib/moneyCheck.ts; nothing is changed until a button is pressed, and every press can be undone
// (Ctrl-Z, or the Left out view of the ledger / Transactions → Duplicates).
//   Leave out      the rows stay in the ledger, dimmed, and count as neither income nor spending
//   Keep           they are counted as they are and never asked about again
//   One transfer   the two rows become one transfer between the accounts, as the engine pairs them
//   Undo pairing   a payment that was recorded as a transfer goes back to being a payment
import { useEffect, useMemo, useState } from 'react'
import { useData } from '../app/hooks'
import { useStore } from '../app/store'
import type { Transaction } from '../app/data/types'
import { Btn, MBody, MFoot, MHead, Note, Pill, useModal } from './ui'
import { moneyChecks, checkSummary, checkTitle, checkWhy, type CheckItem } from '../lib/moneyCheck'
import { leaveOutRules } from '../lib/rules'
import { fm2, fmtMoney } from '../lib/money'
import { fmtD } from '../lib/dates'

const SHOWN = 40
const PILL: Record<CheckItem['kind'], [string, string]> = { mispaired: ['warn', 'Payment, not a move'], passthrough: ['info', 'Out and back'], roundtrip: ['info', 'Out and back'], pair: ['info', 'One move'], from_off: ['idle', 'From a left-out account'], to_off: ['idle', 'To a left-out account'], move: ['idle', 'Transfer'] }
/** One press at a time: two would each start from the same rows. */
let working = false

export function MoneyCheck() {
  const { data, settings, cat, acctName, canEdit, guarded } = useData(); const { close } = useModal()
  const items = useMemo(() => moneyChecks(data, settings), [data, settings]); const sum = checkSummary(items)
  const [openId, setOpenId] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  // the screen belongs to the ledger: following a link to another page closes it rather than leaving it over that page
  useEffect(() => { const on = () => { if (!location.hash.startsWith('#/transactions')) close() }; window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on) }, [close])
  const st = () => useStore.getState()
  /** One change at a time. `done` is said when it is saved — with `offer`, a follow-up the same message carries as a button. */
  const run = (work: () => Promise<unknown>, done: string, offer?: () => { label: string; run: () => void } | null) => { if (busy || working) return; working = true; setBusy(true)
    void guarded(async () => { await work(); return true }).then(ok => { if (ok) st().toast(done, false, offer?.() || undefined) }).finally(() => { working = false; setBusy(false) }) }
  const ids = (rows: Transaction[]) => rows.map(r => r.id)
  const many = (n: number, one: string, more: string) => (n === 1 ? one : more)
  /** Leave the rows out; for a group of one description, offer to leave out every later one too. */
  const leaveOut = (i: CheckItem, rows = i.rows) => run(() => st().bulkUpdate('transactions', ids(rows), { exclude_from_budget: true }), `${many(rows.length, 'Left out', `${rows.length} left out`)} — not counted as income or spending`, () => {
    const one = rows[0]; const next = i.pattern && one.kind !== 'transfer' ? leaveOutRules(st().settings().rules || [], one.payee, one.kind === 'income' ? 'income' : 'expense') : null
    return next ? { label: 'Always leave out ones like this', run: () => { void st().guarded(() => st().saveSettings({ rules: next }), `Every new “${one.payee}” will be left out — change it in Settings → Payee rules`) } } : null
  })
  /** Count them as they are, and do not ask about these rows again; for a group, offer to stop asking about the description altogether. */
  const keep = (i: CheckItem, rows = i.rows) => run(() => st().bulkUpdate('transactions', ids(rows), { dedupe_ok: true }), many(rows.length, 'Kept as it is counted', `${rows.length} kept as they are counted`), () =>
    i.pattern ? { label: 'Do not ask about these again', run: () => { void st().guarded(() => st().saveSettings({ checkOk: [...new Set([...(st().settings().checkOk || []), i.pattern])] }), 'Rows like these will not be listed here again') } } : null)
  const pair = (i: CheckItem) => { const [out, into] = i.rows; run(() => st().mergeDuplicates(out.id, [into.id], { kind: 'transfer', to_account_id: into.account_id }), `Now one transfer from ${acctName(out.account_id)} to ${acctName(into.account_id)} — undo it in Transactions → Duplicates`) }
  const unpair = (i: CheckItem) => run(() => st().restoreDuplicate(i.dup!.id), `${i.rows[0].payee || 'It'} counts as a payment again`)
  const line = (t: Transaction, i: CheckItem, own: boolean) => <tr key={t.id} data-mc-row={t.id}><td style={{ whiteSpace: 'nowrap' }}>{fmtD(t.date)}</td><td>{t.payee || 'No payee'}<div className="note" style={{ margin: 0 }}>{acctName(t.account_id)}{t.kind === 'transfer' ? ` → ${acctName(t.to_account_id)}` : ''} · {t.kind === 'transfer' ? 'recorded as a transfer' : t.kind === 'income' ? `counted as income${cat(t.category_id) ? `, ${cat(t.category_id)!.name}` : ''}` : `counted as spending${cat(t.category_id) ? `, ${cat(t.category_id)!.name}` : ''}`}</div></td><td className="num">{t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : ''}{fm2(t.amount)}</td>
    {own && canEdit && <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}><Btn sm disabled={busy} onClick={() => leaveOut(i, [t])}>Leave out</Btn> <Btn sm disabled={busy} onClick={() => keep(i, [t])}>Keep</Btn></td>}</tr>
  return <>
    <MHead title="Check your money in and out" />
    <MBody>
      {items.length === 0 ? <div className="empty" data-mc="clear"><p><b>Nothing to check.</b></p><p>No income or spending in the last six months looks like money that only moved between accounts.</p></div> : <>
        <div className="banner info" style={{ marginBottom: 10 }} data-mc="summary">{sum.n} thing{sum.n === 1 ? '' : 's'} to look at. If all of it only moved between accounts, your income is overstated by <b>{fmtMoney(sum.income)}</b> and your spending by <b>{fmtMoney(sum.spending)}</b> over the last six months.</div>
        <Note><b>Leave out</b> keeps the row in the ledger but counts it as neither income nor spending. <b>Keep</b> counts it as it is and stops asking. Account balances never change, and every press can be undone.</Note>
        <ul className="ru-list" data-mc="list">{items.slice(0, SHOWN).map(i => { const [pc, pl] = PILL[i.kind]; const group = i.rows.length > 1 && (i.kind === 'from_off' || i.kind === 'to_off' || i.kind === 'move'); const two = i.kind === 'pair' || i.kind === 'passthrough' || i.kind === 'roundtrip'; const amount = two || i.kind === 'mispaired' ? i.rows[0].amount : i.income + i.spending
          return <li key={i.id} className="ru-item" data-mc-item={i.kind}>
            <div className="ru-row">
              <button type="button" className="ru-name" aria-expanded={openId === i.id} onClick={() => setOpenId(openId === i.id ? null : i.id)} title="Show the transactions">
                <b>{checkTitle(i, acctName)}</b><span className="ru-sub">{fm2(amount)}{group ? ` in all · ${i.rows.length} rows · last ${fmtD(i.date)}` : ` · ${fmtD(i.date)}`}{!two && !group && i.rows[0].payee ? ` · ${i.rows[0].payee}` : ''}</span></button>
              <div className="ru-pick"><Pill cls={pc}>{pl}</Pill>
                {canEdit && i.kind === 'mispaired' && <><Btn sm primary disabled={busy} onClick={() => unpair(i)}>Undo the pairing</Btn><Btn sm disabled={busy} onClick={() => keep(i)}>It is a transfer</Btn></>}
                {canEdit && i.kind === 'pair' && <><Btn sm primary disabled={busy} onClick={() => pair(i)}>Make it one transfer</Btn><Btn sm disabled={busy} onClick={() => leaveOut(i)}>Leave both out</Btn><Btn sm disabled={busy} onClick={() => keep(i)}>Keep both</Btn></>}
                {canEdit && (i.kind === 'passthrough' || i.kind === 'roundtrip') && <><Btn sm primary disabled={busy} onClick={() => leaveOut(i)}>Leave both out</Btn><Btn sm disabled={busy} onClick={() => keep(i)}>Keep both</Btn></>}
                {canEdit && !two && i.kind !== 'mispaired' && <><Btn sm primary disabled={busy} onClick={() => leaveOut(i)}>{group ? `Leave all ${i.rows.length} out` : 'Leave out'}</Btn><Btn sm disabled={busy} onClick={() => keep(i)}>{group ? 'Keep all' : 'Keep'}</Btn></>}
              </div>
            </div>
            <div className="ru-why">{checkWhy(i, acctName)}</div>
            {(openId === i.id || two || i.kind === 'mispaired') && <div className="tblwrap ru-tx"><table className="tbl"><tbody>{i.rows.slice(0, 30).map(t => line(t, i, group))}{i.dup ? line(i.dup, i, false) : null}</tbody></table>{i.rows.length > 30 && <Note>and {i.rows.length - 30} more</Note>}</div>}
          </li> })}</ul>
        {items.length > SHOWN && <Note>Showing {SHOWN} of {items.length} — the rest appear as these are settled.</Note>}
      </>}
    </MBody>
    <MFoot><Btn onClick={() => { location.hash = '#/transactions?kind=out'; close() }} title="Everything left out of your figures, to review or count again">See what is left out</Btn><Btn primary onClick={close}>Done</Btn></MFoot>
  </>
}
/** `const check = useMoneyCheck()` then `check()` opens the screen. */
export function useMoneyCheck() { const { open } = useModal(); return () => open(<MoneyCheck />, { wide: true }) }
