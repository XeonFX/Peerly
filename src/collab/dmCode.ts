/**
 * Deterministic 128-bit room code for a 1:1 friend DM so both peers join the
 * same Trystero room without an out-of-band invite. Not a security boundary by
 * itself — the room password is the code; only parties who know both userIds
 * can compute it.
 */

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/** 32 hex chars (same length as generateRoomCode) for both peers. */
export async function dmRoomCode(userIdA: string, userIdB: string): Promise<string> {
  const a = userIdA.trim()
  const b = userIdB.trim()
  if (!a || !b || a === b) {
    throw new Error('dmRoomCode requires two distinct userIds')
  }
  const [x, y] = [a, b].sort()
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`peerly-dm-v1\n${x}\n${y}`)
  )
  return bytesToHex(new Uint8Array(digest)).slice(0, 32)
}
