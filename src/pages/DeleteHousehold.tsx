// Delete this household (0.25.0): an owner schedules it by typing the household's name; for 7 days it is read-only and any owner
// can cancel; then it is gone for good — every account, transaction, file and backup. The sign-in and other households stay.
import { useState } from 'react'
import { useData } from '../app/hooks'
import { useStore } from '../app/store'
import { Card, Btn, Note, Field, MHead, MBody, MFoot, useModal } from '../components/ui'
import { fmtDY, today } from '../lib/dates'

export function DeleteHouseholdCard() {
  const { household, isOwner, repo, guarded, mode } = useData(); const { open, close } = useModal()
  const when = household?.deletion_scheduled_for
  const download = () => guarded(async () => { const j = await repo!.exportJson(); const blob = new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `wealthpilot-backup-${today()}.json`; a.click() }, 'Backup downloaded')
  return <Card span={12} title="Delete this household" hint="permanent after a 7-day grace period">
    {when ? <>
      <div className="msg crit" role="status">Scheduled for permanent deletion on <b>{fmtDY(when.slice(0, 10))}</b>. The household is read-only until then.</div>
      {isOwner ? <div className="btnrow" style={{ marginTop: 8 }}><Btn primary onClick={() => guarded(() => useStore.getState().cancelDeletion(), 'Deletion cancelled — the household is back to normal')}>Cancel the deletion</Btn><Btn onClick={download}>Download a backup</Btn></div> : <Note>Only an owner can cancel it.</Note>}
    </> : <>
      <Note>Deleting removes everything in <b>{household?.name}</b> for every member: accounts, transactions, budgets, bills, goals, receipts and statement PDFs, the bank connection and the nightly backups. For 7 days the household is read-only and any owner can cancel; after that it cannot be undone. Your sign-in and any other households are not affected.</Note>
      {isOwner ? <div className="btnrow" style={{ marginTop: 8 }}><Btn onClick={download}>Download a backup first</Btn><Btn danger onClick={() => open(<DeleteModal onDone={close} />)}>Delete this household…</Btn></div> : <Note>Only an owner can delete the household.</Note>}
      {mode === 'demo' && <Note>In the offline demo this only shows how it works — Reset sample data starts over.</Note>}
    </>}
  </Card>
}

function DeleteModal({ onDone }: { onDone: () => void }) {
  const { household, guarded } = useData(); const [name, setName] = useState(''); const [sure, setSure] = useState(false)
  const match = name.trim().toLowerCase() === (household?.name || '').trim().toLowerCase()
  const go = () => guarded(async () => { const at = await useStore.getState().requestDeletion(name); onDone(); useStore.getState().toast(`Scheduled — the household will be deleted on ${fmtDY(at.slice(0, 10))}. You can cancel until then.`) })
  return <><MHead title={`Delete ${household?.name}?`} /><MBody>
    <p style={{ marginTop: 0, lineHeight: 1.55 }}>Every member loses access to everything in this household. It becomes read-only now and is <b>permanently deleted in 7 days</b>; any owner can cancel before then. Download a backup first if you might want any of it.</p>
    <Field label={`Type the household's name — ${household?.name}`}><input className="inp" value={name} onChange={e => setName(e.target.value)} autoComplete="off" aria-label="Type the household's name to confirm" /></Field>
    <label className="gm-ign" style={{ fontSize: 13, display: 'block', marginTop: 8 }}><input type="checkbox" checked={sure} onChange={e => setSure(e.target.checked)} /> I understand this cannot be undone after 7 days</label>
  </MBody><MFoot><Btn onClick={onDone}>Keep the household</Btn><Btn danger disabled={!match || !sure} onClick={go}>Schedule deletion</Btn></MFoot></>
}
