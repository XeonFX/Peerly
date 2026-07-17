import { isSafeAvatarUrl } from '@peerly/core'

// isSafeAvatarUrl/safeAvatarUrl now live in @peerly/core (avatarSafety.ts) so
// HeyHubs shares the exact same allowlist; re-exported here so existing
// imports throughout this app keep working unchanged.
export { isSafeAvatarUrl, safeAvatarUrl } from '@peerly/core'

/**
 * File thumbnails ride the same rules as avatars (inline raster data only),
 * plus a length cap: they are stored per message in localStorage and relayed
 * in history, so an oversized one is a storage/bandwidth griefing vector.
 */
const MAX_THUMBNAIL_CHARS = 100_000

export function safeThumbnailUrl(value: string | undefined): string | undefined {
  if (!value || value.length > MAX_THUMBNAIL_CHARS) return undefined
  return isSafeAvatarUrl(value) ? value : undefined
}
