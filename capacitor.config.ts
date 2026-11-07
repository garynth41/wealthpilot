// The iOS and Android apps (0.25.1): the same build as the website (`npm run build` → dist), bundled inside the app so it opens
// offline and is reviewed as one version. `npm run native:sync` builds and copies it into ios/ and android/. See docs/MOBILE.md.
// appId is permanent once the first build is uploaded to either store — change it before that, never after.
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'io.github.garynth41.wealthpilot',
  appName: 'WealthPilot',
  webDir: 'dist',
  backgroundColor: '#15181c',
  ios: { contentInset: 'never', backgroundColor: '#15181c', limitsNavigationsToAppBoundDomains: false },
  android: { backgroundColor: '#15181c', allowMixedContent: false, captureInput: true },
  plugins: {
    SplashScreen: { launchAutoHide: false, launchShowDuration: 3000, backgroundColor: '#15181c', showSpinner: false, androidScaleType: 'CENTER_CROP' },
    SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover' },
    LocalNotifications: { smallIcon: 'ic_stat_wealthpilot', iconColor: '#f97316' },
  },
}

export default config
