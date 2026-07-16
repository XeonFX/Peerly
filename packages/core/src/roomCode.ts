/**
 * Generate a room's addressable, secret identity. Unguessable by construction —
 * two rooms named alike must never collide, and unguessability is what makes
 * the room-code-as-password model (see joinRoom.ts) meaningful. 128 bits,
 * lowercase hex: safe as a room id, a Trystero password, and a localStorage
 * key segment with no escaping.
 */
export function generateRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}
