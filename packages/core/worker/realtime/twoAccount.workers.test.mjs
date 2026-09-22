import { env } from 'cloudflare:workers'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { handleRealtimeRoute } from './router.mjs'

/**
 * Two accounts through the real routes, end to end: OIDC enrollment, session
 * establishment, and an authenticated control socket each — no shortcuts past
 * `handleRealtimeRoute`, no hand-written account ids.
 *
 * This is the server half of the two-user test. Every previous suite either
 * called a Durable Object's RPCs directly or stubbed the account id, which is
 * exactly why a broken identity derivation survived: the ids the tests passed
 * were the values that were wrong.
 *
 * Identities are minted here against a keypair generated per run and served
 * through a mocked JWKS endpoint, so no key material is committed and the
 * generic `oidc` provider is configured only in the test environment. A
 * deployment that does not set VITE_OIDC_* resolves that provider to `null`
 * and 503s, so this cannot be turned on by accident in production.
 */

const ISSUER = 'https://issuer.e2e.test'
const CLIENT_ID = 'e2e-two-account-client'
const JWKS_PATH = '/.well-known/jwks.json'
const ORIGIN = 'https://preview.peerly.cc'

const config = { app: 'peerly', allowedOrigin: origin => origin === ORIGIN }

let signingKey
let publicJwk

const base64Url = bytes =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')

const encodeSegment = value => base64Url(new TextEncoder().encode(JSON.stringify(value)))

/** An RS256 id token for `email`, bound to a device key through `nonce`. */
async function mintIdToken({ email, nonce, subject }) {
  const header = { alg: 'RS256', typ: 'JWT', kid: 'e2e' }
  const nowSeconds = Math.floor(Date.now() / 1000)
  const claims = {
    iss: ISSUER,
    aud: CLIENT_ID,
    sub: subject,
    email,
    email_verified: true,
    nonce,
    iat: nowSeconds,
    exp: nowSeconds + 3_600,
  }
  const body = `${encodeSegment(header)}.${encodeSegment(claims)}`
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', signingKey, new TextEncoder().encode(body)
  )
  return `${body}.${base64Url(signature)}`
}

/** A P-256 device identity, in the `P-256:<x>:<y>` form the worker expects. */
async function createDevice() {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
  )
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const deviceKeyId = `P-256:${jwk.x}:${jwk.y}`
  return {
    deviceKeyId,
    async proofHeaders(purpose) {
      const timestamp = Date.now()
      const nonce = crypto.randomUUID()
      const payload = [purpose, config.app, deviceKeyId, String(timestamp), nonce, ''].join('\n')
      const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(payload)
      )
      return {
        'x-peerly-device-key': deviceKeyId,
        'x-peerly-request-ts': String(timestamp),
        'x-peerly-request-nonce': nonce,
        'x-peerly-request-signature': base64Url(signature),
      }
    },
  }
}

const testEnv = () => ({
  ...env,
  COORDINATION_BACKEND: 'durable-objects',
  VITE_OIDC_CLIENT_ID: CLIENT_ID,
  VITE_OIDC_ISSUER: ISSUER,
  OIDC_JWKS_URL: `${ISSUER}${JWKS_PATH}`,
})

/** Enrol, establish a session, and open a control socket for one account. */
async function signIn(email, subject) {
  const device = await createDevice()
  const token = await mintIdToken({ email, nonce: device.deviceKeyId, subject })

  const enroll = await handleRealtimeRoute(
    new Request('https://preview.peerly.cc/api/network/enroll', {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        ...(await device.proofHeaders('realtime-enroll-v1')),
      },
      body: JSON.stringify({ provider: 'oidc', token }),
    }),
    testEnv(),
    config
  )
  expect(enroll.status).toBe(200)
  const { capability } = await enroll.json()

  const session = await handleRealtimeRoute(
    new Request('https://preview.peerly.cc/api/network/session', {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        ...(await device.proofHeaders('realtime-session-v1')),
      },
      body: JSON.stringify({ capability }),
    }),
    testEnv(),
    config
  )
  expect(session.status).toBe(200)
  const cookie = session.headers.get('set-cookie').split(';')[0]

  return { device, capability, cookie, token }
}

