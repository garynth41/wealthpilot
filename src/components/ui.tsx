import { Component, cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type ReactElement, type InputHTMLAttributes, type RefObject } from 'react'
import { useStore } from '../app/store'
import { fmtMoney } from '../lib/money'
import { captureError } from '../lib/errors'
import { openHelp } from '../lib/helpBus'

/** A card. Its heading gets a small ? that opens the guide at this card (0.24.1): keyed by the heading text, or by `help` when the
 *  heading varies (a goal's name); `help={false}` for none. The title is the page's second heading level (the page title is the h1);
 *  the ?, the hint and any controls sit beside it, outside the heading, so a screen reader's heading list reads just the titles. */
export const Card = ({ title, hint, span = 12, children, right, className = '', id, help, meta }: { title?: ReactNode; hint?: ReactNode; span?: number; children?: ReactNode; right?: ReactNode; className?: string; id?: string; help?: string | false; /** a short figure or range for the header's right edge (0.26.1): "4 items", "next 14 days" */ meta?: ReactNode }) => {
  const key = help === false ? null : typeof help === 'string' ? help : typeof title === 'string' ? title : null
  return <div className={`card span${span} ${className}`} id={id}>{title != null && <div className="card-head"><h2 className="ch">{title}</h2>{key && <button type="button" className="cardhelp" onClick={() => openHelp(key)} aria-label={`Help: ${key}`} title="What is this? How do I use it?"><span aria-hidden="true">?</span></button>}{hint && <span className="hint">{hint}</span>}{(right || meta) && <span className="ch-right">{meta && <span className="meta">{meta}</span>}{right}</span>}</div>}{children}</div>
}
export const KPI = ({ l, v, cls = 'info', s, anchor }: { l: string; v: ReactNode; cls?: string; s?: ReactNode; /** data-id a link-through lands on */ anchor?: string }) => <div className={`kpi ${cls}`} data-id={anchor}><div className="l">{l}</div><div className="v">{v}</div><div className="s">{s}</div></div>
export const Pill = ({ cls, children }: { cls: string; children: ReactNode }) => <span className={`pill ${cls}`}>{children}</span>
export const Money = ({ v, sign }: { v: number | null | undefined; sign?: boolean }) => { const n = +(v ?? 0) || 0; return <span style={{ color: sign ? (n >= 0 ? 'var(--good)' : 'var(--crit)') : undefined }}>{sign && n > 0 ? '+' : ''}{fmtMoney(n)}</span> }
export const Note = ({ children }: { children: ReactNode }) => <div className="note">{children}</div>
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>
export const Btn = ({ onClick, children, primary, sm, danger, disabled, title, type = 'button', block, 'aria-label': ariaLabel, autoFocusHere }: { onClick?: () => void; children: ReactNode; primary?: boolean; sm?: boolean; danger?: boolean; disabled?: boolean; title?: string; type?: 'button' | 'submit'; block?: boolean; 'aria-label'?: string; /** the dialog puts focus here when it opens */ autoFocusHere?: boolean }) => <button type={type} className={`btn ${primary ? 'primary' : ''} ${sm ? 'sm' : ''} ${danger ? 'danger' : ''} ${block ? 'block' : ''}`} onClick={onClick} disabled={disabled} title={title} aria-label={ariaLabel} data-autofocus={autoFocusHere ? '' : undefined}>{children}</button>
export const Seg = <T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) => <span className="seg">{options.map(([v, l]) => <button key={v} className={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => onChange(v)} type="button">{l}</button>)}</span>
/** A password box with a show/hide eye (0.19.2). Starts hidden; the eye is a plain button so Enter in the box still submits the form. Everything else (id, autoComplete, required, minLength, autoFocus…) passes straight to the input. */
export const PasswordInput = ({ className = '', ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) => {
  const [show, setShow] = useState(false)
  return <span className="pwwrap">
    <input {...rest} type={show ? 'text' : 'password'} className={`inp ${className}`} spellCheck={false} autoCapitalize="off" />
    <button type="button" className="pwtoggle" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} title={show ? 'Hide password' : 'Show password'}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{show && <path d="M4 4l16 16" />}
      </svg>
    </button>
  </span>
}
/** A labelled control. A single native input/select/textarea (or PasswordInput) child is tied to the label by id (screen readers and axe see the label); anything else keeps the visible label only.
 *  `error` shows a message under the control and marks it invalid (0.25.1). */
