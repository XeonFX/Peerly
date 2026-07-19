import { DEFAULT_USER_COLOR } from './config'
import { loadStoredProfile } from './collab/profileStore'
import { base64UrlToUtf8 } from './utils/base64url'
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
  /** Local workspace icon id in IndexedDB. */
  workspaceAvatarId?: string
  creatorKeyId: DeviceKeyId
  allowList: SignedAllowList
  identityEmail: string
  /** Durable user id (hash of OIDC iss+sub) — see collab/userId. */
  identityUserId?: string
  identityProvider: IdentityProviderId
  userName: string
  color: string
  avatarId?: string
}

export type Session = PersistedSession & {
  avatar?: string
  workspaceAvatar?: string
}

/** The workspace currently open. Cleared when switching workspaces. */
const PERSIST_KEY = 'peerly-session'

/**
 * Who is signed in, kept independently of which workspace is open so that
 * leaving a workspace does not sign the user out — they land on the picker and
 * open another one.
 *
 * Split storage, deliberately:
 * - The raw ID TOKEN stays session-scoped (sessionStorage): it is a bearer
 *   credential, and a new tab / restart should not resurrect it.
 * - The identity METADATA (email, provider, durable userId) is not a
 *   credential — it only drives what the UI offers (your workspaces, whose
 *   name, which provider to re-auth with). It lives in localStorage so a
 *   restart still knows who you are; peers never trust it (they verify the
 *   token itself in the handshake).
 */
const ID_TOKEN_KEY = 'peerly-id-token'
const ID_USER_ID_KEY = 'peerly-id-user-id'
const ID_PROVIDER_KEY = 'peerly-id-provider'
const ID_EMAIL_KEY = 'peerly-id-email'

/** Read identity metadata from localStorage, migrating any pre-split value. */
function readIdentityValue(key: string): string | null {
  const durable = localStorage.getItem(key)
  if (durable !== null) return durable
  const legacy = sessionStorage.getItem(key)
  if (legacy !== null) {
    localStorage.setItem(key, legacy)
    sessionStorage.removeItem(key)
  }
  return legacy
}

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
      workspaceAvatarId:
        typeof data.workspaceAvatarId === 'string' ? data.workspaceAvatarId : undefined,
      creatorKeyId: data.creatorKeyId,
      allowList: data.allowList,
      identityEmail: data.identityEmail,
      identityUserId: typeof data.identityUserId === 'string' ? data.identityUserId : undefined,
      identityProvider: data.identityProvider,
      userName: data.userName,
      color: typeof data.color === 'string' ? data.color : DEFAULT_USER_COLOR,
      avatarId: typeof data.avatarId === 'string' ? data.avatarId : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Read `exp` without verifying the signature.
 *
 * That is safe *for this purpose only*: the question here is "is our own stored
 * token still worth presenting", not "should we trust this token". Every peer
 * re-verifies signature, issuer, audience, nonce and expiry before admitting
 * anyone, so a tampered `exp` buys nothing — it just means we try and get
 * rejected, exactly as if we hadn't checked. Never use this to make an
 * authorization decision; use verifyOidcIdToken.
 */
