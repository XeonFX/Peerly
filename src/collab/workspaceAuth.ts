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
import { generateWorkspaceId, type WorkspaceInvite } from './inviteLink'

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

  /** @deprecated Use getIdToken */
  getGoogleToken(): string | null {
    return this.idToken
  }

  /** @deprecated Use setIdToken */
  setGoogleToken(token: string | null): void {
    this.setIdToken(token, 'google')
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
      issuerPrefixes: provider.issuerPrefixes,
      fetchJwks,
      jwksCacheKey: provider.id,
    })
    this.idToken = token
    this.identityProvider = providerId
    return claims
  }

  /** @deprecated Use verifyAndStoreIdToken */
  async verifyAndStoreGoogleToken(token: string): Promise<OidcIdTokenClaims> {
    return this.verifyAndStoreIdToken(token, 'google')
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

function getE2eProvider(providerId: IdentityProviderId): IdentityProvider | null {
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

export async function verifyInviteAllowList(invite: WorkspaceInvite): Promise<boolean> {
  return verifyAllowList(invite.allowList, invite.creatorKeyId)
}