import {
  resetOidcJwksCache,
  verifyOidcIdToken,
  type JwkWithKid,
  type JwksFetcher,
  type OidcIdTokenClaims,
} from './oidcIdToken.js'

export type GoogleIdTokenClaims = OidcIdTokenClaims

/**
 * Google's OIDC pins, in exactly one place. Every consumer duplicating these
 * is a consumer that can drift — and a wrong issuer set is not a bug, it is
 * an authentication bypass.
 */
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
export const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com'])

async function defaultFetchJwks(): Promise<{ keys: JwkWithKid[] }> {
  const res = await fetch(GOOGLE_JWKS_URL)
  if (!res.ok) throw new Error(`Failed to fetch Google's public keys: HTTP ${res.status}`)
  return res.json()
}

export function resetGoogleJwksCache(): void {
  resetOidcJwksCache()
}

export type VerifyGoogleIdTokenOptions = {
  expectedAudience: string
  expectedNonce: string
  /** Injectable in tests (e.g. a fake issuer). */
  fetchJwks?: JwksFetcher
  now?: number
}

/**
 * verifyOidcIdToken with Google's issuers and JWKS pinned. Everything the
 * generic verifier enforces still applies: RS256 signature against the JWKS,
 * exact issuer match, audience, expiry, verified email, and the nonce that
 * binds the token to the presenting device key.
 */
export async function verifyGoogleIdToken(
  token: string,
  options: VerifyGoogleIdTokenOptions
): Promise<GoogleIdTokenClaims> {
  return verifyOidcIdToken(token, {
    expectedAudience: options.expectedAudience,
    expectedNonce: options.expectedNonce,
    issuers: GOOGLE_ISSUERS,
    fetchJwks: options.fetchJwks ?? defaultFetchJwks,
    jwksCacheKey: 'google',
    now: options.now,
  })
}
