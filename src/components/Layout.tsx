import { lockNow } from './IdleLock'
import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate, Navigate } from 'react-router-dom'
import { useStore, outdated, nativeUpdate, updateRequired } from '../app/store'
import { initNative, syncSystemBars, storeName, storeUrl, openExternal, isNative, hasAppHistory } from '../app/native'
import { rescheduleReminders, wireReminderTaps } from '../app/nativeReminders'
import { APP_NAME, APP_VERSION, APP_BUILD, LS } from '../app/config'
import { Logo } from './Logo'
import { fmtDY, fmtDT, fmtD, fmtDow, today, addDays, ago } from '../lib/dates'
import { fm2, fmtMoney } from '../lib/money'
import { isLiability } from '../lib/accounts'
import { balanceOn } from '../lib/history'
import { upcoming } from '../lib/recurring'
import { isOpenItem } from '../lib/email/apply'
import { useModal, useConfirm, useLayer, hasOpenLayer, trapTab, MHead, MBody, Btn } from './ui'
import { installTableCards } from './tableCards'
import { useColumnResize } from '../lib/colResize'
import { sb } from '../app/supabase'
import { allowedPaths, describeAccess, accessLevel } from '../lib/access'
import { focusIdFrom, highlight, clearHighlight, linkTo } from '../lib/focus'
import { Palette, ShortcutsHelp } from './Palette'
import type { HelpTab } from './HelpDrawer'
import { HELP_EVENT, type HelpRequest } from '../lib/helpBus'
// the drawer (and the guide's text) loads on first use
const HelpDrawer = lazy(() => import('./HelpDrawer'))
import { PullToRefresh } from './PullToRefresh'
import { subscribeDisplay, displayVersion, privacyOn, togglePrivacy } from '../lib/display'

