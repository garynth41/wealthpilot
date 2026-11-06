import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useData } from '../app/hooks'
import { useStore } from '../app/store'
import type { SyncStatus } from '../app/data/types'
import { Card, Btn, Note, Pill, Field, useConfirm } from '../components/ui'
import { autoMatch, guessKind, balanceFor } from '../lib/simplefin'
import { today, fmtDY, fmtDT } from '../lib/dates'
import type { SyncConnection } from '../app/data/types'
import { fm2 } from '../lib/money'
import { acctLabel } from '../lib/accounts'

const NEW = '__new__'
/** Automatic bank sync through SimpleFIN Bridge. The sync itself runs in the sync-simplefin edge function; this card connects, maps accounts and shows what happened. */
export function BankSyncCard({ onKpi }: { onKpi?: (s: SyncStatus | null) => void }) {
  const { data, repo, mode, isOwner, canEdit, guarded, refresh, insert } = useData(); const confirm = useConfirm()
  const [st, setSt] = useState<SyncStatus | null>(null); const [token, setToken] = useState(''); const [map, setMap] = useState<Record<string, string>>({}); const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false)
  const locals = useMemo(() => data.accounts.filter(a => a.status === 'Active'), [data.accounts])
  const localsRef = useRef(locals); localsRef.current = locals
  const suggest = useCallback((c: SyncConnection, current: Record<string, string>) => {
    const locals = localsRef.current
    const sf = c.discovered.map(d => ({ id: d.id, name: d.name, org: d.org, last4: d.last4, balance: d.balance, available: null, balanceDate: '', currency: 'USD', txns: [] }))
    const matched = autoMatch(sf.filter(x => !current[x.id]), locals.filter(a => !Object.values(current).includes(a.id)).map(a => ({ id: a.id, name: a.name, institution: a.institution, last4: a.last4, kind: a.kind })))
    const out = { ...current, ...matched }; for (const d of c.discovered) if (!out[d.id]) out[d.id] = NEW   // anything without a match becomes a new account unless the owner changes it
    return out
  }, [])
  const load = useCallback(async () => { if (!repo) return; const s = await repo.syncStatus(); setSt(s); onKpi?.(s)
    const c = s.connection; const saved = c?.account_map || {}
    if (c && Object.keys(saved).length === 0 && c.discovered.length > 0) { setMap(suggest(c, {})); setDirty(true) } else { setMap(saved); setDirty(false) } }, [repo, onKpi, suggest])
  useEffect(() => { load() }, [load])

  if (!st) return <Card span={12} title="Automatic bank sync"><Note>Checking…</Note></Card>
  if (!st.available) return <Card span={12} title="Automatic bank sync (SimpleFIN)" hint="balances and transactions pulled in once a day"><Note>{mode === 'demo' ? 'Automatic sync needs a real household — it is not available in the offline demo.' : 'Not available yet: the database upgrade for bank sync (migration 0004) has not been applied, or your access does not include Bank connections.'}</Note></Card>
  const c = st.connection
  const run = async (fn: () => Promise<unknown>, ok?: string) => { setBusy(true); try { await guarded(async () => { await fn() }, ok) } finally { setBusy(false) } }

  if (!c) return <Card span={12} title="Automatic bank sync (SimpleFIN)" hint="balances and transactions pulled in once a day — about $15 a year, paid to SimpleFIN">
    <ol className="note" style={{ margin: '0 0 10px', paddingLeft: 18 }}>
      <li>Subscribe at <a href="https://bridge.simplefin.org" target="_blank" rel="noreferrer">bridge.simplefin.org</a> and link your banks there.</li>
      <li>In SimpleFIN choose <b>New Connection</b> (an app connection) and copy the <b>setup token</b>.</li>
      <li>Paste it below. The token is single-use; WealthPilot exchanges it for an access key kept on the server, never in your browser.</li>
    </ol>
    {isOwner ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}><div style={{ flex: '1 1 320px' }}><Field label="Setup token"><input className="inp" value={token} onChange={e => setToken(e.target.value)} placeholder="aHR0cHM6Ly9icmlkZ2Uuc2ltcGxlZmluLm9yZy9…" autoComplete="off" spellCheck={false} /></Field></div>
      <Btn primary disabled={busy || token.trim().length < 20} onClick={() => run(async () => { await repo!.syncConnect(token.trim()); setToken(''); await load() }, 'Connected — now match your accounts')}>{busy ? 'Connecting…' : 'Connect'}</Btn></div> : <Note>Only an owner can connect a bank.</Note>}
    <Note>Nothing is imported until you match each bank account to one of yours. Only balances, dates, amounts and descriptions are kept; the bank login never touches WealthPilot (SimpleFIN holds it).</Note>
  </Card>

  const mappedCount = Object.values(map).filter(Boolean).length, newCount = Object.values(map).filter(v => v === NEW).length
  const used = new Set(Object.values(map).filter(v => v && v !== NEW))
  /** Create the accounts the owner chose to add from the bank, then store the final matching. */
  const saveMatching = async () => {
    const final: Record<string, string> = {}
    for (const [sfId, v] of Object.entries(map)) {
      if (!v) continue
      if (v !== NEW) { final[sfId] = v; continue }
      const d = c.discovered.find(x => x.id === sfId)!; const kind = guessKind(d.name, d.balance)
      const made = await insert('accounts', { name: d.name.replace(/\s*[(\[]?(?:x+|\*+|\.{2,}|…)\s*\d{4}[)\]]?\s*$/i, '').trim() || d.name, kind: kind as never, institution: d.org || null, last4: d.last4, balance: balanceFor(d, kind), balance_as_of: today(), status: 'Active', include_in_cash: kind !== 'retirement' })
      final[sfId] = made.id
    }
    await repo!.syncSetMap(final); return final
  }
  const syncClick = () => run(async () => { if (dirty) await saveMatching(); const r = await repo!.syncNow(); await refresh(); await load(); useStore.getState().toast(r.message) })
  const ytdFrom = today().slice(0, 4) + '-01-01'
  const backfillClick = async () => { if (!(await confirm(`Load every transaction SimpleFIN still has back to ${fmtDY(ytdFrom)}? SimpleFIN keeps about 90 days, so older months usually need a statement file (CSV / QFX) from your bank — the coverage table below shows which. Duplicates are merged automatically. This uses a few of SimpleFIN's roughly 24 requests a day.`, 'Load history'))) return; run(async () => { if (dirty) await saveMatching(); const r = await repo!.syncBackfill(ytdFrom); await refresh(); await load(); useStore.getState().toast(r.message) }) }
  const why = mappedCount === 0 ? 'Choose where at least one bank account should go (or create it from the bank) first.' : ''
  return <Card span={12} title="Automatic bank sync (SimpleFIN)" hint="balances and new transactions once a day, plus on demand" right={<span className="btnrow">
    {canEdit && <Btn primary sm disabled={busy || mappedCount === 0} title={why} onClick={syncClick}>{busy ? 'Working…' : dirty ? 'Save matching & sync now' : 'Sync now'}</Btn>}
    {isOwner && <Btn sm disabled={busy || mappedCount === 0} title={why || 'Re-read history back to January 1'} onClick={backfillClick}>Load year-to-date history</Btn>}
    {isOwner && <Btn sm danger onClick={async () => { if (await confirm('Disconnect the bank? The saved key is deleted; imported transactions stay.', 'Disconnect')) run(async () => { await repo!.syncDisconnect(); await load() }, 'Disconnected') }}>Disconnect</Btn>}</span>}>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
      <Pill cls={c.status === 'connected' ? 'good' : 'crit'}>{c.status === 'connected' ? 'Connected' : 'Needs attention'}</Pill>
      <span className="note" style={{ margin: 0 }}>{c.last_sync_at ? `Last sync ${fmtDT(c.last_sync_at)}` : 'Not synced yet'}</span>
    </div>
    {c.last_error && <div className={`msg ${c.status === 'error' ? 'crit' : 'warn'}`}>{c.status === 'error' ? <b>Last sync failed: </b> : <b>Note from SimpleFIN (sync still worked): </b>}{c.last_error}{/45 days/i.test(c.last_error) && c.status !== 'error' ? ' — WealthPilot now asks for at most 44 days at a time, so this note clears on the next sync.' : ''}</div>}
    <div className="tblwrap" style={{ marginTop: 8 }}><table className="tbl"><thead><tr><th>At the bank</th><th className="num">Balance</th><th>Goes into</th></tr></thead><tbody>
      {c.discovered.length === 0 && <tr><td colSpan={3} className="note">No accounts reported by the bank yet — press Sync now once, or check the accounts are linked in SimpleFIN.</td></tr>}
      {c.discovered.map(d => <tr key={d.id}><td><b>{d.org || '—'}</b> · {d.name}{d.last4 ? <span className="note" style={{ margin: 0, display: 'inline' }}> · …{d.last4}</span> : null}</td><td className="num">{fm2(d.balance)}</td>
        <td>{isOwner ? <select className="inp" value={map[d.id] || ''} onChange={e => { setMap({ ...map, [d.id]: e.target.value }); setDirty(true) }}><option value="">— don't import —</option><option value={NEW}>+ Create a new account from this</option>{locals.map(a => <option key={a.id} value={a.id} disabled={used.has(a.id) && map[d.id] !== a.id}>{acctLabel(a, data.accounts)}</option>)}</select> : (map[d.id] && locals.find(a => a.id === map[d.id]) ? acctLabel(locals.find(a => a.id === map[d.id])!, data.accounts) : '—')}</td></tr>)}
    </tbody></table></div>
    {isOwner && c.discovered.length > 0 && <div className="btnrow" style={{ marginTop: 8 }}>
      <Btn sm onClick={() => { setMap(suggest(c, {})); setDirty(true) }}>Auto-match</Btn>
      <Btn sm disabled={!dirty || busy} onClick={() => run(async () => { await saveMatching(); await load() }, 'Matching saved')}>Save matching only</Btn></div>}
    {mappedCount === 0 && <div className="msg info">Nothing is set to import yet. {isOwner ? 'Press Auto-match, or pick a destination for each bank account above.' : 'Ask an owner to match the accounts.'}</div>}
    {dirty && mappedCount > 0 && <div className="msg info">Review the destinations above{newCount ? ` — ${newCount} new account${newCount === 1 ? ' will be' : 's will be'} created from the bank` : ''}, then press <b>Save matching &amp; sync now</b>.</div>}
    <Note>Each sync sets the balance of matched accounts from the bank and adds new transactions as <b>imported</b> (already-entered or already-imported items are skipped, so it is safe to run twice). Run <b>Auto-categorize</b> on Transactions afterwards. Credit-card and loan balances are stored as the amount owed.</Note>
    {st.log.length > 0 && <details style={{ marginTop: 6 }}><summary className="note" style={{ cursor: 'pointer', marginTop: 0 }}>Sync history ({st.log.length})</summary>
      <div className="tblwrap"><table className="tbl"><thead><tr><th>When</th><th>How</th><th>Result</th></tr></thead><tbody>{st.log.map(l => <tr key={l.id}><td>{fmtDT(l.started_at)}</td><td>{l.trigger === 'daily' ? 'Daily' : l.trigger === 'connect' ? 'Connect' : 'Manual'}</td><td><Pill cls={l.ok ? 'good' : 'crit'}>{l.ok ? 'OK' : 'Failed'}</Pill> {l.message}</td></tr>)}</tbody></table></div></details>}
  </Card>
}
export const syncKpi = (s: SyncStatus | null): { v: string; cls: string; s: string } => !s || !s.available ? { v: 'Not available', cls: 'idle', s: 'needs a real household with the bank-sync upgrade' } : !s.connection ? { v: 'Not connected', cls: 'idle', s: 'SimpleFIN — about $15/year' } : s.connection.status === 'error' ? { v: 'Needs attention', cls: 'crit', s: s.connection.last_error || 'last sync failed' } : { v: 'Connected', cls: 'good', s: s.connection.last_sync_at ? `last sync ${new Date(s.connection.last_sync_at).toLocaleDateString()}` : 'not synced yet' }
