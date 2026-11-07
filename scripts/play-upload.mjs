// Uploads an Android App Bundle to Google Play (0.25.1) through Google's Android Publisher API — no third-party action holds the key.
// Used by .github/workflows/release-apps.yml; it can also be run by hand:
//   PLAY_SERVICE_ACCOUNT_JSON="$(cat key.json)" node scripts/play-upload.mjs --aab app-release.aab --track internal [--status draft]
//     [--notes store/listing/release-notes.txt]
// --track   internal (internal testing) | alpha (closed testing) | beta (open testing) | production
// --status  draft (default): the release waits in Play Console for you to review and roll out — the only status Google accepts until
//           the app has passed its first review. completed: rolls out to that track at once.
// The app must already exist in Play Console, and its very first bundle has to be uploaded there by hand (Google's rule); after that
// this script can do every upload. The service account needs "Release apps to testing tracks" (and production, if used) for this app.
import { readFileSync } from 'node:fs'
import { createSign } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export const PACKAGE = 'io.github.garynth41.wealthpilot'
export const TRACKS = ['internal', 'alpha', 'beta', 'production']
const API = 'https://androidpublisher.googleapis.com'
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher'

/** A signed JWT asking Google for an access token as the service account (RFC 7523, RS256). */
export function signJwt(serviceAccount, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!serviceAccount?.client_email || !serviceAccount?.private_key) throw new Error('The service account JSON needs client_email and private_key')
  const b64u = s => Buffer.from(s).toString('base64url')
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = b64u(JSON.stringify({ iss: serviceAccount.client_email, scope: SCOPE, aud: serviceAccount.token_uri || 'https://oauth2.googleapis.com/token', iat: nowSeconds, exp: nowSeconds + 3600 }))
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(serviceAccount.private_key, 'base64url')
  return `${head}.${body}.${sig}`
}

async function call(fetchImpl, url, init, what) {
  const r = await fetchImpl(url, init)
  const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : {} } catch { /* not JSON */ }
  if (!r.ok) throw new Error(`${what} failed (${r.status}): ${j?.error?.message || text.slice(0, 300)}`)
  return j || {}
}

/** Token → edit → bundle → track release → commit. On any failure after the edit opens, the edit is thrown away. */
export async function uploadBundle({ serviceAccount, bundle, track, status = 'draft', notes = '', packageName = PACKAGE, fetchImpl = fetch, log = () => {} }) {
  if (!TRACKS.includes(track)) throw new Error(`Unknown track "${track}" — use ${TRACKS.join(', ')}`)
  if (!['draft', 'completed'].includes(status)) throw new Error('status must be draft or completed')
  if (!bundle?.length) throw new Error('The bundle file is empty')
  if (notes.length > 500) throw new Error(`Release notes are ${notes.length} characters; Google Play allows 500`)
  const tok = await call(fetchImpl, serviceAccount.token_uri || 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(serviceAccount) }).toString() }, 'Signing in as the service account')
  const auth = { Authorization: `Bearer ${tok.access_token}` }
  const app = `${API}/androidpublisher/v3/applications/${encodeURIComponent(packageName)}`
  const edit = await call(fetchImpl, `${app}/edits`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}' }, 'Opening an edit')
  log(`edit ${edit.id} opened`)
  try {
    const up = await call(fetchImpl, `${API}/upload/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/edits/${edit.id}/bundles?uploadType=media`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: bundle, signal: AbortSignal.timeout(15 * 60 * 1000) }, 'Uploading the bundle')
    log(`bundle uploaded: version code ${up.versionCode}`)
    const release = { versionCodes: [String(up.versionCode)], status, ...(notes.trim() ? { releaseNotes: [{ language: 'en-US', text: notes.trim() }] } : {}) }
    await call(fetchImpl, `${app}/edits/${edit.id}/tracks/${track}`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ track, releases: [release] }) }, `Adding it to the ${track} track`)
    await call(fetchImpl, `${app}/edits/${edit.id}:commit`, { method: 'POST', headers: auth }, 'Saving the release')
    log(`committed: ${track} · ${status}`)
    return { versionCode: up.versionCode, track, status }
  } catch (e) {
    try { await fetchImpl(`${app}/edits/${edit.id}`, { method: 'DELETE', headers: auth }) } catch { /* the edit expires by itself */ }
    throw e
  }
}

const arg = (name, fallback = '') => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raw = process.env.PLAY_SERVICE_ACCOUNT_JSON
  if (!raw) { console.error('PLAY_SERVICE_ACCOUNT_JSON is not set'); process.exit(2) }
  const notesFile = arg('notes')
  uploadBundle({ serviceAccount: JSON.parse(raw), bundle: readFileSync(arg('aab')), track: arg('track', 'internal'), status: arg('status', 'draft'), notes: notesFile ? readFileSync(notesFile, 'utf8') : '', log: m => console.log(m) })
    .then(r => console.log(`Google Play: version ${r.versionCode} is on the ${r.track} track (${r.status}).`))
    .catch(e => { console.error(e.message); process.exit(1) })
}
