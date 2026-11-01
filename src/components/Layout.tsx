import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useStore, outdated } from '../app/store'
import { APP_NAME, APP_VERSION, APP_BUILD, LS } from '../app/config'
import { fmtDY, today, addDays } from '../lib/dates'
import { upcoming } from '../lib/recurring'
import { isOpenItem } from '../lib/email/apply'
import { Toasts, useModal, MHead, MBody, Btn } from './ui'

export interface View { path: string; title: string; sub: string; zone: string; icon: string; tab?: string }
export const VIEWS: View[] = [
  { path: '/', title: 'Dashboard', sub: 'Where you stand today — cash, this period, what is due, net worth', zone: 'Overview', icon: 'home', tab: 'Home' },
  { path: '/forecast', title: 'Cash Flow Forecast', sub: 'Day-by-day calendar and 24-month runway', zone: 'Overview', icon: 'forecast' },
  { path: '/budget', title: 'Budget', sub: 'Plan vs actual for the period — by month, pay period, week or twice a month', zone: 'Money in & out', icon: 'budget', tab: 'Budget' },
  { path: '/transactions', title: 'Transactions', sub: 'Every dollar in and out — log, categorize, search', zone: 'Money in & out', icon: 'list', tab: 'Ledger' },
  { path: '/bills', title: 'Bills & Subscriptions', sub: 'Recurring bills, subscriptions, autopays and what is coming up', zone: 'Money in & out', icon: 'bills', tab: 'Bills' },
  { path: '/income', title: 'Income & Pay Periods', sub: 'Every income source, its pay schedule and the paychecks ahead', zone: 'Money in & out', icon: 'income' },
  { path: '/accounts', title: 'Accounts', sub: 'Checking, savings, investments, cards and loans — balances and statements', zone: 'Accounts & debt', icon: 'bank' },
  { path: '/debts', title: 'Debt Payoff', sub: 'Avalanche or snowball, utilization, interest cost and payoff dates', zone: 'Accounts & debt', icon: 'card' },
  { path: '/goals', title: 'Savings Goals', sub: 'Emergency fund, sinking funds, purchases — progress and pace', zone: 'Accounts & debt', icon: 'goal' },
  { path: '/trends', title: 'Trends & Analysis', sub: 'Week / month / year spending, categories, net worth', zone: 'Planning', icon: 'trend' },
  { path: '/hardship', title: 'Hardship & Creditor Outreach', sub: 'Call every lender and provider before a payment is missed', zone: 'Planning', icon: 'phone' },
  { path: '/email', title: 'Email Money Capture', sub: 'Bills, statements, payments and deposits read from Gmail and Outlook — you approve, the app files', zone: 'Planning', icon: 'mail' },
  { path: '/settings', title: 'Settings', sub: 'Household, categories, budget cadence, members, email setup, backup', zone: 'Administration', icon: 'gear' },
]
const ICON: Record<string, string> = { home: 'M3 11 12 4l9 7v9H3z', forecast: 'M3 17l5-6 4 3 5-7 4 4M3 21h18', budget: 'M4 6h16v12H4zM4 10h16M9 14h3', list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', bills: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6', income: 'M12 3v18M7 8h7a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h8', bank: 'M3 10 12 4l9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18', card: 'M3 7h18v10H3zM3 11h18', goal: 'M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 12l9-9', trend: 'M4 19V5M4 19h16M8 15l4-5 3 3 5-7', phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2', mail: 'M3 6h18v12H3zM3 7l9 6 9-6', gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.3 2.6a7 7 0 0 0-1.7 1l-2.4-1-2 3.5L5.1 11a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 1.7 1l.3 2.6h5l.3-2.6a7 7 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5c.1-.3.1-.7.1-1z', menu: 'M4 7h16M4 12h16M4 17h16' }
export const Icon = ({ n }: { n: string }) => <svg viewBox="0 0 24 24"><path d={ICON[n] || ICON.home} /></svg>

