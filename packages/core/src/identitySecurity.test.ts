import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataPayload } from '@trystero-p2p/core'
import { bytesToBase64Url, utf8ToBase64Url } from './base64url.js'
import { DeviceIdentity, verifyWithDeviceKeyId } from './deviceIdentity.js'
import { resetOidcJwksCache } from './oidcIdToken.js'
import { parseOidcDeviceAttestation, verifyGoogleDeviceBinding, verifyOidcDeviceBinding } from './oidcDeviceBinding.js'
import {
  createPeerIdentityHandshake,
  handshakeProofBytes,
  OLDER_PEER_REASON,
  STALE_TAB_REASON,
  UNKNOWN_SIBLING_REASON,
} from './peerIdentityHandshake.js'
import { TAB_CERTIFICATE_LIFETIME_MS, TabSession } from './tabSession.js'
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

type Fault =
  | 'attestation' | 'binding' | 'challenge' | 'proof' | 'replay' | 'raw' | 'other-peer' | 'reflected' | 'older' | 'self'
  | 'older-attestation' | 'forged-tab' | 'stale-tab' | 'other-context' | 'device-signed-proof' | 'other-tab'
  | 'unconfirmed-sibling'

async function handshakeFixture(isInitiator = true, fault?: Fault, options: { sibling?: boolean } = {}) {
  const local = identity()
  const localTab = new TabSession(local)
  // A sibling is another tab of this browser: the same device key under a tab key of its own.
  const sameDevice = options.sibling || fault === 'unconfirmed-sibling'
  const remote = sameDevice ? local : identity()
  // 'stale-tab': a tab whose certificate was issued two lifetimes ago and never renewed.
  const remoteTab = new TabSession(remote, fault === 'stale-tab'
    ? { now: () => Date.now() - 2 * TAB_CERTIFICATE_LIFETIME_MS }
    : {})
  const myTab = await localTab.certificate('')
  const remoteCert = async () => {
    if (fault === 'self') return myTab
    if (fault === 'other-context') return remoteTab.certificate('workspace:another')
    if (fault === 'forged-tab') {
      // A certificate for the remote's device key, signed by a key that is not it.
      const forger = new TabSession(identity())
      const cert = await forger.certificate('')
      return { ...cert, tabKeyId: await remoteTab.publicKeyId() }
    }
    return remoteTab.certificate('')
  }
  const claim = { providerId: 'google', idToken: 'verified-by-host', deviceKeyId: await remote.publicKeyId(), userId: 'remote-account' }
  const theirs = { ...claim, tab: await remoteCert() }
  const mineClaim = { ...claim, deviceKeyId: await local.publicKeyId(), userId: 'local-account' }
  const mine = { ...mineClaim, tab: myTab }
  const verified = { email: 'remote@example.test' }
  const onPeerVerified = vi.fn()
  const verifyAttestation = vi.fn(async () => fault === 'binding' ? null : verified)
  const isSiblingTab = vi.fn(async (tabKeyId: string) => Boolean(options.sibling) && tabKeyId === await remoteTab.publicKeyId())
  const sent: DataPayload[] = []
  const remoteChallenge = 'R'.repeat(43)
  const myChallenge = () => (sent.find(value => typeof value === 'object' && value !== null && 'nonce' in value) as { nonce: string }).nonce
  let step = 0
  const receive = async () => {
    step += 1
    let data: unknown
    // 'self': a replayed token and certificate of this very tab.
    if (step === 1) {
      data = fault === 'attestation' ? { ...theirs, userId: '' }
        : fault === 'self' ? mine
        : fault === 'older-attestation' ? claim
        : theirs
    }
    if (step === 2) {
      data = fault === 'challenge' ? { v: 3, nonce: 'short' }
        : fault === 'older' ? { v: 2, nonce: remoteChallenge }
        // Sends this side's own challenge back, hoping to get a proof it can return.
        : fault === 'reflected' ? { v: 3, nonce: myChallenge() }
        : { v: 3, nonce: remoteChallenge }
    }
    if (step === 3) {
      const proof = {
        context: '',
        signerKeyId: theirs.deviceKeyId, signerTabKeyId: theirs.tab.tabKeyId,
        verifierKeyId: mine.deviceKeyId, verifierTabKeyId: myTab.tabKeyId,
        verifierChallenge: myChallenge(), signerChallenge: fault === 'reflected' ? myChallenge() : remoteChallenge,
      }
      const bytes = fault === 'raw' ? new TextEncoder().encode(myChallenge())
        : fault === 'replay' ? handshakeProofBytes({ ...proof, verifierChallenge: 'P'.repeat(43) })
        // A proof the remote made for a third device, relayed here.
        : fault === 'other-peer' ? handshakeProofBytes({ ...proof, verifierKeyId: await identity().publicKeyId() })
        // A proof the remote made for another tab of this browser (same device key), relayed here.
        : fault === 'other-tab' ? handshakeProofBytes({ ...proof, verifierTabKeyId: await new TabSession(local).publicKeyId() })
        : handshakeProofBytes(proof)
      data = fault === 'proof' ? { signature: '' }
        : fault === 'device-signed-proof' ? { signature: await remote.sign(bytes) }
        : { signature: await remoteTab.sign(bytes) }
    }
    return { data: data as DataPayload }
  }
  const handshake = createPeerIdentityHandshake({
    tab: localTab, getAttestation: async () => mineClaim, verifyAttestation, onPeerVerified, isSiblingTab,
  })
  const run = () => handshake('remote-peer', async data => { sent.push(data) }, receive, isInitiator)
  return { run, onPeerVerified, verifyAttestation, isSiblingTab, verified, theirs, mine, myTab, local, sent, remoteChallenge, myChallenge }
}

