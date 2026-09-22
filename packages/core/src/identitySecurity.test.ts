import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataPayload } from '@trystero-p2p/core'
import { bytesToBase64Url, utf8ToBase64Url } from './base64url.js'
import { DeviceIdentity, verifyWithDeviceKeyId } from './deviceIdentity.js'
import { resetOidcJwksCache } from './oidcIdToken.js'
import { parseOidcDeviceAttestation, verifyGoogleDeviceBinding, verifyOidcDeviceBinding } from './oidcDeviceBinding.js'
import { createPeerIdentityHandshake } from './peerIdentityHandshake.js'
import { deriveUserId } from './userId.js'

function identity() {
  const keys = new Map<string, CryptoKeyPair>()
  return new DeviceIdentity({
    get: async key => keys.get(key) ?? null,
    set: async (key, value) => { keys.set(key, value) },
  })
}

const issuer = 'https://accounts.google.com'
const audience = 'device-binding-test'
let signingKeys: CryptoKeyPair
let publicJwk: JsonWebKey & { kid: string }

beforeAll(async () => {
  signingKeys = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
  }, true, ['sign', 'verify'])
  publicJwk = { ...await crypto.subtle.exportKey('jwk', signingKeys.publicKey), kid: 'binding-test' }
})
beforeEach(() => resetOidcJwksCache())

async function token(nonce: string, overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  const body = [
    { alg: 'RS256', kid: publicJwk.kid },
    { iss: issuer, aud: audience, sub: 'alice', email: 'alice@example.test',
      email_verified: true, nonce, iat: now, exp: now + 3600, ...overrides },
  ].map(value => utf8ToBase64Url(JSON.stringify(value))).join('.')
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signingKeys.privateKey, new TextEncoder().encode(body))
  return `${body}.${bytesToBase64Url(new Uint8Array(signature))}`
}

async function bindingFixture() {
  const deviceKeyId = await identity().publicKeyId()
  const userId = await deriveUserId(issuer, 'alice')
  const attestation = { providerId: 'google', idToken: await token(deviceKeyId) }
  const expected = { providerId: 'google', deviceKeyId, userId }
  const options = {
    expectedAudience: audience, issuers: new Set([issuer]),
    fetchJwks: async () => ({ keys: [publicJwk] }), jwksCacheKey: 'binding-test',
  }
  return { attestation, expected, options }
}

describe('OIDC device binding', () => {
  it('binds a verified token to both the device key and issuer/subject-derived account', async () => {
    const { attestation, expected, options } = await bindingFixture()
    await expect(verifyOidcDeviceBinding(attestation, expected, options)).resolves.toMatchObject({
      ...expected, claims: { sub: 'alice', email: 'alice@example.test' },
    })
    await expect(verifyOidcDeviceBinding(attestation, { ...expected, userId: 'another-account' }, options)).resolves.toBeNull()
    await expect(verifyOidcDeviceBinding(attestation, { ...expected, deviceKeyId: await identity().publicKeyId() }, options)).resolves.toBeNull()
    await expect(verifyOidcDeviceBinding(attestation, { ...expected, providerId: 'other' }, options)).resolves.toBeNull()
  })

  it('pins the Google wrapper to Google and rejects expired or replayed credentials', async () => {
    const { attestation, expected, options } = await bindingFixture()
    const googleExpected = { ...expected, clientId: audience, fetchJwks: options.fetchJwks }
    await expect(verifyGoogleDeviceBinding(attestation, googleExpected)).resolves.toMatchObject(expected)
    await expect(verifyGoogleDeviceBinding(attestation, { ...googleExpected, userId: 'another-account' })).resolves.toBeNull()
    await expect(verifyGoogleDeviceBinding(attestation, { ...googleExpected, deviceKeyId: await identity().publicKeyId() })).resolves.toBeNull()
    await expect(verifyGoogleDeviceBinding({ ...attestation, providerId: 'other' }, googleExpected)).resolves.toBeNull()
    await expect(verifyGoogleDeviceBinding({ ...attestation, idToken: await token(expected.deviceKeyId, { iss: 'https://evil.test' }) }, googleExpected)).resolves.toBeNull()
    await expect(verifyGoogleDeviceBinding(attestation, { ...googleExpected, atTime: Date.now() + 7_200_000 })).resolves.toBeNull()
  })

  it.each([null, {}, 'token', { providerId: '', idToken: 'x' },
    { providerId: 'g'.repeat(41), idToken: 'x' }, { providerId: 'google', idToken: '' },
    { providerId: 'google', idToken: 'x'.repeat(16_001) },
  ])('rejects malformed and oversized attestations', async raw => {
    const { expected, options } = await bindingFixture()
    expect(parseOidcDeviceAttestation(raw)).toBeNull()
    await expect(verifyOidcDeviceBinding(raw, expected, options)).resolves.toBeNull()
    await expect(verifyGoogleDeviceBinding(raw, { ...expected, clientId: audience })).resolves.toBeNull()
  })

  it('normalizes the attestation and rejects an invalid token signature', async () => {
    const { attestation, expected, options } = await bindingFixture()
    expect(parseOidcDeviceAttestation({ ...attestation, untrusted: true })).toEqual(attestation)
    await expect(verifyOidcDeviceBinding({ ...attestation, idToken: 'invalid.jwt.signature' }, expected, options)).resolves.toBeNull()
  })
})

