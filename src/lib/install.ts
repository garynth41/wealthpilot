// Installing the web app (0.29.0) — until Cresari is in the App Store and Google Play, testers add it to their home screen or desktop from
// the browser. It then opens in its own window with its own icon, works offline, and (on iPhone, only once installed) can send alerts.
// Chrome, Edge and Samsung Internet offer a real install prompt (beforeinstallprompt), caught here as early as possible; Safari and the
// iPhone browsers are installed by hand, so howToInstall() gives the steps for the browser in use.

interface BIPEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferred: BIPEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(f => f())
/** Call once at start-up (main.tsx): the browser fires its install offer only once per page load. */
export function catchInstallPrompt() {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e as BIPEvent; notify() })
  window.addEventListener('appinstalled', () => { deferred = null; notify() })
}
export const onInstallChange = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f) } }
export const canPromptInstall = () => !!deferred
/** Show the browser's own install window. Resolves true when the person installs. */
export async function promptInstall(): Promise<boolean> {
  const d = deferred; if (!d) return false
  await d.prompt(); const { outcome } = await d.userChoice; deferred = null; notify(); return outcome === 'accepted'
}
/** Already running from the home screen or as a desktop app? */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false
  try { if (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: minimal-ui)').matches) return true } catch { /* old browser */ }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export interface InstallHow { device: string; steps: string[]; note?: string }
/** The steps for the device and browser this is running in. */
export function howToInstall(ua: string, touchPoints = 0): InstallHow {
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)
  if (/iPhone|iPod/.test(ua) || ipad) {
    const d = ipad ? 'iPad' : 'iPhone'
    if (/CriOS|FxiOS|EdgiOS/.test(ua)) return { device: d, steps: ['Tap the Share button (the square with an arrow) in the address bar or the menu.', 'Scroll down and tap Add to Home Screen.', 'Tap Add. Open Cresari from its new icon.'], note: 'If you do not see Add to Home Screen, open this page in Safari and follow the steps there.' }
    return { device: d, steps: ['Tap the Share button (the square with an arrow) at the bottom of Safari — on iPad it is at the top.', 'Scroll down and tap Add to Home Screen.', 'Keep "Open as Web App" on if you see it, then tap Add.', 'Open Cresari from its new icon on your home screen.'], note: 'Alerts on iPhone work only from the home-screen app, not from a Safari tab.' }
  }
  if (/Android/.test(ua)) {
    if (/SamsungBrowser/.test(ua)) return { device: 'Android', steps: ['Tap the menu (☰) at the bottom right.', 'Tap Add page to, then Home screen (or Install app if offered).', 'Open Cresari from its new icon.'] }
    if (/Firefox/.test(ua)) return { device: 'Android', steps: ['Tap the menu (⋮).', 'Tap Install or Add to Home screen.', 'Open Cresari from its new icon.'] }
    return { device: 'Android', steps: ['In Chrome, tap the menu (⋮), then Add to Home screen → Install (some phones say Install app).', 'Open Cresari from its new icon, like any other app.'] }
  }
  if (/Edg\//.test(ua)) return { device: 'computer', steps: ['Click the app icon at the right of the address bar — or the menu (…) → Apps → Install this site as an app.', 'Cresari opens in its own window; pin it to the taskbar or Dock.'] }
  if (/Chrome\//.test(ua) && !/OPR\//.test(ua)) return { device: 'computer', steps: ['Click the install icon at the right end of the address bar — or the menu (⋮) → Cast, save, and share → Install page as app.', 'Cresari opens in its own window; pin it to the taskbar or Dock.'] }
  if (/Safari\//.test(ua) && /Macintosh/.test(ua)) return { device: 'Mac', steps: ['In Safari, choose File → Add to Dock (macOS Sonoma or later).', 'Click Add. Cresari opens from the Dock in its own window.'] }
  return { device: 'computer', steps: ['Bookmark this page — or open it in Chrome or Edge, which can install it as an app with its own window.'], note: 'Firefox on a computer cannot install web apps; the page still works in a normal tab.' }
}
