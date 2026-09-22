import { env } from 'cloudflare:workers'
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

/**
 * These two endpoints are the only way to make the control plane spend Durable
 * Object requests without already holding a socket, and until this existed
 * nothing capped them: on 2026-08-02 one broken client spent an account's
 * entire daily quota through them in about an hour.
 */
describe('auth endpoint rate limiting', () => {
  const denyingLimiter = { limit: async () => ({ success: false }) }

  it('answers 429 with Retry-After before doing any work', async () => {
    const response = await handleEnroll(
      requestWithOrigin('https://x/api/network/enroll', {
        origin: 'https://peerly.cc', body: { provider: 'google', token: 't' },
        headers: { 'x-peerly-device-key': 'dk-1' },
      }),
      { ...env, AUTH_RATE_LIMITER: denyingLimiter }, config
    )
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('30')
  })

  it('caps the session endpoint too, not just enrolment', async () => {
    const response = await handleSession(
      requestWithOrigin('https://x/api/network/session', {
        origin: 'https://peerly.cc', body: { capability: 'c' },
        headers: { 'x-peerly-device-key': 'dk-1' },
      }),
      { ...env, AUTH_RATE_LIMITER: denyingLimiter }, config
    )
    expect(response.status).toBe(429)
  })

  /** A cost control, not an authorization one: a deployment that binds no
   *  limiter must keep working rather than failing shut. */
  it('stays open when no limiter is bound', async () => {
    const response = await handleSession(
      requestWithOrigin('https://x/api/network/session', { origin: 'https://peerly.cc', body: {} }),
      env, config
    )
    expect(response.status).toBe(400)
  })

  const allowing = () => ({ limit: async () => ({ success: true }) })

  it('still counts a request carrying neither a device key nor an address', async () => {
    const response = await handleEnroll(
      requestWithOrigin('https://x/api/network/enroll', {
        origin: 'https://peerly.cc', body: { provider: 'google', token: 't' },
      }),
      { ...env, AUTH_IP_RATE_LIMITER: denyingLimiter }, config
    )
    expect(response.status).toBe(429)
  })

  /**
   * A device key is a keypair the client generates, so limiting on it alone
   * hands a fresh allowance to anyone willing to rotate — which is no limit at
   * all. The address bucket is what a rotating client cannot shed.
   */
  it('rejects on the address bucket even when the device bucket allows', async () => {
    const response = await handleEnroll(
      requestWithOrigin('https://x/api/network/enroll', {
        origin: 'https://peerly.cc',
        body: { provider: 'google', token: 't' },
        headers: { 'cf-connecting-ip': '203.0.113.9' },
      }),
      { ...env, AUTH_RATE_LIMITER: allowing(), AUTH_IP_RATE_LIMITER: denyingLimiter }, config
    )
    expect(response.status).toBe(429)
  })

  it('rejects on the device bucket even when the address bucket allows', async () => {
    const response = await handleEnroll(
      requestWithOrigin('https://x/api/network/enroll', {
        origin: 'https://peerly.cc',
        body: { provider: 'google', token: 't' },
        headers: { 'x-peerly-device-key': 'dk-1', 'cf-connecting-ip': '203.0.113.9' },
      }),
      { ...env, AUTH_RATE_LIMITER: denyingLimiter, AUTH_IP_RATE_LIMITER: allowing() }, config
    )
    expect(response.status).toBe(429)
  })

  /** A limiter that silently fails open is indistinguishable from one that is
   *  working, which is how you learn it was broken from a quota email. */
  it('allows but warns when a limiter throws', async () => {
    const warnings = []
    const original = console.warn
    console.warn = (...args) => warnings.push(args.join(' '))
    try {
      const response = await handleSession(
        requestWithOrigin('https://x/api/network/session', {
          origin: 'https://peerly.cc', body: {},
          headers: { 'x-peerly-device-key': 'dk-1' },
        }),
        {
          ...env,
          AUTH_RATE_LIMITER: { limit: async () => { throw new Error('binding down') } },
          AUTH_IP_RATE_LIMITER: allowing(),
        },
        config
      )
      expect(response.status).toBe(400)
    } finally {
      console.warn = original
    }
    expect(warnings.join('\n')).toMatch(/limiter threw/)
  })
})

describe('backend failure handling', () => {
  /**
   * An uncaught throw here is a 500, every client reads a 500 as retryable,
   * and the symptom of an overloaded control plane becomes a stampede against
   * it — 195,185 requests and zero successes in one hour on 2026-08-02.
   */
  it('answers 503 with Retry-After when the gateway call fails', async () => {
    const now = Date.now()
    const uid = `u-${crypto.randomUUID()}`
    const { keyPair, deviceKeyId } = await makeDeviceKey()
    const capability = await mintCapability(env.NETWORK_SESSION_SECRET, {
      app: 'peerly', uid, deviceKeyId, sid: 'any-sid', epoch: 0, now, ttlMs: 600_000,
    })
    const headers = await signedDeviceHeaders('realtime-session-v1', 'peerly', keyPair, deviceKeyId, now)
    const failing = {
      ...env,
      USER_GATEWAYS: {
        getByName: () => ({
          openSession: async () => { throw new Error('over quota') },
        }),
      },
    }

    const response = await handleSession(
      requestWithOrigin('https://x/api/network/session', {
        origin: 'https://peerly.cc', body: { capability }, headers,
      }),
      failing, config
    )
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('30')
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

  it('carries the stable public user id only from the signed cookie', async () => {
    const now = Date.now()
    const cookieValue = await mintCookie(env.NETWORK_SESSION_SECRET, {
      app: 'peerly',
      uid: 'opaque-u1',
      publicUserId: 'public-u1',
      deviceKeyId: 'dk1',
      sid: 's1',
      now,
      ttlMs: 600_000,
    })
    const response = await authenticateUpgrade(
      upgradeRequest({ cookie: `pnet=${cookieValue}` }),
      env,
      { ...config, requirePublicUserId: true }
    )
    expect(response).toMatchObject({
      uid: 'opaque-u1',
      publicUserId: 'public-u1',
      deviceKeyId: 'dk1',
      sid: 's1',
    })
  })

  it('rejects an old cookie when an app requires public identity', async () => {
    const now = Date.now()
    const cookieValue = await mintCookie(env.NETWORK_SESSION_SECRET, {
      app: 'peerly',
      uid: 'opaque-u1',
      deviceKeyId: 'dk1',
      sid: 's1',
      now,
      ttlMs: 600_000,
    })
    const response = await authenticateUpgrade(
      upgradeRequest({ cookie: `pnet=${cookieValue}` }),
      env,
      { ...config, requirePublicUserId: true }
    )
    expect(response.error?.status).toBe(401)
  })

  it('carries a private membership id only from the signed cookie', async () => {
    const now = Date.now()
    const cookieValue = await mintCookie(env.NETWORK_SESSION_SECRET, {
      app: 'peerly',
      uid: 'opaque-u1',
      publicUserId: 'public-u1',
      privateMemberId: 'private-member-u1',
      deviceKeyId: 'dk1',
      sid: 's1',
      now,
      ttlMs: 600_000,
    })
    const response = await authenticateUpgrade(
      upgradeRequest({ cookie: `pnet=${cookieValue}` }),
      env,
      {
        ...config,
        requirePublicUserId: true,
        requirePrivateMemberId: true,
      }
    )
    expect(response).toMatchObject({
      uid: 'opaque-u1',
      publicUserId: 'public-u1',
      privateMemberId: 'private-member-u1',
      deviceKeyId: 'dk1',
      sid: 's1',
    })
  })
})
