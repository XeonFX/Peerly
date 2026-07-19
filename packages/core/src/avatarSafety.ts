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
 * OIDC Google profile photo hosts (https only). Used when importing a provider
 * picture into the local avatar store — not for peer-supplied img src.
 */
export function isAllowedGoogleAvatarUrl(url: string): boolean {
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