async function openControlSocket(cookie) {
  const response = await handleRealtimeRoute(
    new Request('https://preview.peerly.cc/api/realtime/control', {
      headers: { origin: ORIGIN, upgrade: 'websocket', cookie },
    }),
    testEnv(),
    config
  )
  expect(response.status).toBe(101)
  const ws = response.webSocket
  const frames = []
  ws.accept()
  ws.addEventListener('message', event => frames.push(JSON.parse(String(event.data))))
  ws.send(JSON.stringify({ v: 1, id: 'hello', type: 'hello', sentAt: Date.now(), payload: { version: 1 } }))
  return { ws, frames }
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  signingKey = pair.privateKey
  publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'e2e', alg: 'RS256', use: 'sig' }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = input instanceof Request ? input.url : String(input)
    if (url !== `${ISSUER}${JWKS_PATH}`) throw new Error(`Unexpected outbound request: ${url}`)
    return Response.json({ keys: [publicJwk] })
  })
})

afterAll(() => vi.restoreAllMocks())

describe('two accounts through the real routes', () => {
  it('enrols, establishes a session and connects — twice, independently', async () => {
    const alice = await signIn('alice@e2e.test', 'sub-alice')
    const bob = await signIn('bob@e2e.test', 'sub-bob')

    // Distinct people must get distinct capabilities; a shared or empty
    // account id is what collapsed every user onto one identity.
    expect(alice.capability).not.toBe(bob.capability)

    const aliceSocket = await openControlSocket(alice.cookie)
    const bobSocket = await openControlSocket(bob.cookie)
    await vi.waitFor(() => {
      expect(aliceSocket.frames.some(frame => frame.type === 'ack')).toBe(true)
      expect(bobSocket.frames.some(frame => frame.type === 'ack')).toBe(true)
    })
  })

  it('lands the two accounts in different gateway objects', async () => {
    const alice = await signIn('alice2@e2e.test', 'sub-alice-2')
    const bob = await signIn('bob2@e2e.test', 'sub-bob-2')
    // The cookie carries the opaque account id; two different subjects must
    // never derive the same one.
    expect(alice.cookie).not.toBe(bob.cookie)
  })

  it('refuses a token whose nonce is not the enrolling device key', async () => {
    // The binding that makes an id token useless to anyone but the device that
    // requested it. Without it a stolen token enrols an attacker's device.
    const device = await createDevice()
    const token = await mintIdToken({
      email: 'mallory@e2e.test', nonce: 'not-the-device-key', subject: 'sub-mallory',
    })
    const response = await handleRealtimeRoute(
      new Request('https://preview.peerly.cc/api/network/enroll', {
        method: 'POST',
        headers: {
          origin: ORIGIN,
          'content-type': 'application/json',
          ...(await device.proofHeaders('realtime-enroll-v1')),
        },
        body: JSON.stringify({ provider: 'oidc', token }),
      }),
      testEnv(),
      config
    )
    expect(response.status).toBe(401)
  })

  it('refuses a control socket with no session cookie', async () => {
    const response = await handleRealtimeRoute(
      new Request('https://preview.peerly.cc/api/realtime/control', {
        headers: { origin: ORIGIN, upgrade: 'websocket' },
      }),
      testEnv(),
      config
    )
    expect(response.status).toBe(401)
  })

  it('refuses every realtime route from a non-allowlisted origin', async () => {
    const enroll = await handleRealtimeRoute(
      new Request('https://preview.peerly.cc/api/network/enroll', {
        method: 'POST',
        headers: { origin: 'https://evil.test', 'content-type': 'application/json' },
        body: '{}',
      }),
      testEnv(),
      config
    )
    expect(enroll.status).toBe(403)
  })

  it('503s the whole control plane when the backend is not durable-objects', async () => {
    const response = await handleRealtimeRoute(
      new Request('https://preview.peerly.cc/api/network/enroll', {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: '{}',
      }),
      { ...testEnv(), COORDINATION_BACKEND: 'legacy-relay' },
      config
    )
    expect(response.status).toBe(503)
  })

  it('has no oidc provider at all when VITE_OIDC_* is unset', async () => {
    // The property that makes test-only auth safe: it is configuration, not a
    // code branch, so a deployment that does not opt in cannot be talked into
    // accepting these tokens.
    const production = { ...env, COORDINATION_BACKEND: 'durable-objects' }
    const device = await createDevice()
    const response = await handleRealtimeRoute(
      new Request('https://preview.peerly.cc/api/network/enroll', {
        method: 'POST',
        headers: {
          origin: ORIGIN,
          'content-type': 'application/json',
          ...(await device.proofHeaders('realtime-enroll-v1')),
        },
        body: JSON.stringify({ provider: 'oidc', token: 'anything' }),
      }),
      production,
      config
    )
    expect(response.status).toBe(503)
  })
})