export interface View { path: string; title: string; sub: string; zone: string; icon: string; tab?: string }
export const VIEWS: View[] = [
  { path: '/', title: 'Dashboard', sub: 'Where you stand today — cash, this period, what is due, net worth', zone: 'Overview', icon: 'home', tab: 'Home' },
  { path: '/forecast', title: 'Cash Flow Forecast', sub: 'Day-by-day calendar and 24-month runway', zone: 'Overview', icon: 'forecast' },
  { path: '/insights', title: 'Spending Intelligence', sub: 'Merchants, subscriptions, waste detection and financial-health scores', zone: 'Spending Intelligence', icon: 'spark' },
  { path: '/transactions', title: 'Transactions', sub: 'Every dollar in and out — log, categorize, search', zone: 'Spending Intelligence', icon: 'list', tab: 'Ledger' },
  { path: '/budget', title: 'Budget', sub: 'Plan vs actual for the period — by month, pay period, week or twice a month', zone: 'Spending Intelligence', icon: 'budget', tab: 'Budget' },
  { path: '/bills', title: 'Bills & Subscriptions', sub: 'Recurring bills, subscriptions, autopays and what is coming up', zone: 'Spending Intelligence', icon: 'bills', tab: 'Bills' },
  { path: '/income', title: 'Income & Pay Periods', sub: 'Every income source, its pay schedule and the paychecks ahead', zone: 'Spending Intelligence', icon: 'income' },
  { path: '/accounts', title: 'Account Balances', sub: 'Every account as last updated — balances, available credit, liquidity, goal allocation and statements', zone: 'Account Balances', icon: 'bank' },
  { path: '/debts', title: 'Debt Payoff', sub: 'Avalanche or snowball, utilization, interest cost and payoff dates', zone: 'Account Balances', icon: 'card' },
  { path: '/connections', title: 'Cash & Account Operations', sub: 'Bank feed, statement files, year-to-date coverage, data sources — every transaction once', zone: 'Cash & Account Operations', icon: 'plug' },
  { path: '/reconcile', title: 'Checkbook Reconciliation', sub: 'Check register, bank matching, statement reconciliation, verified balances, audit trail', zone: 'Cash & Account Operations', icon: 'check' },
  { path: '/email', title: 'Email Money Capture', sub: 'Bills, statements, payments and deposits read from Gmail and Outlook — you approve, the app files', zone: 'Cash & Account Operations', icon: 'mail' },
  { path: '/investments', title: 'Investments & Retirement', sub: 'Holdings, allocation, retirement planner, Monte Carlo and safe-withdrawal stress test', zone: 'Investments & Retirement', icon: 'chartpie' },
  { path: '/tax', title: 'Tax Planning', sub: 'Federal, Ohio and local estimate, withholding and estimated-payment planning, underpayment risk and deadlines', zone: 'Tax Planning & Compliance', icon: 'tax' },
  { path: '/plan', title: 'Plan', sub: 'One timeline for cash, debt payoff, goals and retirement — allocate extra money once and every page agrees', zone: 'Goals & Financial Planning', icon: 'plan' },
  { path: '/goals', title: 'Savings Goals', sub: 'Emergency fund, sinking funds, purchases — progress and pace', zone: 'Goals & Financial Planning', icon: 'goal' },
  { path: '/protection', title: 'Insurance & Estate', sub: 'Every policy and premium, coverage gaps, beneficiaries and the estate checklist', zone: 'Goals & Financial Planning', icon: 'shield' },
  { path: '/hardship', title: 'Hardship & Creditor Outreach', sub: 'Call every lender and provider before a payment is missed', zone: 'Goals & Financial Planning', icon: 'phone' },
  { path: '/reports', title: 'Reports', sub: 'Monthly, quarterly and annual reports — spending, cash flow, net worth, investments and tax — as PDF, Excel or CSV', zone: 'Reports & Analytics', icon: 'report' },
  { path: '/trends', title: 'Trends & Analysis', sub: 'Week / month / year spending, categories, net worth', zone: 'Reports & Analytics', icon: 'trend' },
  { path: '/settings', title: 'Settings', sub: 'Household, categories, payee rules, members, two-factor and sessions, backup, activity log', zone: 'Security & Settings', icon: 'gear' },
  { path: '/help', title: 'Help Center', sub: 'How to use every page, what every number means, step-by-step how-tos, troubleshooting and a glossary', zone: 'Help', icon: 'help' },
]
const ICON: Record<string, string> = { help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.7M12 16.9v.2', shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM8.5 12l2.5 2.5 4.5-5', check: 'M4 12.5l5 5L20 6.5M3 20h18', chartpie: 'M12 3a9 9 0 1 0 9 9h-9zM12 3v9h9', spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8', plug: 'M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3', home: 'M3 11 12 4l9 7v9H3z', forecast: 'M3 17l5-6 4 3 5-7 4 4M3 21h18', budget: 'M4 6h16v12H4zM4 10h16M9 14h3', list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', bills: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6', income: 'M12 3v18M7 8h7a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h8', bank: 'M3 10 12 4l9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18', card: 'M3 7h18v10H3zM3 11h18', goal: 'M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 12l9-9', trend: 'M4 19V5M4 19h16M8 15l4-5 3 3 5-7', phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2', mail: 'M3 6h18v12H3zM3 7l9 6 9-6', gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.3 2.6a7 7 0 0 0-1.7 1l-2.4-1-2 3.5L5.1 11a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 1.7 1l.3 2.6h5l.3-2.6a7 7 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5c.1-.3.1-.7.1-1z', menu: 'M4 7h16M4 12h16M4 17h16', plan: 'M4 5h16M4 12h10M4 19h6M17 15l3 3-3 3M14 18h6', lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3' }
export const Icon = ({ n }: { n: string }) => <svg viewBox="0 0 24 24"><path d={ICON[n] || ICON.home} /></svg>

