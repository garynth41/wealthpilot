import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { installErrorCapture } from './lib/errors'
import { RootBoundary } from './components/RootBoundary'
installErrorCapture()
createRoot(document.getElementById('root')!).render(<StrictMode><RootBoundary><App /></RootBoundary></StrictMode>)

// Installable app + offline shell (production builds only; the dev server never registers it)
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol === 'https:') window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* optional */ }) })
