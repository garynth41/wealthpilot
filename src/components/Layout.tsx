import { lockNow } from './IdleLock'
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate, Navigate } from 'react-router-dom'
import { useStore, outdated } from '../app/store'
import { APP_NAME, APP_VERSION, APP_BUILD, LS } from '../app/config'
import { Logo } from './Logo'
import { fmtDY, today, addDays, ago } from '../lib/dates'
import { upcoming } from '../lib/recurring'
import { isOpenItem } from '../lib/email/apply'
import { Toasts, useModal, MHead, MBody, Btn } from './ui'
import { sb } from '../app/supabase'
import { allowedPaths, describeAccess, accessLevel } from '../lib/access'
import { focusIdFrom, highlight } from '../lib/focus'
import { Palette, ShortcutsHelp } from './Palette'
import { HelpDrawer } from './HelpDrawer'
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
]
const ICON: Record<string, string> = { shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM8.5 12l2.5 2.5 4.5-5', check: 'M4 12.5l5 5L20 6.5M3 20h18', chartpie: 'M12 3a9 9 0 1 0 9 9h-9zM12 3v9h9', spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8', plug: 'M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3', home: 'M3 11 12 4l9 7v9H3z', forecast: 'M3 17l5-6 4 3 5-7 4 4M3 21h18', budget: 'M4 6h16v12H4zM4 10h16M9 14h3', list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', bills: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6', income: 'M12 3v18M7 8h7a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h8', bank: 'M3 10 12 4l9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18', card: 'M3 7h18v10H3zM3 11h18', goal: 'M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 12l9-9', trend: 'M4 19V5M4 19h16M8 15l4-5 3 3 5-7', phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2', mail: 'M3 6h18v12H3zM3 7l9 6 9-6', gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.3 2.6a7 7 0 0 0-1.7 1l-2.4-1-2 3.5L5.1 11a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 1.7 1l.3 2.6h5l.3-2.6a7 7 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5c.1-.3.1-.7.1-1z', menu: 'M4 7h16M4 12h16M4 17h16', plan: 'M4 5h16M4 12h10M4 19h6M17 15l3 3-3 3M14 18h6', lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3' }
export const Icon = ({ n }: { n: string }) => <svg viewBox="0 0 24 24"><path d={ICON[n] || ICON.home} /></svg>

export function useBadges() {
  const data = useStore(s => s.data)
  return useMemo(() => { const t = today(); const up = upcoming(data, addDays(t, -30), addDays(t, 7)).filter(u => ['overdue', 'due_today', 'due_soon'].includes(u.status)); const em = data.emailItems.filter(x => isOpenItem(x) && ['pastdue', 'declined'].includes(x.kind)).length + data.emailItems.filter(x => x.kind === 'alert' && x.status === 'Alert').length
    const hs = data.hardship.filter(h => !['Closed', 'Not needed', 'Declined', 'Enrolled'].includes(h.status) && ((h.next_followup && h.next_followup <= t) || (h.status === 'To call' && !h.next_followup))).length
    return { '/bills': { n: up.length, why: `${up.length} bill${up.length === 1 ? '' : 's'} overdue or due within 7 days` }, '/email': { n: em, why: `${em} past-due, declined or bank alert` }, '/hardship': { n: hs, why: `${hs} creditor call${hs === 1 ? '' : 's'} due` } } as Record<string, { n: number; why: string }> }, [data])
}
export function Layout({ children }: { children: ReactNode }) {
  const loc = useLocation(), nav = useNavigate(); const { household, mode, user, signOut, exitDemo, resetDemo, role, readOnly, modules } = useStore()
  const visible = useMemo(() => { const ok = mode === 'demo' ? null : modules; const paths = new Set(allowedPaths(ok)); return VIEWS.filter(v => paths.has(v.path)) }, [mode, modules])
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(LS('rail')) === 'collapsed' } catch { return false } })
  // sections fold; the one holding the current page is always open; the choice is remembered per browser
  const [closedZones, setClosedZones] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(LS('navClosed')) || '[]')) } catch { return new Set() } })
  const toggleZone = (z: string) => setClosedZones(s => { const n = new Set(s); if (n.has(z)) n.delete(z); else n.add(z); try { localStorage.setItem(LS('navClosed'), JSON.stringify([...n])) } catch { /* */ } return n })
  const setAllZones = (open: boolean) => setClosedZones(() => { const n = new Set(open ? [] : zonesRef.current); try { localStorage.setItem(LS('navClosed'), JSON.stringify([...n])) } catch { /* */ } return n })
  const zonesRef = { current: [] as string[] }
  const [drawer, setDrawer] = useState(false); const { open } = useModal(); const online = useOnline()
  const [palette, setPalette] = useState(false); const [help, setHelp] = useState(false); const priv = useSyncExternalStore(subscribeDisplay, privacyOn); const dv = useSyncExternalStore(subscribeDisplay, displayVersion)
  // keyboard shortcuts (0.19.0): never while typing in a field; G-then-letter jumps; ? shows the list; Ctrl-Z undoes the last ledger edit
  useEffect(() => {
    let g = 0
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null; const typing = !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p); return }
      if (typing || e.altKey) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); void useStore.getState().guarded(() => useStore.getState().undoLast(), 'Undone'); return }
      if (e.ctrlKey || e.metaKey) return
      if (e.key === '/') { e.preventDefault(); setPalette(true); return }
      if (e.key === '?') { e.preventDefault(); open(<><MHead title="Keyboard shortcuts" /><MBody><ShortcutsHelp /></MBody></>); return }
      if (e.key === '[') { nav(-1); return } if (e.key === ']') { nav(1); return }
      if (e.key === 'F1') { e.preventDefault(); setHelp(true); return }
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
  useEffect(() => { document.title = `${view.title} · ${APP_NAME}`; setDrawer(false); setHelp(false); window.scrollTo(0, 0) }, [loc.pathname, view.title])
  useEffect(() => { try { localStorage.setItem(LS('rail'), collapsed ? 'collapsed' : 'open') } catch { /* */ } }, [collapsed])
  const zones = [...new Set(visible.map(v => v.zone))]; zonesRef.current = zones
  const focusId = focusIdFrom(loc.search)
  useEffect(() => { if (focusId) setTimeout(() => highlight(focusId), 120) }, [focusId, loc.pathname])
  const activeZone = visible.find(v => v.path === loc.pathname)?.zone
  const allOpen = zones.every(z => !closedZones.has(z) || z === activeZone)
  const about = () => open(<><MHead title={`About ${APP_NAME}`} /><MBody><p><b>{APP_NAME}</b> v{APP_VERSION} · build <code>{APP_BUILD}</code></p><StatusPanel /><p className="note">Personal budgeting, savings and financial planning. Data lives in your own Supabase project; email bodies are never stored — only amounts, dates, payees and the last four digits of an account.</p></MBody></>)
  const tabs = visible.filter(v => v.tab)
  if (blocked) return <Navigate to="/" replace />
  const access = mode === 'db' ? { role, read_only: readOnly, modules } : null
  return <div className={`app ${collapsed ? 'rail-collapsed' : ''}`}>
    <a href="#main" className="skip">Skip to content</a>
    {palette && <Palette onClose={() => setPalette(false)} />}
    {help && <HelpDrawer path={view.path} title={view.title} onClose={() => setHelp(false)} />}
    <header className="mbar"><button onClick={() => setDrawer(d => !d)} aria-label="Menu">☰</button><button onClick={() => nav(-1)} aria-label="Back" style={{ fontSize: 28 }}>‹</button><span className="mb-title">{view.title}</span><button onClick={togglePrivacy} aria-label={priv ? 'Show amounts' : 'Hide amounts'} aria-pressed={priv} title="Hide amounts">{priv ? '◉' : '◎'}</button><button onClick={() => setHelp(true)} aria-label="Help for this page">ⓘ</button><ThemeBtn /></header>
    <div className={`backdrop ${drawer ? 'show' : ''}`} onClick={() => setDrawer(false)} aria-hidden="true" />
    <aside className={`rail ${drawer ? 'open' : ''}`}>
      <div className="brand"><span className="mark" onClick={() => collapsed && setCollapsed(false)}><Logo size={28} /></span><div><b>{APP_NAME}</b><small>{mode === 'demo' ? 'Offline demo' : household?.name || 'Household'}</small></div><button className="railToggle" onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Expand menu' : 'Collapse menu'} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'} aria-expanded={!collapsed}>{collapsed ? '›' : '‹'}</button></div>
      <nav className="nav" aria-label="Main">
        <div className="navtools"><button onClick={() => setAllZones(!allOpen)} title={allOpen ? 'Collapse all sections' : 'Expand all sections'}>{allOpen ? '⊟ Collapse all' : '⊞ Expand all'}</button></div>
        {zones.map(z => { const items = visible.filter(v => v.zone === z); const open = collapsed || !closedZones.has(z) || z === activeZone
          return <div key={z} className={`zoneblock ${open ? 'open' : 'closed'}`}>
            <button className="zone" onClick={() => toggleZone(z)} aria-expanded={open} title={open ? 'Collapse' : 'Expand'}><span className="chev">{open ? '▾' : '▸'}</span><span className="zt">{z}</span></button>
            {open && items.map(v => <NavLink key={v.path} to={v.path} className={({ isActive }) => (isActive ? 'active' : '')} title={v.sub}><Icon n={v.icon} /><span className="t">{v.title}</span></NavLink>)}
          </div> })}
      </nav>
      <div className="me"><span className="avatar">{(mode === 'demo' ? 'D' : (user?.email?.[0] || '?')).toUpperCase()}</span><span className="who"><b>{mode === 'demo' ? 'demo' : user?.email}</b><span>{access ? (accessLevel(access) === 'owner' ? 'owner' : accessLevel(access) === 'full' ? 'full access' : accessLevel(access) === 'readonly' ? 'read-only' : 'limited access') : role}</span></span><Btn sm onClick={() => (mode === 'demo' ? exitDemo() : signOut())}>Sign out</Btn></div>
      <div className="railfoot" onClick={about}>{APP_NAME} <b>v{APP_VERSION}</b> · <span className={`envtag env-${envName()}`}>{envName()}</span><br />build {APP_BUILD}</div>
    </aside>
    <main className="main" id="main" tabIndex={-1}>
      <nav className="histnav" aria-label="History"><button className="hn-btn" onClick={() => nav(-1)} title="Back"><span aria-hidden>←</span> Back</button><button className="hn-btn" onClick={() => nav(1)} title="Forward">Forward <span aria-hidden>→</span></button><span className="hn-crumb">{view.path !== '/' && <><NavLink to="/">Home</NavLink> › <span>{view.zone}</span> › </>}<b>{view.title}</b></span></nav>
      <div className="topbar"><div><h1>{view.title}</h1><div className="sub">{view.sub}</div></div><div className="asof"><span className="chip">As of <b>{fmtDY(today())}</b></span><button className="btn" onClick={() => setPalette(true)} title="Jump to anything (Ctrl K)" aria-label="Search and jump (Ctrl K)" style={{ padding: '6px 10px' }}>⌕ <kbd style={{ marginLeft: 4 }}>Ctrl K</kbd></button><button className="btn" onClick={() => setHelp(true)} title="Help for this page (F1)" aria-label="Help for this page" style={{ padding: '6px 10px' }}>ⓘ Help</button><button className={`btn ${priv ? 'on' : ''}`} onClick={togglePrivacy} title={priv ? 'Show amounts (H)' : 'Hide amounts on screen (H)'} aria-label={priv ? 'Show amounts' : 'Hide amounts'} aria-pressed={priv} style={{ padding: '6px 10px' }}>{priv ? '◉ Hidden' : '◎'}</button><button className="btn lockbtn" onClick={lockNow} title="Lock now (L) — hides every figure until you unlock" aria-label="Lock now" style={{ padding: '6px 10px' }}>🔒</button><ThemeBtn /></div></div>
      {outdated() && <div className="banner crit">A newer release (v{useStore.getState().latest}) is available — this tab is still running <b>v{APP_VERSION}</b>. <Btn sm primary onClick={() => { try { navigator.serviceWorker?.getRegistrations().then(rs => rs.forEach(r => r.update())) } catch { /* */ } location.reload() }}>Reload now</Btn></div>}
      {mode === 'demo' && <div className="banner">Offline demo — data is stored only in this browser. <Btn sm onClick={resetDemo}>Reset sample data</Btn><Btn sm onClick={exitDemo}>Sign in to a real household</Btn></div>}
      {!online && <div className="banner warn">You're offline. {mode === 'demo' ? 'The demo keeps working; changes stay in this browser.' : 'Showing what was loaded before the connection dropped — changes will fail until you are back online.'}</div>}
      {access && accessLevel(access) !== 'owner' && accessLevel(access) !== 'full' && <div className="banner info">{describeAccess(access)}{accessLevel(access) === 'limited' ? ' — other sections are hidden.' : '.'}</div>}
      {priv && <div className="banner info privacy-note" role="status">Amounts are hidden on this device. <Btn sm onClick={togglePrivacy}>Show amounts</Btn> <span className="note" style={{ display: 'inline', margin: 0 }}>(or press H)</span></div>}
      <div className={useStore.getState().canEdit() ? '' : 'ro'} key={useThemeName() + '·' + dv}><PullToRefresh>{children}</PullToRefresh></div>
    </main>
    <nav className="tabbar" aria-label="Quick tabs">{tabs.map(v => <NavLink key={v.path} to={v.path} className={({ isActive }) => (isActive ? 'active' : '')}><Icon n={v.icon} /><span>{v.tab}</span></NavLink>)}<button onClick={() => setDrawer(true)}><Icon n="menu" /><span>Menu</span></button></nav>
    <Toasts />
  </div>
}
export type ThemeMode = 'light' | 'dark' | 'system'
const sysTheme = () => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
export const themeMode = (): ThemeMode => { try { const v = localStorage.getItem(LS('theme')); return v === 'light' || v === 'dark' || v === 'system' ? v : 'system' } catch { return 'system' } }
// Charts bake the theme's colours into their data when a page renders, so a theme change re-mounts the page (key below) and every chart redraws in the new colours.
const themeSubs = new Set<() => void>()
export const useThemeName = () => useSyncExternalStore(cb => { themeSubs.add(cb); return () => { themeSubs.delete(cb) } }, () => document.documentElement.dataset.theme || 'light')
export function setThemeMode(m: ThemeMode) {
  try { localStorage.setItem(LS('theme'), m) } catch { /* */ }
  const t = m === 'system' ? sysTheme() : m
  const changed = document.documentElement.dataset.theme !== t
  document.documentElement.dataset.theme = t
  if (changed) themeSubs.forEach(cb => cb())
  // phones paint the status bar / address bar from theme-color, so keep it in step with the theme (white rail in light, near-black in dark)
  try { const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', t === 'dark' ? '#0b0d10' : '#ffffff') } catch { /* */ }
}
/** Light / dark / system (follows the OS). Persisted in localStorage; "system" re-applies live when the OS switches. */
export function ThemeBtn() {
  const [m, setM] = useState<ThemeMode>(themeMode)
  const cycle = () => { const n: ThemeMode = m === 'system' ? 'dark' : m === 'dark' ? 'light' : 'system'; setThemeMode(n); setM(n) }   // system → dark → light → system
  const label = m === 'system' ? `System (${sysTheme()})` : m === 'dark' ? 'Dark' : 'Light'
  return <button className="btn" onClick={cycle} title={`Theme: ${label} — click to change`} aria-label={`Theme: ${label}`} style={{ padding: '6px 10px' }}>{m === 'system' ? '◐' : m === 'dark' ? '☀︎' : '☾'}</button>
}
export function applySavedTheme() { setThemeMode(themeMode()); try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (themeMode() === 'system') setThemeMode('system') }) } catch { /* */ } }

/** Deployment environment from where the app is served: localhost → development, *.github.io or a custom domain → production, anything else (preview URLs) → staging. */
export const envName = (): 'development' | 'staging' | 'production' => { const h = location.hostname; if (!h || h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local')) return 'development'; if (/github\.io$|wealthpilot/.test(h)) return 'production'; return 'staging' }
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
