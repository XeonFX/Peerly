import { authenticateUpgrade, handleEnroll, handleSession } from './auth.mjs'
import { deriveScopeRouteId } from './crypto.mjs'

const ENROLL_PATH = '/api/network/enroll'
const SESSION_PATH = '/api/network/session'
const CONTROL_PATH = '/api/realtime/control'
const SIGNAL_PREFIX = '/api/realtime/signal/'

const REALTIME_PATHS = new Set([ENROLL_PATH, SESSION_PATH, CONTROL_PATH])
const TRUSTED_HEADER_PREFIX = 'x-realtime-'

function stripTrustedHeaders(request) {
  const headers = new Headers(request.headers)
  for (const key of [...headers.keys()]) {
    if (key.toLowerCase().startsWith(TRUSTED_HEADER_PREFIX)) headers.delete(key)
  }
  return new Request(request.url, { method: request.method, headers, body: request.body, duplex: request.body ? 'half' : undefined })
}

function serviceUnavailable() {
  return Response.json({ code: 'service-unavailable' }, { status: 503, headers: { 'retry-after': '60' } })
}

/**
 * Authenticates an app-owned realtime WebSocket route and returns a request
 * carrying server-stamped identity headers. Inbound spoofed headers are
 * removed before the trusted values are added.
 */
export async function prepareAuthenticatedRealtimeUpgrade(request, env, config) {
  const auth = await authenticateUpgrade(request, env, config)
  if (auth.error) return auth
  const trusted = stripTrustedHeaders(request)
  trusted.headers.set('x-realtime-uid', auth.uid)
  trusted.headers.set('x-realtime-dk', auth.deviceKeyId)
  trusted.headers.set('x-realtime-sid', auth.sid)
  if (auth.publicUserId) trusted.headers.set('x-realtime-user', auth.publicUserId)
  if (auth.privateMemberId) trusted.headers.set('x-realtime-member', auth.privateMemberId)
  return { auth, request: trusted }
}

/**
 * Owns every `/api/network/*` and `/api/realtime/*` route. Returns `null`
 * for paths outside that set so each app's existing worker entry chain
 * (Google auth bridge, legacy network credentials, static assets) is
 * untouched — this call is inserted before that fallthrough.
 *
 * `config`: `{ app, allowedOrigin(origin): boolean }`.
 */
export async function handleRealtimeRoute(request, env, config) {
  const url = new URL(request.url)
  const isSignal = url.pathname.startsWith(SIGNAL_PREFIX)
  if (!REALTIME_PATHS.has(url.pathname) && !isSignal) return null

  if (env.COORDINATION_BACKEND !== 'durable-objects') return serviceUnavailable()

  if (url.pathname === ENROLL_PATH) return handleEnroll(request, env, config)
  if (url.pathname === SESSION_PATH) return handleSession(request, env, config)

  if (url.pathname === CONTROL_PATH) {
    const prepared = await prepareAuthenticatedRealtimeUpgrade(request, env, config)
    if (prepared.error) return prepared.error
    const stub = env.USER_GATEWAYS.getByName(`${config.app}:${prepared.auth.uid}`)
    return stub.fetch(prepared.request)
  }

  if (isSignal) {
    const routeId = url.pathname.slice(SIGNAL_PREFIX.length)
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(routeId)) return new Response('Not found', { status: 404 })
    const prepared = await prepareAuthenticatedRealtimeUpgrade(request, env, config)
    if (prepared.error) return prepared.error
    const stub = env.SIGNAL_SCOPES.getByName(`${config.app}:${routeId}`)
    return stub.fetch(prepared.request)
  }

  return null
}

export { deriveScopeRouteId }
