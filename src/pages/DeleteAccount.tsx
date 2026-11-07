// Delete my account (0.25.1) — Settings → Security. Both app stores require that an account can be deleted from inside the app.
// Shows exactly what happens first: households only you belong to are deleted with the account (every account, transaction, file and
// backup in them); households you share are kept for the others, with your name replaced by "a former member"; a household where you
// are the only owner and others are members blocks the deletion until someone else is made an owner. Then the password, a typed
// confirmation, and it is done — immediately and for good.
import { useEffect, useState } from 'react'
import { useStore, type AccountDeletionPlan } from '../app/store'
import { Card, Btn, Note, Field, PasswordInput } from '../components/ui'
import { saveFile, isNative } from '../app/native'
import { today } from '../lib/dates'

const PHRASE = 'delete my account'

export function DeleteAccountCard() {
  const { user, repo, household, accountDeletionPreview, deleteAccount, toast } = useStore()
  const [plan, setPlan] = useState<AccountDeletionPlan | null>(null); const [err, setErr] = useState(''); const [pw, setPw] = useState(''); const [typed, setTyped] = useState(''); const [busy, setBusy] = useState(false); const [open, setOpen] = useState(false)
  useEffect(() => { if (!open || plan) return; accountDeletionPreview().then(setPlan).catch(e => setErr((e as Error).message)) }, [open])   // eslint-disable-line react-hooks/exhaustive-deps
  const backup = async () => { try { const j = await repo!.exportJson(); await saveFile(`wealthpilot-backup-${today()}.json`, JSON.stringify(j, null, 2), 'application/json'); toast(isNative() ? 'Backup ready' : 'Backup downloaded') } catch (e) { toast((e as Error).message, true) } }
  const go = async () => {
    setBusy(true); setErr('')
    try { const r = await deleteAccount(pw); toast(`Your account was deleted${r.households_deleted ? ` with ${r.households_deleted} household${r.households_deleted === 1 ? '' : 's'}` : ''}.`) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const ready = !!plan && !plan.blocked.length && pw.length > 0 && typed.trim().toLowerCase() === PHRASE
  return <Card span={12} title="Delete my account" hint="your sign-in, and every household only you belong to">
    {!open ? <><Note>Deleting your account is immediate and cannot be undone. You will see exactly what goes before anything happens.</Note><div className="btnrow"><Btn danger onClick={() => setOpen(true)}>Delete my account…</Btn></div></> : <>
      {!plan && !err && <Note>Checking your households…</Note>}
      {plan && <>
        {plan.solo.length > 0 && <div className="msg crit" style={{ marginBottom: 8 }}><b>Deleted with your account:</b> {plan.solo.map(h => h.name).join(', ')} — every account, transaction, bill, goal, file and nightly backup in {plan.solo.length === 1 ? 'it' : 'them'}. You are the only member.</div>}
        {plan.shared.length > 0 && <div className="msg info" style={{ marginBottom: 8 }}><b>You leave:</b> {plan.shared.map(h => h.name).join(', ')}. The other members keep everything; where your name appears in history it becomes “a former member”.</div>}
        {plan.blocked.length > 0 && <div className="msg warn" role="alert" style={{ marginBottom: 8 }}><b>First:</b> you are the only owner of {plan.blocked.map(h => h.name).join(', ')}, which other people use. Make one of them an owner under Settings → Members, or delete that household under Settings → General — then come back here.</div>}
        {!plan.solo.length && !plan.shared.length && <Note>You do not belong to any household; only your sign-in is deleted.</Note>}
        {household && repo && <div className="btnrow" style={{ marginBottom: 8 }}><Btn onClick={() => void backup()}>Save a backup of {household.name} first</Btn></div>}
        <div className="grid2">
          <Field label="Your password" hint={user?.email || ''}><PasswordInput autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} /></Field>
          <Field label={`Type “${PHRASE}” to confirm`}><input className="inp" autoComplete="off" autoCapitalize="none" value={typed} onChange={e => setTyped(e.target.value)} /></Field>
        </div>
        <div className="btnrow"><Btn danger disabled={!ready || busy} onClick={() => void go()}>{busy ? 'Deleting…' : 'Delete my account permanently'}</Btn><Btn onClick={() => { setOpen(false); setPw(''); setTyped(''); setErr('') }} disabled={busy}>Cancel</Btn></div>
      </>}
      {err && <div className="msg crit" role="alert" style={{ marginTop: 8 }}>{err}</div>}
    </>}
  </Card>
}
