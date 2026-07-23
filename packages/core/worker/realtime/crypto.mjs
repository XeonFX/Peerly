// HMAC-signed tokens (device-session capability, network cookie), opaque id
// derivation, and device-signature verification for the realtime control
// plane. The device-proof header scheme (x-peerly-device-key/request-ts/
// request-nonce/request-signature) matches ../networkCredentials.mjs so the
// same client-side signer code works against both endpoint families; OIDC
// token verification for /api/network/enroll reuses `resolveOidcProvider` /
// `verifyOidcToken` from that module directly.

const base64UrlBytes = value => {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}
const bytesBase64Url = bytes => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}
const textBase64Url = value => bytesBase64Url(new TextEncoder().encode(value))
const bytesToHex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
const bytesBase64 = bytes => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export { base64UrlBytes, bytesBase64Url, textBase64Url }

async function hmac(secret, algorithm, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign', 'verify']
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))
}
const hmacSha256 = (secret, value) => hmac(secret, 'SHA-256', value)

const DEVICE_KEY_PATTERN = /^P-256:[A-Za-z0-9_-]{20,}:[A-Za-z0-9_-]{20,}$/
const MAX_DEVICE_REQUEST_AGE_MS = 60_000

/**
 * Verify a live P-256 device signature over an endpoint-specific,
 * purpose-scoped payload carried in the same request headers as
 * `/api/network/credentials` (x-peerly-device-key/request-ts/request-nonce/
 * request-signature) — same scheme, generalized to an arbitrary payload so
 * new endpoints do not need OIDC claims in hand.
 */
export async function verifyDeviceSignature(headers, expectedDeviceKeyId, payloadBytes, now = Date.now()) {
  const deviceKeyId = headers.get('x-peerly-device-key') ?? ''
  const timestamp = Number(headers.get('x-peerly-request-ts') ?? '')
  const nonce = headers.get('x-peerly-request-nonce') ?? ''
  const signature = headers.get('x-peerly-request-signature') ?? ''
  if (deviceKeyId !== expectedDeviceKeyId || !DEVICE_KEY_PATTERN.test(deviceKeyId)) return null
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > MAX_DEVICE_REQUEST_AGE_MS) return null
  if (nonce.length < 16 || nonce.length > 128 || signature.length < 40 || signature.length > 256) return null
  const [, x, y] = deviceKeyId.split(':')
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x, y, ext: true, key_ops: ['verify'] },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    )
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      base64UrlBytes(signature),
      payloadBytes
    )
    return valid ? { deviceKeyId, timestamp, nonce } : null
  } catch {
    return null
  }
}

/** Purpose-scoped payload bytes signed by the client for a device-proof header set. */
export function deviceProofBytes(purpose, app, deviceKeyId, timestamp, nonce, extra = '') {
  return new TextEncoder().encode([purpose, app, deviceKeyId, String(timestamp), nonce, extra].join('\n'))
}

/** Short-lived TURN REST credential, same HMAC-SHA-1 scheme as the legacy relay's coturn ticket. */
export async function mintTurnCredential(env, { subject, now, ttlMs }) {
  if (!env.TURN_AUTH_SECRET || !env.TURN_URLS) return null
  const urls = env.TURN_URLS.split(',').map(value => value.trim()).filter(Boolean)
  if (urls.length === 0) return null
  const expiresAt = now + ttlMs
  const username = `${Math.floor(expiresAt / 1000)}:${subject}`
  const credential = bytesBase64(await hmac(env.TURN_AUTH_SECRET, 'SHA-1', username))
  return { urls, username, credential, expiresAt }
}

/** SHA-256 hex digest, used for nonce single-use tracking (never store the raw nonce). */
export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return bytesToHex(new Uint8Array(digest))
}

