import { beforeEach, describe, expect, it } from 'vitest'
import type { DataPayload } from '@trystero-p2p/core'
import type { KvStore } from '../utils/kvStore'
import { utf8ToBase64Url, bytesToBase64Url } from '../utils/base64url'
import { DeviceIdentity, verifyWithDeviceKeyId } from './deviceIdentity'
import { signAllowList, verifyAllowList, workspaceAuthorityScope, type SignedAllowList } from './allowList'
import { resetJwksCache, type JwkWithKid, type JwksFetcher } from './googleIdToken'
import { OLDER_PEER_REASON, STALE_TAB_REASON, TabSession, UNKNOWN_SIBLING_REASON } from '@peerly/core'
import { fakeBrowser } from './testing/fakeBrowserTabs'
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

  it.each([
    // Mallory cannot certify a tab key for Alice's device key, so her tab is refused before any challenge.
    ['to another member', 'bob', 'tab certificate is not signed by the device key'],
    ['back to its owner', 'alice', 'tab certificate is not signed by the device key'],
  ])('denies a replayed Google token %s: the attacker has the JWT but not the device key', async (_, target, reason) => {
    const google = await makeFakeGoogle()
    const creator = new DeviceIdentity(memoryStore())
    const creatorKeyId = await creator.publicKeyId()
    const allowList = await signAllowList(creator, ['alice@example.com', 'bob@example.com'])

    const alice = new DeviceIdentity(memoryStore())
    const bob = new DeviceIdentity(memoryStore())
    const mallory = new DeviceIdentity(memoryStore())
    const aliceKeyId = await alice.publicKeyId()
    const bobKeyId = await bob.publicKeyId()

    // Mallory captured Alice's real, validly-signed, correctly-nonced token
    // (e.g. by being a peer in the same room earlier) and replays it verbatim
    // — but she signs the live challenge with HER OWN device key, since she
    // does not have Alice's private key.
    const aliceToken = await google.issueToken('alice@example.com', aliceKeyId)
    const victim = target === 'bob'
      ? { identity: bob, idToken: await google.issueToken('bob@example.com', bobKeyId), deviceKeyId: bobKeyId }
      : { identity: alice, idToken: aliceToken, deviceKeyId: aliceKeyId }

    const { a, b } = await runHandshake(
      {
        identity: victim.identity,
        getAttestation: async () => ({
          idToken: victim.idToken,
          providerId: 'google',
          deviceKeyId: victim.deviceKeyId,
          allowList,
        }),
        resolveProvider: resolveFakeGoogle(google),
        fetchJwks: google.fetchJwks,
        creatorKeyId,
      },
      {
        identity: mallory, // Mallory's real device key does the signing
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
    expectHandshakeError({ a, b }, reason)
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
    // The denial names the device to go fix: a user with two open devices
    // otherwise re-authenticates the healthy one and watches the error persist.
    expectHandshakeError({ a, b }, 'peer claims to be alice@example.com')
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

// ---- A member who is in the workspace attacks the creator's device through the handshake ----

const SECRET = 'workspace-secret'

/**
 * The creator's real handshake against a member who drives the protocol by hand: a valid attestation, then
 * `challenge` where a fresh random challenge belongs, then `proof` (if the creator gets that far). Returns what
 * the creator sent and how its handshake ended.
 */
async function creatorAgainst(
  challenge: unknown | ((workspace: { scope: string; signedAt: number }) => unknown),
  { creatorIsInitiator = true, proof = { signature: 'AAAA' }, withoutTab = false } = {}
) {
  const google = await makeFakeGoogle()
  const creator = new DeviceIdentity(memoryStore())
  const creatorKeyId = await creator.publicKeyId()
  const scope = await workspaceAuthorityScope(SECRET, creatorKeyId)
  const allowList = await signAllowList(creator, ['creator@example.com', 'mallory@example.com'], scope)
  const mallory = new DeviceIdentity(memoryStore())
  const malloryKeyId = await mallory.publicKeyId()

  const channel = createPeerChannel()
  const sentByCreator: unknown[] = []
  const handshake = createIdentityHandshake({
    identity: creator,
    getAttestation: async () => ({
      idToken: await google.issueToken('creator@example.com', creatorKeyId),
      providerId: 'google',
      deviceKeyId: creatorKeyId,
      allowList,
    }),
    resolveProvider: resolveFakeGoogle(google),
    fetchJwks: google.fetchJwks,
    creatorKeyId,
    workspaceSecret: SECRET,
  })
  const outcome = handshake(
    'mallory',
    async data => {
      sentByCreator.push(data)
      await channel.sideA.send(data)
    },
    channel.sideA.receive,
    creatorIsInitiator
  ).then(
    () => 'admitted',
    (err: Error) => {
      channel.closeBoth(new Error('creator denied'))
      return err.message
    }
  )

  const attestation = {
    idToken: await google.issueToken('mallory@example.com', malloryKeyId),
    providerId: 'google',
    deviceKeyId: malloryKeyId,
    allowList,
    ...(withoutTab ? {} : { tab: await new TabSession(mallory).certificate(`workspace:${creatorKeyId}`) }),
  }
  // Each phase: the initiator sends first, the responder answers.
  const exchange = async (message: unknown) => {
    if (creatorIsInitiator) {
      await channel.sideB.receive()
      await channel.sideB.send(message as DataPayload)
    } else {
      await channel.sideB.send(message as DataPayload)
      await channel.sideB.receive()
    }
  }
  try {
    await exchange(attestation)
    await exchange(typeof challenge === 'function' ? challenge({ scope, signedAt: allowList.signedAt }) : challenge)
    await exchange(proof)
  } catch {
    // The creator stopped talking: what it sent so far is the evidence.
  }
  return { outcome: await outcome, sentByCreator, creatorKeyId, scope, signedAt: allowList.signedAt }
}

const signaturesIn = (sent: unknown[]) =>
  sent.flatMap(m => (m && typeof m === 'object' && 'signature' in m ? [(m as { signature: string }).signature] : []))

describe('the handshake is not a signing oracle for the creator key', () => {
  it.each([true, false])(
    'refuses to sign a newer allow-list sent as the challenge (creator initiator=%s)',
    async creatorIsInitiator => {
      // The exact bytes the creator signs for a newer member list, adding an account of the attacker's choice.
      const forged = ({ scope, signedAt }: { scope: string; signedAt: number }) => ({
        v: 3,
        nonce: JSON.stringify(['peerly-workspace-members-v2', scope, ['creator@example.com', 'eve@example.com', 'mallory@example.com'], signedAt + 1]),
      })
      const attack = await creatorAgainst(forged, { creatorIsInitiator })
      expect(attack.outcome).toContain(`${IDENTITY_DENIED_PREFIX}: malformed challenge`)
      expect(signaturesIn(attack.sentByCreator)).toEqual([])
    }
  )

  it.each([
    ['the legacy member list', { v: 3, nonce: 'eve@example.com,mallory@example.com|1790000000000' }],
    ['a 42-character challenge', { v: 3, nonce: 'A'.repeat(42) }],
    ['a 44-character challenge', { v: 3, nonce: 'A'.repeat(44) }],
    ['a challenge with characters outside base64url', { v: 3, nonce: `${'A'.repeat(42)}+` }],
    ['a padded challenge', { v: 3, nonce: `${'A'.repeat(42)}=` }],
    ['a very long challenge', { v: 3, nonce: 'A'.repeat(100_000) }],
    ['a number', { v: 3, nonce: 123 }],
    ['no challenge', { v: 3 }],
    ['a challenge from a newer protocol version', { v: 4, nonce: 'A'.repeat(43) }],
    ['a challenge from the protocol before tab keys', { v: 2, nonce: 'A'.repeat(43) }],
  ])('refuses %s before signing anything', async (_, challenge) => {
    const { outcome, sentByCreator } = await creatorAgainst(challenge)
    expect(outcome).toContain(IDENTITY_DENIED_PREFIX)
    expect(signaturesIn(sentByCreator)).toEqual([])
  })

  it('tells an older peer (no protocol version) to reload, without signing its challenge', async () => {
    const { outcome, sentByCreator } = await creatorAgainst({ nonce: 'A'.repeat(43) })
    expect(outcome).toContain('older version of Peerly')
    expect(signaturesIn(sentByCreator)).toEqual([])
  })

  it('a proof for a well-formed challenge is no signature over the challenge or a member list', async () => {
    const nonce = 'Q'.repeat(43)
    const { outcome, sentByCreator, creatorKeyId, scope, signedAt } = await creatorAgainst({ v: 3, nonce })
    // The bogus proof sent back is refused; the creator had signed its proof first (it is the initiator).
    expect(outcome).toContain('proof-of-possession failed')
    const [signature] = signaturesIn(sentByCreator)
    expect(signature).toBeTruthy()
    const encode = (text: string) => new TextEncoder().encode(text)
    expect(await verifyWithDeviceKeyId(creatorKeyId, encode(nonce), signature)).toBe(false)
    const list = { emails: [nonce], signedAt, scope, signature }
    expect(await verifyAllowList(list, creatorKeyId, SECRET)).toBe(false)
  })
})

// ---- Two tabs of one browser: one device key, one sign-in, two tab keys ----

type Verified = { peerId: string; deviceKeyId: string; tabKeyId: string; sameDevice: boolean }

/**
 * Alice's browser profile (one IndexedDB store, so one device key and one ID token) opening tabs, and Bob on his own
 * device. Each tab is wired as WorkspaceAuthManager wires it: its own TabSession, and `isSiblingTab` asking the other
 * tabs of the same browser.
 */
async function twoTabWorkspace() {
  const google = await makeFakeGoogle()
  const creator = new DeviceIdentity(memoryStore())
  const creatorKeyId = await creator.publicKeyId()
  const allowList = await signAllowList(creator, ['alice@example.com', 'bob@example.com', 'mallory@example.com'])
  const aliceStore = memoryStore()
  const aliceKeyId = await new DeviceIdentity(aliceStore).publicKeyId()
  const aliceToken = await google.issueToken('alice@example.com', aliceKeyId)
  const aliceBrowser = fakeBrowser()

  const openTab = async (options: {
    store?: KvStore<CryptoKeyPair>
    email?: string
    browser?: ReturnType<typeof fakeBrowser>
    tab?: (identity: DeviceIdentity) => TabSession
    idToken?: string
    deviceKeyId?: string
  } = {}) => {
    const identity = new DeviceIdentity(options.store ?? aliceStore)
    const deviceKeyId = options.deviceKeyId ?? await identity.publicKeyId()
    const idToken = options.idToken ?? (options.store
      ? await google.issueToken(options.email ?? 'bob@example.com', deviceKeyId)
      : aliceToken)
    const tab = options.tab?.(identity) ?? new TabSession(identity)
    const tabs = (options.browser ?? aliceBrowser).tab()
    tabs.addOwnTabKey(await tab.publicKeyId())
    const verified: Verified[] = []
    const deps: Parameters<typeof createIdentityHandshake>[0] = {
      identity,
      tab,
      isSiblingTab: tabKeyId => tabs.hasSibling(tabKeyId),
      getAttestation: async () => ({ idToken, providerId: 'google', deviceKeyId, allowList }),
      resolveProvider: resolveFakeGoogle(google),
      fetchJwks: google.fetchJwks,
      creatorKeyId,
      onPeerVerified: (peerId, _claims, peerDeviceKeyId, tabKeyId, sameDevice) =>
        verified.push({ peerId, deviceKeyId: peerDeviceKeyId, tabKeyId, sameDevice }),
    }
    return { deps, tab, tabs, verified, tabKeyId: await tab.publicKeyId() }
  }
  const openBob = () => openTab({ store: memoryStore(), browser: fakeBrowser() })
  return { google, creatorKeyId, aliceKeyId, aliceToken, openTab, openBob }
}

describe('two tabs of one browser', () => {
  it('two tabs join: each admits the other as a distinct peer of the same device', async () => {
    const ws = await twoTabWorkspace()
    const first = await ws.openTab()
    const second = await ws.openTab()

    const { a, b } = await runHandshake(first.deps, second.deps)

    expect(a).toEqual({ ok: true })
    expect(b).toEqual({ ok: true })
    expect(first.tabKeyId).not.toBe(second.tabKeyId)
    expect(first.verified).toEqual([{ peerId: 'peer-b', deviceKeyId: ws.aliceKeyId, tabKeyId: second.tabKeyId, sameDevice: true }])
    expect(second.verified).toEqual([{ peerId: 'peer-a', deviceKeyId: ws.aliceKeyId, tabKeyId: first.tabKeyId, sameDevice: true }])
  })

  it('another member admits both tabs, each under its own tab key, as one person on one device', async () => {
    const ws = await twoTabWorkspace()
    const first = await ws.openTab()
    const second = await ws.openTab()
    const bob = await ws.openBob()

    const one = await runHandshake(bob.deps, first.deps)
    const two = await runHandshake(bob.deps, second.deps)

    expect([one.a.ok, one.b.ok, two.a.ok, two.b.ok]).toEqual([true, true, true, true])
    expect(bob.verified.map(v => [v.deviceKeyId, v.tabKeyId, v.sameDevice])).toEqual([
      [ws.aliceKeyId, first.tabKeyId, false],
      [ws.aliceKeyId, second.tabKeyId, false],
    ])
  })

  it('one closes: a tab that closed no longer vouches, so its tab key is refused here afterwards', async () => {
    const ws = await twoTabWorkspace()
    const first = await ws.openTab()
    const second = await ws.openTab()
    expect((await runHandshake(first.deps, second.deps)).a.ok).toBe(true)

    second.tabs.close()
    const { a } = await runHandshake(first.deps, second.deps)

    expect(a.ok).toBe(false)
    expect(a.ok ? '' : a.error).toContain(UNKNOWN_SIBLING_REASON)
  })

  it('both reconnect: the same two tabs handshake again and are admitted under the same tab keys', async () => {
    const ws = await twoTabWorkspace()
    const first = await ws.openTab()
    const second = await ws.openTab()
    const bob = await ws.openBob()

    for (let round = 0; round < 2; round += 1) {
      const siblings = await runHandshake(first.deps, second.deps)
      const withBob = await runHandshake(bob.deps, second.deps)
      expect([siblings.a.ok, siblings.b.ok, withBob.a.ok, withBob.b.ok]).toEqual([true, true, true, true])
    }
    expect(new Set(first.verified.map(v => v.tabKeyId))).toEqual(new Set([second.tabKeyId]))
    expect(new Set(bob.verified.map(v => v.tabKeyId))).toEqual(new Set([second.tabKeyId]))
  })

  it('a stale tab: an expired tab certificate is refused, and the same tab is admitted once it renews', async () => {
    const ws = await twoTabWorkspace()
    const bob = await ws.openBob()
    let asleepFor = 3 * 60 * 60_000
    // Its clock reads the moment it fell asleep until it wakes; a sleeping tab issues nothing new.
    const stale = await ws.openTab({ tab: identity => new TabSession(identity, { now: () => Date.now() - asleepFor }) })

    const refused = await runHandshake(bob.deps, stale.deps)
    expect(refused.a.ok).toBe(false)
    expect(refused.a.ok ? '' : refused.a.error).toContain(STALE_TAB_REASON)

    asleepFor = 0
    const admitted = await runHandshake(bob.deps, stale.deps)
    expect([admitted.a.ok, admitted.b.ok]).toEqual([true, true])
    expect(bob.verified.at(-1)?.tabKeyId).toBe(stale.tabKeyId)
  })

  describe('a forged tab identity is refused', () => {
    it("a tab with this device's key that no open tab of this browser vouches for", async () => {
      const ws = await twoTabWorkspace()
      const first = await ws.openTab()
      // The same device key and sign-in, from a tab that belongs to no browser this one can see.
      const outsider = await ws.openTab({ browser: fakeBrowser() })

      const { a } = await runHandshake(first.deps, outsider.deps)

      expect(a.ok).toBe(false)
      expect(a.ok ? '' : a.error).toContain(UNKNOWN_SIBLING_REASON)
      expect(first.verified).toEqual([])
    })

    it("a member presenting Alice's token and Alice's tab certificate, without Alice's tab key", async () => {
      const ws = await twoTabWorkspace()
      const alice = await ws.openTab()
      const aliceCert = await alice.tab.certificate(`workspace:${ws.creatorKeyId}`)
      const bob = await ws.openBob()
      // Mallory recorded both from an earlier session; she signs with a tab key of her own.
      const mallory = await ws.openTab({
        store: memoryStore(),
        browser: fakeBrowser(),
        idToken: ws.aliceToken,
        deviceKeyId: ws.aliceKeyId,
        tab: identity => Object.assign(new TabSession(identity), { certificate: async () => aliceCert }),
      })

      const { a } = await runHandshake(bob.deps, mallory.deps)

      expect(a.ok).toBe(false)
      expect(a.ok ? '' : a.error).toContain('proof-of-possession failed')
      expect(bob.verified).toEqual([])
    })

    it("a member presenting her own valid sign-in with another member's tab certificate", async () => {
      const ws = await twoTabWorkspace()
      const alice = await ws.openTab()
      const aliceCert = await alice.tab.certificate(`workspace:${ws.creatorKeyId}`)
      const bob = await ws.openBob()
      const mallory = await ws.openTab({
        store: memoryStore(),
        email: 'mallory@example.com',
        browser: fakeBrowser(),
        tab: identity => Object.assign(new TabSession(identity), { certificate: async () => aliceCert }),
      })

      const { a } = await runHandshake(bob.deps, mallory.deps)

      expect(a.ok).toBe(false)
      expect(a.ok ? '' : a.error).toContain('tab certificate is not signed by the device key')
    })

    it('a tab presenting a certificate for another workspace', async () => {
      const ws = await twoTabWorkspace()
      const bob = await ws.openBob()
      const elsewhere = await ws.openTab({
        tab: identity => {
          const tab = new TabSession(identity)
          const issue = tab.certificate.bind(tab)
          return Object.assign(tab, { certificate: () => issue('workspace:some-other-creator') })
        },
      })

      const { a } = await runHandshake(bob.deps, elsewhere.deps)

      expect(a.ok).toBe(false)
      expect(a.ok ? '' : a.error).toContain('tab certificate is not signed by the device key')
    })
  })
})

describe('the device key signs only the tab certificate', () => {
  it('which is issued before any peer input, is the same whatever the peer sends, and is no member list', async () => {
    const first = await creatorAgainst({ v: 3, nonce: 'Q'.repeat(43) })
    const attestation = (sent: unknown[]) => sent[0] as { tab: { signature: string; tabKeyId: string } }
    const cert = attestation(first.sentByCreator).tab
    expect(cert.signature).toBeTruthy()
    const list = { emails: [cert.tabKeyId], signedAt: first.signedAt, scope: first.scope, signature: cert.signature }
    expect(await verifyAllowList(list, first.creatorKeyId, SECRET)).toBe(false)
  })

  it('a peer from before tab keys is told to reload, and nothing is signed for it', async () => {
    const { outcome, sentByCreator } = await creatorAgainst({ v: 3, nonce: 'Q'.repeat(43) }, { withoutTab: true })
    expect(outcome).toContain(OLDER_PEER_REASON)
    expect(signaturesIn(sentByCreator)).toEqual([])
  })
})
