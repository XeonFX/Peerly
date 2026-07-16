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

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone()
          void caches.open(CACHE).then(cache => cache.put('/', copy))
          return response
        })
        .catch(() => caches.match('/'))
    )
    return
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached
      return fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone()
          void caches.open(CACHE).then(cache => cache.put(request, copy))
        }
        return response
      })
    })
  )
})
