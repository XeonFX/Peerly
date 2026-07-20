/**
 * Deterministic 128-bit room code for a 1:1 DM derived from a random secret
 * exchanged when the friendship is established. User ids and scheme names are
 * public namespace inputs; they are deliberately not treated as credentials.
 *
 * Apps pass their own scheme string so Peerly and HeyHubs never share rooms
 * (e.g. `peerly-dm-v2` vs `hh-dm-v2`).
 */

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 32 hex chars (same length as generateRoomCode) for both peers.
 * @param scheme App-owned namespace, e.g. `peerly-dm-v2`
 */
export async function dmRoomCode(
  userIdA: string,
  userIdB: string,
  scheme: string,
  sharedSecret: string
): Promise<string> {
  const a = userIdA.trim()
  const b = userIdB.trim()
  const s = scheme.trim()
  const secret = sharedSecret.trim().toLowerCase()
  if (!a || !b || a === b) {
    throw new Error('dmRoomCode requires two distinct userIds')
  }
  if (!s) {
    throw new Error('dmRoomCode requires a non-empty scheme')
  }
  if (!isValidDmSecret(secret)) {
    throw new Error('dmRoomCode requires a 128-bit shared secret')
  }
  const [x, y] = [a, b].sort()
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${s}\n${secret}\n${x}\n${y}`)
  )
  return bytesToHex(new Uint8Array(digest)).slice(0, 32)
}

const DM_SECRET_RE = /^[0-9a-f]{32}$/i

export function isValidDmSecret(secret: string | undefined): boolean {
  return typeof secret === 'string' && DM_SECRET_RE.test(secret)
}

/** Generate an app-independent 128-bit secret to exchange over an authenticated channel. */
export function generateDmSecret(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}
