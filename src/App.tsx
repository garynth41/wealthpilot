import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './app/store'
import { ModalHost } from './components/ui'
import { Layout, applySavedTheme } from './components/Layout'
import { AuthPage, Onboarding, FirstSignIn, ResetPassword } from './pages/Auth'
import { Dashboard } from './pages/Dashboard'
import { BudgetPage } from './pages/Budget'
import { TransactionsPage } from './pages/Transactions'
import { BillsPage } from './pages/Bills'
import { IncomePage } from './pages/Income'
import { AccountsPage } from './pages/Accounts'
import { DebtsPage } from './pages/Debts'
import { GoalsPage } from './pages/Goals'
import { ForecastPage } from './pages/Forecast'
import { TrendsPage } from './pages/Trends'
import { HardshipPage } from './pages/Hardship'
import { EmailPage } from './pages/Email'
import { SettingsPage } from './pages/Settings'
import { InsightsPage } from './pages/Insights'
import { TaxPage } from './pages/Tax'
import { ReportsPage } from './pages/Reports'
import { ConnectionsPage } from './pages/Connections'
import { InvestmentsPage } from './pages/Investments'
import { olPopupRelay } from './lib/email/mail'

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
  return <ModalHost><HashRouter><Layout><Routes>
    <Route path="/" element={<Dashboard />} /><Route path="/forecast" element={<ForecastPage />} /><Route path="/budget" element={<BudgetPage />} /><Route path="/transactions" element={<TransactionsPage />} /><Route path="/bills" element={<BillsPage />} /><Route path="/income" element={<IncomePage />} />
    <Route path="/accounts" element={<AccountsPage />} /><Route path="/debts" element={<DebtsPage />} /><Route path="/goals" element={<GoalsPage />} /><Route path="/trends" element={<TrendsPage />} /><Route path="/insights" element={<InsightsPage />} /><Route path="/tax" element={<TaxPage />} /><Route path="/reports" element={<ReportsPage />} /><Route path="/connections" element={<ConnectionsPage />} /><Route path="/investments" element={<InvestmentsPage />} /><Route path="/hardship" element={<HardshipPage />} /><Route path="/email" element={<EmailPage />} /><Route path="/settings" element={<SettingsPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Layout></HashRouter></ModalHost>
}
