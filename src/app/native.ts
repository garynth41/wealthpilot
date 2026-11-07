// The phone apps (0.25.1). The same web build runs in a browser and inside the iOS / Android apps (Capacitor). Everything that has to
// behave differently inside an app goes through here, so pages never test the platform themselves:
//   • files: browsers download; the apps write the file and open the share sheet (Save to Files, Drive, Mail, AirDrop…)
//   • links to other sites open in the system browser, never inside the app
//   • the Android back button closes the top dialog first, walks back through the app's pages, then leaves the app from the dashboard
//   • status and navigation bar icons follow the light / dark theme
//   • Face ID / Touch ID / fingerprint can unlock the idle lock on the device
// Store links (STORE) are filled in once each listing exists; until then the update prompts simply say where to update.
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core'
import { SITE_URL } from './config'
import { closeTopDialog } from '../components/ui'

export const isNative = () => Capacitor.isNativePlatform()
export const platform = () => Capacitor.getPlatform() as 'ios' | 'android' | 'web'
/** Passkeys need the website's domain; an app would need a domain association, which it does not have — so only browsers offer them. */
export const passkeysAvailable = () => !isNative() && typeof window !== 'undefined' && 'PublicKeyCredential' in window
/** Web push (VAPID) only exists in browsers; the apps use on-device reminders instead. */
export const webPushAvailable = () => !isNative() && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
/** Gmail / Outlook sign-in refuses to run inside apps (Google and Microsoft block embedded sign-in), so email capture is set up on the website. */
export const emailCaptureAvailable = () => !isNative()
/** Printing to PDF is a browser feature; the apps offer Excel and CSV (and the website still prints). */
export const printAvailable = () => !isNative()

/** A page of the app's website: the page you are on in a browser (so a staging copy links to itself), the published site inside the apps.
 *  publicUrl() is the app itself; publicUrl('privacy.html') the privacy policy. */
export function publicUrl(path = '') { const base = isNative() ? SITE_URL : location.origin + location.pathname.replace(/[^/]*$/, ''); return base + path.replace(/^\/+/, '') }

export const STORE = {
  ios: '',       // e.g. https://apps.apple.com/app/id1234567890 once App Store Connect has created the app
  android: 'https://play.google.com/store/apps/details?id=io.github.garynth41.wealthpilot',
}
export const storeName = () => platform() === 'ios' ? 'the App Store' : 'Google Play'
export const storeUrl = () => platform() === 'ios' ? STORE.ios : platform() === 'android' ? STORE.android : ''

const toBase64 = (buf: ArrayBuffer) => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s) }
const safeName = (n: string) => n.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120) || 'wealthpilot-file'

/** Save a file the user asked for: a download in a browser, the share sheet in the apps. */
export async function saveFile(name: string, data: Blob | string | ArrayBuffer, mime = 'application/octet-stream'): Promise<void> {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime })
  if (!isNative()) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000); return
  }
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')])
  const path = `exports/${safeName(name)}`
  const { uri } = await Filesystem.writeFile({ path, data: toBase64(await blob.arrayBuffer()), directory: Directory.Cache, recursive: true })
  try { await Share.share({ title: name, files: [uri], dialogTitle: 'Save or send ' + name }) }
  catch (e) { if (!/cancel/i.test(String((e as Error)?.message || e))) throw e }   // closing the share sheet is not an error
}

/** Open a link to another site: a new tab in a browser, the system browser from the apps. */
export async function openExternal(url: string) {
  if (!isNative()) { window.open(url, '_blank', 'noopener,noreferrer'); return }
  const { Browser } = await import('@capacitor/browser'); await Browser.open({ url })
}

/** Face ID / Touch ID / fingerprint, when the device has it set up. */
export async function biometryAvailable(): Promise<{ ok: boolean; label: string }> {
  if (!isNative()) return { ok: false, label: '' }
  try {
    const { NativeBiometric, BiometryType } = await import('@capgo/capacitor-native-biometric')
    const r = await NativeBiometric.isAvailable({ useFallback: false })
    const label = r.biometryType === BiometryType.FACE_ID ? 'Face ID' : r.biometryType === BiometryType.TOUCH_ID ? 'Touch ID' : r.biometryType === BiometryType.FACE_AUTHENTICATION ? 'face unlock' : 'fingerprint'
    return { ok: !!r.isAvailable, label }
  } catch { return { ok: false, label: '' } }
}
export async function verifyBiometry(reason: string): Promise<boolean> {
  try { const { NativeBiometric } = await import('@capgo/capacitor-native-biometric'); await NativeBiometric.verifyIdentity({ reason, title: 'Unlock WealthPilot', subtitle: reason, negativeButtonText: 'Use password' }); return true }
  catch { return false }
}

/** Status / navigation bar icons that stay readable on the current theme. */
export function syncSystemBars(dark: boolean) {
  if (!isNative()) return
  SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => { /* older OS */ })
}

/** True when the app itself navigated to this page (react-router numbers its history entries in history.state.idx, 0 for the page the
 *  app opened on). A page opened straight from a notification, a home-screen shortcut or a link has nothing inside the app to go back to,
 *  and history.back() there would leave the app (a blank page in the Android app). */
export const hasAppHistory = (): boolean => { try { return ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0 } catch { return false } }

let started = false
/** Once, at start-up inside the apps. `back()` is the router's back, `home()` opens the dashboard; `atRoot()` says whether the dashboard is showing. */
export async function initNative(opts: { back: () => void; home: () => void; atRoot: () => boolean; onResume: () => void }) {
  if (!isNative() || started) return; started = true
  document.documentElement.classList.add('native', 'native-' + platform())
  const { App } = await import('@capacitor/app')
  // Back: the newest dialog, drawer or menu closes first; then the previous page; a page opened directly goes to the dashboard; the dashboard leaves the app
  App.addListener('backButton', () => { if (closeTopDialog()) return; if (opts.atRoot()) App.minimizeApp(); else if (hasAppHistory()) opts.back(); else opts.home() })
  App.addListener('resume', () => opts.onResume())
  // links to other sites leave the app; links inside the app (hash routes, relative) stay
  document.addEventListener('click', e => {
    const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null; if (!a) return
    const href = a.getAttribute('href') || ''; if (!/^(https?:|mailto:|tel:)/i.test(href)) return
    let u: URL; try { u = new URL(href, location.href) } catch { return }
    if (u.origin === location.origin) return
    e.preventDefault(); if (/^https?:/.test(u.protocol)) void openExternal(u.href); else location.href = u.href
  }, true)
  try { const { SplashScreen } = await import('@capacitor/splash-screen'); await SplashScreen.hide({ fadeOutDuration: 200 }) } catch { /* */ }
}

/** Haptic tap for completed actions (no-op in browsers). */
export async function tap() { if (!isNative()) return; try { const { Haptics, ImpactStyle } = await import('@capacitor/haptics'); await Haptics.impact({ style: ImpactStyle.Light }) } catch { /* */ } }
