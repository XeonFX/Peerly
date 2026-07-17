const CACHE = 'peerly-shell-v1'
const SHELL = ['/', '/site.webmanifest', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // SPA navigations (including deep links like /workspace/channel/…) fall back
  // to the cached shell when the network is away. The `?? Response.error()`
  // matters: respondWith(undefined) is itself a TypeError, so a missing cache
  // entry must degrade to an explicit network error, not a second exception.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone()
          void caches.open(CACHE).then(cache => cache.put('/', copy))
          return response
        })
        .catch(async () => (await caches.match('/')) ?? Response.error())
    )
    return
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached
      return fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone()
            void caches.open(CACHE).then(cache => cache.put(request, copy))
          }
          return response
        })
        // Offline and not cached: answer with a clean network error instead of
        // letting the rejected fetch escape respondWith as an uncaught
        // "TypeError: Failed to fetch" in the console.
        .catch(() => Response.error())
    })
  )
})
