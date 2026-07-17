/**
 * Newline-joined canonical encoding for device signatures.
 *
 * Fixed fields must not contain "\n"; free text goes last so embedded newlines
 * cannot shift other fields. Used by Peerly messages and any signed gossip
 * payload that follows the same field order.
 */
export function encodeCanonicalLines(parts: readonly string[]): Uint8Array {
  return new TextEncoder().encode(parts.join('\n'))
}
