import { bytesToBase64Url } from './base64url.js'

/**
 * Durable user id: SHA-256 over the OIDC issuer + subject pair.
 *
 * `sub` is stable for the life of the account (emails on the same account can
 * change; providers can even recycle them), and pairing it with `iss` keeps
 * ids from different providers in separate namespaces. The newline separator
 * cannot appear in either claim, so the encoding is unambiguous. Hashing means
 * peers learn nothing from the id that the handshake didn't already show them.
 */
export async function deriveUserId(iss: string, sub: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${iss}\n${sub}`))
  // 128 bits is plenty for uniqueness and keeps the id compact on the wire.
  return bytesToBase64Url(new Uint8Array(digest).slice(0, 16))
}
