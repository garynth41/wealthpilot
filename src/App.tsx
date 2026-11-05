import { lazy, Suspense, useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './app/store'
import { ModalHost } from './components/ui'
import { Layout, applySavedTheme } from './components/Layout'
import { AuthPage, Onboarding, FirstSignIn, ResetPassword } from './pages/Auth'
import { olPopupRelay } from './lib/email/mail'
// Every page is its own chunk (0.19.0): the shell loads first, a page's code arrives when it is first opened. Plotly and xlsx were already lazy.
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })))
const BudgetPage = lazy(() => import('./pages/Budget').then(m => ({ default: m.BudgetPage })))
const TransactionsPage = lazy(() => import('./pages/Transactions').then(m => ({ default: m.TransactionsPage })))
const BillsPage = lazy(() => import('./pages/Bills').then(m => ({ default: m.BillsPage })))
const IncomePage = lazy(() => import('./pages/Income').then(m => ({ default: m.IncomePage })))
const AccountsPage = lazy(() => import('./pages/Accounts').then(m => ({ default: m.AccountsPage })))
const DebtsPage = lazy(() => import('./pages/Debts').then(m => ({ default: m.DebtsPage })))
const GoalsPage = lazy(() => import('./pages/Goals').then(m => ({ default: m.GoalsPage })))
const ForecastPage = lazy(() => import('./pages/Forecast').then(m => ({ default: m.ForecastPage })))
const TrendsPage = lazy(() => import('./pages/Trends').then(m => ({ default: m.TrendsPage })))
const HardshipPage = lazy(() => import('./pages/Hardship').then(m => ({ default: m.HardshipPage })))
const EmailPage = lazy(() => import('./pages/Email').then(m => ({ default: m.EmailPage })))
const SettingsPage = lazy(() => import('./pages/Settings').then(m => ({ default: m.SettingsPage })))
const InsightsPage = lazy(() => import('./pages/Insights').then(m => ({ default: m.InsightsPage })))
const TaxPage = lazy(() => import('./pages/Tax').then(m => ({ default: m.TaxPage })))
const ReportsPage = lazy(() => import('./pages/Reports').then(m => ({ default: m.ReportsPage })))
const ConnectionsPage = lazy(() => import('./pages/Connections').then(m => ({ default: m.ConnectionsPage })))
const ReconcilePage = lazy(() => import('./pages/Reconcile').then(m => ({ default: m.ReconcilePage })))
const InvestmentsPage = lazy(() => import('./pages/Investments').then(m => ({ default: m.InvestmentsPage })))

applySavedTheme()
if (olPopupRelay()) { /* this window was the Microsoft sign-in popup; it has posted the code back and is closing */ }

export default function App() {
  const { booting, boot, mode, household, user, loadError, mustChangePassword, recovering } = useStore()
  useEffect(() => { boot() }, [boot])
  if (booting) return <div className="auth"><div className="note">Loading…</div></div>
  if (recovering) return <ResetPassword />
  if (user && mustChangePassword()) return <FirstSignIn />
  if (!mode) { if (user) return <Onboarding />; return <AuthPage /> }
  if (!household) return <div className="auth"><div className="box">{loadError ? <div className="msg crit">{loadError}</div> : <div className="note">Opening your household…</div>}</div></div>
  return <HashRouter><ModalHost><Layout><Suspense fallback={<div className="empty" aria-live="polite">Loading…</div>}><Routes>
    <Route path="/" element={<Dashboard />} /><Route path="/forecast" element={<ForecastPage />} /><Route path="/budget" element={<BudgetPage />} /><Route path="/transactions" element={<TransactionsPage />} /><Route path="/bills" element={<BillsPage />} /><Route path="/income" element={<IncomePage />} />
    <Route path="/reconcile" element={<ReconcilePage />} /><Route path="/accounts" element={<AccountsPage />} /><Route path="/debts" element={<DebtsPage />} /><Route path="/goals" element={<GoalsPage />} /><Route path="/trends" element={<TrendsPage />} /><Route path="/insights" element={<InsightsPage />} /><Route path="/tax" element={<TaxPage />} /><Route path="/reports" element={<ReportsPage />} /><Route path="/connections" element={<ConnectionsPage />} /><Route path="/investments" element={<InvestmentsPage />} /><Route path="/hardship" element={<HardshipPage />} /><Route path="/email" element={<EmailPage />} /><Route path="/settings" element={<SettingsPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense></Layout></ModalHost></HashRouter>
}
