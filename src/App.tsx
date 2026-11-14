import { lazy, Suspense, useEffect, useState } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './app/store'
import { ModalHost } from './components/ui'
import { IdleLock } from './components/IdleLock'
import { Layout, applySavedTheme } from './components/Layout'
import { AuthPage, Onboarding, FirstSignIn, ResetPassword } from './pages/Auth'
import { olPopupRelay } from './lib/email/mail'
import { retryingImport } from './lib/chunks'
import { hideSplash } from './app/native'
// Every page is its own chunk (0.19.0): the shell loads first, a page's code arrives when it is first opened. Plotly and xlsx were already lazy.
// retryingImport (0.20.1): a page file missing after a deploy reloads the tab once to the new version instead of showing an error.
const Dashboard = lazy(retryingImport(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard }))))
const BudgetPage = lazy(retryingImport(() => import('./pages/Budget').then(m => ({ default: m.BudgetPage }))))
const TransactionsPage = lazy(retryingImport(() => import('./pages/Transactions').then(m => ({ default: m.TransactionsPage }))))
const BillsPage = lazy(retryingImport(() => import('./pages/Bills').then(m => ({ default: m.BillsPage }))))
const IncomePage = lazy(retryingImport(() => import('./pages/Income').then(m => ({ default: m.IncomePage }))))
const AccountsPage = lazy(retryingImport(() => import('./pages/Accounts').then(m => ({ default: m.AccountsPage }))))
const DebtsPage = lazy(retryingImport(() => import('./pages/Debts').then(m => ({ default: m.DebtsPage }))))
const GoalsPage = lazy(retryingImport(() => import('./pages/Goals').then(m => ({ default: m.GoalsPage }))))
const ForecastPage = lazy(retryingImport(() => import('./pages/Forecast').then(m => ({ default: m.ForecastPage }))))
const TrendsPage = lazy(retryingImport(() => import('./pages/Trends').then(m => ({ default: m.TrendsPage }))))
const HardshipPage = lazy(retryingImport(() => import('./pages/Hardship').then(m => ({ default: m.HardshipPage }))))
const EmailPage = lazy(retryingImport(() => import('./pages/Email').then(m => ({ default: m.EmailPage }))))
const SettingsPage = lazy(retryingImport(() => import('./pages/Settings').then(m => ({ default: m.SettingsPage }))))
const InsightsPage = lazy(retryingImport(() => import('./pages/Insights').then(m => ({ default: m.InsightsPage }))))
const TaxPage = lazy(retryingImport(() => import('./pages/Tax').then(m => ({ default: m.TaxPage }))))
const ReportsPage = lazy(retryingImport(() => import('./pages/Reports').then(m => ({ default: m.ReportsPage }))))
const ConnectionsPage = lazy(retryingImport(() => import('./pages/Connections').then(m => ({ default: m.ConnectionsPage }))))
const ReconcilePage = lazy(retryingImport(() => import('./pages/Reconcile').then(m => ({ default: m.ReconcilePage }))))
const PlanPage = lazy(retryingImport(() => import('./pages/Plan').then(m => ({ default: m.PlanPage }))))
const ProtectionPage = lazy(retryingImport(() => import('./pages/Protection').then(m => ({ default: m.ProtectionPage }))))
const HelpPage = lazy(retryingImport(() => import('./pages/Help').then(m => ({ default: m.HelpPage }))))
const InvestmentsPage = lazy(retryingImport(() => import('./pages/Investments').then(m => ({ default: m.InvestmentsPage }))))
const StartPage = lazy(retryingImport(() => import('./pages/Start').then(m => ({ default: m.StartPage }))))
const FeedbackInboxPage = lazy(retryingImport(() => import('./pages/FeedbackInbox').then(m => ({ default: m.FeedbackInboxPage }))))
const TryPage = lazy(retryingImport(() => import('./pages/Try').then(m => ({ default: m.TryPage }))))
/** The address after # — watched outside the router too, for the public Try page (0.29.0). */
function useHash() { const [h, setH] = useState(() => location.hash); useEffect(() => { const f = () => setH(location.hash); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f) }, []); return h }

applySavedTheme()
if (olPopupRelay()) { /* this window was the Microsoft sign-in popup; it has posted the code back and is closing */ }

export default function App() {
  const { booting, boot, mode, household, user, loadError, mustChangePassword, recovering } = useStore(); const hash = useHash()
  useEffect(() => { boot() }, [boot])
  useEffect(() => { if (!booting) void hideSplash() }, [booting])   // phone apps: off the launch screen as soon as any screen is ready (0.25.1)
  if (booting) return <div className="auth"><div className="note">Loading…</div></div>
  if (recovering) return <ResetPassword />
  // the public invitation page (0.29.0): open to everyone, signed in or not
  if (/^#\/try(\?|$)/.test(hash)) return <ModalHost><Suspense fallback={<div className="auth"><div className="note">Loading…</div></div>}><TryPage /></Suspense></ModalHost>
  if (user && mustChangePassword()) return <FirstSignIn />
  if (!mode) { if (user) return <Onboarding />; return <AuthPage /> }
  if (!household) return <div className="auth"><div className="box">{loadError ? <div className="msg crit">{loadError}</div> : <div className="note">Opening your household…</div>}</div></div>
  return <HashRouter><ModalHost><IdleLock><Layout><Suspense fallback={<div className="empty" aria-live="polite">Loading…</div>}><Routes>
    <Route path="/" element={<Dashboard />} /><Route path="/forecast" element={<ForecastPage />} /><Route path="/budget" element={<BudgetPage />} /><Route path="/transactions" element={<TransactionsPage />} /><Route path="/bills" element={<BillsPage />} /><Route path="/income" element={<IncomePage />} />
    <Route path="/reconcile" element={<ReconcilePage />} /><Route path="/accounts" element={<AccountsPage />} /><Route path="/debts" element={<DebtsPage />} /><Route path="/goals" element={<GoalsPage />} /><Route path="/plan" element={<PlanPage />} /><Route path="/protection" element={<ProtectionPage />} /><Route path="/trends" element={<TrendsPage />} /><Route path="/insights" element={<InsightsPage />} /><Route path="/tax" element={<TaxPage />} /><Route path="/reports" element={<ReportsPage />} /><Route path="/connections" element={<ConnectionsPage />} /><Route path="/investments" element={<InvestmentsPage />} /><Route path="/hardship" element={<HardshipPage />} /><Route path="/email" element={<EmailPage />} /><Route path="/settings" element={<SettingsPage />} />
    <Route path="/help" element={<HelpPage />} /><Route path="/start" element={<StartPage />} /><Route path="/feedback" element={<FeedbackInboxPage />} />
    <Route path="/try" element={null} />{/* the invitation page: App shows it in place of the app (useHash), so the catch-all must not send it to the Dashboard first */}
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense></Layout></IdleLock></ModalHost></HashRouter>
}
