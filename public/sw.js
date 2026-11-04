// WealthPilot service worker: makes the app installable and lets it open offline.
// App shell + hashed assets are cached; index.html is network-first so a new release is picked up on the next load.
// Nothing from Supabase, Google or Microsoft is ever cached — financial data only comes from the live API.
const CACHE = 'wealthpilot-v4'
const SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './icon-192.png', './icon-512.png']
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())) })
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())) })
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return
  const url = new URL(req.url); if (url.origin !== self.location.origin) return            // Supabase, Google, Microsoft, fonts: straight to the network
  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html')) {                // HTML: network first, cached copy when offline
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return r }).catch(() => caches.match('./index.html')))
    return
  }
  if (url.pathname.includes('/assets/') || /\.(png|svg|webmanifest|woff2?)$/.test(url.pathname)) {   // hashed assets: cache first
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)) } return r })))
  }
})
