import type { UserProfile } from '../types'
import { safeAvatarUrl } from './avatarUrl'

export const MAX_DISPLAY_NAME_LENGTH = 64

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i

/**
 * Colors are rendered as `style={{ background: color }}`. React writes that
 * through the CSSOM, so it cannot break out into new rules — but `url(...)` is a
 * perfectly valid background value, which would make every viewer's browser
 * fetch a peer-controlled URL and leak their IP. Only accept literal hex.
 */
export function safeColor(color: string | undefined, fallback: string): string {
  if (!color) return fallback
  const value = color.trim()
  return HEX_COLOR.test(value) ? value : fallback
}

/** Peers control this string; keep it short enough to render and store. */
export function safeDisplayName(name: string | undefined, fallback: string): string {
  if (typeof name !== 'string') return fallback
  const value = name.replace(/\s+/g, ' ').trim().slice(0, MAX_DISPLAY_NAME_LENGTH)
  return value.length > 0 ? value : fallback
}

/** Scrub an inbound profile from an untrusted peer before it enters state. */
export function sanitizePeerProfile(
  profile: Partial<UserProfile> | undefined,
  fallback: { name: string; color: string }
): { name: string; color: string; avatar?: string } {
  return {
    name: safeDisplayName(profile?.name, fallback.name),
    color: safeColor(profile?.color, fallback.color),
    avatar: safeAvatarUrl(profile?.avatar),
  }
}
