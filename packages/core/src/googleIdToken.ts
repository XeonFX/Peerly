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
const GOOGLE_JWKS_STORAGE_KEY = 'peerly-google-jwks-v1'
const GOOGLE_JWKS_STALE_FALLBACK_MS = 7 * 24 * 60 * 60 * 1000

type StoredGoogleJwks = { keys: JwkWithKid[]; fetchedAt: number }

function readStoredGoogleJwks(): StoredGoogleJwks | null {
  try {
    const raw = globalThis.localStorage?.getItem(GOOGLE_JWKS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredGoogleJwks>
    if (!Array.isArray(parsed.keys) || !Number.isFinite(parsed.fetchedAt)) return null
    return { keys: parsed.keys, fetchedAt: parsed.fetchedAt! }
  } catch {
    return null
  }
}

function storeGoogleJwks(value: StoredGoogleJwks): void {
  try {
    globalThis.localStorage?.setItem(GOOGLE_JWKS_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Storage denial/quota must not turn a successful online login into a failure.
  }
}

async function defaultFetchJwks(): Promise<{ keys: JwkWithKid[] }> {
  try {
    const res = await fetch(GOOGLE_JWKS_URL)
    if (!res.ok) throw new Error(`Failed to fetch Google's public keys: HTTP ${res.status}`)
    const value = (await res.json()) as { keys: JwkWithKid[] }
    if (!Array.isArray(value.keys) || value.keys.length === 0) {
      throw new Error("Google's public-key response was empty")
    }
    storeGoogleJwks({ keys: value.keys, fetchedAt: Date.now() })
    return value
  } catch (error) {
    // Google's token is short-lived and still goes through issuer, audience,
    // nonce, expiry, and signature verification. A recently downloaded old
    // public key is therefore a safe availability fallback during a transient
    // googleapis reset; an unknown rotated `kid` still fails closed later.
    const stored = readStoredGoogleJwks()
    if (stored && Date.now() - stored.fetchedAt <= GOOGLE_JWKS_STALE_FALLBACK_MS) {
      return { keys: stored.keys }
    }
    throw error
  }
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
