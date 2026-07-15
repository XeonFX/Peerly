import { base64UrlToBytes, base64UrlToUtf8 } from '../utils/base64url'

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

function issuerMatches(
  iss: string,
  issuers?: Set<string>,
  issuerPrefixes?: string[]
): boolean {
  if (issuers?.has(iss)) return true
  if (issuerPrefixes?.some(prefix => iss.startsWith(prefix))) return true
  return false
}

export function extractEmailClaim(payload: Record<string, unknown>): string {
  if (typeof payload.email === 'string' && payload.email.includes('@')) {
    return payload.email
  }
  const preferred = payload.preferred_username
  if (typeof preferred === 'string' && preferred.includes('@')) {
    return preferred
  }
  throw new Error('Token is missing an email claim')
}

export type VerifyOidcIdTokenOptions = {
  expectedAudience: string
  expectedNonce: string
  issuers?: Set<string>
  issuerPrefixes?: string[]
  fetchJwks: JwksFetcher
  jwksCacheKey?: string
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
  if (
    !issuerMatches(payload.iss, options.issuers, options.issuerPrefixes)
  ) {
    throw new Error(`Unexpected token issuer: ${payload.iss}`)
  }
  if (!audienceMatches(payload.aud, options.expectedAudience)) {
    throw new Error('Token audience does not match this app')
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < now) {
    throw new Error('Token expired')
  }
  if (payload.nonce !== options.expectedNonce) {
    throw new Error('Token nonce does not match the presenting device key')
  }

  const email = extractEmailClaim(payload)

  return {
    ...(payload as OidcIdTokenClaims),
    email,
  }
}