async function handshakeFixture(isInitiator = true, fault?: 'attestation' | 'binding' | 'challenge' | 'proof' | 'replay') {
  const local = identity()
  const remote = identity()
  const theirs = { providerId: 'google', idToken: 'verified-by-host', deviceKeyId: await remote.publicKeyId(), userId: 'remote-account' }
  const mine = { ...theirs, deviceKeyId: await local.publicKeyId(), userId: 'local-account' }
  const verified = { email: 'remote@example.test' }
  const onPeerVerified = vi.fn()
  const verifyAttestation = vi.fn(async () => fault === 'binding' ? null : verified)
  const sent: DataPayload[] = []
  const remoteChallenge = 'remote-challenge-'.repeat(3)
  let step = 0
  const receive = async () => {
    step += 1
    let data: unknown
    if (step === 1) data = fault === 'attestation' ? { ...theirs, userId: '' } : theirs
    if (step === 2) data = { nonce: fault === 'challenge' ? 'short' : remoteChallenge }
    if (step === 3) {
      const challenge = sent.find(value => typeof value === 'object' && value !== null && 'nonce' in value) as { nonce: string }
      data = fault === 'proof' ? { signature: '' } : {
        signature: await remote.sign(new TextEncoder().encode(fault === 'replay' ? 'an-old-challenge' : challenge.nonce)),
      }
    }
    return { data: data as DataPayload }
  }
  const handshake = createPeerIdentityHandshake({
    signer: local, getAttestation: async () => mine, verifyAttestation, onPeerVerified,
  })
  const run = () => handshake('remote-peer', async data => { sent.push(data) }, receive, isInitiator)
  return { run, onPeerVerified, verifyAttestation, verified, theirs, mine, sent, remoteChallenge }
}

describe('peer identity proof of possession', () => {
  it.each([true, false])('authenticates and signs the peer challenge (initiator=%s)', async isInitiator => {
    const f = await handshakeFixture(isInitiator)
    await f.run()
    expect(f.verifyAttestation).toHaveBeenCalledWith(f.theirs)
    expect(f.onPeerVerified).toHaveBeenCalledWith('remote-peer', f.verified, f.theirs)
    expect(f.sent[0]).toEqual(f.mine)
    const proof = f.sent[2] as { signature: string }
    await expect(verifyWithDeviceKeyId(f.mine.deviceKeyId, new TextEncoder().encode(f.remoteChallenge), proof.signature)).resolves.toBe(true)
  })

  it.each(['attestation', 'binding', 'challenge', 'proof', 'replay'] as const)('fails closed for invalid %s', async fault => {
    const f = await handshakeFixture(true, fault)
    await expect(f.run()).rejects.toThrow('identity verification failed')
    expect(f.onPeerVerified).not.toHaveBeenCalled()
    if (fault === 'attestation') expect(f.verifyAttestation).not.toHaveBeenCalled()
  })
})