export function useBadges() {
  const data = useStore(s => s.data)
  return useMemo(() => { const t = today(); const up = upcoming(data, addDays(t, -30), addDays(t, 7)).filter(u => ['overdue', 'due_today', 'due_soon'].includes(u.status)); const em = data.emailItems.filter(x => isOpenItem(x) && ['pastdue', 'declined'].includes(x.kind)).length + data.emailItems.filter(x => x.kind === 'alert' && x.status === 'Alert').length
    const hs = data.hardship.filter(h => !['Closed', 'Not needed', 'Declined', 'Enrolled'].includes(h.status) && ((h.next_followup && h.next_followup <= t) || (h.status === 'To call' && !h.next_followup))).length
    return { '/bills': { n: up.length, why: `${up.length} bill${up.length === 1 ? '' : 's'} overdue or due within 7 days` }, '/email': { n: em, why: `${em} past-due, declined or bank alert` }, '/hardship': { n: hs, why: `${hs} creditor call${hs === 1 ? '' : 's'} due` } } as Record<string, { n: number; why: string }> }, [data])
}
export function Layout({ children }: { children: ReactNode }) {
  const loc = useLocation(), nav = useNavigate(); const { household, mode, user, signOut, exitDemo, resetDemo, role, readOnly, modules, offlineAt } = useStore()
  const visible = useMemo(() => { const ok = mode === 'demo' ? null : modules; const paths = new Set(allowedPaths(ok)); return VIEWS.filter(v => paths.has(v.path)) }, [mode, modules])
  // the icon rail is the Terminal default (the analyst's desk keeps the width for figures); Graphite opens the full rail — a saved choice wins either way
  const [collapsed, setCollapsed] = useState(() => { try { const v = localStorage.getItem(LS('rail')); return v === 'collapsed' ? true : v === 'open' ? false : styleName() === 'terminal' } catch { return false } })
  // sections fold; going to a page opens its section (which can then be folded again); the choice is remembered per browser
  const [closedZones, setClosedZones] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(LS('navClosed')) || '[]')) } catch { return new Set() } })
  const toggleZone = (z: string) => setClosedZones(s => { const n = new Set(s); if (n.has(z)) n.delete(z); else n.add(z); try { localStorage.setItem(LS('navClosed'), JSON.stringify([...n])) } catch { /* */ } return n })
  const setAllZones = (open: boolean) => setClosedZones(() => { const n = new Set(open ? [] : zonesRef.current); try { localStorage.setItem(LS('navClosed'), JSON.stringify([...n])) } catch { /* */ } return n })
  const zonesRef = { current: [] as string[] }
  const [drawer, setDrawer] = useState(false); const { open } = useModal(); const confirm = useConfirm(); const online = useOnline()
  // Back (0.25.1): the previous page when the app got here itself; a page opened directly (a notification, a home-screen shortcut, a link) goes to the dashboard instead of leaving the app
  const goBack = () => { if (hasAppHistory()) nav(-1); else nav('/', { replace: true }) }
  const [palette, setPalette] = useState(false); const [help, setHelp] = useState<false | { card?: string | null; tab?: HelpTab }>(false); const keepHelp = useRef(false); const priv = useSyncExternalStore(subscribeDisplay, privacyOn); const dv = useSyncExternalStore(subscribeDisplay, displayVersion)
  // keyboard shortcuts (0.19.0): never while typing in a field; G-then-letter jumps; ? shows the list; Ctrl-Z undoes the last ledger edit
  useEffect(() => {
    let g = 0
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null; const typing = !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { if (hasOpenLayer() && !document.querySelector('.modal.palette')) return; e.preventDefault(); setPalette(p => !p); return }
      if (typing || e.altKey || hasOpenLayer()) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); void useStore.getState().guarded(() => useStore.getState().undoLast(), 'Undone'); return }
      if (e.ctrlKey || e.metaKey) return
      if (e.key === '/') { e.preventDefault(); setPalette(true); return }
      if (e.key === '?') { e.preventDefault(); open(<><MHead title="Keyboard shortcuts" /><MBody><ShortcutsHelp /></MBody></>); return }
      if (e.key === '[') { goBack(); return } if (e.key === ']') { nav(1); return }
      if (e.key === 'F1') { e.preventDefault(); setHelp({}); return }
      if (e.key.toLowerCase() === 'l' && !(g && Date.now() - g < 1500)) { e.preventDefault(); lockNow(); return }
      if (e.key.toLowerCase() === 'h' && !(g && Date.now() - g < 1500)) { e.preventDefault(); togglePrivacy(); useStore.getState().toast(privacyOn() ? 'Amounts hidden — press H to show them' : 'Amounts shown'); return }
      if (e.key.toLowerCase() === 'g') { g = Date.now(); return }
      if (g && Date.now() - g < 1500) { const map: Record<string, string> = { d: '/', t: '/transactions', b: '/bills', a: '/accounts', f: '/forecast', p: '/plan', r: '/reports', s: '/settings' }; const to = map[e.key.toLowerCase()]; g = 0; if (to) { e.preventDefault(); nav(to) } return }
      if (e.key.toLowerCase() === 'n' && loc.pathname === '/transactions') { const btn = document.querySelector<HTMLButtonElement>('button.btn.primary.sm'); if (btn && /Add transaction/.test(btn.textContent || '')) { e.preventDefault(); btn.click() } }
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [loc.pathname])   // eslint-disable-line react-hooks/exhaustive-deps
  const view = VIEWS.find(v => v.path === loc.pathname) || VIEWS[0]
  const blocked = VIEWS.some(v => v.path === loc.pathname) && !visible.some(v => v.path === loc.pathname)
  // the phone apps (0.25.1): back button, refresh on return to the app, reminder taps, and reminders kept in step with the data
  const navRef = useRef(nav); navRef.current = nav
  useEffect(() => {
    if (!isNative()) return
    void initNative({ back: () => navRef.current(-1), home: () => navRef.current('/', { replace: true }), atRoot: () => !location.hash || location.hash === '#/' || location.hash === '#', onResume: () => { const s = useStore.getState(); if (s.mode === 'db') void s.refresh(); void s.checkLatest() } })
    void wireReminderTaps(u => navRef.current(u)); syncSystemBars(document.documentElement.dataset.theme === 'dark')
    let t: ReturnType<typeof setTimeout> | undefined; void rescheduleReminders(useStore.getState().data)
    const off = useStore.subscribe((s, p) => { if (s.data !== p.data) { clearTimeout(t); t = setTimeout(() => void rescheduleReminders(s.data), 1500) } })
    return () => { off(); clearTimeout(t) }
  }, [])
  const drawerOpen = useRef(false); drawerOpen.current = drawer
  // a page picked from the phone menu: the menu closes and focus goes to the new page (it was left on a link that just disappeared)
  useEffect(() => { document.title = `${view.title} · ${APP_NAME}`; if (drawerOpen.current) { setDrawer(false); requestAnimationFrame(() => document.getElementById('main')?.focus({ preventScroll: true })) } if (keepHelp.current) keepHelp.current = false; else setHelp(false); window.scrollTo(0, 0) }, [loc.pathname, view.title])
  // a card's ? (lib/helpBus) opens the drawer at that card
  useEffect(() => { const on = (e: Event) => { const d = (e as CustomEvent<HelpRequest>).detail || {}; setHelp({ card: d.card ?? null, tab: d.tab }) }; window.addEventListener(HELP_EVENT, on); return () => window.removeEventListener(HELP_EVENT, on) }, [])
  // a search result on another page: go there and keep the drawer open at that card; general topics open the Help Center
  const helpGo = (path: string | null, card?: string | null) => { if (!path || path.startsWith('/help')) { setHelp(false); nav(path || '/help') } else if (path !== view.path) { keepHelp.current = true; nav(path); setHelp({ card: card ?? null }) } else setHelp({ card: card ?? null }) }
  useEffect(() => { try { localStorage.setItem(LS('rail'), collapsed ? 'collapsed' : 'open') } catch { /* */ } }, [collapsed])
  // the phone menu (0.25.1): hidden from screen readers and the keyboard while closed (styles.css); open, it takes focus, keeps Tab inside,
  // and Esc, a tap outside or the phone's Back button closes it and puts focus back on the Menu button
  const railRef = useRef<HTMLElement>(null); const menuBtn = useRef<HTMLButtonElement | null>(null); const mbarMenu = useRef<HTMLButtonElement>(null)
  const closeDrawer = () => { setDrawer(false); requestAnimationFrame(() => (menuBtn.current || mbarMenu.current)?.focus({ preventScroll: true })) }
  const drawerLayer = useLayer(drawer, closeDrawer)
  useEffect(() => { if (!drawer) return; const el = railRef.current; const t = setTimeout(() => (el?.querySelector<HTMLElement>('.nav a.active') || el?.querySelector<HTMLElement>('.nav a, .nav button'))?.focus({ preventScroll: true }), 60)
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && isTop()) { e.preventDefault(); closeDrawer() } }
    const isTop = () => !!drawerLayer.current && !document.querySelector('.modal')
    window.addEventListener('keydown', k); return () => { clearTimeout(t); window.removeEventListener('keydown', k) } }, [drawer])   // eslint-disable-line react-hooks/exhaustive-deps
  // phones: hand-written tables become cards, and table areas that still scroll get a tab stop (components/tableCards.ts)
  useEffect(() => installTableCards(document.body), [])
  useColumnResize()   // every table's columns drag to resize (0.26.0)
  // Skip to content moves focus to the page without changing the route (the hash router read "#main" as a page and opened the dashboard)
  const skip = (e: React.MouseEvent) => { e.preventDefault(); const m = document.getElementById('main'); if (m) { m.focus({ preventScroll: true }); m.scrollIntoView({ block: 'start' }) } }
  const zones = [...new Set(visible.map(v => v.zone))]; zonesRef.current = zones
  const focusId = focusIdFrom(loc.search)
  useEffect(() => { if (focusId) setTimeout(() => highlight(focusId), 120); else clearHighlight() }, [focusId, loc.pathname])
  const activeZone = visible.find(v => v.path === loc.pathname)?.zone
  const allOpen = zones.every(z => !closedZones.has(z))
  // arriving on a page opens its section once; before, the section holding the current page could never be folded
  useEffect(() => { if (activeZone) setClosedZones(s => { if (!s.has(activeZone)) return s; const n = new Set(s); n.delete(activeZone); try { localStorage.setItem(LS('navClosed'), JSON.stringify([...n])) } catch { /* */ } return n }) }, [loc.pathname]) // eslint-disable-line react-hooks/exhaustive-deps
  const resetDemoAsk = async () => { if (await confirm('Reset the demo? Every change you made in the demo is replaced by fresh sample data. This cannot be undone.', 'Reset sample data')) resetDemo() }
  const about = () => open(<><MHead title={`About ${APP_NAME}`} /><MBody><p><b>{APP_NAME}</b> v{APP_VERSION} · build <code>{APP_BUILD}</code></p><StatusPanel /><p className="note">Personal budgeting, savings and financial planning. Data lives in your own Supabase project; email bodies are never stored — only amounts, dates, payees and the last four digits of an account.</p></MBody></>)
  const tabs = visible.filter(v => v.tab)
  if (blocked) return <Navigate to="/" replace />
  const access = mode === 'db' ? { role, read_only: readOnly, modules } : null
  if (updateRequired()) return <div className="lockscreen" role="alert"><div className="box"><h2>Update Cresari</h2><p className="note">This version (v{APP_VERSION}) is too old to keep your data in step with the household. Install the latest version from {storeName()} — nothing you saved is lost.</p>{storeUrl() ? <Btn primary block onClick={() => void openExternal(storeUrl())}>Open {storeName()}</Btn> : <p className="note">Open {storeName()} and update Cresari.</p>}</div></div>
  return <div className={`app ${collapsed ? 'rail-collapsed' : ''}`}>
    <a href="#main" className="skip" onClick={skip}>Skip to content</a>
    {palette && <Palette onClose={() => setPalette(false)} />}
    {help && <Suspense fallback={null}><HelpDrawer path={view.path} title={view.title} card={help.card} tab={help.tab} onClose={() => setHelp(false)} onGo={helpGo} /></Suspense>}
    <header className="mbar"><button type="button" ref={mbarMenu} onClick={() => { if (drawer) closeDrawer(); else { menuBtn.current = mbarMenu.current; setDrawer(true) } }} aria-label="Menu" aria-expanded={drawer} aria-controls="app-menu">☰</button><button type="button" onClick={goBack} aria-label="Back" style={{ fontSize: 28 }}>‹</button><span className="mb-title">{view.title}</span><button type="button" onClick={togglePrivacy} aria-label={priv ? 'Show amounts' : 'Hide amounts'} aria-pressed={priv} title="Hide amounts">{priv ? '◉' : '◎'}</button><button type="button" onClick={() => setHelp({})} aria-label="Help for this page">ⓘ</button><ThemeBtn /></header>
    <div className={`backdrop ${drawer ? 'show' : ''}`} onClick={closeDrawer} aria-hidden="true" />
    <aside className={`rail ${drawer ? 'open' : ''}`} id="app-menu" ref={railRef} aria-label="Menu" onKeyDown={e => { if (drawer) trapTab(e, railRef.current) }}>
      <div className="brand"><span className="mark" onClick={() => collapsed && setCollapsed(false)}><Logo size={28} /></span><div><b>{APP_NAME}</b><small>{mode === 'demo' ? 'Offline demo' : household?.name || 'Household'}</small></div><button type="button" className="railToggle" onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Expand menu' : 'Collapse menu'} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'} aria-expanded={!collapsed}>{collapsed ? '›' : '‹'}</button></div>
      <nav className="nav" aria-label="Main">
        <div className="navtools"><button type="button" onClick={() => setAllZones(!allOpen)} title={allOpen ? 'Collapse all sections' : 'Expand all sections'}>{allOpen ? '⊟ Collapse all' : '⊞ Expand all'}</button></div>
        {zones.map(z => { const items = visible.filter(v => v.zone === z); const open = collapsed || !closedZones.has(z)
          return <div key={z} className={`zoneblock ${open ? 'open' : 'closed'}`}>
            <button type="button" className="zone" onClick={() => toggleZone(z)} aria-expanded={open} title={open ? 'Collapse' : 'Expand'}><span className="chev">{open ? '▾' : '▸'}</span><span className="zt">{z}</span></button>
            {open && items.map(v => <NavLink key={v.path} to={v.path} className={({ isActive }) => (isActive ? 'active' : '')} title={collapsed ? `${v.title} — ${v.sub}` : v.sub}><Icon n={v.icon} /><span className="t">{v.title}</span></NavLink>)}
          </div> })}
      </nav>
      <div className="me"><span className="avatar">{(mode === 'demo' ? 'D' : (user?.email?.[0] || '?')).toUpperCase()}</span><span className="who"><b>{mode === 'demo' ? 'demo' : user?.email}</b><span>{access ? (accessLevel(access) === 'owner' ? 'owner' : accessLevel(access) === 'full' ? 'full access' : accessLevel(access) === 'readonly' ? 'read-only' : 'limited access') : role}</span></span><Btn sm onClick={() => (mode === 'demo' ? exitDemo() : signOut())}>Sign out</Btn></div>
      <div className="railfoot" onClick={about}>{APP_NAME} <b>v{APP_VERSION}</b> · <span className={`envtag env-${envName()}`}>{envName()}</span><br />build {APP_BUILD}</div>
    </aside>
    <main className="main" id="main" tabIndex={-1}>
      <Ticker />
      <nav className="histnav" aria-label="History"><button type="button" className="hn-btn" onClick={goBack} title="Back"><span aria-hidden>←</span> Back</button><button type="button" className="hn-btn" onClick={() => nav(1)} title="Forward">Forward <span aria-hidden>→</span></button><span className="hn-crumb">{view.path !== '/' && <><NavLink to="/">Home</NavLink> › <span>{view.zone}</span> › </>}<b>{view.title}</b></span></nav>
      <div className="topbar"><div><div className="eyebrow">{fmtDow(today())} {today()} · {mode === 'demo' ? 'Offline demo' : household?.name || 'Household'}</div><h1>{view.title}</h1><div className="sub">{view.sub}</div></div><div className="asof"><span className="chip">As of <b>{fmtDY(today())}</b></span><button type="button" className="btn" onClick={() => setPalette(true)} title="Jump to anything (Ctrl K)" aria-label="Ctrl K: search and jump" style={{ padding: '6px 10px' }}><span aria-hidden="true">⌕ </span><kbd style={{ marginLeft: 4 }}>Ctrl K</kbd></button><button type="button" className="btn" onClick={() => setHelp({})} title="Help for this page (F1)" style={{ padding: '6px 10px' }}><span aria-hidden="true">ⓘ </span>Help</button><button type="button" className={`btn ${priv ? 'on' : ''}`} onClick={togglePrivacy} title={priv ? 'Show amounts (H)' : 'Hide amounts on screen (H)'} aria-label={priv ? 'Hidden — show amounts' : 'Hide amounts'} aria-pressed={priv} style={{ padding: '6px 10px' }}>{priv ? <><span aria-hidden="true">◉ </span>Hidden</> : '◎'}</button><button type="button" className="btn lockbtn" onClick={lockNow} title="Lock now (L) — hides every figure until you unlock" aria-label="Lock now" style={{ padding: '6px 10px' }}>🔒</button><ThemeBtn /></div></div>
      {outdated() && <div className="banner crit">A newer release (v{useStore.getState().latest}) is available — this tab is still running <b>v{APP_VERSION}</b>. <Btn sm primary onClick={() => { try { navigator.serviceWorker?.getRegistrations().then(rs => rs.forEach(r => r.update())) } catch { /* */ } location.reload() }}>Reload now</Btn></div>}
      {nativeUpdate() && <div className="banner info" role="status">A newer version of Cresari (v{useStore.getState().nativeLatest}) is in {storeName()}. {storeUrl() && <Btn sm primary onClick={() => void openExternal(storeUrl())}>Update</Btn>}</div>}
      {mode === 'demo' && <div className="banner">Offline demo — data is stored only in this browser. <Btn sm onClick={() => void resetDemoAsk()}>Reset sample data</Btn><Btn sm onClick={exitDemo}>Sign in to a real household</Btn></div>}
      {offlineAt && mode === 'db' ? <div className="banner warn" role="status" data-testid="offline-banner">You're offline — showing your data as of <b>{fmtDT(offlineAt)}</b>. Changes are paused until you're back online; the page updates by itself when the connection returns.</div>
        : !online && <div className="banner warn">You're offline. {mode === 'demo' ? 'The demo keeps working; changes stay in this browser.' : 'Showing what was loaded before the connection dropped — changes are paused until you are back online.'}</div>}
      {household?.deletion_scheduled_for && <div className="banner crit" role="alert" data-testid="deletion-banner">This household will be <b>permanently deleted on {fmtDY(household.deletion_scheduled_for.slice(0, 10))}</b> — every account, transaction, file and backup, for every member. Until then it is read-only. {useStore.getState().isOwner() ? <Btn sm primary onClick={() => void useStore.getState().cancelDeletion().then(() => useStore.getState().toast('Deletion cancelled — the household is back to normal'), (e: Error) => useStore.getState().toast(e.message, true))}>Cancel the deletion</Btn> : 'An owner can cancel it in Settings.'}</div>}
      {access && accessLevel(access) !== 'owner' && accessLevel(access) !== 'full' && <div className="banner info">{describeAccess(access)}{accessLevel(access) === 'limited' ? ' — other sections are hidden.' : '.'}</div>}
      {priv && <div className="banner info privacy-note" role="status">Amounts are hidden on this device. <Btn sm onClick={togglePrivacy}>Show amounts</Btn> <span className="note" style={{ display: 'inline', margin: 0 }}>(or press H)</span></div>}
      <div className={useStore.getState().canEdit() ? '' : 'ro'} key={useThemeName() + '·' + dv}><PullToRefresh>{children}</PullToRefresh></div>
    </main>
    <nav className="tabbar" aria-label="Quick tabs">{tabs.map(v => <NavLink key={v.path} to={v.path} className={({ isActive }) => (isActive ? 'active' : '')}><Icon n={v.icon} /><span>{v.tab}</span></NavLink>)}<button type="button" onClick={e => { menuBtn.current = e.currentTarget; setDrawer(true) }} aria-expanded={drawer} aria-controls="app-menu"><Icon n="menu" /><span>Menu</span></button></nav>
  </div>
}
export type ThemeMode = 'light' | 'dark' | 'system'
/** The app's look (0.26.0): Graphite (Swiss minimal, the original) or Terminal (the analyst's desk — charcoal & amber, mono figures). Saved per browser; Terminal is the default. */
export type StyleName = 'graphite' | 'terminal'
export const STYLES: Array<[StyleName, string, string]> = [['terminal', 'Terminal — analyst\'s desk, charcoal & amber, mono figures', 'a ticker of your accounts across the top, an icon rail, every figure in mono'], ['graphite', 'Graphite — Swiss minimal, cool grey & tangerine', 'the original look: white panels, hairlines, one tangerine accent']]
export const styleName = (): StyleName => { try { const v = localStorage.getItem(LS('style')); return v === 'graphite' || v === 'terminal' ? v : 'terminal' } catch { return 'terminal' } }
export function setStyle(s: StyleName) {
  try { localStorage.setItem(LS('style'), s) } catch { /* */ }
  const changed = document.documentElement.dataset.style !== s
  document.documentElement.dataset.style = s
  if (changed) { themeSubs.forEach(cb => cb()); paintBars() }
}
const railColor = () => { const t = document.documentElement.dataset.theme, s = document.documentElement.dataset.style; return s === 'terminal' ? (t === 'dark' ? '#0d0f11' : '#1b1d20') : t === 'dark' ? '#0b0d10' : '#ffffff' }
// phones paint the status bar / address bar from theme-color, so keep it in step with the theme and style (the rail's colour)
const paintBars = () => { try { const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', railColor()) } catch { /* */ } syncSystemBars(document.documentElement.dataset.theme === 'dark' || document.documentElement.dataset.style === 'terminal') }
const sysTheme = () => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
export const themeMode = (): ThemeMode => { try { const v = localStorage.getItem(LS('theme')); return v === 'light' || v === 'dark' || v === 'system' ? v : 'system' } catch { return 'system' } }
// Charts bake the theme's colours into their data when a page renders, so a theme change re-mounts the page (key below) and every chart redraws in the new colours.
const themeSubs = new Set<() => void>()
export const useThemeName = () => useSyncExternalStore(cb => { themeSubs.add(cb); return () => { themeSubs.delete(cb) } }, () => `${document.documentElement.dataset.theme || 'light'}/${document.documentElement.dataset.style || 'graphite'}`)
export function setThemeMode(m: ThemeMode) {
  try { localStorage.setItem(LS('theme'), m) } catch { /* */ }
  const t = m === 'system' ? sysTheme() : m
  const changed = document.documentElement.dataset.theme !== t
  document.documentElement.dataset.theme = t
  if (changed) themeSubs.forEach(cb => cb())
  paintBars()
}
/** Light / dark / system (follows the OS). Persisted in localStorage; "system" re-applies live when the OS switches. */
export function ThemeBtn() {
  const [m, setM] = useState<ThemeMode>(themeMode)
  const cycle = () => { const n: ThemeMode = m === 'system' ? 'dark' : m === 'dark' ? 'light' : 'system'; setThemeMode(n); setM(n) }   // system → dark → light → system
  const label = m === 'system' ? `System (${sysTheme()})` : m === 'dark' ? 'Dark' : 'Light'
  return <button type="button" className="btn" onClick={cycle} title={`Theme: ${label} — click to change`} aria-label={`Theme: ${label}`} style={{ padding: '6px 10px' }}>{m === 'system' ? '◐' : m === 'dark' ? '☀︎' : '☾'}</button>
}
export function applySavedTheme() { document.documentElement.dataset.style = styleName(); setThemeMode(themeMode()); try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (themeMode() === 'system') setThemeMode('system') }) } catch { /* */ } }

