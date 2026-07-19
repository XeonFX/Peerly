/**
 * Deterministic 128-bit room code for a 1:1 DM so both peers join the same
 * Trystero room without an out-of-band invite. Not a security boundary by
 * itself — the room password is the code; only parties who know both userIds
 * (and the app scheme) can compute it.
 *
 * Apps pass their own scheme string so Peerly and HeyHubs never share rooms
 * (e.g. `peerly-dm-v1` vs `hh-dm-v1`).
 */

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 32 hex chars (same length as generateRoomCode) for both peers.
 * @param scheme App-owned namespace, e.g. `peerly-dm-v1`
 */
export async function dmRoomCode(
  userIdA: string,
  userIdB: string,
  scheme: string
): Promise<string> {
  const a = userIdA.trim()
  const b = userIdB.trim()
  const s = scheme.trim()
  if (!a || !b || a === b) {
    throw new Error('dmRoomCode requires two distinct userIds')
  }
  if (!s) {
    throw new Error('dmRoomCode requires a non-empty scheme')
  }
  const [x, y] = [a, b].sort()
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${s}\n${x}\n${y}`)
  )
  return bytesToHex(new Uint8Array(digest)).slice(0, 32)
}
