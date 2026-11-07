// @vitest-environment node
// 0.25.1 — the app-store release tools: the store listing text fits each store's limits and rules, and the Google Play upload script
// signs in and walks Google's edit → upload → track → commit steps correctly (against a fake Google, so no account is needed).
import { describe, it, expect } from 'vitest'
import { signJwt, uploadBundle, PACKAGE } from '../../scripts/play-upload.mjs'

const LISTING = import.meta.glob<string>('../../store/listing/**/*.txt', { query: '?raw', import: 'default', eager: true })
const text = (p: string) => { const k = Object.keys(LISTING).find(x => x.endsWith(`store/listing/${p}`)); if (!k) throw new Error(`missing store/listing/${p}`); return LISTING[k] }

describe('store listing text', () => {
  // App Store Connect and Play Console limits, in characters
  const LIMITS: Array<[string, number]> = [
    ['apple/name.txt', 30], ['apple/subtitle.txt', 30], ['apple/promotional_text.txt', 170], ['apple/description.txt', 4000], ['apple/keywords.txt', 100], ['apple/release_notes.txt', 4000],
    ['google/title.txt', 30], ['google/short_description.txt', 80], ['google/full_description.txt', 4000], ['google/release_notes.txt', 500],
  ]
  it.each(LIMITS)('%s fits in %i characters', (file, max) => { const t = text(file).trim(); expect(t.length).toBeGreaterThan(0); expect([...t].length).toBeLessThanOrEqual(max) })
  it('App Store text never names the other store or platform (guideline 2.3.10), and Play text never names Apple\'s', () => {
    for (const f of Object.keys(LISTING).filter(k => k.includes('/apple/'))) expect(LISTING[f], f).not.toMatch(/android|google play/i)
    for (const f of Object.keys(LISTING).filter(k => k.includes('/google/'))) expect(LISTING[f], f).not.toMatch(/iphone|ipad|app store|face id|touch id|apple/i)
  })
  it('keywords are comma-separated without repeating the app name (Apple already indexes it)', () => {
    const kw = text('apple/keywords.txt').trim().split(',')
    expect(kw.every(k => k.trim() === k && k.length > 1)).toBe(true)
    expect(kw.some(k => /wealthpilot/i.test(k))).toBe(false)
    expect(new Set(kw).size).toBe(kw.length)
  })
  it('the Play title starts with the app name used everywhere else', () => { expect(text('google/title.txt').startsWith(text('apple/name.txt').trim())).toBe(true) })
})

