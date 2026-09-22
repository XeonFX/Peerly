import type { GoogleSignInClient } from './googleAuthBridge.js'
import {
  verifyGoogleIdToken,
  type GoogleIdTokenClaims,
  type VerifyGoogleIdTokenOptions,
} from './googleIdToken.js'
import { deriveUserId } from './userId.js'

export type RememberedGoogleIdentity =
  | { email: string; userId?: string }
  | { email?: string; userId: string }

export type RenewGoogleCredentialOptions = {
  client: Pick<GoogleSignInClient, 'requestCredentialSilently'>
  clientId: string
  nonce: string
  remembered: RememberedGoogleIdentity
  /** Injectable JWKS source for test or non-browser runtimes. */
  fetchJwks?: VerifyGoogleIdTokenOptions['fetchJwks']
}

export type RenewedGoogleCredential = {
  token: string
  claims: GoogleIdTokenClaims
  userId: string
  expiresAt: number
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** A silent refresh must never switch the application to another Google account. */
export function googleIdentityMatchesRemembered(
  claims: Pick<GoogleIdTokenClaims, 'email'>,
  userId: string,
  remembered: RememberedGoogleIdentity
): boolean {
  if (remembered.userId && remembered.userId !== userId) return false
  if (remembered.email && normalizeEmail(remembered.email) !== normalizeEmail(claims.email)) {
    return false
  }
  return true
}

/**
 * Obtain, verify, and identity-pin a fresh Google credential.
 *
 * Returns null for normal silent-flow outcomes (no credential or another
 * signed-in Google account). Cryptographic/network failures reject so the
 * lifecycle controller can apply its retry policy without trusting bad data.
 */
export async function renewGoogleCredentialSilently(
  options: RenewGoogleCredentialOptions
): Promise<RenewedGoogleCredential | null> {
  const token = await options.client.requestCredentialSilently(
    options.nonce,
    options.clientId
  )
  if (!token) return null

  const claims = await verifyGoogleIdToken(token, {
    expectedAudience: options.clientId,
    expectedNonce: options.nonce,
    fetchJwks: options.fetchJwks,
  })
  const userId = await deriveUserId(claims.iss, claims.sub)
  if (!googleIdentityMatchesRemembered(claims, userId, options.remembered)) return null

  return {
    token,
    claims,
    userId,
    expiresAt: claims.exp * 1000,
  }
}
