import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getConfiguredIdentityProviders,
  identityConfigurationError,
  isIdentityConfigured,
  resetIdentityProviderCache,
} from './identityProviders'

beforeEach(() => {
  resetIdentityProviderCache()
  vi.stubEnv('VITE_E2E_AUTH_BYPASS', '')
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
  vi.stubEnv('VITE_MICROSOFT_CLIENT_ID', '')
  vi.stubEnv('VITE_MICROSOFT_TENANT_ID', '')
  vi.stubEnv('VITE_APPLE_CLIENT_ID', '')
  vi.stubEnv('VITE_OIDC_CLIENT_ID', '')
  vi.stubEnv('VITE_OIDC_ISSUER', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  resetIdentityProviderCache()
})

describe('identityProviders', () => {
  it('reports configured when Google client id is set', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'abc.apps.googleusercontent.com')
    resetIdentityProviderCache()

    const providers = getConfiguredIdentityProviders()
    expect(providers.map(p => p.id)).toEqual(['google'])
    expect(isIdentityConfigured()).toBe(true)
  })

  it('reports configured when Microsoft client id and a pinned tenant are set', () => {
    vi.stubEnv('VITE_MICROSOFT_CLIENT_ID', 'ms-client-id')
    vi.stubEnv('VITE_MICROSOFT_TENANT_ID', '11111111-2222-3333-4444-555555555555')
    resetIdentityProviderCache()

    const providers = getConfiguredIdentityProviders()
    expect(providers.map(p => p.id)).toEqual(['microsoft'])
    expect(isIdentityConfigured()).toBe(true)
  })

  it('pins Microsoft to the exact issuers of one tenant', () => {
    vi.stubEnv('VITE_MICROSOFT_CLIENT_ID', 'ms-client-id')
    vi.stubEnv('VITE_MICROSOFT_TENANT_ID', 'tenant-abc')
    resetIdentityProviderCache()

    const microsoft = getConfiguredIdentityProviders().find(p => p.id === 'microsoft')
    expect(microsoft).toBeDefined()
    expect([...(microsoft!.issuers ?? [])]).toEqual([
      'https://login.microsoftonline.com/tenant-abc/v2.0',
      'https://sts.windows.net/tenant-abc/',
    ])
  })

  // Authorization here is by email, and Azure lets a tenant admin set an
  // unverified email. Multi-tenant would let anyone spin up a free tenant and
  // assert a member's address (Microsoft's documented "nOAuth" abuse), so it
  // must fail loudly at config time rather than silently admit strangers.
  it.each(['common', 'organizations', 'consumers', 'COMMON'])(
    'refuses the multi-tenant value %s',
    tenant => {
      vi.stubEnv('VITE_MICROSOFT_CLIENT_ID', 'ms-client-id')
      vi.stubEnv('VITE_MICROSOFT_TENANT_ID', tenant)
      resetIdentityProviderCache()

      expect(() => getConfiguredIdentityProviders()).toThrow(/specific tenant id/i)
    }
  )

  it('refuses Microsoft with no tenant at all', () => {
    vi.stubEnv('VITE_MICROSOFT_CLIENT_ID', 'ms-client-id')
    resetIdentityProviderCache()

    expect(() => getConfiguredIdentityProviders()).toThrow(/specific tenant id/i)
  })

  // Azure never emits the standard `email_verified`; its equivalent is the
  // optional `xms_edov`. If this reverts to the default, every Microsoft
  // sign-in breaks — and "fix" it by dropping the check and you have handed
  // anyone the ability to assert a colleague's address.
  it('verifies Microsoft emails against xms_edov, not email_verified', () => {
    vi.stubEnv('VITE_MICROSOFT_CLIENT_ID', 'ms-client-id')
    vi.stubEnv('VITE_MICROSOFT_TENANT_ID', 'tenant-abc')
    resetIdentityProviderCache()

    const microsoft = getConfiguredIdentityProviders().find(p => p.id === 'microsoft')
    expect(microsoft?.emailVerifiedClaim).toBe('xms_edov')
  })

  it('leaves other providers on the standard email_verified claim', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'abc.apps.googleusercontent.com')
    resetIdentityProviderCache()

    expect(getConfiguredIdentityProviders()[0].emailVerifiedClaim).toBeUndefined()
  })

  it('reports configured when Apple client id is set', () => {
    vi.stubEnv('VITE_APPLE_CLIENT_ID', 'com.example.app.service')
    resetIdentityProviderCache()

    expect(getConfiguredIdentityProviders().map(p => p.id)).toEqual(['apple'])
    expect(isIdentityConfigured()).toBe(true)
  })

  it('requires both OIDC client id and issuer', () => {
    vi.stubEnv('VITE_OIDC_CLIENT_ID', 'oidc-client')
    resetIdentityProviderCache()
    expect(getConfiguredIdentityProviders()).toEqual([])

    vi.stubEnv('VITE_OIDC_ISSUER', 'https://idp.example.com')
    resetIdentityProviderCache()
    expect(getConfiguredIdentityProviders().map(p => p.id)).toEqual(['oidc'])
  })

  it('is not configured when no provider env vars are set', () => {
    expect(isIdentityConfigured()).toBe(false)
    expect(identityConfigurationError()).toMatch(/VITE_GOOGLE_CLIENT_ID/)
  })
})