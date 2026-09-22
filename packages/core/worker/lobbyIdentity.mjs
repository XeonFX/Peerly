import { resolveOidcProvider, verifyDevicePayload, verifyOidcToken } from './networkCredentials.mjs'
import { deriveUserId } from '../dist/userId.js'

const PURPOSE = 'peerly-lobby-identity-v1'
const TTL_MS = 5 * 60_000
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
const bytes = value => new TextEncoder().encode(value)
const encode = value => btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))
const keyFor = secret => crypto.subtle.importKey('raw', bytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

/** Public discovery trusts the same-origin Worker to attest identity. The
 * provider token is verified here and never included in the certificate. */
export async function issueLobbyIdentity(request, env) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!env.RENDEZVOUS_SECRET || !env.RENDEZVOUS_RATE_LIMITER) return new Response('Unavailable', { status: 503 })
  try {
    const providerId = request.headers.get('x-peerly-provider') ?? ''
    const provider = resolveOidcProvider(providerId, env)
    const authorization = request.headers.get('authorization') ?? ''
    if (!provider || !authorization.startsWith('Bearer ')) throw new Error('unauthorized')
    const now = Date.now()
    const claims = await verifyOidcToken(authorization.slice(7), provider, fetch, now)
    const deviceKeyId = request.headers.get('x-peerly-device-key') ?? ''
    const proof = bytes([PURPOSE, providerId, deviceKeyId,
      request.headers.get('x-peerly-request-ts'), request.headers.get('x-peerly-request-nonce')].join('\n'))
    if (!await verifyDevicePayload(request.headers, claims, proof, now)) throw new Error('unauthorized')
    const allowed = await env.RENDEZVOUS_RATE_LIMITER.limit({ key: `${claims.iss}\n${claims.sub}` })
    if (!allowed.success) return new Response('Too many requests', { status: 429 })
    const key = await keyFor(env.RENDEZVOUS_SECRET)
    const rendezvousId = encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes(claims.email.trim().toLowerCase()))))
    const identity = {
      userId: await deriveUserId(claims.iss, claims.sub),
      deviceKeyId,
      rendezvousId,
      expiresAt: Math.min(now + TTL_MS, claims.exp * 1000),
    }
    // Scope the MAC to this protocol and origin; lookup capabilities are not certificates.
    const body = encode(bytes(JSON.stringify(identity)))
    const signature = encode(new Uint8Array(await crypto.subtle.sign('HMAC', key,
      bytes(`${PURPOSE}\n${new URL(request.url).origin}\n${body}`))))
    return Response.json({ ...identity, certificate: `${body}.${signature}` }, { headers })
  } catch {
    return new Response('Unauthorized', { status: 401, headers })
  }
}

/** Verification is public, stateless and bounded. It accepts only an already
 * issued certificate; it cannot look up emails or mint discovery capabilities. */
export async function verifyLobbyIdentity(request, env) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!env.RENDEZVOUS_SECRET) return new Response('Unavailable', { status: 503 })
  try {
    const reader = request.body?.getReader()
    if (!reader) throw new Error('missing certificate')
    const chunks = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 2048) {
          await reader.cancel()
          return new Response('Too large', { status: 413, headers })
        }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const input = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.length }
    const certificate = new TextDecoder().decode(input)
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(certificate)) throw new Error('invalid certificate')
    const [body, signature] = certificate.split('.')
    if (!await crypto.subtle.verify('HMAC', await keyFor(env.RENDEZVOUS_SECRET), decode(signature),
      bytes(`${PURPOSE}\n${new URL(request.url).origin}\n${body}`))) throw new Error('invalid certificate')
    const identity = JSON.parse(new TextDecoder().decode(decode(body)))
    if (!Number.isFinite(identity.expiresAt) || identity.expiresAt <= Date.now() ||
      identity.expiresAt > Date.now() + TTL_MS) throw new Error('expired certificate')
    return Response.json(identity, { headers })
  } catch {
    return new Response('Unauthorized', { status: 401, headers })
  }
}
