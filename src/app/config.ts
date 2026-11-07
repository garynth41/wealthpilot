export const APP_NAME = import.meta.env.VITE_APP_NAME || 'WealthPilot'
export const APP_VERSION = '0.25.1'
export const APP_BUILD = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : 'dev'
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || ''
/** The app's public website (0.25.1). Links that leave the app — sign-up confirmation, password reset, invitations, the privacy policy —
 *  must use it inside the phone apps, whose own address is capacitor://localhost (iOS) or https://localhost (Android). */
export const SITE_URL = String(import.meta.env.VITE_SITE_URL || 'https://garynth41.github.io/wealthpilot/').replace(/\/*$/, '/')
export const LS = (k: string) => `wealthpilot.${k}`
export const cmpVer = (a: string, b: string) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return 1; if ((x[i] || 0) < (y[i] || 0)) return -1 } return 0 }