export function idTokenExpiryMs(token: string): number | null {
  try {
    const payload = JSON.parse(base64UrlToUtf8(token.split('.')[1])) as { exp?: unknown }
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

/**
 * ID tokens live about an hour. An expired token is treated as no token, but
 * ONLY the token is dropped — the identity metadata (who you are) survives so
 * the workspace stays open and the ReauthBanner can offer a one-click renewal
 * with the same account, instead of dumping the user back to the join screen.
 */
export function loadIdToken(): string | null {
  const token = sessionStorage.getItem(ID_TOKEN_KEY)
  if (!token) return null

  const expiresAt = idTokenExpiryMs(token)
  if (expiresAt !== null && expiresAt <= Date.now()) {
    clearIdToken()
    return null
  }
  return token
}

/** Drop only the bearer token; identity metadata (email/provider/id) stays. */
export function clearIdToken(): void {
  sessionStorage.removeItem(ID_TOKEN_KEY)
}

export function loadIdentityProvider(): IdentityProviderId | null {
  const stored = readIdentityValue(ID_PROVIDER_KEY)
  if (
    stored === 'google' ||
    stored === 'microsoft' ||
    stored === 'apple' ||
    stored === 'oidc'
  ) {
    return stored
  }
  return null
}

/**
 * The verified email of the signed-in user.
 *
 * Stored alongside the token rather than derived from it: this is only used to
 * decide what the UI offers (which workspaces, whose name). It is never an
 * authorization input — peers re-verify the token itself, so a tampered value
 * here changes nothing except that the user gets rejected at the handshake.
 */
export function loadIdentityEmail(): string | null {
  return readIdentityValue(ID_EMAIL_KEY)
}

export function saveIdCredentials(
  token: string,
  providerId: IdentityProviderId,
  email: string,
  userId?: string
): void {
  sessionStorage.setItem(ID_TOKEN_KEY, token)
  localStorage.setItem(ID_PROVIDER_KEY, providerId)
  localStorage.setItem(ID_EMAIL_KEY, email)
  if (userId) {
    localStorage.setItem(ID_USER_ID_KEY, userId)
  } else {
    localStorage.removeItem(ID_USER_ID_KEY)
  }
}

export function loadIdentityUserId(): string | null {
  return readIdentityValue(ID_USER_ID_KEY)
}

/** Full sign-out: token AND identity metadata, from both storages. */
export function clearIdCredentials(): void {
  sessionStorage.removeItem(ID_TOKEN_KEY)
  for (const key of [ID_USER_ID_KEY, ID_PROVIDER_KEY, ID_EMAIL_KEY]) {
    sessionStorage.removeItem(key)
    localStorage.removeItem(key)
  }
}

/**
 * Close the open workspace but stay signed in — the "switch workspace" path.
 * Deliberately distinct from leaveWorkspace(), which drops the identity too.
 */
export function clearActiveWorkspace(): void {
  localStorage.removeItem(PERSIST_KEY)
}

/** The signed-in identity, independent of any active workspace. */
export type StoredIdentity = {
  email: string
  token: string
  providerId: IdentityProviderId
  userId?: string
}

/**
 * Restore the signed-in identity from stored credentials, independent of any
 * workspace — so switching workspaces in place from the rail works while on the
 * home view with no active session. Returns null unless a full, still-valid
 * credential set is present (an expired token reads as signed-out here).
 */
export function loadSignedInIdentity(): StoredIdentity | null {
  const token = loadIdToken()
  const providerId = loadIdentityProvider()
  const email = loadIdentityEmail()
  if (!token || !providerId || !email) return null
  return { email, token, providerId, userId: loadIdentityUserId() ?? undefined }
}

/**
 * The open workspace, independent of ID-token freshness. Tokens live ~1h; the
 * workspace session must not — everything needed to come back (workspace
 * secret, allow-list, profile) is durable, message signing uses the device
 * key, and only NEW peer handshakes need a live token. A reload past token
 * expiry therefore lands back in the workspace with the ReauthBanner showing
 * (missing token ⇒ 'expired' phase), instead of a full logout that read as
 * "the app forgot me".
 */
export function loadSession(): Session | null {
  return loadPersistedSession()
}

export function saveSession(session: Session): void {
  const { avatar: _avatar, workspaceAvatar: _workspaceAvatar, ...persisted } = session
  localStorage.setItem(PERSIST_KEY, JSON.stringify(persisted))
}

/**
 * Full logout: drop identity and the open workspace. (Display profile and the
 * remembered-workspaces picker live in their own stores and survive.) Entry is
 * no longer gated on credentials — loadSession returns any persisted workspace
 * — so leaving must clear the workspace itself, not just the identity.
 */
export function leaveWorkspace(): void {
  clearIdCredentials()
  clearActiveWorkspace()
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
    workspaceAvatarId?: string
  },
  identityEmail: string,
  identityProvider: IdentityProviderId,
  displayName?: string,
  identityUserId?: string
): Session {
  const saved = loadPersistedSession()
  const storedProfile = loadStoredProfile()
  return {
    workspaceId: invite.workspaceId,
    workspaceName: invite.workspaceName,
    workspaceAvatarId: invite.workspaceAvatarId,
    creatorKeyId: invite.creatorKeyId,
    allowList: invite.allowList,
    identityEmail,
    identityUserId,
    identityProvider,
    // Precedence: live session (mid-session rejoin) > the profile store
    // (survives leaving a workspace) > provider display name > email stem.
    userName: saved?.userName ?? storedProfile.userName ?? displayName ?? identityEmail.split('@')[0],
    color: saved?.color ?? storedProfile.color ?? DEFAULT_USER_COLOR,
    avatarId: saved?.avatarId ?? storedProfile.avatarId,
  }
}

export async function hydrateSessionAvatar(session: Session): Promise<Session> {
  const [avatar, workspaceAvatar] = await Promise.all([
    resolveAvatarPreview(session.avatarId),
    resolveAvatarPreview(session.workspaceAvatarId),
  ])
  return { ...session, avatar, workspaceAvatar }
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