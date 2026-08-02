import { resolveOidcProvider, verifyOidcToken } from '../networkCredentials.mjs'
import {
  deriveOpaqueUserId, derivePrivateMemberId, deviceProofBytes, mintCapability, mintCookie,
  mintTurnCredential, readNetworkCookie, serializeNetworkCookie, sha256Hex,
  verifyCapability, verifyCookie, verifyDeviceSignature,
} from './crypto.mjs'
import { LIMITS } from '../../dist/protocol/index.js'
import { deriveUserId } from '../../dist/userId.js'

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

/**
 * A Durable Object call failed — overloaded, over quota, or faulting.
 *
 * `503` with `Retry-After`, never an uncaught throw. An uncaught throw is a
 * `500`, every client reads a `500` as retryable, and the symptom of an
 * overloaded control plane becomes a stampede against it: on 2026-08-02 that
 * was 195,185 requests and zero successes in one hour.
 */
const RETRY_AFTER_SECONDS = 30
const backendUnavailable = () =>
  json({ code: 'service-unavailable' }, {
    status: 503,
    headers: { 'retry-after': String(RETRY_AFTER_SECONDS) },
  })

/** Runs a gateway call, converting a failure into 503 rather than letting it
 *  reach the client as an unhandled 500. */
async function callGateway(operation) {
  try {
    return { value: await operation() }
  } catch {
    return { error: backendUnavailable() }
  }
}

/**
 * Caps the enrol/session endpoints, which are the only unauthenticated-ish way
 * to make the control plane spend Durable Object requests.
 *
 * Keyed by device key where there is one, falling back to the connecting IP,
 * so a single broken client cannot spend an account-wide daily quota — which
 * is exactly what happened before this existed. Absent binding means no
 * limiter is configured, and the endpoint stays open rather than failing shut:
 * this is a cost control, not an authorization one.
 */
async function withinAuthRateLimit(request, env) {
  const limiter = env.AUTH_RATE_LIMITER
  if (!limiter) return true
  const key = request.headers.get('x-peerly-device-key')
    || request.headers.get('cf-connecting-ip')
    || 'anonymous'
  try {
    const { success } = await limiter.limit({ key })
    return success
  } catch {
    return true
  }
}

const rateLimited = () =>
  json({ code: 'rate-limited' }, {
    status: 429,
    headers: { 'retry-after': String(RETRY_AFTER_SECONDS) },
  })

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
  if (!await withinAuthRateLimit(request, env)) return rateLimited()

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
  const publicUserId = await deriveUserId(claims.iss, claims.sub)
  const privateMemberId = typeof claims.email === 'string'
    ? await derivePrivateMemberId(
        env.OPAQUE_USER_ID_SECRET,
        config.app,
        claims.email
      )
    : undefined
  if (config.requirePrivateMemberId && !privateMemberId) return unauthorized()
  const gateway = gatewayFor(env, config.app, uid)

  const nonceHash = await sha256Hex(`enroll\n${deviceKeyId}\n${nonce}`)
  // One call, not two. The uid rides along on it: a Durable Object cannot read
  // back the name it was addressed by (`ctx.id.name` is undefined inside the
  // object), so the caller is the only source of "which account is this".
  const enrolled = await callGateway(() => gateway.enrollDevice({
    nonceHash, nonceExpiresAt: now + LIMITS.nonceTtlMs,
    dk: deviceKeyId, now, ttlMs: LIMITS.capabilityTtlMs, uid,
  }))
  if (enrolled.error) return enrolled.error
  const registered = enrolled.value
  if (registered.code) return conflict(registered.code)

  const capability = await mintCapability(env.NETWORK_SESSION_SECRET, {
    app: config.app, uid, publicUserId, privateMemberId, deviceKeyId,
    sid: registered.sid, epoch: registered.epoch,
    now, ttlMs: LIMITS.capabilityTtlMs,
  })
  return json({ capability, expiresAt: now + LIMITS.capabilityTtlMs })
}

/** `POST /api/network/session` — capability + fresh device signature, sets the network cookie. */
export async function handleSession(request, env, config) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } })
  if (!originAllowed(request, config)) return forbiddenOrigin()
  if (!env.NETWORK_SESSION_SECRET || !env.OPAQUE_USER_ID_SECRET) return notConfigured()
  if (!await withinAuthRateLimit(request, env)) return rateLimited()

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
  if (
    !claims ||
    claims.dk !== deviceKeyId ||
    (config.requirePublicUserId && typeof claims.user !== 'string') ||
    (config.requirePrivateMemberId && typeof claims.member !== 'string')
  ) return unauthorized()

  // The device signature is over the SAME fields the client signs in
  // src/realtime/client.ts establishSession(): purpose, app, deviceKeyId,
  // timestamp, nonce — no sid. The client cannot bind its signature to the
  // sid because the sid lives only inside the opaque, MAC-protected
  // capability and is never handed to the browser separately. The sid is
  // already bound here by verifyCapability above (claims.sid comes from the
  // integrity-checked capability); requiring it in the device proof too was a
  // client/server mismatch that made every session request 401.
  const proof = await verifyDeviceSignature(
    request.headers,
    deviceKeyId,
    deviceProofBytes('realtime-session-v1', config.app, deviceKeyId, timestamp, nonce),
    now
  )
  if (!proof) return unauthorized()

  const gateway = gatewayFor(env, config.app, claims.uid)
  const nonceHash = await sha256Hex(`session\n${deviceKeyId}\n${nonce}`)
  const opened = await callGateway(() => gateway.openSession({
    nonceHash, nonceExpiresAt: now + LIMITS.nonceTtlMs,
    sid: claims.sid, dk: deviceKeyId, epoch: claims.epoch, uid: claims.uid,
  }))
  if (opened.error) return opened.error
  if (opened.value.code === 'replay') return conflict('replay')
  if (!opened.value.ok) return unauthorized()

  const cookie = await mintCookie(env.NETWORK_SESSION_SECRET, {
    app: config.app, uid: claims.uid, publicUserId: claims.user,
    privateMemberId: claims.member,
    deviceKeyId, sid: claims.sid, now, ttlMs: LIMITS.cookieTtlMs,
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
  if (config.requirePublicUserId && typeof claims.user !== 'string') {
    return { error: new Response('Unauthorized', { status: 401 }) }
  }
  if (config.requirePrivateMemberId && typeof claims.member !== 'string') {
    return { error: new Response('Unauthorized', { status: 401 }) }
  }
  return {
    uid: claims.uid,
    deviceKeyId: claims.dk,
    sid: claims.sid,
    ...(typeof claims.user === 'string' ? { publicUserId: claims.user } : {}),
    ...(typeof claims.member === 'string' ? { privateMemberId: claims.member } : {}),
  }
}
