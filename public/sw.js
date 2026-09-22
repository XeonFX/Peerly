const CACHE = 'peerly-shell-v3'
const SHELL = ['/', '/site.webmanifest', '/icon-192.png', '/icon-512.png']
const MAX_RUNTIME_ASSETS = 60

async function cacheAsset(request, response) {
  const cache = await caches.open(CACHE)
  await cache.put(request, response)
  const assets = (await cache.keys()).filter(key => new URL(key.url).pathname.startsWith('/assets/'))
  await Promise.all(assets.slice(0, Math.max(0, assets.length - MAX_RUNTIME_ASSETS)).map(key => cache.delete(key)))
}

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
  if (url.pathname.startsWith('/api/')) return

  // SPA navigations (including deep links like /workspace/channel/…) fall back
  // to the cached shell when the network is away. The `?? Response.error()`
  // matters: respondWith(undefined) is itself a TypeError, so a missing cache
  // entry must degrade to an explicit network error, not a second exception.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async response => {
          if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
            event.waitUntil(caches.open(CACHE).then(cache => cache.put('/', response.clone())).catch(() => {}))
          } else if (response.status >= 500) {
            const shell = await caches.match('/')
            if (shell) return shell
          }
          return response
        })
        .catch(async () => {
          const shell = await caches.match('/')
          if (shell) return shell
          // A first-ever offline navigation has no shell yet. Return a real
          // HTTP response so Chrome does not report the service worker itself
          // as a failed FetchEvent (and the user gets an actionable screen).
          return new Response(
            '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Peerly offline</title><body><main style="font:16px system-ui;max-width:36rem;margin:15vh auto;padding:2rem"><h1>Peerly is offline</h1><p>Reconnect to the internet and reload this page.</p></main></body></html>',
            { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
          )
        })
    )
    return
  }

  // Only versioned build assets and explicit public shell files belong in
  // this cache. Never turn arbitrary same-origin GETs into persistent data.
  if (!url.pathname.startsWith('/assets/') && !SHELL.includes(url.pathname)) return

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached
      return fetch(request)
        .then(response => {
          if (response.ok) {
            event.waitUntil(cacheAsset(request, response.clone()).catch(() => {}))
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
