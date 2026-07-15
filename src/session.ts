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

const PERSIST_KEY = 'flux-session'
const ID_TOKEN_KEY = 'flux-id-token'
const ID_PROVIDER_KEY = 'flux-id-provider'
const LEGACY_GOOGLE_TOKEN_KEY = 'flux-google-token'

type LegacySession = {
  workspace?: string
  workspaceId?: string
  workspaceName?: string
  password?: string
  userName?: string
  color?: string
  avatar?: string
  avatarId?: string
  creatorKeyId?: string
  allowList?: SignedAllowList
  googleEmail?: string
  identityEmail?: string
  identityProvider?: string
}

export function loadPersistedSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as Partial<LegacySession>
    const workspaceId = data.workspaceId ?? data.workspace
    const identityEmail = data.identityEmail ?? data.googleEmail
    if (typeof workspaceId !== 'string' || typeof data.userName !== 'string') {
      return null
    }
    if (
      typeof data.workspaceName !== 'string' ||
      typeof data.creatorKeyId !== 'string' ||
      !data.allowList ||
      typeof identityEmail !== 'string'
    ) {
      return null
    }
    const identityProvider = (data.identityProvider ?? 'google') as IdentityProviderId
    return {
      workspaceId,
      workspaceName: data.workspaceName,
      creatorKeyId: data.creatorKeyId,
      allowList: data.allowList,
      identityEmail,
      identityProvider,
      userName: data.userName,
      color: typeof data.color === 'string' ? data.color : DEFAULT_USER_COLOR,
      avatarId: typeof data.avatarId === 'string' ? data.avatarId : undefined,
    }
  } catch {
    return null
  }
}

export function loadIdToken(): string | null {
  return (
    sessionStorage.getItem(ID_TOKEN_KEY) ?? sessionStorage.getItem(LEGACY_GOOGLE_TOKEN_KEY)
  )
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
  if (sessionStorage.getItem(LEGACY_GOOGLE_TOKEN_KEY)) return 'google'
  return null
}

export function saveIdCredentials(token: string, providerId: IdentityProviderId): void {
  sessionStorage.setItem(ID_TOKEN_KEY, token)
  sessionStorage.setItem(ID_PROVIDER_KEY, providerId)
  sessionStorage.removeItem(LEGACY_GOOGLE_TOKEN_KEY)
}

export function clearIdCredentials(): void {
  sessionStorage.removeItem(ID_TOKEN_KEY)
  sessionStorage.removeItem(ID_PROVIDER_KEY)
  sessionStorage.removeItem(LEGACY_GOOGLE_TOKEN_KEY)
}

/** @deprecated Use loadIdToken */
export function loadGoogleToken(): string | null {
  return loadIdToken()
}

/** @deprecated Use saveIdCredentials */
export function saveGoogleToken(token: string): void {
  saveIdCredentials(token, 'google')
}

/** @deprecated Use clearIdCredentials */
export function clearGoogleToken(): void {
  clearIdCredentials()
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

export async function migrateLegacySession(): Promise<void> {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return
    const data = JSON.parse(raw) as LegacySession
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