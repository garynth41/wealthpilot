import { StrictMode } from 'react'
import { isNative } from './app/native'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { installErrorCapture } from './lib/errors'
import { RootBoundary } from './components/RootBoundary'
import { reloadForNewVersion } from './lib/chunks'
import { initDisplay } from './lib/display'
installErrorCapture(); initDisplay()
// Vite fires this when a page's code or CSS cannot be preloaded — after a deploy, the old file names are gone. Reload once to the new version.
window.addEventListener('vite:preloadError', e => { if (reloadForNewVersion()) e.preventDefault() })
createRoot(document.getElementById('root')!).render(<StrictMode><RootBoundary><App /></RootBoundary></StrictMode>)

// Installable app + offline shell (production builds only; the dev server never registers it)
// never inside the phone apps (0.25.1): they ship the app inside themselves, and the stores deliver updates
if (import.meta.env.PROD && !isNative() && 'serviceWorker' in navigator && location.protocol === 'https:') window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* optional */ }) })