/** Deployment environment from where the app is served: localhost → development, *.github.io or a custom domain → production, anything else (preview URLs) → staging. */
export const envName = (): 'development' | 'staging' | 'production' => { const h = location.hostname; if (!h || h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local')) return 'development'; if (/github\.io$|cresari/.test(h)) return 'production'; return 'staging' }
export function StatusPanel() {
  const { mode, lastRefresh, latest, household } = useStore(); const [db, setDb] = useState<'checking' | 'ok' | 'down' | 'n/a'>(mode === 'db' ? 'checking' : 'n/a'); const [ms, setMs] = useState<number | null>(null)
  useEffect(() => { if (mode !== 'db') return; let on = true; const t0 = performance.now(); Promise.resolve(sb().from('app_meta').select('key').limit(1)).then(r => { if (!on) return; setDb(r.error ? 'down' : 'ok'); setMs(Math.round(performance.now() - t0)) }).catch(() => on && setDb('down')); return () => { on = false } }, [mode])
  const row = (l: string, v: ReactNode) => <tr><td style={{ color: 'var(--ink-3)', paddingRight: 12 }}>{l}</td><td><b>{v}</b></td></tr>
  return <table className="tbl" style={{ marginTop: 10 }}><tbody>
    {row('Environment', <span className={`envtag env-${envName()}`}>{envName()}</span>)}
    {row('Deployment', APP_BUILD === 'dev' ? 'dev server' : `build ${APP_BUILD}${latest ? ` · latest ${latest}` : ''}`)}
    {row('Data', mode === 'demo' ? 'offline demo (this browser only)' : household?.name || '—')}
    {row('Database', mode !== 'db' ? 'not used in demo' : db === 'checking' ? 'checking…' : db === 'ok' ? <span style={{ color: 'var(--good)' }}>reachable · {ms} ms</span> : <span style={{ color: 'var(--crit)' }}>unreachable</span>)}
    {row('Last successful sync', lastRefresh ? `${new Date(lastRefresh).toLocaleTimeString()} (${ago(lastRefresh)})` : '—')}
  </tbody></table>
}

/** navigator.onLine, kept current. */
export function useOnline() { const [on, setOn] = useState(() => typeof navigator === 'undefined' || navigator.onLine); useEffect(() => { const up = () => setOn(true), down = () => setOn(false); window.addEventListener('online', up); window.addEventListener('offline', down); return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) } }, []); return on }

