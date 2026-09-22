import { isAllowedGoogleAvatarUrl, isSafeAvatarUrl } from './avatarSafety.js'
import { processAvatarBlob, processAvatarImage } from './avatarImage.js'
import type { AvatarStore } from './avatarStore.js'

/**
 * Getting an avatar into the local store: from a file the user picked, from a
 * provider's profile photo, or from a legacy inline data URL.
 *
 * Every path re-encodes the image before storing it, so what peers eventually
 * receive is bytes this app produced rather than anything the source chose.
 *
 * Deciding *which* avatar an account currently has stays with each app — one
 * keeps a single stored profile, the other keeps per-account extras — so this
 * service never reads or writes a profile.
 */
export type AvatarUpload = {
  avatarId: string
  /** Re-encoded image, ready for `<img src>` without a round trip. */
  dataUrl: string
}

export type AvatarService = {
  /** Stores a user-picked file, replacing `previousAvatarId` if given. */
  upload(file: File, previousAvatarId?: string): Promise<AvatarUpload>
  remove(avatarId?: string): Promise<void>
  preview(avatarId?: string): Promise<string | undefined>
  /**
   * Imports a provider-hosted profile photo. Only ever called by the
   * signed-in user's own browser: peers receive the re-encoded data URL, never
   * this URL. `no-referrer` keeps the provider from learning which of its
   * hosted images this app fetched, and for whom.
   *
   * Throws when the URL is not a trusted provider host, or the fetch fails.
   */
  importFromUrl(url: string, previousAvatarId?: string): Promise<AvatarUpload>
  /** Moves an inline `data:` avatar into the store, returning its new id. */
  adoptDataUrl(dataUrl: string, previousAvatarId?: string): Promise<string>
}

export function createAvatarService(store: AvatarStore): AvatarService {
  /**
   * Housekeeping, not correctness: the new avatar is already stored, so a
   * failure to drop the old one must not lose the caller their new id.
   */
  async function discard(avatarId: string | undefined): Promise<void> {
    if (!avatarId) return
    try {
      await store.remove(avatarId)
    } catch {
      // Leaves one orphaned blob; the account still has the right avatar.
    }
  }

  async function adopt(blob: Blob, dataUrl: string, previousAvatarId?: string): Promise<AvatarUpload> {
    const avatarId = crypto.randomUUID()
    await store.save(avatarId, blob)
    await discard(previousAvatarId)
    return { avatarId, dataUrl }
  }

  return {
    async upload(file, previousAvatarId) {
      const { blob, dataUrl } = await processAvatarImage(file)
      return adopt(blob, dataUrl, previousAvatarId)
    },

    async remove(avatarId) {
      if (avatarId) await store.remove(avatarId)
    },

    async preview(avatarId) {
      if (!avatarId) return undefined
      return (await store.loadDataUrl(avatarId)) ?? undefined
    },

    async importFromUrl(url, previousAvatarId) {
      if (!isAllowedGoogleAvatarUrl(url)) {
        throw new Error('Avatar URL is not from a trusted provider.')
      }
      const response = await fetch(url, { referrerPolicy: 'no-referrer' })
      if (!response.ok) {
        throw new Error(`Failed to fetch avatar: HTTP ${response.status}`)
      }
      const { blob, dataUrl } = await processAvatarBlob(await response.blob())
      return adopt(blob, dataUrl, previousAvatarId)
    },

    async adoptDataUrl(dataUrl, previousAvatarId) {
      // Guarded here rather than only at the call site: this fetches whatever
      // it is handed, and an https URL would reach out to its host.
      if (!isSafeAvatarUrl(dataUrl)) {
        throw new Error('Not an inline image.')
      }
      const avatarId = crypto.randomUUID()
      await store.save(avatarId, await (await fetch(dataUrl)).blob())
      await discard(previousAvatarId)
      return avatarId
    },
  }
}
