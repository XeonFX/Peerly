import { isE2eAuthBypass } from './e2eAuth'
import type { JwksFetcher } from './oidcIdToken'

export type IdentityProviderId = 'google' | 'microsoft' | 'github' | 'apple' | 'oidc'

export type IdentityProvider = {
  id: IdentityProviderId
  label: string
  clientId: string
  issuers?: Set<string>
  issuerPrefixes?: string[]
  jwksUrl: string
  /** Injectable in tests (e.g. fake Google issuer). */
  fetchJwks?: JwksFetcher
}

const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com'])

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
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
  }
}

function microsoftProvider(): IdentityProvider | null {
  const clientId = env('VITE_MICROSOFT_CLIENT_ID')
  if (!clientId) return null
  const tenant = env('VITE_MICROSOFT_TENANT_ID') ?? 'common'
  return {
    id: 'microsoft',
    label: 'Microsoft',
    clientId,
    issuerPrefixes: ['https://login.microsoftonline.com/', 'https://sts.windows.net/'],
    jwksUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/discovery/v2.0/keys`,
  }
}

function githubProvider(): IdentityProvider | null {
  const clientId = env('VITE_GITHUB_CLIENT_ID')
  if (!clientId) return null
  return {
    id: 'github',
    label: 'GitHub',
    clientId,
    issuers: new Set(['https://github.com/login/oauth']),
    jwksUrl: 'https://github.com/login/oauth/.well-known/jwks',
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
    githubProvider(),
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
    'VITE_GOOGLE_CLIENT_ID, VITE_MICROSOFT_CLIENT_ID, VITE_GITHUB_CLIENT_ID, ' +
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