export const Field = ({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string | null }) => {
  const id = useId(); const native = isValidElement(children) && ((typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type)) || children.type === PasswordInput) && !(children.props as { id?: string }).id
  const child = native ? cloneElement(children as ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>, { id, ...(error ? { 'aria-invalid': true, 'aria-describedby': id + '-err' } : {}) }) : children
  return <div className={`field${error ? ' has-error' : ''}`}><label htmlFor={native ? id : undefined}>{label}{hint && <span className="hint" style={{ fontWeight: 400, color: 'var(--ink-3)', marginLeft: 6 }}>{hint}</span>}</label>{child}{error && <div className="field-err" id={id + '-err'} role="alert">{error}</div>}</div>
}
export const Banner = ({ cls = '', children }: { cls?: string; children: ReactNode }) => <div className={`banner ${cls}`}>{children}</div>
export const AList = ({ items }: { items: Array<{ c: string; t: ReactNode; m?: ReactNode; d?: ReactNode }> }) => <ul className="alist">{items.map((i, k) => <li key={k} className={`al-${i.c}`}><span className={`dot ${i.c}`} aria-hidden="true"></span><span><span className="t">{i.t}</span>{i.m && <div className="m">{i.m}</div>}</span>{i.d && <span className="d">{i.d}</span>}</li>)}</ul>

/* ---- layers: everything that sits on top of the page (0.25.1) ----
   Dialogs, the help drawer, the command palette and the phone menu register while they are open, newest last. Escape and the phone's Back
   button close the newest one first; closeTopDialog() is what the Android back button calls (src/app/native.ts). */
type Layer = { id: number; close: () => void }
const layers: Layer[] = []
let layerSeq = 0
export function useLayer(open: boolean, close: () => void): RefObject<number> {
  const fn = useRef(close); fn.current = close; const idRef = useRef(0)
  useEffect(() => { if (!open) return; const id = ++layerSeq; idRef.current = id; layers.push({ id, close: () => fn.current() }); return () => { const i = layers.findIndex(l => l.id === id); if (i >= 0) layers.splice(i, 1) } }, [open])
  return idRef
}
export const isTopLayer = (id: number) => layers.length > 0 && layers[layers.length - 1].id === id
export const hasOpenLayer = () => layers.length > 0
/** Close the newest open dialog, drawer or menu. True when something was closed, so the phone's Back button stays on the page. */
export function closeTopDialog(): boolean { const top = layers[layers.length - 1]; if (!top) return false; top.close(); return true }

