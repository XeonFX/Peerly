/**
 * Deterministic peer visuals. Peerly (and other consumers) render peers as a
 * colored bubble with initials; deriving both from the same seed on every
 * device is what makes a peer look identical to everyone without exchanging
 * any profile data.
 */

export const PEER_COLORS = [
  '#e01e5a',
  '#36c5f0',
  '#2eb67d',
  '#ecb22e',
  '#9b59b6',
  '#e67e22',
  '#1abc9c',
  '#3498db',
]

/** Stable color for a seed (peer id, user id, name — any stable string). */
export function getPeerColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash)
  }
  return PEER_COLORS[Math.abs(hash) % PEER_COLORS.length]
}

/**
 * Up to two initials for an avatar tile: first letters of the first two
 * words, or the first two characters of a single-word name.
 */
export function avatarInitial(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return trimmed.slice(0, 2).toUpperCase()
}
