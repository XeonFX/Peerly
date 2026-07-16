import { beforeEach, describe, expect, it } from 'vitest'
import type { DataPayload } from '@trystero-p2p/core'
import type { KvStore } from '../utils/kvStore'
import { utf8ToBase64Url, bytesToBase64Url } from '../utils/base64url'
import { DeviceIdentity } from './deviceIdentity'
import { signAllowList, type SignedAllowList } from './allowList'
import { resetJwksCache, type JwkWithKid, type JwksFetcher } from './googleIdToken'
import { createIdentityHandshake, IDENTITY_DENIED_PREFIX, type Attestation } from './identityHandshake'

const AUDIENCE = 'test-client.apps.googleusercontent.com'

function resolveFakeGoogle(google: { fetchJwks: JwksFetcher }) {
  return (id: string) =>
    id === 'google'
      ? {
          id: 'google' as const,
          label: 'Google',
          clientId: AUDIENCE,
          issuers: new Set(['https://accounts.google.com']),
          jwksUrl: 'https://example.test/jwks',
          fetchJwks: google.fetchJwks,
        }
      : undefined
}

// ---- Fake Google, shared by every peer in a test (same "issuer") ----

async function makeFakeGoogle() {
  const keyPair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair
  const publicJwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JwkWithKid
  publicJwk.kid = 'fake-google-key'
  const fetchJwks: JwksFetcher = async () => ({ keys: [publicJwk] })

  const issueToken = async (email: string, nonce: string, overrides: Record<string, unknown> = {}) => {
    const header = { alg: 'RS256', typ: 'JWT', kid: 'fake-google-key' }
    const nowSec = Math.floor(Date.now() / 1000)
    const claims = {
      iss: 'https://accounts.google.com',
      aud: AUDIENCE,
      sub: email,
      email,
      // Real providers assert this and the app requires it; overridable so
      // tests can exercise the unverified-email rejection.
      email_verified: true,
      nonce,
      iat: nowSec,
      exp: nowSec + 3600,
      ...overrides,
    }
    const signingInput = `${utf8ToBase64Url(JSON.stringify(header))}.${utf8ToBase64Url(JSON.stringify(claims))}`
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      keyPair.privateKey,
      new TextEncoder().encode(signingInput) as BufferSource
    )
    return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`
  }

  return { fetchJwks, issueToken }
}

// ---- Duplex channel simulating two real Trystero peers' handshake transport ----

type Envelope = { data: DataPayload }

class AsyncQueue {
  private items: Envelope[] = []
  private waiters: Array<{ resolve: (item: Envelope) => void; reject: (err: Error) => void }> = []
  private closeError: Error | null = null

  push(item: Envelope) {
    if (this.closeError) return
    const waiter = this.waiters.shift()
    if (waiter) waiter.resolve(item)
    else this.items.push(item)
  }

  async pop(timeoutMs = 3000): Promise<Envelope> {
    const item = this.items.shift()
    if (item !== undefined) return item
    if (this.closeError) throw this.closeError
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('handshake receive timeout')), timeoutMs)
      this.waiters.push({
        resolve: value => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: err => {
          clearTimeout(timer)
          reject(err)
        },
      })
    })
  }

  // Simulates the transport tearing down when one side denies: otherwise the
  // other side's receive() would hang forever waiting for a peer that has
  // already stopped talking, which isn't what a real severed connection does.
  close(err: Error) {
    this.closeError = err
    for (const waiter of this.waiters) waiter.reject(err)
    this.waiters = []
  }
}

function createPeerChannel() {
  const aToB = new AsyncQueue()
  const bToA = new AsyncQueue()
  return {
    sideA: {
      send: async (data: DataPayload) => aToB.push({ data }),
      receive: () => bToA.pop(),
    },
    sideB: {
      send: async (data: DataPayload) => bToA.push({ data }),
      receive: () => aToB.pop(),
    },
    closeBoth: (err: Error) => {
      aToB.close(err)
      bToA.close(err)
    },
  }
}

function memoryStore(): KvStore<CryptoKeyPair> {
  const map = new Map<string, CryptoKeyPair>()
  return {
    async get(key) {
      return map.get(key) ?? null
    },
    async set(key, value) {
      map.set(key, value)
    },
  }
}

/** Runs the handshake for both simulated peers concurrently and reports the outcome of each side. */
async function runHandshake(
  depsA: Parameters<typeof createIdentityHandshake>[0],
  depsB: Parameters<typeof createIdentityHandshake>[0]
) {
  const channel = createPeerChannel()
  const handshakeA = createIdentityHandshake(depsA)
  const handshakeB = createIdentityHandshake(depsB)

  const settle = async (p: Promise<void>) => {
    try {
      await p
      return { ok: true as const }
    } catch (err) {
      channel.closeBoth(new Error('peer denied handshake'))
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  }

  const [a, b] = await Promise.all([
    settle(handshakeA('peer-b', channel.sideA.send, channel.sideA.receive, true)),
    settle(handshakeB('peer-a', channel.sideB.send, channel.sideB.receive, false)),
  ])
  return { a, b }
}

function expectHandshakeError(
  results: { a: { ok: boolean; error?: string }; b: { ok: boolean; error?: string } },
  substring: string
) {
  const errors = [results.a, results.b].filter(r => !r.ok).map(r => r.error ?? '')
  expect(errors.some(error => error.includes(substring))).toBe(true)
}

beforeEach(() => {
  resetJwksCache()
})

describe('identity handshake', () => {
  it('accepts two members whose emails are both on a validly-signed allow-list', async () => {
    const google = await makeFakeGoogle()
    const creator = new DeviceIdentity(memoryStore())
    const creatorKeyId = await creator.publicKeyId()
    const allowList = await signAllowList(creator, ['alice@example.com', 'bob@example.com'])

    const alice = new DeviceIdentity(memoryStore())
    const bob = new DeviceIdentity(memoryStore())
    const aliceKeyId = await alice.publicKeyId()
    const bobKeyId = await bob.publicKeyId()

    const buildAttestation = (keyId: string, email: string) => async (): Promise<Attestation> => ({
      idToken: await google.issueToken(email, keyId),
      providerId: 'google',
      deviceKeyId: keyId,
      allowList,
    })

    const seen: string[] = []
    const { a, b } = await runHandshake(
      {
        identity: alice,
        getAttestation: buildAttestation(aliceKeyId, 'alice@example.com'),
        resolveProvider: resolveFakeGoogle(google),
        fetchJwks: google.fetchJwks,
        creatorKeyId,
        onPeerVerified: (_id, claims) => seen.push(claims.email),
      },
      {
        identity: bob,
        getAttestation: buildAttestation(bobKeyId, 'bob@example.com'),
        resolveProvider: resolveFakeGoogle(google),
        fetchJwks: google.fetchJwks,
        creatorKeyId,
        onPeerVerified: (_id, claims) => seen.push(claims.email),
      }
    )

    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(seen.sort()).toEqual(['alice@example.com', 'bob@example.com'])
  })

  it('denies a removed member who presents the older list that still names them', async () => {
    const google = await makeFakeGoogle()
    const creator = new DeviceIdentity(memoryStore())
    const creatorKeyId = await creator.publicKeyId()

    // Both lists are validly creator-signed; only their age differs.
    const oldList = await signAllowList(creator, ['alice@example.com', 'bob@example.com'])
    await new Promise(resolve => setTimeout(resolve, 5))
    const newListWithoutBob = await signAllowList(creator, ['alice@example.com'])

    const alice = new DeviceIdentity(memoryStore())
    const bob = new DeviceIdentity(memoryStore())
    const aliceKeyId = await alice.publicKeyId()
    const bobKeyId = await bob.publicKeyId()

    const { a, b } = await runHandshake(
      {
        identity: alice,
        getAttestation: async (): Promise<Attestation> => ({
          idToken: await google.issueToken('alice@example.com', aliceKeyId),
          providerId: 'google',
          deviceKeyId: aliceKeyId,
          allowList: newListWithoutBob,
        }),
        resolveProvider: resolveFakeGoogle(google),
        fetchJwks: google.fetchJwks,
        creatorKeyId,
        getKnownAllowList: () => newListWithoutBob,
      },
      {
        identity: bob,
        getAttestation: async (): Promise<Attestation> => ({
          idToken: await google.issueToken('bob@example.com', bobKeyId),
          providerId: 'google',
          deviceKeyId: bobKeyId,
          allowList: oldList,
        }),
        resolveProvider: resolveFakeGoogle(google),
        fetchJwks: google.fetchJwks,
        creatorKeyId,
        getKnownAllowList: () => oldList,
      }
    )

    // Alice (holding the newer list) must refuse bob even though bob's list is
    // validly signed and names him — the newest known list wins.
    expect(a.ok).toBe(false)
    expectHandshakeError({ a, b }, "bob@example.com is not on this workspace's invite list")
  })

  it('still admits a member presenting an older list when the newest list names them', async () => {
    const google = await makeFakeGoogle()
    const creator = new DeviceIdentity(memoryStore())
    const creatorKeyId = await creator.publicKeyId()

    const oldList = await signAllowList(creator, ['alice@example.com', 'bob@example.com'])
    await new Promise(resolve => setTimeout(resolve, 5))
    const newList = await signAllowList(creator, [
      'alice@example.com',
      'bob@example.com',
      'carol@example.com',
    ])

    const alice = new DeviceIdentity(memoryStore())
    const bob = new DeviceIdentity(memoryStore())
    const aliceKeyId = await alice.publicKeyId()
    const bobKeyId = await bob.publicKeyId()

    const { a, b } = await runHandshake(
      {
        identity: alice,
        getAttestation: async (): Promise<Attestation> => ({
          idToken: await google.issueToken('alice@example.com', aliceKeyId),
          providerId: 'google',
          deviceKeyId: aliceKeyId,
          allowList: newList,
        }),
        resolveProvider: resolveFakeGoogle(google),
        fetchJwks: google.fetchJwks,
        creatorKeyId,
        getKnownAllowList: () => newList,
      },
      {
        identity: bob,
        getAttestation: async (): Promise<Attestation> => ({
          idToken: await google.issueToken('bob@example.com', bobKeyId),
          providerId: 'google',
          deviceKeyId: bobKeyId,
          allowList: oldList,
        }),
        resolveProvider: resolveFakeGoogle(google),
        fetchJwks: google.fetchJwks,
        creatorKeyId,
        getKnownAllowList: () => oldList,
      }
    )

    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
  })

  it('denies an otherwise-valid Google identity whose email is not on the allow-list', async () => {
    const google = await makeFakeGoogle()
    const creator = new DeviceIdentity(memoryStore())
    const creatorKeyId = await creator.publicKeyId()
    const allowList = await signAllowList(creator, ['alice@example.com'])

    const alice = new DeviceIdentity(memoryStore())
    const outsider = new DeviceIdentity(memoryStore())
    const aliceKeyId = await alice.publicKeyId()
    const outsiderKeyId = await outsider.publicKeyId()

    const { a, b } = await runHandshake(
      {
        identity: alice,
        getAttestation: async () => ({
          idToken: await google.issueToken('alice@example.com', aliceKeyId),
          providerId: 'google',
          deviceKeyId: aliceKeyId,
          allowList,
        }),
        resolveProvider: resolveFakeGoogle(google),
        fetchJwks: google.fetchJwks,
        creatorKeyId,
      },
      {
        identity: outsider,
        // A real, validly-signed Google token for a real email — just not invited.
        getAttestation: async () => ({
          idToken: await google.issueToken('outsider@example.com', outsiderKeyId),
          providerId: 'google',
          deviceKeyId: outsiderKeyId,
          allowList,
        }),
        resolveProvider: resolveFakeGoogle(google),
        fetchJwks: google.fetchJwks,
        creatorKeyId,
      }
    )

    expect(a.ok && b.ok).toBe(false)
    expectHandshakeError({ a, b }, 'not on this workspace')
  })

  it('denies a self-signed (forged) allow-list claiming an outsider is invited', async () => {
    const google = await makeFakeGoogle()
    const creator = new DeviceIdentity(memoryStore())
    const creatorKeyId = await creator.publicKeyId()
    const realAllowList = await signAllowList(creator, ['alice@example.com'])

    const alice = new DeviceIdentity(memoryStore())
    const mallory = new DeviceIdentity(memoryStore())
    const aliceKeyId = await alice.publicKeyId()
    const malloryKeyId = await mallory.publicKeyId()

    // Mallory signs her OWN allow-list (with her own device key, not the
    // creator's) claiming she's invited, and presents it as if legitimate.
    const forgedAllowList = await signAllowList(mallory, ['mallory@evil.com'])

    const { a, b } = await runHandshake(
      {
        identity: alice,
        getAttestation: async () => ({
          idToken: await google.issueToken('alice@example.com', aliceKeyId),
          providerId: 'google',
          deviceKeyId: aliceKeyId,
          allowList: realAllowList,
        }),
        resolveProvider: resolveFakeGoogle(google),
        fetchJwks: google.fetchJwks,
        creatorKeyId,
      },
      {
        identity: mallory,
        getAttestation: async () => ({
          idToken: await google.issueToken('mallory@evil.com', malloryKeyId),
          providerId: 'google',
          deviceKeyId: malloryKeyId,
          allowList: forgedAllowList,
        }),
        resolveProvider: resolveFakeGoogle(google),
        fetchJwks: google.fetchJwks,
        creatorKeyId,
      }
    )

    expect(a.ok && b.ok).toBe(false)
    expectHandshakeError({ a, b }, 'allow-list signature')
  })

  it('denies a replayed Google token: attacker has the JWT but not the matching device key', async () => {
    const google = await makeFakeGoogle()
    const creator = new DeviceIdentity(memoryStore())
    const creatorKeyId = await creator.publicKeyId()
    const allowList = await signAllowList(creator, ['alice@example.com'])

    const alice = new DeviceIdentity(memoryStore())
    const mallory = new DeviceIdentity(memoryStore())
    const aliceKeyId = await alice.publicKeyId()

    // Mallory captured Alice's real, validly-signed, correctly-nonced token
    // (e.g. by being a peer in the same room earlier) and replays it verbatim
    // — but she signs the live challenge with HER OWN device key, since she
    // does not have Alice's private key.
    const aliceToken = await google.issueToken('alice@example.com', aliceKeyId)

    const { a, b } = await runHandshake(
      {
        identity: alice,
        getAttestation: async () => ({
          idToken: aliceToken,
          providerId: 'google',
          deviceKeyId: aliceKeyId,
          allowList,
        }),
        resolveProvider: resolveFakeGoogle(google),
        fetchJwks: google.fetchJwks,
        creatorKeyId,
      },
      {
        identity: mallory, // Mallory's real device key does the signing in round 2/3
        getAttestation: async () => ({
          idToken: aliceToken, // replayed, unmodified
          providerId: 'google',
          deviceKeyId: aliceKeyId, // claims to be Alice's device
          allowList,
        }),
        resolveProvider: resolveFakeGoogle(google),
        fetchJwks: google.fetchJwks,
        creatorKeyId,
      }
    )

    expect(a.ok).toBe(false)
    expectHandshakeError({ a, b }, 'proof-of-possession failed')
  })

  it('denies a peer whose email the provider has NOT verified', async () => {
    const google = await makeFakeGoogle()
    const creator = new DeviceIdentity(memoryStore())
    const creatorKeyId = await creator.publicKeyId()
    const allowList = await signAllowList(creator, ['alice@example.com'])

    const alice = new DeviceIdentity(memoryStore())
    const mallory = new DeviceIdentity(memoryStore())
    const aliceKeyId = await alice.publicKeyId()
    const malloryKeyId = await mallory.publicKeyId()

    const { a, b } = await runHandshake(
      {
        identity: alice,
        getAttestation: async () => ({
          idToken: await google.issueToken('alice@example.com', aliceKeyId),
          providerId: 'google',
          deviceKeyId: aliceKeyId,
          allowList,
        }),
        resolveProvider: resolveFakeGoogle(google),
        fetchJwks: google.fetchJwks,
        creatorKeyId,
      },
      {
        identity: mallory,
        // Mallory holds a real, correctly-signed, correctly-nonced token that
        // she genuinely owns the device key for — but the address on it was
        // never verified by the provider. She simply typed a colleague's
        // address into a provider that doesn't check. Without the
        // email_verified requirement this walks straight in, because the
        // allow-list only ever compares the address.
        getAttestation: async () => ({
          idToken: await google.issueToken('alice@example.com', malloryKeyId, {
            email_verified: false,
          }),
          providerId: 'google',
          deviceKeyId: malloryKeyId,
          allowList,
        }),
        resolveProvider: resolveFakeGoogle(google),
        fetchJwks: google.fetchJwks,
        creatorKeyId,
      }
    )

    expect(a.ok).toBe(false)
    expect(b.ok).toBe(false)
    expect(a.ok ? '' : a.error).toMatch(/not verified/i)
  })

  it('denies a token carrying only preferred_username, which is not a verified email', async () => {
    const google = await makeFakeGoogle()
    const creator = new DeviceIdentity(memoryStore())
    const creatorKeyId = await creator.publicKeyId()
    const allowList = await signAllowList(creator, ['alice@example.com'])

    const alice = new DeviceIdentity(memoryStore())
    const mallory = new DeviceIdentity(memoryStore())
    const aliceKeyId = await alice.publicKeyId()
    const malloryKeyId = await mallory.publicKeyId()

    const { a, b } = await runHandshake(
      {
        identity: alice,
        getAttestation: async () => ({
          idToken: await google.issueToken('alice@example.com', aliceKeyId),
          providerId: 'google',
          deviceKeyId: aliceKeyId,
          allowList,
        }),
        resolveProvider: resolveFakeGoogle(google),
        fetchJwks: google.fetchJwks,
        creatorKeyId,
      },
      {
        identity: mallory,
        // Azure-shaped token: no verified `email`, just a UPN that looks like
        // one. It must not be accepted as proof of the address.
        getAttestation: async () => ({
          idToken: await google.issueToken('', malloryKeyId, {
            email: undefined,
            email_verified: undefined,
            preferred_username: 'alice@example.com',
          }),
          providerId: 'google',
          deviceKeyId: malloryKeyId,
          allowList,
        }),
        resolveProvider: resolveFakeGoogle(google),
        fetchJwks: google.fetchJwks,
        creatorKeyId,
      }
    )

    expect(a.ok).toBe(false)
    expect(b.ok).toBe(false)
    expect(a.ok ? '' : a.error).toMatch(/missing an email claim/i)
  })

  it('denies an expired token even with a correct nonce and allow-list membership', async () => {
    const google = await makeFakeGoogle()
    const creator = new DeviceIdentity(memoryStore())
    const creatorKeyId = await creator.publicKeyId()
    const allowList = await signAllowList(creator, ['alice@example.com'])

    const alice = new DeviceIdentity(memoryStore())
    const bob = new DeviceIdentity(memoryStore())
    const aliceKeyId = await alice.publicKeyId()
    const bobKeyId = await bob.publicKeyId()
    const nowSec = Math.floor(Date.now() / 1000)

    const { a, b } = await runHandshake(
      {
        identity: alice,
        getAttestation: async () => ({
          idToken: await google.issueToken('alice@example.com', aliceKeyId, { exp: nowSec - 60 }),
          providerId: 'google',
          deviceKeyId: aliceKeyId,
          allowList,
        }),
        resolveProvider: resolveFakeGoogle(google),
        fetchJwks: google.fetchJwks,
        creatorKeyId,
      },
      {
        identity: bob,
        getAttestation: async () => ({
          idToken: await google.issueToken('bob@example.com', bobKeyId),
          providerId: 'google',
          deviceKeyId: bobKeyId,
          allowList: await signAllowList(creator, ['alice@example.com', 'bob@example.com']),
        }),
        resolveProvider: resolveFakeGoogle(google),
        fetchJwks: google.fetchJwks,
        creatorKeyId,
      }
    )

    expect(a.ok && b.ok).toBe(false)
    expectHandshakeError({ a, b }, 'expired')
  })

  it('denies a malformed attestation instead of crashing', async () => {
    const google = await makeFakeGoogle()
    const creator = new DeviceIdentity(memoryStore())
    const creatorKeyId = await creator.publicKeyId()
    const alice = new DeviceIdentity(memoryStore())
    const attacker = new DeviceIdentity(memoryStore())

    const { a, b } = await runHandshake(
      {
        identity: alice,
        getAttestation: async () => ({
          idToken: 'irrelevant, peer sends garbage',
          providerId: 'google',
          deviceKeyId: await alice.publicKeyId(),
          allowList: { emails: [], signedAt: 0, signature: '' },
        }),
        resolveProvider: resolveFakeGoogle(google),
        creatorKeyId,
      },
      {
        identity: attacker,
        // @ts-expect-error deliberately sending a malformed attestation
        getAttestation: async () => ({ nonsense: true }),
        resolveProvider: resolveFakeGoogle(google),
        creatorKeyId,
      }
    )

    expect(a.ok).toBe(false)
    expect(b.ok).toBe(false)
    expect(a.ok ? '' : a.error).toContain(IDENTITY_DENIED_PREFIX)
  })

  it('reports a newer allow-list the peer presents, for propagation', async () => {
    const google = await makeFakeGoogle()
    const creator = new DeviceIdentity(memoryStore())
    const creatorKeyId = await creator.publicKeyId()
    const originalList = await signAllowList(creator, ['alice@example.com'])
    await new Promise(r => setTimeout(r, 5))
    const updatedList = await signAllowList(creator, ['alice@example.com', 'bob@example.com'])

    const alice = new DeviceIdentity(memoryStore())
    const bob = new DeviceIdentity(memoryStore())
    const aliceKeyId = await alice.publicKeyId()
    const bobKeyId = await bob.publicKeyId()

    let seenByAlice: SignedAllowList | null = null

    const { a, b } = await runHandshake(
      {
        identity: alice,
        getAttestation: async () => ({
          idToken: await google.issueToken('alice@example.com', aliceKeyId),
          providerId: 'google',
          deviceKeyId: aliceKeyId,
          allowList: originalList,
        }),
        resolveProvider: resolveFakeGoogle(google),
        fetchJwks: google.fetchJwks,
        creatorKeyId,
        onAllowListSeen: list => {
          seenByAlice = list
        },
      },
      {
        identity: bob,
        getAttestation: async () => ({
          idToken: await google.issueToken('bob@example.com', bobKeyId),
          providerId: 'google',
          deviceKeyId: bobKeyId,
          allowList: updatedList,
        }),
        resolveProvider: resolveFakeGoogle(google),
        fetchJwks: google.fetchJwks,
        creatorKeyId,
      }
    )

    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(seenByAlice).toEqual(updatedList)
  })
})
