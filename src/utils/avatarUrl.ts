/**
 * Avatars arrive from peers as arbitrary strings. Rendering one straight into
 * `<img src>` lets any peer point every member's browser at a URL they control,
 * which leaks each viewer's IP and User-Agent to them. Only allow inline image
 * data we can't be tricked into fetching.
 *
 * svg+xml is excluded deliberately: it is a document format, not just pixels.
 */
const ALLOWED_AVATAR_PREFIXES = [
  'data:image/png;',
  'data:image/jpeg;',
  'data:image/webp;',
  'data:image/gif;',
]

export function isSafeAvatarUrl(avatar: string | undefined): boolean {
  if (!avatar) return false
  const value = avatar.trim().toLowerCase()
  return ALLOWED_AVATAR_PREFIXES.some(prefix => value.startsWith(prefix))
}

/** Returns the avatar if it is safe to render, otherwise undefined. */
export function safeAvatarUrl(avatar: string | undefined): string | undefined {
  return isSafeAvatarUrl(avatar) ? avatar : undefined
}

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
