// Cresari service worker: makes the app installable and lets it open offline.
// The app shell and every built file are stored when a release installs; index.html is network-first so a new release is picked up on the next load.
// Nothing from Supabase, Google or Microsoft is ever cached — financial data only comes from the live API.
const CACHE = 'cresari-v39'
// the shell is fetched past the browser's HTTP cache at install (0.29.2), so a new version never stores an older icon or page
const SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './icon-192.png', './icon-512.png']
// 0.39.4 — a release is stored whole before the one before it is let go. Installing used to store only the shell; the scripts and styles
// were stored as the page asked for them, into the cache of whichever release was in charge at that moment — and activating then deleted
// that cache. So right after every update the new cache held the new page and none of its files, and opening the app offline before the
// next online load showed nothing. Now install reads asset-manifest.json (written by the build: every file under assets/) and stores each
// one: a file an earlier release already holds under the same hashed name is copied across, the rest are fetched. If any of them cannot
// be stored — or the list itself cannot be read — install fails, the release in charge stays in charge with its cache untouched, and the
// browser tries again later.
async function storeRelease() {
  const c = await caches.open(CACHE)
  await c.addAll(SHELL.map(u => new Request(u, { cache: 'no-cache' })))
  let files = []
  // Only a plain "not found" means this build has no list (files are then stored as they are used, as before). A request that fails, any
  // other error, or an answer that is not a list fails the install — letting it through would store the shell alone and then delete the
  // release before it, which is the very gap this closes.
  const r = await fetch('./asset-manifest.json', { cache: 'no-cache' })
  if (r.status !== 404) {
    if (!r.ok) throw new Error('could not read asset-manifest.json (' + r.status + ')')
    const j = await r.json(); if (!Array.isArray(j)) throw new Error('asset-manifest.json is not a list')
    files = j.filter(u => typeof u === 'string' && /^\.\/assets\/[^?#]+$/.test(u))
  }
  const one = async u => {
    const url = new URL(u, self.location).href; if (await c.match(url)) return
    const held = await caches.match(url); if (held && held.ok) { await c.put(url, held); return }
    const r = await fetch(url); if (!r.ok) throw new Error('could not store ' + u + ' (' + r.status + ')'); await c.put(url, r) }
  for (let i = 0; i < files.length; i += 6) await Promise.all(files.slice(i, i + 6).map(one))   // six at a time: gentle on a phone connection
}
self.addEventListener('install', e => { e.waitUntil(storeRelease().then(() => self.skipWaiting())) })
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())) })
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return
  const url = new URL(req.url); if (url.origin !== self.location.origin) return            // Supabase, Google, Microsoft, fonts: straight to the network
  // the plain pages (privacy, terms, support, delete account — 0.25.1) always come live, and are never stored as the app's start page
  if (/\.html$/.test(url.pathname) && !url.pathname.endsWith('/index.html')) return
  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html')) {                // HTML: network first, cached copy when offline
    // cache:'no-cache' revalidates with GitHub Pages instead of trusting the browser's 10-minute HTTP cache, so a release is live on the very next load
    e.respondWith(fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return r }).catch(() => caches.match('./index.html')))
    return
  }
  if (url.pathname.includes('/assets/') || /\.(png|svg|webmanifest|woff2?)$/.test(url.pathname)) {   // hashed assets: cache first
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)) } return r })))
  }
})

// Web Push (0.19.0): the notify edge function sends { title, body, url, tag }; tapping the notification opens (or focuses) the app at that page
self.addEventListener('push', e => {
  let d = { title: 'Cresari', body: '', url: './', tag: 'cresari' }
  try { d = { ...d, ...e.data.json() } } catch { try { d.body = e.data.text() } catch { /* empty push */ } }
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, tag: d.tag, icon: './icon-192.png', badge: './icon-192.png', data: { url: d.url }, renotify: false }))
})
self.addEventListener('notificationclick', e => {
  e.notification.close(); const target = (e.notification.data && e.notification.data.url) || './'
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => { for (const c of list) { if ('focus' in c) { c.navigate(target); return c.focus() } } return self.clients.openWindow(target) }))
})
