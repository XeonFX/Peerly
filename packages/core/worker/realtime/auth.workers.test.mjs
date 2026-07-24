import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { authenticateUpgrade, handleEnroll, handleSession } from './auth.mjs'
import {
  bytesBase64Url, deviceProofBytes, mintCapability, mintCookie, serializeNetworkCookie,
} from './crypto.mjs'

const config = {
  app: 'peerly',
  allowedOrigin: origin => origin === 'https://peerly.cc',
}

/**
 * Sign a device proof exactly as the browser client does in
 * src/realtime/client.ts (deviceProofHeaders): purpose, app, deviceKeyId,
 * timestamp, nonce — and no sid, because the client never sees the sid.
 */
async function signedDeviceHeaders(purpose, app, keyPair, deviceKeyId, now) {
  const timestamp = now
  const nonce = crypto.randomUUID()
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    deviceProofBytes(purpose, app, deviceKeyId, timestamp, nonce)
  )
  return {
    'x-peerly-device-key': deviceKeyId,
    'x-peerly-request-ts': String(timestamp),
    'x-peerly-request-nonce': nonce,
    'x-peerly-request-signature': bytesBase64Url(new Uint8Array(signature)),
  }
}

async function makeDeviceKey() {
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
  return { keyPair, deviceKeyId: `P-256:${jwk.x}:${jwk.y}` }
}

function requestWithOrigin(url, { method = 'POST', origin, body, headers = {} } = {}) {
  return new Request(url, {
    method,
    headers: { origin, 'content-type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

describe('handleEnroll origin and size checks', () => {
  it('rejects a non-allowlisted origin with 403 before touching OIDC/device verification', async () => {
    const response = await handleEnroll(
      requestWithOrigin('https://x/api/network/enroll', { origin: 'https://evil.example', body: {} }),
      env, config
    )
    expect(response.status).toBe(403)
  })

  it('rejects a missing origin with 403', async () => {
    const request = new Request('https://x/api/network/enroll', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    })
    const response = await handleEnroll(request, env, config)
    expect(response.status).toBe(403)
  })

  it('rejects an oversized body with 413 before parsing', async () => {
    const request = requestWithOrigin('https://x/api/network/enroll', {
      origin: 'https://peerly.cc', body: {}, headers: { 'content-length': String(20 * 1024) },
    })
    const response = await handleEnroll(request, env, config)
    expect(response.status).toBe(413)
  })

  it('rejects a wrong method with 405', async () => {
    const response = await handleEnroll(
      requestWithOrigin('https://x/api/network/enroll', { method: 'GET', origin: 'https://peerly.cc' }),
      env, config
    )
    expect(response.status).toBe(405)
  })

  it('allowlisted origin with missing fields reaches field validation (400), not the origin check', async () => {
    const response = await handleEnroll(
      requestWithOrigin('https://x/api/network/enroll', { origin: 'https://peerly.cc', body: {} }),
      env, config
    )
    expect(response.status).toBe(400)
  })
})

describe('handleSession origin and size checks', () => {
  it('rejects a non-allowlisted origin with 403', async () => {
    const response = await handleSession(
      requestWithOrigin('https://x/api/network/session', { origin: 'https://evil.example', body: {} }),
      env, config
    )
    expect(response.status).toBe(403)
  })

  it('rejects an oversized body with 413 before parsing, mirroring handleEnroll', async () => {
    const request = requestWithOrigin('https://x/api/network/session', {
      origin: 'https://peerly.cc', body: {}, headers: { 'content-length': String(20 * 1024) },
    })
    const response = await handleSession(request, env, config)
    expect(response.status).toBe(413)
  })

  it('allowlisted origin with missing fields reaches field validation (400), not the origin check', async () => {
    const response = await handleSession(
      requestWithOrigin('https://x/api/network/session', { origin: 'https://peerly.cc', body: {} }),
      env, config
    )
    expect(response.status).toBe(400)
  })

  // Regression: the device signature the client sends covers (purpose, app,
  // deviceKeyId, ts, nonce) with NO sid — the client can't sign over a sid it
  // never receives. handleSession must verify against those exact fields, not
  // append claims.sid, or every real session request 401s in an endless
  // reconnect loop. This exercises the full happy path a real browser hits.
  it('accepts a capability plus a matching client device signature and sets the cookie', async () => {
    const now = Date.now()
    const uid = `u-${crypto.randomUUID()}`
    const { keyPair, deviceKeyId } = await makeDeviceKey()

    const gateway = env.USER_GATEWAYS.getByName(`peerly:${uid}`)
    const registered = await gateway.registerSession({ dk: deviceKeyId, now, ttlMs: 600_000 })
    expect(registered.sid).toBeTruthy()

    const capability = await mintCapability(env.NETWORK_SESSION_SECRET, {
      app: 'peerly', uid, deviceKeyId, sid: registered.sid, epoch: registered.epoch, now, ttlMs: 600_000,
    })

    const headers = await signedDeviceHeaders('realtime-session-v1', 'peerly', keyPair, deviceKeyId, now)
    const response = await handleSession(
      requestWithOrigin('https://x/api/network/session', {
        origin: 'https://peerly.cc', body: { capability }, headers,
      }),
      env, config
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('pnet=')
  })
})

describe('authenticateUpgrade', () => {
  function upgradeRequest({ origin = 'https://peerly.cc', cookie } = {}) {
    const headers = { upgrade: 'websocket', origin }
    if (cookie) headers.cookie = cookie
    return new Request('https://x/api/realtime/control', { headers })
  }

  it('rejects a non-websocket-upgrade request with 426', async () => {
    const response = await authenticateUpgrade(new Request('https://x/api/realtime/control', { headers: { origin: 'https://peerly.cc' } }), env, config)
    expect(response.error?.status).toBe(426)
  })

  it('rejects a non-allowlisted origin with 403', async () => {
    const response = await authenticateUpgrade(upgradeRequest({ origin: 'https://evil.example' }), env, config)
    expect(response.error?.status).toBe(403)
  })

  it('rejects a missing cookie with 401', async () => {
    const response = await authenticateUpgrade(upgradeRequest({}), env, config)
    expect(response.error?.status).toBe(401)
  })

  it('rejects an expired cookie with 401', async () => {
    const now = Date.now()
    const cookieValue = await mintCookie(env.NETWORK_SESSION_SECRET, {
      app: 'peerly', uid: 'u1', deviceKeyId: 'dk1', sid: 's1', now: now - 700_000, ttlMs: 600_000,
    })
    const response = await authenticateUpgrade(upgradeRequest({ cookie: `pnet=${cookieValue}` }), env, config)
    expect(response.error?.status).toBe(401)
  })

  it('accepts a live cookie and returns the trusted identity', async () => {
    const now = Date.now()
    const cookieValue = await mintCookie(env.NETWORK_SESSION_SECRET, {
      app: 'peerly', uid: 'u1', deviceKeyId: 'dk1', sid: 's1', now, ttlMs: 600_000,
    })
    // serializeNetworkCookie produces the full Set-Cookie value; only the
    // name=value pair belongs in a request's Cookie header.
    const setCookie = serializeNetworkCookie(cookieValue, 600_000)
    const nameValue = setCookie.split(';')[0]
    const response = await authenticateUpgrade(upgradeRequest({ cookie: nameValue }), env, config)
    expect(response).toMatchObject({ uid: 'u1', deviceKeyId: 'dk1', sid: 's1' })
  })
})