/* ---- focus inside a dialog: start inside it, Tab cycles within it, and it goes back where it came from on close ---- */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
const focusablesIn = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.getClientRects().length > 0 && !el.closest('[inert]'))
/** Keep Tab and Shift+Tab inside `root`. */
export function trapTab(e: { key: string; shiftKey: boolean; preventDefault: () => void }, root: HTMLElement | null) {
  if (!root || e.key !== 'Tab') return
  const f = focusablesIn(root); const cur = document.activeElement
  if (!f.length) { e.preventDefault(); root.focus(); return }
  const first = f[0], last = f[f.length - 1]
  if (e.shiftKey) { if (cur === first || cur === root || !root.contains(cur)) { e.preventDefault(); last.focus() } }
  else if (cur === last || !root.contains(cur)) { e.preventDefault(); first.focus() }
}
/** Move focus into `ref` when it opens (unless something inside already has it — a field with autoFocus) and give it back to the element
 *  that opened it when it closes. The Help drawer and the command palette use the same. */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, opts: { initial?: string } = {}) {
  // the opener is read while the dialog first renders — before a field inside it takes focus with autoFocus
  const [opener] = useState<HTMLElement | null>(() => { const a = typeof document !== 'undefined' ? document.activeElement : null; return a instanceof HTMLElement && a !== document.body ? a : null })
  useEffect(() => {
    const el = ref.current
    if (el && !el.contains(document.activeElement)) { const want = (opts.initial && el.querySelector<HTMLElement>(opts.initial)) || el.querySelector<HTMLElement>('[data-autofocus]'); (want || el).focus({ preventScroll: true }) }
    // after closing: back to the opener; if it is gone (its row was deleted) or behind another dialog, to the dialog underneath or the page
    return () => { requestAnimationFrame(() => { if (opener && opener.isConnected && !opener.closest('[inert]')) { opener.focus({ preventScroll: true }); return } const a = document.activeElement; if (a && a !== document.body && a.isConnected) return; const under = [...document.querySelectorAll<HTMLElement>('.modal')].filter(m => !m.closest('[inert]')).pop(); (under || document.getElementById('main'))?.focus({ preventScroll: true }) }) }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps
}

/* ---- modal dialogs: a stack, so a confirmation opened from a dialog sits on top of it and returns to it (0.25.1) ---- */
export interface DialogOpts { wide?: boolean; xwide?: boolean; role?: 'dialog' | 'alertdialog'; /** runs once when the dialog closes, however it closes */ onClose?: () => void }
interface ModalCtx { open: (content: ReactNode, opts?: DialogOpts) => number; close: () => void; closeAll: () => void; titleId?: string }
const MC = createContext<ModalCtx>({ open: () => 0, close: () => {}, closeAll: () => {} })
/** open() puts a dialog on top; close() closes the dialog this is called from (or, outside any dialog, the top one); closeAll() closes every one. */
export const useModal = () => useContext(MC)
interface Entry { id: number; content: ReactNode; opts: DialogOpts }
let dlgSeq = 0
export function ModalHost({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Entry[]>([]); const live = useRef<Entry[]>([])
  const commit = useCallback((next: Entry[]) => { live.current = next; setStack(next) }, [])
  const closeId = useCallback((id: number) => { const d = live.current.find(x => x.id === id); if (!d) return; commit(live.current.filter(x => x.id !== id)); d.opts.onClose?.() }, [commit])
  const open = useCallback((content: ReactNode, opts: DialogOpts = {}) => { const id = ++dlgSeq; commit([...live.current, { id, content, opts }]); return id }, [commit])
  const closeTop = useCallback(() => { const top = live.current[live.current.length - 1]; if (top) closeId(top.id) }, [closeId])
  const closeAll = useCallback(() => { const all = live.current; commit([]); all.forEach(d => d.opts.onClose?.()) }, [commit])
  // Escape with focus outside every dialog (Safari leaves it on the page after a tap) still closes the top one
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key !== 'Escape' || e.defaultPrevented || !live.current.length) return; const t = e.target as HTMLElement | null; if (t && t.closest?.('.modal')) return; e.preventDefault(); closeTop() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [closeTop])
  const root = useMemo<ModalCtx>(() => ({ open, close: closeTop, closeAll }), [open, closeTop, closeAll])
  return <MC.Provider value={root}>
    <div className="modal-under" inert={stack.length > 0}>{children}</div>
    {stack.map((d, i) => <Dialog key={d.id} d={d} top={i === stack.length - 1} close={() => closeId(d.id)} open={open} closeAll={closeAll} />)}
    <Toasts />
  </MC.Provider>
}
function Dialog({ d, top, close, open, closeAll }: { d: Entry; top: boolean; close: () => void; open: ModalCtx['open']; closeAll: () => void }) {
  const ref = useRef<HTMLDivElement>(null); const titleId = `dlg-${d.id}-title`
  useLayer(true, close); useDialogFocus(ref)
  const ctx = useMemo<ModalCtx>(() => ({ open, close, closeAll, titleId }), [open, close, closeAll, titleId])
  // the accessible name is the dialog's title (MHead); a dialog without one is named from its first heading text
  useLayoutEffect(() => { const el = ref.current; if (!el) return; if (el.querySelector('#' + titleId)) { el.setAttribute('aria-labelledby', titleId); el.removeAttribute('aria-label') } else { el.removeAttribute('aria-labelledby'); el.setAttribute('aria-label', (el.querySelector('h2, h3, .mhead b')?.textContent || 'Dialog').trim().slice(0, 80)) } })
  const onKey = (e: React.KeyboardEvent) => { if (!top) return; if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return } trapTab(e, ref.current) }
  return <div className={`modalBack${top ? '' : ' under'}`} onMouseDown={e => { if (top && e.target === e.currentTarget) close() }} inert={!top}>
    <div ref={ref} className={`modal ${d.opts.wide ? 'wide' : ''} ${d.opts.xwide ? 'xwide' : ''}`} role={d.opts.role || 'dialog'} aria-modal="true" tabIndex={-1} onKeyDown={onKey}>
      <MC.Provider value={ctx}><ModalGuard onClose={close}>{d.content}</ModalGuard></MC.Provider>
    </div>
  </div>
}
/** A dialog that throws while rendering shows a plain message and a Close button instead of silently doing nothing (the whole app used to go
 *  blank). The error itself goes to the error log, never onto the screen. */
