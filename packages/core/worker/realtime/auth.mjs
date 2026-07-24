import { resolveOidcProvider, verifyOidcToken } from '../networkCredentials.mjs'
import {
  deriveOpaqueUserId, deviceProofBytes, mintCapability, mintCookie,
  mintTurnCredential, readNetworkCookie, serializeNetworkCookie, sha256Hex,
  verifyCapability, verifyCookie, verifyDeviceSignature,
} from './crypto.mjs'
import { LIMITS } from './limits.mjs'

function json(body, init) {
  return Response.json(body, {
    ...init,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(init?.headers ?? {}) },
  })
}
const unauthorized = () => new Response('Unauthorized', { status: 401 })
const badRequest = message => new Response(message, { status: 400 })
const conflict = code => json({ code }, { status: 409 })
const notConfigured = () => new Response('Realtime backend is not configured', { status: 503 })
const forbiddenOrigin = () => new Response('Forbidden origin', { status: 403 })

/** All endpoints reject a non-allowlisted Origin with 403 — see plan section 5. */
function originAllowed(request, config) {
  return config.allowedOrigin(request.headers.get('origin') ?? '')
}

function gatewayFor(env, app, uid) {
  return env.USER_GATEWAYS.getByName(`${app}:${uid}`)
}

/** `GET /api/network/enroll` device-proof headers, `POST` body carries the OIDC token. */
export async function handleEnroll(request, env, config) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } })
  if (!originAllowed(request, config)) return forbiddenOrigin()
  if (!env.NETWORK_SESSION_SECRET || !env.OPAQUE_USER_ID_SECRET) return notConfigured()

  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (contentLength > LIMITS.maxRequestBodyBytes) return new Response('Request too large', { status: 413 })

  let body
  try {
    body = await request.json()
  } catch {
    return badRequest('invalid json')
  }
  const providerId = typeof body?.provider === 'string' ? body.provider : ''
  const token = typeof body?.token === 'string' ? body.token : ''
  const deviceKeyId = request.headers.get('x-peerly-device-key') ?? ''
  const nonce = request.headers.get('x-peerly-request-nonce') ?? ''
  const timestamp = request.headers.get('x-peerly-request-ts') ?? ''
  if (!providerId || !token || !deviceKeyId) return badRequest('missing fields')

  const provider = resolveOidcProvider(providerId, env)
  if (!provider) return notConfigured()

  const now = Date.now()
  let claims
  try {
    claims = await verifyOidcToken(token, provider, fetch, now)
  } catch {
    return unauthorized()
  }
  // The OIDC token must have been requested with nonce = deviceKeyId, binding
  // "Google says someone owns this email" to "this specific device key".
  if (claims.nonce !== deviceKeyId) return unauthorized()

  const proof = await verifyDeviceSignature(
    request.headers,
    deviceKeyId,
    deviceProofBytes('realtime-enroll-v1', config.app, deviceKeyId, timestamp, nonce),
    now
  )
  if (!proof) return unauthorized()

  const uid = await deriveOpaqueUserId(env.OPAQUE_USER_ID_SECRET, config.app, claims.iss, claims.sub)
  const gateway = gatewayFor(env, config.app, uid)

  const nonceHash = await sha256Hex(`enroll\n${deviceKeyId}\n${nonce}`)
  const fresh = await gateway.consumeNonce(nonceHash, now + LIMITS.nonceTtlMs)
  if (!fresh) return conflict('replay')

  const registered = await gateway.registerSession({ dk: deviceKeyId, now, ttlMs: LIMITS.capabilityTtlMs })
  if (registered.code) return conflict(registered.code)

  const capability = await mintCapability(env.NETWORK_SESSION_SECRET, {
    app: config.app, uid, deviceKeyId, sid: registered.sid, epoch: registered.epoch,
    now, ttlMs: LIMITS.capabilityTtlMs,
  })
  return json({ capability, expiresAt: now + LIMITS.capabilityTtlMs })
}

/** `POST /api/network/session` — capability + fresh device signature, sets the network cookie. */
export async function handleSession(request, env, config) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } })
  if (!originAllowed(request, config)) return forbiddenOrigin()
  if (!env.NETWORK_SESSION_SECRET || !env.OPAQUE_USER_ID_SECRET) return notConfigured()

  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (contentLength > LIMITS.maxRequestBodyBytes) return new Response('Request too large', { status: 413 })

  let body
  try {
    body = await request.json()
  } catch {
    return badRequest('invalid json')
  }
  const capabilityToken = typeof body?.capability === 'string' ? body.capability : ''
  const deviceKeyId = request.headers.get('x-peerly-device-key') ?? ''
  const nonce = request.headers.get('x-peerly-request-nonce') ?? ''
  const timestamp = request.headers.get('x-peerly-request-ts') ?? ''
  if (!capabilityToken || !deviceKeyId) return badRequest('missing fields')

  const now = Date.now()
  const claims = await verifyCapability(env.NETWORK_SESSION_SECRET, capabilityToken, { app: config.app, now })
  if (!claims || claims.dk !== deviceKeyId) return unauthorized()

  const proof = await verifyDeviceSignature(
    request.headers,
    deviceKeyId,
    deviceProofBytes('realtime-session-v1', config.app, deviceKeyId, timestamp, nonce, claims.sid),
    now
  )
  if (!proof) return unauthorized()

  const gateway = gatewayFor(env, config.app, claims.uid)
  const nonceHash = await sha256Hex(`session\n${deviceKeyId}\n${nonce}`)
  const fresh = await gateway.consumeNonce(nonceHash, now + LIMITS.nonceTtlMs)
  if (!fresh) return conflict('replay')

  const validation = await gateway.validateSession({ sid: claims.sid, dk: deviceKeyId, epoch: claims.epoch })
  if (!validation.ok) return unauthorized()

  const cookie = await mintCookie(env.NETWORK_SESSION_SECRET, {
    app: config.app, uid: claims.uid, deviceKeyId, sid: claims.sid, now, ttlMs: LIMITS.cookieTtlMs,
  })
  const turn = await mintTurnCredential(env, { subject: claims.uid, now, ttlMs: LIMITS.cookieTtlMs })

  return json(
    { runtimeConfig: { protocolVersion: LIMITS.protocolVersion }, ...(turn ? { turn } : {}) },
    { headers: { 'set-cookie': serializeNetworkCookie(cookie, LIMITS.cookieTtlMs) } }
  )
}

/**
 * Shared upgrade-request auth used by both the control and signal routes:
 * verify origin and the network cookie, and return the trusted identity to
 * stamp onto the request the DO receives. Callers must strip any inbound
 * `x-realtime-*` headers before calling this — see `router.mjs`.
 */
export async function authenticateUpgrade(request, env, config) {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return { error: new Response('Expected WebSocket upgrade', { status: 426 }) }
  const origin = request.headers.get('origin') ?? ''
  if (!config.allowedOrigin(origin)) return { error: new Response('Forbidden origin', { status: 403 }) }
  const cookieToken = readNetworkCookie(request)
  if (!cookieToken) return { error: new Response('Unauthorized', { status: 401 }) }
  const claims = await verifyCookie(env.NETWORK_SESSION_SECRET, cookieToken, { app: config.app, now: Date.now() })
  if (!claims) return { error: new Response('Unauthorized', { status: 401 }) }
  return { uid: claims.uid, deviceKeyId: claims.dk, sid: claims.sid }
}
