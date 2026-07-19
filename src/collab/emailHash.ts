/**
 * Privacy-preserving email matching for the presence lobby.
 *
 * Presence and invite envelopes carry only a hash so the mesh never gossips
 * raw addresses. Inviting still requires typing the email; matching is
 * SHA-256 of the normalized form.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Lowercase + trim; empty string if unusable. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isPlausibleEmail(email: string): boolean {
  const n = normalizeEmail(email)
  return n.length >= 5 && n.length <= 254 && EMAIL_RE.test(n)
}

/** Hex SHA-256 of normalized email. Empty input → empty string. */
export async function hashEmail(email: string): Promise<string> {
  const n = normalizeEmail(email)
  if (!n) return ''
  const bytes = new TextEncoder().encode(n)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
