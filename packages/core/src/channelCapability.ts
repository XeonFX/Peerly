import { bytesToBase64Url } from './base64url.js'

/**
 * A server-visible routing capability, never an encryption key. The secret
 * stays in the browser; independent domain labels keep this digest separate
 * from content encryption and from other channels using the same secret.
 */
export async function deriveChannelCapability(secret: string, context: string): Promise<string> {
  if (!secret || !context) throw new Error('Channel secret and context are required')
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(['peerly-routing-v2', context, secret]))
  )
  return bytesToBase64Url(new Uint8Array(digest))
}
