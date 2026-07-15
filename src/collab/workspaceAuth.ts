import type { PeerHandshake } from '@trystero-p2p/core'
import { DeviceIdentity, type DeviceKeyId } from './deviceIdentity'
import { signAllowList, verifyAllowList, newerAllowList, type SignedAllowList } from './allowList'
import {
  issueE2eGoogleToken,
  getE2eJwksFetcher,
  isE2eAuthBypass,
  E2E_GOOGLE_CLIENT_ID,
} from './e2eAuth'
import {
  defaultJwksFetcher,
  getIdentityProvider,
  type IdentityProvider,
  type IdentityProviderId,
} from './identityProviders'
import { verifyOidcIdToken, type JwksFetcher, type OidcIdTokenClaims } from './oidcIdToken'
import { createIdentityHandshake } from './identityHandshake'
import { generateWorkspaceId, type WorkspaceAccess, type WorkspaceInvite } from './inviteLink'

export type WorkspaceAuthConfig = {
  workspaceId: string
  creatorKeyId: DeviceKeyId
  allowList: SignedAllowList
}

export class WorkspaceAuthManager {
  private readonly identity = new DeviceIdentity()
  private readonly config: WorkspaceAuthConfig
  private allowList: SignedAllowList
  private idToken: string | null = null
  private identityProvider: IdentityProviderId | null = null
  private readonly fetchJwks: JwksFetcher | undefined

  constructor(config: WorkspaceAuthConfig, options?: { fetchJwks?: JwksFetcher }) {
    this.config = config
    this.allowList = config.allowList
    this.fetchJwks = options?.fetchJwks ?? (isE2eAuthBypass() ? getE2eJwksFetcher() : undefined)
  }

  getAllowList(): SignedAllowList {
    return this.allowList
  }

  setAllowList(list: SignedAllowList): void {
    this.allowList = list
  }

  getIdToken(): string | null {
    return this.idToken
  }

  setIdToken(token: string | null, providerId?: IdentityProviderId | null): void {
    this.idToken = token
    if (providerId !== undefined) {
      this.identityProvider = providerId
    }
  }

  getIdentityProvider(): IdentityProviderId | null {
    return this.identityProvider
  }

  setIdentityProvider(providerId: IdentityProviderId | null): void {
    this.identityProvider = providerId
  }

  async deviceKeyId(): Promise<DeviceKeyId> {
    return this.identity.publicKeyId()
  }

  async verifyAndStoreIdToken(
    token: string,
    providerId: IdentityProviderId
  ): Promise<OidcIdTokenClaims> {
    const keyId = await this.deviceKeyId()
    const provider = getE2eProvider(providerId) ?? getIdentityProvider(providerId)
    if (!provider) {
      throw new Error(`Identity provider "${providerId}" is not configured`)
    }

    const fetchJwks =
      provider.fetchJwks ??
      (providerId === 'google' && this.fetchJwks
        ? this.fetchJwks
        : defaultJwksFetcher(provider.jwksUrl))

    const claims = await verifyOidcIdToken(token, {
      expectedAudience: provider.clientId,
      expectedNonce: keyId,
      issuers: provider.issuers,
      fetchJwks,
      jwksCacheKey: provider.id,
      emailVerifiedClaim: provider.emailVerifiedClaim,
    })
    this.idToken = token
    this.identityProvider = providerId
    return claims
  }

  async signInWithE2eEmail(email: string): Promise<OidcIdTokenClaims> {
    if (!isE2eAuthBypass()) {
      throw new Error('E2E auth bypass is not enabled')
    }
    const keyId = await this.deviceKeyId()
    const token = await issueE2eGoogleToken(email, keyId)
    return this.verifyAndStoreIdToken(token, 'google')
  }

