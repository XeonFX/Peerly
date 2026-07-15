import {
  resetOidcJwksCache,
  verifyOidcIdToken,
  type JwkWithKid,
  type JwksFetcher,
  type OidcIdTokenClaims,
} from './oidcIdToken'

export type GoogleIdTokenClaims = OidcIdTokenClaims
export type { JwkWithKid, JwksFetcher }

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com'])

async function defaultFetchJwks(): Promise<{ keys: JwkWithKid[] }> {
  const res = await fetch(GOOGLE_JWKS_URL)
  if (!res.ok) throw new Error(`Failed to fetch Google's public keys: HTTP ${res.status}`)
  return res.json()
}

export function resetJwksCache(): void {
  resetOidcJwksCache()
}

export type VerifyIdTokenOptions = {
  expectedAudience: string
  expectedNonce: string
  fetchJwks?: JwksFetcher
  now?: number
}

export async function verifyGoogleIdToken(
  token: string,
  options: VerifyIdTokenOptions
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