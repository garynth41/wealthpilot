// Comment threads on a transaction (0.21.0): "is this the dentist or the vet?" Any member can read and post; you edit or delete your own,
// the owner can delete any (row-level security in migration 0015). Threads go with the transaction when it is deleted.
import { useState, type FormEvent } from 'react'
import { useData } from '../app/hooks'
import { useStore } from '../app/store'
import type { Transaction, TransactionComment } from '../app/data/types'
import { Btn, Note, MHead, MBody, MFoot, useConfirm } from '../components/ui'
import { fmtD, fmtTime } from '../lib/dates'
import { fm2 } from '../lib/money'

export const commentsFor = (d: { comments?: TransactionComment[] }, id: string): TransactionComment[] => (d.comments || []).filter(c => c.transaction_id === id).sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
const when = (iso?: string) => { if (!iso) return ''; const d = new Date(iso); return isNaN(+d) ? '' : `${fmtD(iso.slice(0, 10))} ${fmtTime(iso)}` }

export function CommentsModal({ txn, onDone }: { txn: Transaction; onDone: () => void }) {
  const { data, insert, update, remove, guarded, mode, isOwner, members } = { ...useData(), members: useStore(s => s.data.members) }
  const user = useStore(s => s.user); const confirm = useConfirm()
  const me = user?.id || null, myEmail = user?.email || (mode === 'demo' ? 'you (demo)' : null)
  const list = commentsFor(data, txn.id)
  const [body, setBody] = useState(''); const [editing, setEditing] = useState<string | null>(null); const [draft, setDraft] = useState('')
  const nameOf = (c: TransactionComment) => { const m = members.find(x => x.user_id === c.created_by); return m?.display_name || m?.email || c.author_email || 'someone' }
  const mine = (c: TransactionComment) => mode === 'demo' ? (c.created_by || 'demo-user') === 'demo-user' : !!me && c.created_by === me
  const post = (e: FormEvent) => { e.preventDefault(); const text = body.trim(); if (!text) return
    guarded(async () => { await insert('comments', { transaction_id: txn.id, body: text.slice(0, 2000), author_email: myEmail }); setBody('') }, 'Comment posted') }
  const save = (c: TransactionComment) => { const text = draft.trim(); if (!text) return; guarded(async () => { await update('comments', c.id, { body: text.slice(0, 2000) }); setEditing(null) }, 'Comment updated') }
  const del = async (c: TransactionComment) => { if (!(await confirm('Delete this comment?', 'Delete'))) return; guarded(() => remove('comments', c.id), 'Comment deleted') }
  return <><MHead title={`Comments · ${txn.payee || 'transaction'} · ${fm2(txn.amount)} on ${fmtD(txn.date)}`} /><MBody>
    {list.length === 0 ? <div className="empty">No comments yet. Ask the household about this one — everyone who can see the ledger can read and reply.</div>
      : <ol className="thread" aria-label="Comments">{list.map(c => <li key={c.id} className={mine(c) ? 'mine' : ''}>
        <div className="who"><b>{mine(c) ? 'You' : nameOf(c)}</b> <span className="note" style={{ margin: 0 }}>{when(c.created_at)}{c.updated_at && c.created_at && c.updated_at.slice(0, 16) !== c.created_at.slice(0, 16) ? ' · edited' : ''}</span></div>
        {editing === c.id ? <div className="btnrow"><textarea className="inp" rows={2} value={draft} onChange={e => setDraft(e.target.value)} aria-label="Edit comment" maxLength={2000} style={{ flex: 1 }} /><Btn sm primary onClick={() => save(c)} disabled={!draft.trim()}>Save</Btn><Btn sm onClick={() => setEditing(null)}>Cancel</Btn></div>
          : <div className="body">{c.body}</div>}
        {editing !== c.id && (mine(c) || isOwner) && <div className="btnrow" style={{ marginTop: 4 }}>{mine(c) && <button type="button" className="btn sm" onClick={() => { setEditing(c.id); setDraft(c.body) }}>Edit</button>}<button type="button" className="btn sm" onClick={() => del(c)} aria-label="Delete comment">Delete</button></div>}
      </li>)}</ol>}
    <form onSubmit={post} style={{ marginTop: 12 }}><label className="sr-only" htmlFor="wp-comment">Add a comment</label>
      <div className="btnrow" style={{ alignItems: 'flex-end' }}><textarea id="wp-comment" className="inp" rows={2} placeholder="Add a comment…" value={body} onChange={e => setBody(e.target.value)} maxLength={2000} style={{ flex: 1 }} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(e as unknown as FormEvent) }} /><Btn type="submit" primary disabled={!body.trim()}>Post</Btn></div></form>
    <Note>Ctrl/⌘ + Enter posts. Comments appear for everyone in the household straight away and are kept in the activity log.</Note>
  </MBody><MFoot><Btn onClick={onDone}>Close</Btn></MFoot></>
}
