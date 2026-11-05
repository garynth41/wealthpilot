// Receipts and documents on a transaction (0.19.0): photos and PDFs in the private `attachments` bucket (migration 0011), one row per file.
import { useRef, useState } from 'react'
import { useData } from '../app/hooks'
import { useStore } from '../app/store'
import type { Transaction, Attachment } from '../app/data/types'
import { Btn, Note, MHead, MBody, MFoot, useConfirm } from '../components/ui'
import { sb } from '../app/supabase'
import { fmtD } from '../lib/dates'
import { fm2 } from '../lib/money'

const MAX = 15 * 1024 * 1024
const safeName = (n: string) => n.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(0, 80)
export const attachmentsFor = (d: { attachments?: Attachment[] }, id: string): Attachment[] => (d.attachments || []).filter(a => a.transaction_id === id)

export function AttachmentsModal({ txn, onDone }: { txn: Transaction; onDone: () => void }) {
  const { data, mode, household, insert, remove, guarded, canEdit } = useData(); const confirm = useConfirm(); const toast = useStore.getState().toast
  const files = attachmentsFor(data, txn.id).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  const ref = useRef<HTMLInputElement>(null); const [busy, setBusy] = useState(false)
  const upload = (list: FileList | null) => { if (!list?.length || mode !== 'db' || !household) return
    guarded(async () => { setBusy(true); try {
      for (const f of Array.from(list)) {
        if (f.size > MAX) { toast(`${f.name} is over 15 MB`, true); continue }
        if (!/^(image\/(jpeg|png|webp|heic)|application\/pdf)$/.test(f.type)) { toast(`${f.name}: only photos (JPEG, PNG, WebP, HEIC) and PDFs`, true); continue }
        const path = `${household.id}/${txn.id}/${Date.now().toString(36)}-${safeName(f.name)}`
        const { error } = await sb().storage.from('attachments').upload(path, f, { contentType: f.type, upsert: false }); if (error) throw new Error(/bucket/i.test(error.message) ? 'Attachments need migration 0011' : error.message)
        await insert('attachments', { transaction_id: txn.id, name: f.name, path, mime: f.type, size: f.size })
      } } finally { setBusy(false); if (ref.current) ref.current.value = '' } }, 'Attached') }
  const openFile = (path: string, name: string) => guarded(async () => { const { data: blob, error } = await sb().storage.from('attachments').download(path); if (error) throw error; const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = name; a.target = '_blank'; a.click(); setTimeout(() => URL.revokeObjectURL(u), 4000) })
  const del = async (id: string, path: string, name: string) => { if (!(await confirm(`Remove ${name}? The file is deleted from storage.`, 'Remove'))) return; guarded(async () => { await sb().storage.from('attachments').remove([path]); await remove('attachments', id) }, 'Removed') }
  return <><MHead title={`Receipts · ${txn.payee || 'transaction'} · ${fm2(txn.amount)} on ${fmtD(txn.date)}`} /><MBody>
    {mode !== 'db' ? <Note>Receipts are stored in your household's private storage, which the offline demo does not have. Sign in to a real household to attach files.</Note> : <>
      {canEdit && <div className="btnrow" style={{ marginBottom: 10 }}><input ref={ref} type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" multiple capture="environment" className="inp" style={{ maxWidth: 360 }} onChange={e => upload(e.target.files)} aria-label="Add a photo or PDF" disabled={busy} />{busy && <span className="note" style={{ margin: 0 }}>Uploading…</span>}</div>}
      {files.length === 0 ? <div className="empty">No receipts yet. On a phone, the file picker opens the camera.</div> : <div className="tblwrap"><table className="tbl"><caption className="sr-only">Attachments</caption><thead><tr><th scope="col">File</th><th scope="col" className="num">Size</th><th scope="col">Added</th><th scope="col" /></tr></thead><tbody>
        {files.map(f => <tr key={f.id}><td><button className="btn sm" onClick={() => openFile(f.path, f.name)}>{/^image\//.test(f.mime || '') ? '🖼' : '📄'} {f.name}</button></td><td className="num">{Math.max(1, Math.round(f.size / 1024))} KB</td><td>{f.created_at ? fmtD(f.created_at.slice(0, 10)) : '—'}</td><td>{canEdit && <button className="del" onClick={() => del(f.id, f.path, f.name)} aria-label={`Remove ${f.name}`}>✕</button>}</td></tr>)}
      </tbody></table></div>}
      <Note>Photos and PDFs up to 15 MB. Files are private to this household (row-level security on the bucket) and go with the transaction when it is deleted.</Note></>}
  </MBody><MFoot><Btn onClick={onDone}>Close</Btn></MFoot></>
}
