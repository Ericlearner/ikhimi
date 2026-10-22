// Minimal service worker: offline shell + cache-first for static assets.
// Answers are kept in localStorage by the attempt runner; the API is never cached.
// v2: v1 could hold a 404 saved during a deploy; a new name makes `activate` delete it
const CACHE = 'ikhimi-v2'
const SHELL = ['/brand/app-icon.svg', '/brand/ikhimi-logo-primary.svg', '/brand/ikhimi-logo-inverse.svg']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)))
  self.skipWaiting()
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))))
  self.clients.claim()
})
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return
  // Static build assets never change for a given URL
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/brand/')) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          (hit && hit.ok && hit) ||
          fetch(e.request).then((res) => {
            // Only a real file is kept: a 404 kept here would break the app until the cache is cleared
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(e.request, copy))
            }
            return res
          }),
      ),
    )
    return
  }
  // Pages: network first, fall back to the last copy (e.g. the homework page on a lost signal)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(e.request, copy))
          }
          return res
        })
        .catch(() => caches.match(e.request).then((hit) => hit || Response.error())),
    )
  }
})
