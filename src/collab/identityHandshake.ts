import type { PeerHandshake } from '@trystero-p2p/core'
import {
  exchangeHandshakeStep,
  IDENTITY_DENIED_PREFIX,
  olderPeer,
  parseTabCertificate,
  proveTabKeys,
  TabSession,
  type TabCertificate,
} from '@peerly/core'
import { base64UrlToUtf8 } from '../utils/base64url'
import { DeviceIdentity, type DeviceKeyId } from './deviceIdentity'
import {
  defaultJwksFetcher,
  getIdentityProvider,
  type IdentityProvider,
} from './identityProviders'
import { verifyOidcIdToken, type JwksFetcher, type OidcIdTokenClaims } from './oidcIdToken'
import { isEmailAllowed, newerAllowList, verifyAllowList, type SignedAllowList } from './allowList'

export { IDENTITY_DENIED_PREFIX }

export type Attestation = {
  idToken: string
  providerId: string
  deviceKeyId: DeviceKeyId
  allowList: SignedAllowList
}

/** What goes on the wire: the attestation plus this tab's certificate for the workspace. */
type WireAttestation = Attestation & { tab: TabCertificate }

export type IdentityHandshakeDeps = {
  identity: DeviceIdentity
  /**
   * This tab. Its key signs the handshake proofs and the device key certifies it per workspace, so two tabs of one
   * browser (one device key) are still two distinct peers. Defaults to a fresh tab key for this handshake factory.
   */
  tab?: TabSession
  /**
   * Whether a tab key belongs to another open tab of this browser. A peer presenting this device's own key is admitted
   * only if this confirms it; without it, such a peer is refused as before.
   */
  isSiblingTab?: (tabKeyId: DeviceKeyId) => Promise<boolean>
  getAttestation: () => Promise<Attestation>
  creatorKeyId: DeviceKeyId
  workspaceSecret?: string
  /** Injectable for tests — resolves provider config by id. */
  resolveProvider?: (providerId: string) => IdentityProvider | undefined
  /** Injectable for tests; overrides JWKS fetch for the google provider. */
  fetchJwks?: JwksFetcher
  /** `sameDevice`: the peer is another tab of this browser (it holds this device's key, under its own tab key). */
  onPeerVerified?: (
    peerId: string,
    claims: OidcIdTokenClaims,
    deviceKeyId: DeviceKeyId,
    tabKeyId: DeviceKeyId,
    sameDevice: boolean
  ) => void
  onAllowListSeen?: (list: SignedAllowList) => void
  /**
   * The newest creator-signed list this device holds. Authorization judges the
   * peer against the newer of this and the list they present — a peer showing
   * an old list that still names them is rejected once we hold a newer list
   * that does not. This is what makes removal real for updated members; a
   * removed member and a member who never saw the update can still pair, which
   * is the honest limit of revocation without a server.
   */
  getKnownAllowList?: () => SignedAllowList
}

/**
 * Every field here is attacker-controlled — this is the first thing a stranger
 * gets to send us. Accept one exact shape and nothing else: a peer that omits
 * `providerId` is not silently treated as Google, because that would let the
 * shape of a request decide which issuer we trust.
 */
function isAttestationShape(data: unknown): data is WireAttestation {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  if (typeof d.idToken === 'string' && d.tab === undefined) olderPeer()
  if (!parseTabCertificate(d.tab)) return false

  if (typeof d.idToken !== 'string' || !d.idToken) return false
  if (typeof d.providerId !== 'string' || !d.providerId) return false
  if (typeof d.deviceKeyId !== 'string' || !d.deviceKeyId) return false

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

function deny(reason: string): never {
  throw new Error(`${IDENTITY_DENIED_PREFIX}: ${reason}`)
}

/**
 * The email a rejected token CLAIMS to belong to — read without verification,
 * purely so the error can say which device to go fix. A user with two open
 * devices otherwise sees "Token expired", re-authenticates the healthy one,
 * and watches the error persist: nothing tells them the dead token lives on
 * the machine they are not looking at. The claim is attacker-controlled, so
 * it is length-capped and always labelled "claims to be", never trusted.
 */
function unverifiedEmailClaim(token: string): string | null {
  try {
    const payload = JSON.parse(base64UrlToUtf8(token.split('.')[1])) as { email?: unknown }
    const email = payload.email
    if (typeof email !== 'string' || !email.includes('@') || email.length > 100) return null
    return email
  } catch {
    return null
  }
}

function resolveProviderConfig(
  providerId: string,
  deps: IdentityHandshakeDeps
): IdentityProvider | undefined {
  if (deps.resolveProvider) return deps.resolveProvider(providerId)
  return getIdentityProvider(providerId)
}

export function createIdentityHandshake(deps: IdentityHandshakeDeps): PeerHandshake {
  const tab = deps.tab ?? new TabSession(deps.identity)
  // The proofs and the tab certificate are bound to this workspace: neither is worth anything in another one.
  const context = `workspace:${deps.creatorKeyId}`
  return async (_peerId, send, receive, isInitiator) => {
    const mine: WireAttestation = { ...(await deps.getAttestation()), tab: await tab.certificate(context) }
    const theirsRaw = await exchangeHandshakeStep(send, receive, isInitiator, mine)

    if (!isAttestationShape(theirsRaw)) deny('malformed attestation')
    const theirs = theirsRaw

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
        fetchJwks,
        jwksCacheKey: provider.id,
        emailVerifiedClaim: provider.emailVerifiedClaim,
      })
    } catch (err) {
      const claimed = unverifiedEmailClaim(theirs.idToken)
      deny(
        `ID token: ${err instanceof Error ? err.message : String(err)}${
          claimed ? ` (peer claims to be ${claimed})` : ''
        }`
      )
    }

    if (!(await verifyAllowList(theirs.allowList, deps.creatorKeyId, deps.workspaceSecret))) {
      deny('allow-list signature does not match this workspace')
    }
    const known = deps.getKnownAllowList?.()
    const effective = known ? newerAllowList(known, theirs.allowList) : theirs.allowList
    if (!isEmailAllowed(effective, claims.email)) {
      deny(`${claims.email} is not on this workspace's invite list`)
    }

    // Bound to this workspace, both devices, both tabs and both challenges. The tab key signs the proof, so the device
    // key – the creator's, on the creator's tabs – signs nothing in a handshake, let alone something a peer chose.
    const theirTab = parseTabCertificate(theirs.tab)!
    await proveTabKeys({
      send, receive, isInitiator, tab, context, isSiblingTab: deps.isSiblingTab,
      myKeyId: mine.deviceKeyId, myTab: mine.tab, theirKeyId: theirs.deviceKeyId, theirTab,
    })

    deps.onPeerVerified?.(_peerId, claims, theirs.deviceKeyId, theirTab.tabKeyId, theirs.deviceKeyId === mine.deviceKeyId)
    deps.onAllowListSeen?.(theirs.allowList)
  }
}
