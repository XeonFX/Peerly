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

  it('reports configured when Microsoft client id is set', () => {
    vi.stubEnv('VITE_MICROSOFT_CLIENT_ID', 'ms-client-id')
    resetIdentityProviderCache()

    const providers = getConfiguredIdentityProviders()
    expect(providers.map(p => p.id)).toEqual(['microsoft'])
    expect(isIdentityConfigured()).toBe(true)
  })

  it('reports configured when GitHub client id is set', () => {
    vi.stubEnv('VITE_GITHUB_CLIENT_ID', 'github-client-id')
    resetIdentityProviderCache()

    expect(getConfiguredIdentityProviders().map(p => p.id)).toEqual(['github'])
    expect(isIdentityConfigured()).toBe(true)
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