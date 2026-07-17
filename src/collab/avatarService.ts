import { processAvatarBlob, processAvatarImage } from '@peerly/core'
import { loadStoredProfile, saveStoredProfile } from './profileStore'
import { deleteAvatar, loadAvatarDataUrl, saveAvatar } from '../utils/avatarStore'

function isAllowedOidcAvatarUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'lh3.googleusercontent.com' ||
        parsed.hostname.endsWith('.googleusercontent.com'))
    )
  } catch {
    return false
  }
}

export async function uploadAvatar(
  file: File,
  previousAvatarId?: string
): Promise<{ avatarId: string; dataUrl: string }> {
  const { blob, dataUrl } = await processAvatarImage(file)
  const avatarId = crypto.randomUUID()
  await saveAvatar(avatarId, blob)
  if (previousAvatarId) {
    await deleteAvatar(previousAvatarId)
  }
  return { avatarId, dataUrl }
}

export async function removeAvatar(avatarId?: string): Promise<void> {
  if (avatarId) {
    await deleteAvatar(avatarId)
  }
}

export async function resolveAvatarPreview(avatarId?: string): Promise<string | undefined> {
  if (!avatarId) return undefined
  return (await loadAvatarDataUrl(avatarId)) ?? undefined
}

export async function migrateLegacyAvatarDataUrl(dataUrl: string): Promise<string> {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  const avatarId = crypto.randomUUID()
  await saveAvatar(avatarId, blob)
  return avatarId
}

export async function importAvatarFromUrl(
  url: string,
  previousAvatarId?: string
): Promise<{ avatarId: string; dataUrl: string }> {
  if (!isAllowedOidcAvatarUrl(url)) {
    throw new Error('Avatar URL is not from a trusted provider.')
  }

  const response = await fetch(url, { referrerPolicy: 'no-referrer' })
  if (!response.ok) {
    throw new Error(`Failed to fetch avatar: HTTP ${response.status}`)
  }

  const { blob, dataUrl } = await processAvatarBlob(await response.blob())
  const avatarId = crypto.randomUUID()
  await saveAvatar(avatarId, blob)
  if (previousAvatarId) {
    await deleteAvatar(previousAvatarId)
  }
  return { avatarId, dataUrl }
}

/** Import the OIDC profile photo on first sign-in when no custom avatar exists yet. */
export async function ensureOidcAvatar(picture?: string): Promise<void> {
  const stored = loadStoredProfile()
  if (stored.avatarId || !picture) return

  try {
    const { avatarId } = await importAvatarFromUrl(picture)
    saveStoredProfile({ avatarId })
  } catch {
    // Sign-in still succeeds without an imported avatar.
  }
}