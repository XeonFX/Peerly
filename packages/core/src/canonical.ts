/**
 * Newline-joined canonical encoding for device signatures.
 *
 * Fixed fields must not contain "\n"; free text goes last so embedded newlines
 * cannot shift other fields. Used by Peerly messages, HeyHubs chat/board, and
 * any future signed gossip payload.
 */
export function encodeCanonicalLines(parts: readonly string[]): Uint8Array {
  return new TextEncoder().encode(parts.join('\n'))
}
