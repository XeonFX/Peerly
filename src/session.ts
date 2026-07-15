import { DEFAULT_USER_COLOR } from './config'
import { migrateLegacyAvatarDataUrl, resolveAvatarPreview } from './collab/avatarService'
import type { SignedAllowList } from './collab/allowList'
import type { DeviceKeyId } from './collab/deviceIdentity'
import type { IdentityProviderId } from './collab/identityProviders'
import type { UserProfile } from './types'

export type PersistedSession = {
  /** High-entropy secret — doubles as the Trystero room password. */
  workspaceId: string
  /** Human-readable label shown in the UI. */
  workspaceName: string
  creatorKeyId: DeviceKeyId
  allowList: SignedAllowList
  identityEmail: string
  identityProvider: IdentityProviderId
  userName: string
  color: string
  avatarId?: string
}

export type Session = PersistedSession & {
  avatar?: string
}

const PERSIST_KEY = 'peerly-session'
const ID_TOKEN_KEY = 'peerly-id-token'
const ID_PROVIDER_KEY = 'peerly-id-provider'

type StoredSession = Partial<PersistedSession> & {
  avatar?: string
}

export function loadPersistedSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as StoredSession
    if (typeof data.workspaceId !== 'string' || typeof data.userName !== 'string') {
      return null
    }
    if (
      typeof data.workspaceName !== 'string' ||
      typeof data.creatorKeyId !== 'string' ||
      !data.allowList ||
      typeof data.identityEmail !== 'string' ||
      typeof data.identityProvider !== 'string'
    ) {
      return null
    }
    return {
      workspaceId: data.workspaceId,
      workspaceName: data.workspaceName,
      creatorKeyId: data.creatorKeyId,
      allowList: data.allowList,
      identityEmail: data.identityEmail,
      identityProvider: data.identityProvider,
      userName: data.userName,
      color: typeof data.color === 'string' ? data.color : DEFAULT_USER_COLOR,
      avatarId: typeof data.avatarId === 'string' ? data.avatarId : undefined,
    }
  } catch {
    return null
  }
}

export function loadIdToken(): string | null {
  return sessionStorage.getItem(ID_TOKEN_KEY)
}

export function loadIdentityProvider(): IdentityProviderId | null {
  const stored = sessionStorage.getItem(ID_PROVIDER_KEY)
  if (
    stored === 'google' ||
    stored === 'microsoft' ||
    stored === 'github' ||
    stored === 'apple' ||
    stored === 'oidc'
  ) {
    return stored
  }
  return null
}

export function saveIdCredentials(token: string, providerId: IdentityProviderId): void {
  sessionStorage.setItem(ID_TOKEN_KEY, token)
  sessionStorage.setItem(ID_PROVIDER_KEY, providerId)
}

export function clearIdCredentials(): void {
  sessionStorage.removeItem(ID_TOKEN_KEY)
  sessionStorage.removeItem(ID_PROVIDER_KEY)
}

export function loadSession(): Session | null {
  const persisted = loadPersistedSession()
  if (!persisted) return null
  if (!loadIdToken()) return null
  return persisted
}

export function saveSession(session: Session): void {
  const { avatar: _avatar, ...persisted } = session
  localStorage.setItem(PERSIST_KEY, JSON.stringify(persisted))
}

/** Leave workspace but keep profile for next join. */
export function leaveWorkspace(): void {
  clearIdCredentials()
}

/** Full reset — profile and workspace. */
export function clearSession(): void {
  localStorage.removeItem(PERSIST_KEY)
  clearIdCredentials()
}

export function createSessionFromInvite(
  invite: {
    workspaceId: string
    workspaceName: string
    creatorKeyId: DeviceKeyId
    allowList: SignedAllowList
  },
  identityEmail: string,
  identityProvider: IdentityProviderId,
  displayName?: string
): Session {
  const saved = loadPersistedSession()
  return {
    workspaceId: invite.workspaceId,
    workspaceName: invite.workspaceName,
    creatorKeyId: invite.creatorKeyId,
    allowList: invite.allowList,
    identityEmail,
    identityProvider,
    userName: saved?.userName ?? displayName ?? identityEmail.split('@')[0],
    color: saved?.color ?? DEFAULT_USER_COLOR,
    avatarId: saved?.avatarId,
  }
}

export async function hydrateSessionAvatar(session: Session): Promise<Session> {
  const avatar = await resolveAvatarPreview(session.avatarId)
  return { ...session, avatar }
}

/** Migrate inline avatar data URLs to IndexedDB-backed avatar ids. */
export async function migrateLegacySession(): Promise<void> {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return
    const data = JSON.parse(raw) as StoredSession
    if (typeof data.avatar !== 'string' || !data.avatar.startsWith('data:image/')) {
      return
    }
    if (data.avatarId) return

    const avatarId = await migrateLegacyAvatarDataUrl(data.avatar)
    const next = {
      ...data,
      avatarId,
    }
    delete next.avatar
    localStorage.setItem(PERSIST_KEY, JSON.stringify(next))
  } catch {
    // ignore migration failures
  }
}

export function sessionProfile(session: Session): UserProfile {
  return {
    name: session.userName,
    color: session.color,
    avatar: session.avatar,
  }
}