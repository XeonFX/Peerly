/**
 * This app's avatar handling.
 *
 * Getting an avatar into local storage lives in `@peerly/core`. What stays
 * here is where the current avatar id is kept — this app has one stored
 * profile, not per-account extras.
 */
import { createAvatarService } from '@peerly/core'
import { loadStoredProfile, saveStoredProfile } from './profileStore'
import { avatarStore } from '../utils/avatarStore'

const service = createAvatarService(avatarStore)

export const uploadAvatar = service.upload
export const removeAvatar = service.remove
export const resolveAvatarPreview = service.preview
export const importAvatarFromUrl = service.importFromUrl
export const migrateLegacyAvatarDataUrl = service.adoptDataUrl

/** Import the OIDC profile photo on first sign-in when no custom avatar exists yet. */
export async function ensureOidcAvatar(picture?: string): Promise<void> {
  if (loadStoredProfile().avatarId || !picture) return
  try {
    const { avatarId } = await importAvatarFromUrl(picture)
    saveStoredProfile({ avatarId })
  } catch {
    // Sign-in still succeeds without an imported avatar.
  }
}
