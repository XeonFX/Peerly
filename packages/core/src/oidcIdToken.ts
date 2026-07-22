import { base64UrlToBytes, base64UrlToUtf8 } from './base64url.js'

/** Claims this app relies on from a verified OIDC ID token. */
export type OidcIdTokenClaims = {
  iss: string
  aud: string | string[]
  sub: string
  email: string
  email_verified?: boolean
  name?: string
  picture?: string
  nonce?: string
  exp: number
  iat: number
}

/**
 * Read a token's expiry for local credential lifecycle decisions only. This
 * does not verify the token and must never be used for authorization.
 */
export function oidcTokenExpiryMs(token: string): number | null {
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(token.split('.')[1]))) as {
      exp?: unknown
    }
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : null
  } catch {
    return null
  }
}

export type JwkWithKid = JsonWebKey & { kid?: string }

export type JwksFetcher = () => Promise<{ keys: JwkWithKid[] }>

const JWKS_CACHE_MS = 60 * 60 * 1000
const jwksCaches = new Map<string, { keys: JwkWithKid[]; fetchedAt: number }>()

async function getJwks(cacheKey: string, fetchJwks: JwksFetcher): Promise<JwkWithKid[]> {
  const now = Date.now()
  const cached = jwksCaches.get(cacheKey)
  if (cached && now - cached.fetchedAt < JWKS_CACHE_MS) return cached.keys
  const { keys } = await fetchJwks()
  jwksCaches.set(cacheKey, { keys, fetchedAt: now })
  return keys
}

/** Exposed for tests: clears JWKS caches between fake-issuer runs. */
export function resetOidcJwksCache(): void {
  jwksCaches.clear()
}

function parseJwt(token: string) {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Malformed JWT')
  const [headerB64, payloadB64, signatureB64] = parts
  const header = JSON.parse(base64UrlToUtf8(headerB64)) as { alg?: string; kid?: string }
  const payload = JSON.parse(base64UrlToUtf8(payloadB64)) as Record<string, unknown>
  return {
    header,
    payload,
    signingInput: `${headerB64}.${payloadB64}`,
    signature: base64UrlToBytes(signatureB64),
  }
}

function audienceMatches(aud: unknown, expectedAudience: string): boolean {
  if (typeof aud === 'string') return aud === expectedAudience
  if (Array.isArray(aud)) return aud.some(value => value === expectedAudience)
  return false
}

/**
 * Exact match only. Prefix matching was removed: it is correct solely when the
 * prefix ends in "/" (otherwise "https://issuer.com.evil.test/" matches
 * "https://issuer.com"), which is a trap for whoever adds the next provider.
 * Every provider now pins its exact issuer(s).
 */
function issuerMatches(iss: string, issuers?: Set<string>): boolean {
  return issuers?.has(iss) ?? false
}

/**
 * Providers disagree on the type: Google sends a boolean, Apple has historically
 * sent the string "true". Anything else — absent, false, "false" — is not a
 * verified email.
 */
function isEmailVerifiedClaim(value: unknown): boolean {
  return value === true || value === 'true'
}

/** The standard OIDC claim. Microsoft is the exception — see EMAIL_VERIFIED_CLAIM notes. */
export const DEFAULT_EMAIL_VERIFIED_CLAIM = 'email_verified'

/**
 * The email a workspace's allow-list is matched against, and therefore the only
 * thing standing between a stranger and a private workspace.
 *
 * Three rules, all load-bearing:
 *
 * 1. The provider must assert the address is verified. Without this, a provider
 *    that lets a user type any address into their profile hands an attacker the
 *    ability to claim a colleague's address and walk in.
 * 2. `preferred_username` is not accepted as a fallback. It looks like an email
 *    in Azure AD (it is the UPN) but carries no verification guarantee, so
 *    treating it as one silently re-opens exactly the hole rule 1 closes.
 * 3. Which claim carries that assertion is per-provider. Most use the standard
 *    `email_verified`; Microsoft never emits it and uses the optional `xms_edov`
 *    ("email domain owner verified") instead. Defaulting Microsoft to
 *    `email_verified` would not fail open — it would reject every Microsoft
 *    user — but naming the claim per provider is what keeps rule 1 true for all
 *    of them rather than only the ones that happen to follow the spec.
 */
export function extractEmailClaim(
  payload: Record<string, unknown>,
  verifiedClaim: string = DEFAULT_EMAIL_VERIFIED_CLAIM
): string {
  const email = payload.email
  if (typeof email !== 'string' || !email.includes('@')) {
    throw new Error('Token is missing an email claim')
  }
  if (!isEmailVerifiedClaim(payload[verifiedClaim])) {
    throw new Error(
      `Email ${email} is not verified by the identity provider (${verifiedClaim} is not true)`
    )
  }
  return email
}

export type VerifyOidcIdTokenOptions = {
  expectedAudience: string
  expectedNonce: string
  issuers?: Set<string>
  fetchJwks: JwksFetcher
  jwksCacheKey?: string
  /** Claim carrying the provider's email-verified assertion. See extractEmailClaim. */
  emailVerifiedClaim?: string
  now?: number
}

export async function verifyOidcIdToken(
  token: string,
  options: VerifyOidcIdTokenOptions
): Promise<OidcIdTokenClaims> {
  const { header, payload, signingInput, signature } = parseJwt(token)

  if (header.alg !== 'RS256') {
    throw new Error(`Unsupported JWT algorithm: ${header.alg}`)
  }

  const cacheKey = options.jwksCacheKey ?? 'default'
  const keys = await getJwks(cacheKey, options.fetchJwks)
  const jwk = keys.find(key => key.kid === header.kid)
  if (!jwk) {
    throw new Error('Signing key not found in issuer JWKS (kid mismatch)')
  }

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  )

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    signature as BufferSource,
    new TextEncoder().encode(signingInput) as BufferSource
  )
  if (!valid) {
    throw new Error('Invalid ID token signature')
  }

  const now = options.now ?? Date.now()
  if (typeof payload.iss !== 'string' || !payload.iss) {
    throw new Error(`Unexpected token issuer: ${String(payload.iss)}`)
  }
  if (!issuerMatches(payload.iss, options.issuers)) {
    throw new Error(`Unexpected token issuer: ${payload.iss}`)
  }
  if (!audienceMatches(payload.aud, options.expectedAudience)) {
    throw new Error('Token audience does not match this app')
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < now) {
    throw new Error('Token expired')
  }
  if (typeof payload.iat !== 'number' || payload.iat * 1000 > now + 60_000) {
    throw new Error('Token issuance time is invalid')
  }
  if (typeof payload.nbf === 'number' && payload.nbf * 1000 > now + 60_000) {
    throw new Error('Token is not active yet')
  }
  if (payload.nonce !== options.expectedNonce) {
    throw new Error('Token nonce does not match the presenting device key')
  }

  const email = extractEmailClaim(payload, options.emailVerifiedClaim)

  return {
    ...(payload as OidcIdTokenClaims),
    email,
  }
}