class ModalGuard extends Component<{ children: ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(e: unknown) { console.error('dialog failed to render', e); captureError(e, { kind: 'dialog' }) }
  render() { return this.state.failed ? <><div className="mhead"><h2>This window could not open</h2><button type="button" className="mclose" onClick={this.props.onClose} aria-label="Close">×</button></div><div className="mbody"><div className="msg crit">Something went wrong while showing it.{useStore.getState().mode === 'demo' ? '' : ' The problem was added to the error log (Settings → Security → Errors).'}</div><div className="note">Close it and try again. If it keeps happening, reload the app.</div></div><div className="mfoot"><button type="button" className="btn" onClick={this.props.onClose}>Close</button></div></> : this.props.children }
}
export const MHead = ({ title }: { title: ReactNode }) => { const { close, titleId } = useModal(); return <div className="mhead"><h2 id={titleId}>{title}</h2><button type="button" className="mclose" onClick={close} aria-label="Close">×</button></div> }
export const MBody = ({ children }: { children: ReactNode }) => <div className="mbody">{children}</div>
export const MFoot = ({ children }: { children: ReactNode }) => <div className="mfoot">{children}</div>
/** A yes/no confirmation that resolves to a boolean. It opens on top of whatever dialog is showing and, when answered, that dialog is still
 *  there as it was (a half-typed reply included). Closing it any other way (Esc, ×, Back) counts as No. */
export function useConfirm() {
  const { open } = useModal()
  return (text: string, okLabel = 'Delete') => new Promise<boolean>(res => { open(<ConfirmBody text={text} okLabel={okLabel} onAnswer={res} />, { role: 'alertdialog', onClose: () => res(false) }) })
}
function ConfirmBody({ text, okLabel, onAnswer }: { text: string; okLabel: string; onAnswer: (ok: boolean) => void }) {
  const { close } = useModal()
  return <><MHead title="Are you sure?" /><MBody><p style={{ margin: 0 }}>{text}</p></MBody><MFoot><Btn autoFocusHere onClick={() => { onAnswer(false); close() }}>Cancel</Btn><Btn danger onClick={() => { onAnswer(true); close() }}>{okLabel}</Btn></MFoot></>
}

export function Toasts() { const toasts = useStore(s => s.toasts); return <div className="toasts" aria-live="polite" role="status">{toasts.map(t => <div key={t.id} className={`toast ${t.err ? 'err' : ''}`}>{t.text}{t.action && <button type="button" className="toast-act" onClick={t.action.run}>{t.action.label}</button>}</div>)}</div> }
export const classOf = (n: number, warn: number, crit: number, inverse = false) => (inverse ? (n >= crit ? 'crit' : n >= warn ? 'warn' : 'good') : n <= crit ? 'crit' : n <= warn ? 'warn' : 'good')