/** The desk's ticker (0.26.1, Terminal style only — styles.css hides it elsewhere and on phones): every active account's balance with its
 *  30-day move, cards and loans with their next due date, and at the right the last bank sync and the version. */
function Ticker() {
  const data = useStore(s => s.data); const t = today(); const since = addDays(t, -30)
  const accts = data.accounts.filter(a => a.status === 'Active' && !a.asset_type && a.kind !== 'other_asset').slice().sort((a, b) => (isLiability(a) ? 1 : 0) - (isLiability(b) ? 1 : 0) || a.sort_order - b.sort_order).slice(0, 8)
  const sync = data.audit.find(e => e.kind === 'sync' || e.kind === 'sync_failure')
  if (!accts.length) return null
  return <div className="ticker" aria-label="Account ticker">
    {accts.map(a => { const bal = +a.balance || 0; const li = isLiability(a); const prev = li ? null : balanceOn(data, a, since).balance; const d = prev == null ? null : Math.round((bal - prev) * 100) / 100
      return <Link key={a.id} to={linkTo('/accounts', a.id)} className="tk"><span className="tk-n">{a.name}{a.last4 ? ` ··${a.last4}` : ''}</span><b className={li ? 'neg' : ''}>{li ? '−' : ''}{fm2(Math.abs(bal))}</b>
        {li ? <span className="tk-d">{a.autopay && a.due_date ? `autopay ${fmtD(a.due_date)}` : a.due_date ? `due ${fmtD(a.due_date)}` : ''}</span> : d != null && Math.abs(d) >= 1 ? <span className={`tk-d ${d > 0 ? 'up' : 'down'}`}>{d > 0 ? '▲' : '▼'} {fmtMoney(Math.abs(d))}</span> : null}</Link> })}
    <span className="tk tk-end"><span className={`tk-dot ${sync?.kind === 'sync_failure' ? 'bad' : sync ? 'ok' : ''}`} />sync {sync ? fmtDT(sync.created_at) : 'never'} · v{APP_VERSION}</span>
  </div>
}
