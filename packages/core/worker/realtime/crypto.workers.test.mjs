import { describe, expect, it } from 'vitest'
import {
  deriveOpaqueUserId, deriveScopeRouteId, deviceProofBytes, mintCapability, mintCookie,
  verifyCapability, verifyCookie, verifyDeviceSignature,
} from './crypto.mjs'

async function generateDeviceKeyId() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  return { pair, deviceKeyId: `P-256:${jwk.x}:${jwk.y}` }
}

function bytesToBase64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function sign(privateKey, payload) {
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, payload)
  return bytesToBase64Url(new Uint8Array(signature))
}

describe('capability tokens', () => {
  it('mints and verifies a capability', async () => {
    const now = Date.now()
    const token = await mintCapability('secret-a', { app: 'peerly', uid: 'u1', deviceKeyId: 'dk1', sid: 's1', epoch: 0, now, ttlMs: 1000 })
    const claims = await verifyCapability('secret-a', token, { app: 'peerly', now })
    expect(claims).toMatchObject({ uid: 'u1', dk: 'dk1', sid: 's1', epoch: 0 })
  })

  it('rejects a capability after expiry', async () => {
    const now = Date.now()
    const token = await mintCapability('secret-a', { app: 'peerly', uid: 'u1', deviceKeyId: 'dk1', sid: 's1', epoch: 0, now, ttlMs: 1000 })
    const claims = await verifyCapability('secret-a', token, { app: 'peerly', now: now + 1001 })
    expect(claims).toBeNull()
  })

  it('rejects a capability minted for a different app', async () => {
    const now = Date.now()
    const token = await mintCapability('secret-a', { app: 'peerly', uid: 'u1', deviceKeyId: 'dk1', sid: 's1', epoch: 0, now, ttlMs: 1000 })
    const claims = await verifyCapability('secret-a', token, { app: 'app-b', now })
    expect(claims).toBeNull()
  })

  it('rejects a capability signed with the wrong secret', async () => {
    const now = Date.now()
    const token = await mintCapability('secret-a', { app: 'peerly', uid: 'u1', deviceKeyId: 'dk1', sid: 's1', epoch: 0, now, ttlMs: 1000 })
    const claims = await verifyCapability('secret-b', token, { app: 'peerly', now })
    expect(claims).toBeNull()
  })

  it('verifies against the previous secret during rotation', async () => {
    const now = Date.now()
    const token = await mintCapability('old-secret', { app: 'peerly', uid: 'u1', deviceKeyId: 'dk1', sid: 's1', epoch: 0, now, ttlMs: 1000 })
    const rotated = 'new-secret:old-secret'
    const claims = await verifyCapability(rotated, token, { app: 'peerly', now })
    expect(claims).toMatchObject({ uid: 'u1' })
  })

  it('rejects a tampered token body', async () => {
    const now = Date.now()
    const token = await mintCapability('secret-a', { app: 'peerly', uid: 'u1', deviceKeyId: 'dk1', sid: 's1', epoch: 0, now, ttlMs: 1000 })
    const [v1, body, mac] = token.split('.')
    const tampered = [v1, `${body}x`, mac].join('.')
    expect(await verifyCapability('secret-a', tampered, { app: 'peerly', now })).toBeNull()
  })
})

describe('network cookie', () => {
  it('mints and verifies a cookie', async () => {
    const now = Date.now()
    const token = await mintCookie('secret-a', { app: 'app-b', uid: 'u1', deviceKeyId: 'dk1', sid: 's1', now, ttlMs: 600_000 })
    const claims = await verifyCookie('secret-a', token, { app: 'app-b', now })
    expect(claims).toMatchObject({ uid: 'u1', dk: 'dk1', sid: 's1' })
  })
})