async function testKey() {
  const k = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', k.privateKey))
  const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n')
  return { pem: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`, publicKey: k.publicKey }
}
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0))
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('Google Play upload script', () => {
  it('signs a one-hour token request as the service account (RS256)', async () => {
    const { pem, publicKey } = await testKey()
    const jwt = signJwt({ client_email: 'ci@proj.iam.gserviceaccount.com', private_key: pem }, 1_800_000_000)
    const [h, b, s] = jwt.split('.')
    expect(JSON.parse(new TextDecoder().decode(unb64u(h)))).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(JSON.parse(new TextDecoder().decode(unb64u(b)))).toEqual({ iss: 'ci@proj.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat: 1_800_000_000, exp: 1_800_003_600 })
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, unb64u(s), new TextEncoder().encode(`${h}.${b}`))).toBe(true)
    expect(() => signJwt({ client_email: '', private_key: pem })).toThrow(/client_email/)
  })

  it('opens an edit, uploads the bundle, puts it on the track as a draft with notes, and commits', async () => {
    const { pem } = await testKey(); const calls: Array<{ url: string; method: string; auth?: string; type?: string; body?: unknown }> = []
    const fake = async (url: string, init: RequestInit = {}) => {
      const h = (init.headers || {}) as Record<string, string>
      calls.push({ url, method: init.method || 'GET', auth: h.Authorization, type: h['Content-Type'], body: init.body })
      if (url === 'https://oauth2.googleapis.com/token') return json(200, { access_token: 'TOKEN', expires_in: 3599 })
      if (url.endsWith('/edits') && init.method === 'POST') return json(200, { id: 'E1', expiryTimeSeconds: '9' })
      if (url.includes('/upload/') && url.endsWith('/edits/E1/bundles?uploadType=media')) return json(200, { versionCode: 250100, sha256: 'x' })
      if (url.endsWith('/edits/E1/tracks/internal') && init.method === 'PUT') return json(200, {})
      if (url.endsWith('/edits/E1:commit')) return json(200, { id: 'E1' })
      return json(404, { error: { message: 'unexpected ' + url } })
    }
    const r = await uploadBundle({ serviceAccount: { client_email: 'ci@p.iam.gserviceaccount.com', private_key: pem }, bundle: new Uint8Array([80, 75, 3, 4]), track: 'internal', notes: ' First release. ', fetchImpl: fake })
    expect(r).toEqual({ versionCode: 250100, track: 'internal', status: 'draft' })
    const app = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`
    expect(calls.map(c => `${c.method} ${c.url}`)).toEqual([
      'POST https://oauth2.googleapis.com/token', `POST ${app}/edits`,
      `POST https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}/edits/E1/bundles?uploadType=media`,
      `PUT ${app}/edits/E1/tracks/internal`, `POST ${app}/edits/E1:commit`,
    ])
    expect(new URLSearchParams(String(calls[0].body)).get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
    expect(calls.slice(1).every(c => c.auth === 'Bearer TOKEN')).toBe(true)
    expect(calls[2].type).toBe('application/octet-stream')
    expect(JSON.parse(String(calls[3].body))).toEqual({ track: 'internal', releases: [{ versionCodes: ['250100'], status: 'draft', releaseNotes: [{ language: 'en-US', text: 'First release.' }] }] })
  })

  it('throws the edit away when a step fails, and says which step', async () => {
    const { pem } = await testKey(); const seen: string[] = []
    const fake = async (url: string, init: RequestInit = {}) => {
      seen.push(`${init.method} ${url.replace(/^https:\/\/[^/]+/, '')}`)
      if (url.endsWith('/token')) return json(200, { access_token: 'T' })
      if (url.endsWith('/edits')) return json(200, { id: 'E9' })
      if (url.includes('/bundles')) return json(200, { versionCode: 250101 })
      if (url.includes('/tracks/')) return json(403, { error: { message: 'The caller does not have permission' } })
      return json(200, {})
    }
    await expect(uploadBundle({ serviceAccount: { client_email: 'a@b', private_key: pem }, bundle: new Uint8Array([1]), track: 'alpha', fetchImpl: fake })).rejects.toThrow(/Adding it to the alpha track failed \(403\): The caller does not have permission/)
    expect(seen.at(-1)).toBe(`DELETE /androidpublisher/v3/applications/${PACKAGE}/edits/E9`)
    expect(seen.some(s => s.includes(':commit'))).toBe(false)
  })

  it('refuses bad input before contacting Google', async () => {
    let called = 0; const fake = async () => { called++; return json(200, {}) }
    const sa = { client_email: 'a@b', private_key: 'x' }
    await expect(uploadBundle({ serviceAccount: sa, bundle: new Uint8Array([1]), track: 'prod', fetchImpl: fake })).rejects.toThrow(/Unknown track/)
    await expect(uploadBundle({ serviceAccount: sa, bundle: new Uint8Array([1]), track: 'internal', status: 'live' as 'draft', fetchImpl: fake })).rejects.toThrow(/draft or completed/)
    await expect(uploadBundle({ serviceAccount: sa, bundle: new Uint8Array([]), track: 'internal', fetchImpl: fake })).rejects.toThrow(/empty/)
    await expect(uploadBundle({ serviceAccount: sa, bundle: new Uint8Array([1]), track: 'internal', notes: 'x'.repeat(501), fetchImpl: fake })).rejects.toThrow(/500/)
    expect(called).toBe(0)
  })
})
