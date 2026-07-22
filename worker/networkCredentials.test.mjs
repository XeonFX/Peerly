import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearOidcJwksCache,
  issueNetworkCredentials,
  resolveOidcProvider,
  verifyDeviceRequest,
  verifyOidcToken,
} from '../packages/core/worker/networkCredentials.mjs'

const b64url = bytes => Buffer.from(bytes).toString('base64url')
const jsonPart = value => b64url(new TextEncoder().encode(JSON.stringify(value)))

async function fixture() {
  const rsa = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  const rsaJwk = await crypto.subtle.exportKey('jwk', rsa.publicKey)
  rsaJwk.kid = 'test-key'
  rsaJwk.alg = 'RS256'
  rsaJwk.use = 'sig'

  const device = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  )
  const deviceJwk = await crypto.subtle.exportKey('jwk', device.publicKey)
  const deviceKeyId = `P-256:${deviceJwk.x}:${deviceJwk.y}`
  const now = Date.now()
  const claims = {
    iss: 'https://accounts.google.com',
    aud: 'client-id',
    sub: 'subject',
    email: 'user@example.com',
    email_verified: true,
    nonce: deviceKeyId,
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 3600,
  }
  const head = jsonPart({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })
  const body = jsonPart(claims)
  const jwtSig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    rsa.privateKey,
    new TextEncoder().encode(`${head}.${body}`)
  )
  const token = `${head}.${body}.${b64url(jwtSig)}`
  const timestamp = now
  const nonce = 'request-nonce-0123456789'
  const proof = new TextEncoder().encode([
    'peerly-network-credentials-v1',
    'google',
    deviceKeyId,
    String(timestamp),
    nonce,
  ].join('\n'))
  const requestSig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    device.privateKey,
    proof
  )
  return {
    token,
    rsaJwk,
    claims,
    headers: {
      authorization: `Bearer ${token}`,
      'x-peerly-provider': 'google',
      'x-peerly-device-key': deviceKeyId,
      'x-peerly-request-ts': String(timestamp),
      'x-peerly-request-nonce': nonce,
      'x-peerly-request-signature': b64url(requestSig),
    },
  }
}

afterEach(() => {
  clearOidcJwksCache()
  vi.restoreAllMocks()
})

describe('network credential worker', () => {
  it('rejects unsafe multi-tenant Microsoft configuration', () => {
    expect(resolveOidcProvider('microsoft', {
      VITE_MICROSOFT_CLIENT_ID: 'client',
      VITE_MICROSOFT_TENANT_ID: 'common',
    })).toBeNull()
  })

  it('verifies the live device signature and token nonce binding', async () => {
    const { claims, headers } = await fixture()
    const verified = await verifyDeviceRequest(new Headers(headers), 'google', claims)
    expect(verified?.deviceKeyId).toBe(headers['x-peerly-device-key'])
    const tampered = new Headers(headers)
    tampered.set('x-peerly-request-nonce', 'tampered-request-nonce')
    await expect(verifyDeviceRequest(tampered, 'google', claims)).resolves.toBeNull()
  })

  it('issues relay and TURN credentials only for an OIDC-bound device request', async () => {
    const { rsaJwk, headers } = await fixture()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ keys: [rsaJwk] })))
    const env = {
      VITE_GOOGLE_CLIENT_ID: 'client-id',
      RELAY_TICKET_SECRET: 'relay-secret-at-least-long-enough',
      RELAY_TICKET_AUDIENCE: 'relay.example.com',
      TURN_AUTH_SECRET: 'turn-secret-at-least-long-enough',
      TURN_URLS: 'turn:turn.example.com:3478,turns:turn.example.com:443?transport=tcp',
    }
    const response = await issueNetworkCredentials(new Request('https://app.example/api/network/credentials', {
      method: 'POST',
      headers,
    }), env)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.json()
    expect(body.relayTicket).toMatch(/^[^.]+\.[^.]+$/)
    expect(body.iceServers[1].username).toMatch(/^\d+:/)
    expect(body.expiresAt).toBeGreaterThan(Date.now())

    const forged = new Headers(headers)
    forged.set('x-peerly-request-signature', 'forged')
    const denied = await issueNetworkCredentials(new Request('https://app.example/api/network/credentials', {
      method: 'POST',
      headers: forged,
    }), env)
    expect(denied.status).toBe(401)
  })

  it('uses a bounded last-good JWKS during a transient provider outage', async () => {
    const { rsaJwk, token } = await fixture()
    const provider = resolveOidcProvider('google', { VITE_GOOGLE_CLIENT_ID: 'client-id' })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ keys: [rsaJwk] }))
      .mockRejectedValueOnce(new Error('temporary network failure'))
    const first = await verifyOidcToken(token, provider, fetcher)
    const second = await verifyOidcToken(token, provider, fetcher, Date.now() + 6 * 60_000)
    expect(first.sub).toBe('subject')
    expect(second.sub).toBe('subject')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