/**
 * `NETWORK_SESSION_SECRET` may hold one value or `current:previous` (a colon
 * separator) during rotation. Signing always uses `current`. Verification
 * tries both unconditionally — a token cannot know in advance that the
 * secret it was signed with will later become "previous", so there is no
 * tag worth embedding; trying both is the entire rotation mechanism.
 */
function secretsFromEnv(raw) {
  const [current, previous] = String(raw ?? '').split(':')
  return { current: current || undefined, previous: previous || undefined }
}

async function signToken(prefix, envSecret, payload) {
  const { current } = secretsFromEnv(envSecret)
  if (!current) throw new Error('missing signing secret')
  const body = textBase64Url(JSON.stringify(payload))
  const mac = bytesBase64Url(await hmacSha256(current, `${prefix}\n${body}`))
  return `v1.${body}.${mac}`
}

async function verifyToken(prefix, envSecret, token) {
  if (typeof token !== 'string' || token.length > 4096) return null
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return null
  const [, body, mac] = parts
  const { current, previous } = secretsFromEnv(envSecret)
  for (const candidate of [current, previous]) {
    if (!candidate) continue
    const expected = bytesBase64Url(await hmacSha256(candidate, `${prefix}\n${body}`))
    if (expected === mac) {
      try {
        return JSON.parse(new TextDecoder().decode(base64UrlBytes(body)))
      } catch {
        return null
      }
    }
  }
  return null
}

const CAPABILITY_PREFIX = 'realtime-capability-v1'
const COOKIE_PREFIX = 'realtime-cookie-v1'

/** Mint the 30-day device-session capability returned by /api/network/enroll. */
export async function mintCapability(secret, { app, uid, deviceKeyId, sid, epoch, now, ttlMs }) {
  return signToken(CAPABILITY_PREFIX, secret, {
    app, uid, dk: deviceKeyId, sid, epoch, iat: now, exp: now + ttlMs, ver: 1,
  })
}

/** Verify a device-session capability. Returns null on any failure (expired, bad mac, wrong app). */
export async function verifyCapability(secret, token, { app, now }) {
  const claims = await verifyToken(CAPABILITY_PREFIX, secret, token)
  if (!claims || claims.app !== app || claims.ver !== 1) return null
  if (typeof claims.exp !== 'number' || claims.exp <= now) return null
  return claims
}

/** Mint the 10-minute HttpOnly network cookie value (not the Set-Cookie header). */
export async function mintCookie(secret, { app, uid, deviceKeyId, sid, now, ttlMs }) {
  return signToken(COOKIE_PREFIX, secret, {
    app, uid, dk: deviceKeyId, sid, iat: now, exp: now + ttlMs,
  })
}

export async function verifyCookie(secret, token, { app, now }) {
  const claims = await verifyToken(COOKIE_PREFIX, secret, token)
  if (!claims || claims.app !== app) return null
  if (typeof claims.exp !== 'number' || claims.exp <= now) return null
  return claims
}

const COOKIE_NAME = 'pnet'

export function serializeNetworkCookie(value, ttlMs) {
  const maxAge = Math.floor(ttlMs / 1000)
  return `${COOKIE_NAME}=${value}; Path=/api/realtime; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`
}

export function readNetworkCookie(request) {
  const header = request.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(`${COOKIE_NAME}=`)) return trimmed.slice(COOKIE_NAME.length + 1)
  }
  return null
}

/**
 * Opaque, deployment- and app-scoped user id derived from the OIDC
 * issuer+subject. Never reversible; never logged alongside the inputs that
 * produced it.
 */
export async function deriveOpaqueUserId(secret, app, issuer, subject) {
  return bytesBase64Url(await hmacSha256(secret, `opaque-user-v1\n${app}\n${issuer}\n${subject}`))
}

/** Route id for a signaling scope: HMAC of the app-supplied capability string, never reversible. */
export async function deriveScopeRouteId(secret, app, kind, capability) {
  return bytesBase64Url(await hmacSha256(secret, `scope-route-v1\n${app}\n${kind}\n${capability}`))
}