  buildPeerHandshake(handlers?: {
    onPeerVerified?: (peerId: string, claims: OidcIdTokenClaims) => void
    onAllowListUpdated?: (list: SignedAllowList) => void
  }): PeerHandshake {
    return createIdentityHandshake({
      identity: this.identity,
      getAttestation: async () => {
        const token = this.idToken
        const providerId = this.identityProvider
        if (!token || !providerId) throw new Error('Sign-in required')
        return {
          idToken: token,
          providerId,
          deviceKeyId: await this.deviceKeyId(),
          allowList: this.allowList,
        }
      },
      resolveProvider: providerId =>
        getE2eProvider(providerId) ?? getIdentityProvider(providerId),
      fetchJwks: this.fetchJwks,
      creatorKeyId: this.config.creatorKeyId,
      onPeerVerified: handlers?.onPeerVerified,
      onAllowListSeen: list => {
        void verifyAllowList(list, this.config.creatorKeyId).then(valid => {
          if (!valid) return
          const next = newerAllowList(this.allowList, list)
          if (next.signedAt !== this.allowList.signedAt) {
            this.allowList = next
            handlers?.onAllowListUpdated?.(next)
          }
        })
      },
    })
  }

  /**
   * Whether this device can change who is allowed in.
   *
   * The allow-list is only accepted by peers if it verifies against the
   * workspace's `creatorKeyId`, and that key never leaves the browser profile
   * that created the workspace (see deviceIdentity.ts). So this is not a role
   * check that could be relaxed — a non-creator physically cannot produce a
   * signature anyone would accept, and neither can the creator from a second
   * device. Callers should use this to hide the invite UI rather than let
   * someone fill in emails and hit an error at the end.
   */
  async canInvite(): Promise<boolean> {
    return (await this.deviceKeyId()) === this.config.creatorKeyId
  }

  /**
   * Add members to an existing workspace by re-signing its allow-list.
   *
   * Existing members pick this up without any action: the newly invited peer
   * presents the newer list during its handshake, everyone verifies it against
   * the same `creatorKeyId`, and `newerAllowList` adopts it.
   *
   * There is deliberately no removeMembers(). Adding works because a signed list
   * is a *capability* — showing a newer one that includes you gets you in. That
   * same property makes removal ineffective: the handshake authorizes a peer
   * against the list they present, so anyone once invited keeps a validly signed
   * list naming them and can present it forever. Real revocation needs the
   * handshake to judge peers against the newest list *we* know rather than the
   * one they hand us, and even then only for peers who have seen the update.
   * Offering a remove button today would imply a guarantee that does not exist.
   */
  async addMembers(emails: string[]): Promise<SignedAllowList> {
    if (!(await this.canInvite())) {
      throw new Error(
        'Only the workspace creator can invite people, and only from the device that created it.'
      )
    }

    const next = await signAllowList(this.identity, [...this.allowList.emails, ...emails])
    this.allowList = next
    return next
  }

  async createInvite(workspaceName: string, memberEmails: string[]): Promise<WorkspaceInvite> {
    const creatorKeyId = await this.deviceKeyId()
    const workspaceId = generateWorkspaceId()
    const allowList = await signAllowList(this.identity, memberEmails)
    const invite: WorkspaceInvite = {
      v: 1,
      workspaceId,
      workspaceName: workspaceName.trim() || 'Workspace',
      creatorKeyId,
      allowList,
    }
    this.allowList = allowList
    return invite
  }
}

function getE2eProvider(providerId: string): IdentityProvider | null {
  if (!isE2eAuthBypass() || providerId !== 'google') return null
  return {
    id: 'google',
    label: 'Google',
    clientId: E2E_GOOGLE_CLIENT_ID,
    issuers: new Set(['https://accounts.google.com', 'accounts.google.com']),
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    fetchJwks: getE2eJwksFetcher(),
  }
}

/**
 * Does this workspace's allow-list actually carry its creator's signature?
 *
 * Takes WorkspaceAccess, not WorkspaceInvite, so a remembered workspace gets
 * checked on exactly the same path as a fresh invite link — localStorage is no
 * more trustworthy than a URL someone pasted.
 */
export async function verifyInviteAllowList(access: WorkspaceAccess): Promise<boolean> {
  return verifyAllowList(access.allowList, access.creatorKeyId)
}