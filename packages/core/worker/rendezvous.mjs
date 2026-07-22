import {
  resolveOidcProvider,
  verifyDevicePayload,
  verifyOidcToken,
} from './networkCredentials.mjs'

const SCHEME = 'peerly-rendezvous-lookup-v1'
const MAX_EMAIL_LENGTH = 320

const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : ''
const plausibleEmail = value => value.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const proofBytes = (providerId, deviceKeyId, timestamp, nonce, email) => new TextEncoder().encode([
  SCHEME,
  providerId,
  deviceKeyId,
  String(timestamp),
  nonce,
  email,
].join('\n'))

async function hmacId(secret, email) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(email)))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** Authenticated, rate-limited email → opaque rendezvous capability lookup. */
export async function lookupRendezvous(request, env) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!env.RENDEZVOUS_SECRET || !env.RENDEZVOUS_RATE_LIMITER) {
    return new Response('Rendezvous is not configured', { status: 503 })
  }
  try {
    const body = await request.json()
    const email = normalizeEmail(body?.email)
    if (!plausibleEmail(email)) return new Response('Invalid request', { status: 400 })
    const authorization = request.headers.get('authorization') ?? ''
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    const providerId = request.headers.get('x-peerly-provider') ?? ''
    const provider = resolveOidcProvider(providerId, env)
    if (!token || !provider) throw new Error('unauthorized')
    const now = Date.now()
    const claims = await verifyOidcToken(token, provider, fetch, now)
    const deviceKeyId = request.headers.get('x-peerly-device-key') ?? ''
    const timestamp = Number(request.headers.get('x-peerly-request-ts') ?? '')
    const nonce = request.headers.get('x-peerly-request-nonce') ?? ''
    const proof = await verifyDevicePayload(
      request.headers,
      claims,
      proofBytes(providerId, deviceKeyId, timestamp, nonce, email),
      now
    )
    if (!proof) throw new Error('unauthorized')
    const rateKey = `${claims.iss}\n${claims.sub}`
    const allowed = await env.RENDEZVOUS_RATE_LIMITER.limit({ key: rateKey })
    if (!allowed.success) return new Response('Too many requests', { status: 429 })
    return Response.json({ rendezvousId: await hmacId(env.RENDEZVOUS_SECRET, email) }, {
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    })
  } catch {
    return new Response('Unauthorized', { status: 401 })
  }
}
