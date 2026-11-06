import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { installErrorCapture } from './lib/errors'
import { RootBoundary } from './components/RootBoundary'
import { reloadForNewVersion } from './lib/chunks'
installErrorCapture()
// Vite fires this when a page's code or CSS cannot be preloaded — after a deploy, the old file names are gone. Reload once to the new version.
window.addEventListener('vite:preloadError', e => { if (reloadForNewVersion()) e.preventDefault() })
createRoot(document.getElementById('root')!).render(<StrictMode><RootBoundary><App /></RootBoundary></StrictMode>)

// Installable app + offline shell (production builds only; the dev server never registers it)
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol === 'https:') window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* optional */ }) })