describe('opaque ids', () => {
  it('is deterministic for the same inputs', async () => {
    const a = await deriveOpaqueUserId('secret', 'peerly', 'https://accounts.google.com', 'subject-1')
    const b = await deriveOpaqueUserId('secret', 'peerly', 'https://accounts.google.com', 'subject-1')
    expect(a).toBe(b)
  })

  it('differs across apps for the same subject', async () => {
    const appA = await deriveOpaqueUserId('secret', 'app-a', 'https://accounts.google.com', 'subject-1')
    const appB = await deriveOpaqueUserId('secret', 'app-b', 'https://accounts.google.com', 'subject-1')
    expect(appA).not.toBe(appB)
  })

  it('scope route ids never reveal the input capability and are deterministic', async () => {
    const a = await deriveScopeRouteId('secret', 'peerly', 'workspace', 'my-capability')
    const b = await deriveScopeRouteId('secret', 'peerly', 'workspace', 'my-capability')
    expect(a).toBe(b)
    expect(a).not.toContain('my-capability')
  })
})

describe('verifyDeviceSignature', () => {
  it('accepts a valid live signature over the exact payload', async () => {
    const { pair, deviceKeyId } = await generateDeviceKeyId()
    const timestamp = Date.now()
    const nonce = 'a'.repeat(20)
    const payload = deviceProofBytes('realtime-enroll-v1', 'peerly', deviceKeyId, timestamp, nonce)
    const signature = await sign(pair.privateKey, payload)
    const headers = new Headers({
      'x-peerly-device-key': deviceKeyId,
      'x-peerly-request-ts': String(timestamp),
      'x-peerly-request-nonce': nonce,
      'x-peerly-request-signature': signature,
    })
    const result = await verifyDeviceSignature(headers, deviceKeyId, payload, timestamp)
    expect(result).toMatchObject({ deviceKeyId })
  })

  it('rejects a signature over a different payload (purpose confusion)', async () => {
    const { pair, deviceKeyId } = await generateDeviceKeyId()
    const timestamp = Date.now()
    const nonce = 'b'.repeat(20)
    const enrollPayload = deviceProofBytes('realtime-enroll-v1', 'peerly', deviceKeyId, timestamp, nonce)
    const signature = await sign(pair.privateKey, enrollPayload)
    const headers = new Headers({
      'x-peerly-device-key': deviceKeyId,
      'x-peerly-request-ts': String(timestamp),
      'x-peerly-request-nonce': nonce,
      'x-peerly-request-signature': signature,
    })
    const sessionPayload = deviceProofBytes('realtime-session-v1', 'peerly', deviceKeyId, timestamp, nonce)
    const result = await verifyDeviceSignature(headers, deviceKeyId, sessionPayload, timestamp)
    expect(result).toBeNull()
  })

  it('rejects a stale timestamp outside the request-age window', async () => {
    const { pair, deviceKeyId } = await generateDeviceKeyId()
    const timestamp = Date.now() - 120_000
    const nonce = 'c'.repeat(20)
    const payload = deviceProofBytes('realtime-enroll-v1', 'peerly', deviceKeyId, timestamp, nonce)
    const signature = await sign(pair.privateKey, payload)
    const headers = new Headers({
      'x-peerly-device-key': deviceKeyId,
      'x-peerly-request-ts': String(timestamp),
      'x-peerly-request-nonce': nonce,
      'x-peerly-request-signature': signature,
    })
    const result = await verifyDeviceSignature(headers, deviceKeyId, payload, Date.now())
    expect(result).toBeNull()
  })

  it('rejects when the header device key does not match the expected one', async () => {
    const { pair, deviceKeyId } = await generateDeviceKeyId()
    const { deviceKeyId: otherKeyId } = await generateDeviceKeyId()
    const timestamp = Date.now()
    const nonce = 'd'.repeat(20)
    const payload = deviceProofBytes('realtime-enroll-v1', 'peerly', deviceKeyId, timestamp, nonce)
    const signature = await sign(pair.privateKey, payload)
    const headers = new Headers({
      'x-peerly-device-key': deviceKeyId,
      'x-peerly-request-ts': String(timestamp),
      'x-peerly-request-nonce': nonce,
      'x-peerly-request-signature': signature,
    })
    const result = await verifyDeviceSignature(headers, otherKeyId, payload, timestamp)
    expect(result).toBeNull()
  })
})
