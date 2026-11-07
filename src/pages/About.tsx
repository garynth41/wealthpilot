// About this app (0.25.1) — Settings → General. The version, and the pages both app stores require to be reachable from inside the app:
// the privacy policy, the terms, support and how to delete an account. They live on the website (public/*.html), so the same page is
// linked from the stores, the website and the apps; inside the apps the links open in the system browser.
import { Card, Note } from '../components/ui'
import { APP_NAME, APP_VERSION, APP_BUILD } from '../app/config'
import { publicUrl, isNative, platform } from '../app/native'

export const LEGAL_PAGES: ReadonlyArray<readonly [file: string, label: string]> = [['privacy.html', 'Privacy policy'], ['terms.html', 'Terms of use'], ['support.html', 'Support'], ['delete-account.html', 'Deleting your account']]

/** The policy links, as a row of plain links (sign-in screen, About card). */
export function LegalLinks({ short }: { short?: boolean }) {
  const pages = short ? LEGAL_PAGES.slice(0, 3) : LEGAL_PAGES
  // inline layout: a plain row of links, each at least 44px tall so it is easy to tap
  return <nav className="legal" aria-label="Privacy, terms and support" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: short ? 'center' : 'flex-start', columnGap: 16, marginTop: 6 }}>
    {pages.map(([f, l]) => <a key={f} href={publicUrl(f)} target="_blank" rel="noopener noreferrer" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>{short ? l.replace(' policy', '').replace(' of use', '') : l}</a>)}
  </nav>
}

export function AboutCard() {
  const where = isNative() ? (platform() === 'ios' ? 'iPhone app' : 'Android app') : 'website'
  return <Card span={12} title="About this app" hint="version, privacy, terms and support">
    <Note>{APP_NAME} {APP_VERSION} · build {APP_BUILD} · {where}. No ads and no tracking; your information is used only to run the app for your household and is never sold.</Note>
    <LegalLinks />
  </Card>
}