export function useBadges() {
  const data = useStore(s => s.data)
  return useMemo(() => { const t = today(); const up = upcoming(data, addDays(t, -30), addDays(t, 7)).filter(u => ['overdue', 'due_today', 'due_soon'].includes(u.status)); const em = data.emailItems.filter(x => isOpenItem(x) && ['pastdue', 'declined'].includes(x.kind)).length + data.emailItems.filter(x => x.kind === 'alert' && x.status === 'Alert').length
    const hs = data.hardship.filter(h => !['Closed', 'Not needed', 'Declined', 'Enrolled'].includes(h.status) && ((h.next_followup && h.next_followup <= t) || (h.status === 'To call' && !h.next_followup))).length
    return { '/bills': { n: up.length, why: `${up.length} bill${up.length === 1 ? '' : 's'} overdue or due within 7 days` }, '/email': { n: em, why: `${em} past-due, declined or bank alert` }, '/hardship': { n: hs, why: `${hs} creditor call${hs === 1 ? '' : 's'} due` } } as Record<string, { n: number; why: string }> }, [data])
}
export function Layout({ children }: { children: ReactNode }) {
  const loc = useLocation(), nav = useNavigate(); const { household, mode, user, signOut, exitDemo, resetDemo, role, readOnly } = useStore()
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(LS('rail')) === 'collapsed' } catch { return false } })
  const [drawer, setDrawer] = useState(false); const badges = useBadges(); const { open } = useModal()
  const view = VIEWS.find(v => v.path === loc.pathname) || VIEWS[0]
  useEffect(() => { document.title = `${view.title} · ${APP_NAME}`; setDrawer(false); window.scrollTo(0, 0) }, [loc.pathname, view.title])
  useEffect(() => { try { localStorage.setItem(LS('rail'), collapsed ? 'collapsed' : 'open') } catch { /* */ } }, [collapsed])
  const zones = [...new Set(VIEWS.map(v => v.zone))]
  const about = () => open(<><MHead title={`About ${APP_NAME}`} /><MBody><p><b>{APP_NAME}</b> v{APP_VERSION} · build <code>{APP_BUILD}</code></p><p className="note">Personal budgeting, savings and financial planning. Data lives in your own Supabase project; email bodies are never stored — only amounts, dates, payees and the last four digits of an account.</p></MBody></>)
  const tabs = VIEWS.filter(v => v.tab)
  return <div className={`app ${collapsed ? 'rail-collapsed' : ''}`}>
    <header className="mbar"><button onClick={() => setDrawer(d => !d)} aria-label="Menu">☰</button><button onClick={() => nav(-1)} aria-label="Back" style={{ fontSize: 28 }}>‹</button><span className="mb-title">{view.title}</span><ThemeBtn /></header>
    <div className={`backdrop ${drawer ? 'show' : ''}`} onClick={() => setDrawer(false)} />
    <aside className={`rail ${drawer ? 'open' : ''}`}>
      <div className="brand"><span className="mark" onClick={() => collapsed && setCollapsed(false)}><svg viewBox="0 0 64 64"><path d="M16 40c6-10 10-10 16 0s10 10 16 0" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" /><circle cx="32" cy="22" r="6" fill="#fff" /></svg></span><div><b>{APP_NAME}</b><small>{mode === 'demo' ? 'Offline demo' : household?.name || 'Household'}</small></div><button className="railToggle" onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Expand menu' : 'Collapse menu'}>{collapsed ? '›' : '‹'}</button></div>
      <nav className="nav">{zones.map(z => <div key={z}><div className="zone">{z}</div>{VIEWS.filter(v => v.zone === z).map(v => <NavLink key={v.path} to={v.path} className={({ isActive }) => (isActive ? 'active' : '')} title={v.sub}><Icon n={v.icon} /><span className="t">{v.title}</span>{badges[v.path]?.n ? <span className="badge" title={badges[v.path].why}>{badges[v.path].n}</span> : null}</NavLink>)}</div>)}</nav>
      <div className="me"><span className="avatar">{(mode === 'demo' ? 'D' : (user?.email?.[0] || '?')).toUpperCase()}</span><span className="who"><b>{mode === 'demo' ? 'demo' : user?.email}</b><span>{role}{readOnly ? ' · read-only' : ''}</span></span><Btn sm onClick={() => (mode === 'demo' ? exitDemo() : signOut())}>Sign out</Btn></div>
      <div className="railfoot" onClick={about}>{APP_NAME} <b>v{APP_VERSION}</b><br />build {APP_BUILD}</div>
    </aside>
    <main className="main">
      <nav className="histnav"><button className="hn-btn" onClick={() => nav(-1)} title="Back"><span aria-hidden>←</span> Back</button><button className="hn-btn" onClick={() => nav(1)} title="Forward">Forward <span aria-hidden>→</span></button><span className="hn-crumb">{view.path !== '/' && <><NavLink to="/">Home</NavLink> › <span>{view.zone}</span> › </>}<b>{view.title}</b></span></nav>
      <div className="topbar"><div><h1>{view.title}</h1><div className="sub">{view.sub}</div></div><div className="asof"><span className="chip">As of <b>{fmtDY(today())}</b></span><ThemeBtn /></div></div>
      {outdated() && <div className="banner crit">This copy is <b>v{APP_VERSION}</b> but a newer release is registered — reload or redeploy to get it.</div>}
      {mode === 'demo' && <div className="banner">Offline demo — data is stored only in this browser. <Btn sm onClick={resetDemo}>Reset sample data</Btn><Btn sm onClick={exitDemo}>Sign in to a real household</Btn></div>}
      {mode === 'db' && !useStore.getState().canEdit() && <div className="banner info">You have <b>{role}{readOnly ? ' (read-only)' : ''}</b> access — everything is read-only.</div>}
      <div className={useStore.getState().canEdit() ? '' : 'ro'}>{children}</div>
    </main>
    <nav className="tabbar">{tabs.map(v => <NavLink key={v.path} to={v.path} className={({ isActive }) => (isActive ? 'active' : '')}><Icon n={v.icon} /><span>{v.tab}</span>{badges[v.path]?.n ? <span className="badge">{badges[v.path].n}</span> : null}</NavLink>)}<button onClick={() => setDrawer(true)}><Icon n="menu" /><span>Menu</span></button></nav>
    <Toasts />
  </div>
}
export function ThemeBtn() {
  const [t, setT] = useState(() => document.documentElement.dataset.theme || 'light')
  const toggle = () => { const n = t === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = n; try { localStorage.setItem(LS('theme'), n) } catch { /* */ } setT(n) }
  return <button className="btn" onClick={toggle} title="Toggle dark mode" aria-label="Toggle dark mode" style={{ padding: '6px 10px' }}>{t === 'dark' ? '☀︎' : '☾'}</button>
}
export function applySavedTheme() { try { const t = localStorage.getItem(LS('theme')) || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); document.documentElement.dataset.theme = t } catch { /* */ } }
