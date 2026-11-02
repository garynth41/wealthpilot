import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useStore } from '../app/store'
import { fmtMoney } from '../lib/money'

export const Card = ({ title, hint, span = 12, children, right, className = '', id }: { title?: ReactNode; hint?: ReactNode; span?: number; children?: ReactNode; right?: ReactNode; className?: string; id?: string }) => (
  <div className={`card span${span} ${className}`} id={id}>{title != null && <h3>{title}{hint && <span className="hint">{hint}</span>}{right && <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{right}</span>}</h3>}{children}</div>
)
export const KPI = ({ l, v, cls = 'info', s }: { l: string; v: ReactNode; cls?: string; s?: ReactNode }) => <div className={`kpi ${cls}`}><div className="l">{l}</div><div className="v">{v}</div><div className="s">{s}</div></div>
export const Pill = ({ cls, children }: { cls: string; children: ReactNode }) => <span className={`pill ${cls}`}>{children}</span>
export const Money = ({ v, sign }: { v: number | null | undefined; sign?: boolean }) => { const n = +(v ?? 0) || 0; return <span style={{ color: sign ? (n >= 0 ? 'var(--good)' : 'var(--crit)') : undefined }}>{sign && n > 0 ? '+' : ''}{fmtMoney(n)}</span> }
export const Note = ({ children }: { children: ReactNode }) => <div className="note">{children}</div>
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>
export const Btn = ({ onClick, children, primary, sm, danger, disabled, title, type = 'button', block }: { onClick?: () => void; children: ReactNode; primary?: boolean; sm?: boolean; danger?: boolean; disabled?: boolean; title?: string; type?: 'button' | 'submit'; block?: boolean }) => <button type={type} className={`btn ${primary ? 'primary' : ''} ${sm ? 'sm' : ''} ${danger ? 'danger' : ''} ${block ? 'block' : ''}`} onClick={onClick} disabled={disabled} title={title}>{children}</button>
export const Seg = <T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) => <span className="seg">{options.map(([v, l]) => <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)} type="button">{l}</button>)}</span>
export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => <div className="field"><label>{label}{hint && <span className="hint" style={{ fontWeight: 400, color: 'var(--ink-3)', marginLeft: 6 }}>{hint}</span>}</label>{children}</div>
export const Banner = ({ cls = '', children }: { cls?: string; children: ReactNode }) => <div className={`banner ${cls}`}>{children}</div>
export const AList = ({ items }: { items: Array<{ c: string; t: ReactNode; m?: ReactNode; d?: ReactNode }> }) => <ul className="alist">{items.map((i, k) => <li key={k}><span className={`dot ${i.c}`}></span><span><span className="t">{i.t}</span>{i.m && <div className="m">{i.m}</div>}</span>{i.d && <span className="d">{i.d}</span>}</li>)}</ul>

/* ---- modal ---- */
interface ModalCtx { open: (content: ReactNode, opts?: { wide?: boolean; xwide?: boolean }) => void; close: () => void }
const MC = createContext<ModalCtx>({ open: () => {}, close: () => {} })
export const useModal = () => useContext(MC)
export function ModalHost({ children }: { children: ReactNode }) {
  const [m, setM] = useState<{ content: ReactNode; wide?: boolean; xwide?: boolean } | null>(null)
  const close = () => setM(null)
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [])
  return <MC.Provider value={{ open: (content, opts) => setM({ content, ...(opts || {}) }), close }}>{children}{m && <div className="modalBack" onMouseDown={e => { if (e.target === e.currentTarget) close() }}><div className={`modal ${m.wide ? 'wide' : ''} ${m.xwide ? 'xwide' : ''}`}>{m.content}</div></div>}</MC.Provider>
}
export const MHead = ({ title }: { title: ReactNode }) => { const { close } = useModal(); return <div className="mhead"><b>{title}</b><button className="mclose" onClick={close} aria-label="Close">×</button></div> }
export const MBody = ({ children }: { children: ReactNode }) => <div className="mbody">{children}</div>
export const MFoot = ({ children }: { children: ReactNode }) => <div className="mfoot">{children}</div>
/** A yes/no confirmation that resolves to a boolean. */
export function useConfirm() { const { open, close } = useModal(); return (text: string, okLabel = 'Delete') => new Promise<boolean>(res => { open(<><MHead title="Are you sure?" /><MBody><p style={{ margin: 0 }}>{text}</p></MBody><MFoot><Btn onClick={() => { close(); res(false) }}>Cancel</Btn><Btn danger onClick={() => { close(); res(true) }}>{okLabel}</Btn></MFoot></>) }) }

export function Toasts() { const toasts = useStore(s => s.toasts); return <div className="toasts">{toasts.map(t => <div key={t.id} className={`toast ${t.err ? 'err' : ''}`}>{t.text}</div>)}</div> }
export const classOf = (n: number, warn: number, crit: number, inverse = false) => (inverse ? (n >= crit ? 'crit' : n >= warn ? 'warn' : 'good') : n <= crit ? 'crit' : n <= warn ? 'warn' : 'good')
