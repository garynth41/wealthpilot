import { Component, cloneElement, createContext, isValidElement, useContext, useEffect, useId, useState, type ReactNode, type ReactElement } from 'react'
import { useStore } from '../app/store'
import { fmtMoney } from '../lib/money'
import { captureError } from '../lib/errors'

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
/** A labelled control. A single native input/select/textarea child is tied to the label by id (screen readers and axe see the label); anything else keeps the visible label only. */
export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => {
  const id = useId(); const native = isValidElement(children) && typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type) && !(children.props as { id?: string }).id
  const child = native ? cloneElement(children as ReactElement<{ id?: string }>, { id }) : children
  return <div className="field"><label htmlFor={native ? id : undefined}>{label}{hint && <span className="hint" style={{ fontWeight: 400, color: 'var(--ink-3)', marginLeft: 6 }}>{hint}</span>}</label>{child}</div>
}
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
  return <MC.Provider value={{ open: (content, opts) => setM({ content, ...(opts || {}) }), close }}>{children}{m && <div className="modalBack" onMouseDown={e => { if (e.target === e.currentTarget) close() }}><div className={`modal ${m.wide ? 'wide' : ''} ${m.xwide ? 'xwide' : ''}`}><ModalGuard onClose={close}>{m.content}</ModalGuard></div></div>}</MC.Provider>
}
/** A dialog that throws while rendering shows the error and a Close button instead of silently doing nothing (the whole app used to go blank). */
class ModalGuard extends Component<{ children: ReactNode; onClose: () => void }, { err: string | null }> {
  state = { err: null as string | null }
  static getDerivedStateFromError(e: unknown) { return { err: e instanceof Error ? e.message : String(e) } }
  componentDidCatch(e: unknown) { console.error('dialog failed to render', e); captureError(e, { kind: 'dialog' }) }
  render() { return this.state.err ? <><div className="mhead"><b>Something went wrong</b><button className="mclose" onClick={this.props.onClose} aria-label="Close">×</button></div><div className="mbody"><div className="msg crit">This dialog could not be shown: {this.state.err}</div><div className="note">Reload the page and try again. If it keeps happening, copy the message above into a bug report.</div></div><div className="mfoot"><button className="btn" onClick={this.props.onClose}>Close</button></div></> : this.props.children }
}
export const MHead = ({ title }: { title: ReactNode }) => { const { close } = useModal(); return <div className="mhead"><b>{title}</b><button className="mclose" onClick={close} aria-label="Close">×</button></div> }
export const MBody = ({ children }: { children: ReactNode }) => <div className="mbody">{children}</div>
export const MFoot = ({ children }: { children: ReactNode }) => <div className="mfoot">{children}</div>
/** A yes/no confirmation that resolves to a boolean. */
export function useConfirm() { const { open, close } = useModal(); return (text: string, okLabel = 'Delete') => new Promise<boolean>(res => { open(<><MHead title="Are you sure?" /><MBody><p style={{ margin: 0 }}>{text}</p></MBody><MFoot><Btn onClick={() => { close(); res(false) }}>Cancel</Btn><Btn danger onClick={() => { close(); res(true) }}>{okLabel}</Btn></MFoot></>) }) }

export function Toasts() { const toasts = useStore(s => s.toasts); return <div className="toasts" aria-live="polite" role="status">{toasts.map(t => <div key={t.id} className={`toast ${t.err ? 'err' : ''}`}>{t.text}{t.action && <button className="toast-act" onClick={t.action.run}>{t.action.label}</button>}</div>)}</div> }
export const classOf = (n: number, warn: number, crit: number, inverse = false) => (inverse ? (n >= crit ? 'crit' : n >= warn ? 'warn' : 'good') : n <= crit ? 'crit' : n <= warn ? 'warn' : 'good')
