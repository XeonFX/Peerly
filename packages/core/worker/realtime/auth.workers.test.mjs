import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { authenticateUpgrade, handleEnroll, handleSession } from './auth.mjs'
import { mintCookie, serializeNetworkCookie } from './crypto.mjs'

const config = {
  app: 'peerly',
  allowedOrigin: origin => origin === 'https://peerly.cc',
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
