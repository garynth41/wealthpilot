// Cresari service worker: makes the app installable and lets it open offline.
// App shell + hashed assets are cached; index.html is network-first so a new release is picked up on the next load.
// Nothing from Supabase, Google or Microsoft is ever cached — financial data only comes from the live API.
const CACHE = 'cresari-v21'
const SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './icon-192.png', './icon-512.png']
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())) })
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
