const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const GOOGLE_JWKS_PATH = '/api/auth/google/jwks'

function validJwks(value) {
  return Boolean(
    value &&
      Array.isArray(value.keys) &&
      value.keys.length > 0 &&
      value.keys.every(key =>
        key &&
        key.kty === 'RSA' &&
        typeof key.kid === 'string' &&
        typeof key.n === 'string' &&
        typeof key.e === 'string'
      )
  )
}

async function googleJwks(request, context) {
  const cache = caches.default
  const cacheKey = new Request(new URL(GOOGLE_JWKS_PATH, request.url), { method: 'GET' })
  const cached = await cache.match(cacheKey)
  if (cached) return cached

  const upstream = await fetch(GOOGLE_JWKS_URL, {
    headers: { accept: 'application/json' },
  })
  if (!upstream.ok) return new Response('Google public keys unavailable', { status: 503 })
  const value = await upstream.json()
  if (!validJwks(value)) return new Response('Invalid Google public-key response', { status: 502 })

  const response = Response.json(value, {
    headers: {
      'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
      'x-content-type-options': 'nosniff',
    },
  })
  context.waitUntil(cache.put(cacheKey, response.clone()))
  return response
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url)
    if (url.pathname === GOOGLE_JWKS_PATH) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
      }
      return googleJwks(request, context)
    }
    return env.ASSETS.fetch(request)
  },
}
