import { GOOGLE_ISSUERS, GOOGLE_JWKS_URL } from '@peerly/core'
import { isE2eAuthBypass } from './e2eAuth'
import type { JwksFetcher } from './oidcIdToken'

/**
 * GitHub is deliberately absent. Its OIDC discovery document
 * (https://github.com/login/oauth/.well-known/openid-configuration) advertises
 * claims_supported = [sub, aud, exp, nbf, iat, iss, act] — no `email` and no
 * `nonce`, and no userinfo_endpoint. This app authorizes by verified email and
 * binds tokens to a device key via nonce, so GitHub can supply neither.
 * Its plain OAuth returns an opaque access token instead, which a peer cannot
 * verify without a server (and only by handing that server the token). Adding
 * it back needs a different trust model, not a config entry.
 */
export type IdentityProviderId = 'google' | 'microsoft' | 'apple' | 'oidc'

export type IdentityProvider = {
  id: IdentityProviderId
  label: string
  clientId: string
  issuers?: Set<string>
  jwksUrl: string
  /**
   * Claim this provider uses to assert the email is verified. Defaults to the
   * standard `email_verified`; Microsoft does not emit that claim at all.
   */
  emailVerifiedClaim?: string
  /** Injectable in tests (e.g. fake Google issuer). */
  fetchJwks?: JwksFetcher
}


function env(key: keyof ImportMetaEnv): string | undefined {
  const value = import.meta.env[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function googleProvider(): IdentityProvider | null {
  const clientId = env('VITE_GOOGLE_CLIENT_ID')
  if (!clientId) return null
  return {
    id: 'google',
    label: 'Google',
    clientId,
    issuers: GOOGLE_ISSUERS,
    jwksUrl: GOOGLE_JWKS_URL,
  }
}

/** Tenant values that mean "any Azure tenant on earth" rather than a specific one. */
const MICROSOFT_MULTI_TENANT = new Set(['common', 'organizations', 'consumers'])

/**
 * Microsoft is pinned to one tenant on purpose, and it is not optional.
 *
 * This app authorizes by email address. Azure AD lets a tenant administrator
 * set an account's `email` to an arbitrary, unverified value — so a multi-tenant
 * configuration ("common") means anyone can register their own free tenant, mint
 * a user whose email is your colleague's, and be let straight into the
 * workspace. That is Microsoft's documented "nOAuth" abuse, and an email-based
 * allow-list is exactly the shape it targets.
 *
 * Pinning the issuer to a single tenant you control reduces "who can assert
 * this email" to "an admin of your own tenant". Combined with the
 * email_verified requirement in oidcIdToken.ts, that closes it. Anyone who
 * genuinely wants multi-tenant needs a different authorization key than email
 * (immutable `oid` + `tid`), which is a design change, not a config flag.
 */
function microsoftProvider(): IdentityProvider | null {
  const clientId = env('VITE_MICROSOFT_CLIENT_ID')
  if (!clientId) return null

  const tenant = env('VITE_MICROSOFT_TENANT_ID')
  if (!tenant || MICROSOFT_MULTI_TENANT.has(tenant.toLowerCase())) {
    throw new Error(
      'VITE_MICROSOFT_TENANT_ID must be a specific tenant id. ' +
        `Multi-tenant values (${[...MICROSOFT_MULTI_TENANT].join(', ')}) are refused: Azure lets a ` +
        'tenant admin set an unverified email, so any tenant could claim your members’ ' +
        'addresses and join. Use your tenant’s directory (GUID), or drop VITE_MICROSOFT_CLIENT_ID.'
    )
  }

  return {
    id: 'microsoft',
    label: 'Microsoft',
    clientId,
    // Exact issuers for this tenant only — not a prefix over every tenant.
    issuers: new Set([
      `https://login.microsoftonline.com/${tenant}/v2.0`,
      `https://sts.windows.net/${tenant}/`,
    ]),
    jwksUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/discovery/v2.0/keys`,
    // Azure never sends `email_verified`. Its equivalent is the OPTIONAL claim
    // `xms_edov`, which must be enabled on the app registration (along with
    // `email`) or no Microsoft user can be admitted. That is deliberate: without
    // it, nothing in the token says the address was ever verified, and
    // Microsoft's own guidance is to never authorize on an unverified `email`.
    emailVerifiedClaim: 'xms_edov',
  }
}

function appleProvider(): IdentityProvider | null {
  const clientId = env('VITE_APPLE_CLIENT_ID')
  if (!clientId) return null
  return {
    id: 'apple',
    label: 'Apple',
    clientId,
    issuers: new Set(['https://appleid.apple.com']),
    jwksUrl: 'https://appleid.apple.com/auth/keys',
  }
}

function genericOidcProvider(): IdentityProvider | null {
  const clientId = env('VITE_OIDC_CLIENT_ID')
  const issuer = env('VITE_OIDC_ISSUER')
  if (!clientId || !issuer) return null
  const normalizedIssuer = issuer.replace(/\/$/, '')
  const label = env('VITE_OIDC_LABEL') ?? 'SSO'
  return {
    id: 'oidc',
    label,
    clientId,
    issuers: new Set([normalizedIssuer]),
    jwksUrl: `${normalizedIssuer}/.well-known/jwks.json`,
  }
}

let cachedProviders: IdentityProvider[] | null = null

export function getConfiguredIdentityProviders(): IdentityProvider[] {
  if (cachedProviders) return cachedProviders
  cachedProviders = [
    googleProvider(),
    microsoftProvider(),
    appleProvider(),
    genericOidcProvider(),
  ].filter(
    (provider): provider is IdentityProvider => provider !== null
  )
  return cachedProviders
}

/** Test helper — bypasses module cache. */
export function resetIdentityProviderCache(): void {
  cachedProviders = null
}

export function getIdentityProvider(id: string): IdentityProvider | undefined {
  return getConfiguredIdentityProviders().find(provider => provider.id === id)
}

export function isIdentityConfigured(): boolean {
  return getConfiguredIdentityProviders().length > 0 || isE2eAuthBypass()
}

export function identityConfigurationError(): string {
  return (
    'No identity provider configured. Set at least one of: ' +
    'VITE_GOOGLE_CLIENT_ID, VITE_MICROSOFT_CLIENT_ID, ' +
    'VITE_APPLE_CLIENT_ID, or VITE_OIDC_CLIENT_ID + VITE_OIDC_ISSUER.'
  )
}

export function requireIdentityConfigured(): void {
  if (!isIdentityConfigured()) {
    throw new Error(identityConfigurationError())
  }
}

export function defaultJwksFetcher(jwksUrl: string): JwksFetcher {
  return async () => {
    const res = await fetch(jwksUrl)
    if (!res.ok) throw new Error(`Failed to fetch JWKS: HTTP ${res.status}`)
    return res.json()
  }
}