describe('peer identity proof of possession', () => {
  it.each([true, false])('authenticates and signs the peer challenge with the tab key (initiator=%s)', async isInitiator => {
    const f = await handshakeFixture(isInitiator)
    await f.run()
    expect(f.verifyAttestation).toHaveBeenCalledWith(f.theirs)
    expect(f.onPeerVerified).toHaveBeenCalledWith('remote-peer', f.verified, f.theirs)
    expect(f.sent[0]).toEqual(f.mine)
    const proof = f.sent[2] as { signature: string }
    // The proof signs this session's transcript, bound to both devices and both tabs – never the bare challenge.
    const transcript = handshakeProofBytes({
      context: '',
      signerKeyId: f.mine.deviceKeyId, signerTabKeyId: f.myTab.tabKeyId,
      verifierKeyId: f.theirs.deviceKeyId, verifierTabKeyId: f.theirs.tab.tabKeyId,
      verifierChallenge: f.remoteChallenge, signerChallenge: f.myChallenge(),
    })
    await expect(verifyWithDeviceKeyId(f.myTab.tabKeyId, transcript, proof.signature)).resolves.toBe(true)
    await expect(verifyWithDeviceKeyId(f.myTab.tabKeyId, new TextEncoder().encode(f.remoteChallenge), proof.signature)).resolves.toBe(false)
    // The device key signs no proof: whatever a peer sends, the key an ID token is bound to signs nothing for it.
    await expect(verifyWithDeviceKeyId(f.mine.deviceKeyId, transcript, proof.signature)).resolves.toBe(false)
    expect(f.sent[1]).toEqual({ v: 3, nonce: f.myChallenge() })
    expect(f.myChallenge()).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(f.isSiblingTab).not.toHaveBeenCalled()
  })

  it('admits another tab of this browser once a tab here vouches for its tab key', async () => {
    const f = await handshakeFixture(true, undefined, { sibling: true })
    await f.run()
    expect(f.theirs.deviceKeyId).toBe(f.mine.deviceKeyId)
    expect(f.isSiblingTab).toHaveBeenCalledWith(f.theirs.tab.tabKeyId)
    expect(f.onPeerVerified).toHaveBeenCalled()
  })

  it.each([
    ['attestation', 'malformed attestation'],
    ['binding', 'invalid OIDC device binding'],
    ['challenge', 'malformed challenge'],
    ['proof', 'proof-of-possession failed'],
    ['replay', 'proof-of-possession failed'],
    ['raw', 'proof-of-possession failed'],
    ['other-peer', 'proof-of-possession failed'],
    ['other-tab', 'proof-of-possession failed'],
    ['device-signed-proof', 'proof-of-possession failed'],
    ['reflected', 'reflected challenge'],
    ['older', OLDER_PEER_REASON],
    ['older-attestation', OLDER_PEER_REASON],
    ['self', "this tab's own key"],
    ['forged-tab', 'not signed by the device key'],
    ['other-context', 'not signed by the device key'],
    ['stale-tab', STALE_TAB_REASON],
    ['unconfirmed-sibling', UNKNOWN_SIBLING_REASON],
  ] as const)('fails closed for invalid %s', async (fault, reason) => {
    const f = await handshakeFixture(true, fault)
    const error = await f.run().then(() => null, (err: Error) => err.message)
    expect(error).toContain('identity verification failed: ')
    expect(error).toContain(reason)
    expect(f.onPeerVerified).not.toHaveBeenCalled()
    if (fault === 'attestation' || fault === 'older-attestation') expect(f.verifyAttestation).not.toHaveBeenCalled()
    // Refused before a challenge is answered: nothing is signed for a peer whose tab is not accepted.
    if (['self', 'forged-tab', 'other-context', 'stale-tab', 'unconfirmed-sibling', 'older-attestation'].includes(fault)) {
      expect(f.sent.some(value => typeof value === 'object' && value !== null && 'signature' in value)).toBe(false)
    }
  })
})
