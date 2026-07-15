import type { PeerHandshake } from '@trystero-p2p/core'
import { bytesToBase64Url } from '../utils/base64url'
import { DeviceIdentity, verifyWithDeviceKeyId, type DeviceKeyId } from './deviceIdentity'
import {
  defaultJwksFetcher,
  getIdentityProvider,
  type IdentityProvider,
} from './identityProviders'
import { verifyOidcIdToken, type JwksFetcher, type OidcIdTokenClaims } from './oidcIdToken'
import { isEmailAllowed, verifyAllowList, type SignedAllowList } from './allowList'

export const IDENTITY_DENIED_PREFIX = 'identity verification failed'

export type Attestation = {
  idToken: string
  providerId: string
  deviceKeyId: DeviceKeyId
  allowList: SignedAllowList
}

export type IdentityHandshakeDeps = {
  identity: DeviceIdentity
  getAttestation: () => Promise<Attestation>
  creatorKeyId: DeviceKeyId
  /** Injectable for tests — resolves provider config by id. */
  resolveProvider?: (providerId: string) => IdentityProvider | undefined
  /** Injectable for tests; overrides JWKS fetch for the google provider. */
  fetchJwks?: JwksFetcher
  onPeerVerified?: (peerId: string, claims: OidcIdTokenClaims) => void
  onAllowListSeen?: (list: SignedAllowList) => void
}

function isAttestationShape(data: unknown): data is Attestation {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>

  const idToken =
    typeof d.idToken === 'string'
      ? d.idToken
      : typeof d.googleIdToken === 'string'
        ? d.googleIdToken
        : null
  const providerId =
    typeof d.providerId === 'string' ? d.providerId : idToken ? 'google' : null

  if (!idToken || !providerId || typeof d.deviceKeyId !== 'string') return false

  const list = d.allowList as Record<string, unknown> | undefined
  return (
    !!list &&
    typeof list === 'object' &&
    Array.isArray(list.emails) &&
    list.emails.every(e => typeof e === 'string') &&
    typeof list.signedAt === 'number' &&
    typeof list.signature === 'string'
  )
}

function normalizeAttestation(data: Record<string, unknown>): Attestation {
  const idToken =
    typeof data.idToken === 'string'
      ? data.idToken
      : typeof data.googleIdToken === 'string'
        ? data.googleIdToken
        : ''
  const providerId = typeof data.providerId === 'string' ? data.providerId : 'google'
  return {
    idToken,
    providerId,
    deviceKeyId: data.deviceKeyId as DeviceKeyId,
    allowList: data.allowList as SignedAllowList,
  }
}

function isNonceMessage(data: unknown): data is { nonce: string } {
  return !!data && typeof data === 'object' && typeof (data as { nonce?: unknown }).nonce === 'string'
}

function isSignatureMessage(data: unknown): data is { signature: string } {
  return (
    !!data && typeof data === 'object' && typeof (data as { signature?: unknown }).signature === 'string'
  )
}

function randomChallenge(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))
}

function deny(reason: string): never {
  throw new Error(`${IDENTITY_DENIED_PREFIX}: ${reason}`)
}

function resolveProviderConfig(
  providerId: string,
  deps: IdentityHandshakeDeps
): IdentityProvider | undefined {
  if (deps.resolveProvider) return deps.resolveProvider(providerId)
  return getIdentityProvider(providerId)
}

export function createIdentityHandshake(deps: IdentityHandshakeDeps): PeerHandshake {
  return async (_peerId, send, receive, isInitiator) => {
    const mine = await deps.getAttestation()

    let theirsRaw: unknown
    if (isInitiator) {
      await send(mine)
      ;({ data: theirsRaw } = await receive())
    } else {
      ;({ data: theirsRaw } = await receive())
      await send(mine)
    }

    if (!isAttestationShape(theirsRaw)) deny('malformed attestation')
    const theirs = normalizeAttestation(theirsRaw as Record<string, unknown>)

    const provider = resolveProviderConfig(theirs.providerId, deps)
    if (!provider) deny(`unknown identity provider: ${theirs.providerId}`)

    let claims: OidcIdTokenClaims
    try {
      const fetchJwks =
        provider.fetchJwks ??
        (theirs.providerId === 'google' && deps.fetchJwks
          ? deps.fetchJwks
          : defaultJwksFetcher(provider.jwksUrl))
      claims = await verifyOidcIdToken(theirs.idToken, {
        expectedAudience: provider.clientId,
        expectedNonce: theirs.deviceKeyId,
        issuers: provider.issuers,
        issuerPrefixes: provider.issuerPrefixes,
        fetchJwks,
        jwksCacheKey: provider.id,
      })
    } catch (err) {
      deny(`ID token: ${err instanceof Error ? err.message : String(err)}`)
    }

    if (!(await verifyAllowList(theirs.allowList, deps.creatorKeyId))) {
      deny('allow-list signature does not match this workspace')
    }
    if (!isEmailAllowed(theirs.allowList, claims.email)) {
      deny(`${claims.email} is not on this workspace's invite list`)
    }

    const myChallenge = randomChallenge()
    let theirChallengeRaw: unknown
    if (isInitiator) {
      await send({ nonce: myChallenge })
      ;({ data: theirChallengeRaw } = await receive())
    } else {
      ;({ data: theirChallengeRaw } = await receive())
      await send({ nonce: myChallenge })
    }
    if (!isNonceMessage(theirChallengeRaw)) deny('malformed challenge')

    const myProof = await deps.identity.sign(new TextEncoder().encode(theirChallengeRaw.nonce))

    let theirProofRaw: unknown
    if (isInitiator) {
      await send({ signature: myProof })
      ;({ data: theirProofRaw } = await receive())
    } else {
      ;({ data: theirProofRaw } = await receive())
      await send({ signature: myProof })
    }
    if (!isSignatureMessage(theirProofRaw)) deny('malformed proof')

    const possessesKey = await verifyWithDeviceKeyId(
      theirs.deviceKeyId,
      new TextEncoder().encode(myChallenge),
      theirProofRaw.signature
    )
    if (!possessesKey) {
      deny('device key proof-of-possession failed (likely a replayed ID token)')
    }

    deps.onPeerVerified?.(_peerId, claims)
    deps.onAllowListSeen?.(theirs.allowList)
  }
}