import { afterEach, describe, expect, it, vi } from 'vitest'

async function client() {
  const module = await import('./googleAuth')
  return module.googleSignInClient
}

describe('googleSignInClient', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('uses the configured build origin', async () => {
    vi.stubEnv('VITE_GOOGLE_AUTH_BRIDGE_ORIGIN', 'https://auth.example.test')
    expect((await client()).bridgeOrigin()).toBe('https://auth.example.test')
  })

  it('keeps direct sign-in when no bridge is configured', async () => {
    vi.stubEnv('VITE_GOOGLE_AUTH_BRIDGE_ORIGIN', '')
    expect((await client()).bridgeOrigin()).toBeUndefined()
  })

  it('keeps production sign-in direct when the configured bridge is the current origin', async () => {
    vi.stubEnv('VITE_GOOGLE_AUTH_BRIDGE_ORIGIN', 'https://peerly.cc')
    expect((await client()).bridgeOrigin('https://peerly.cc')).toBeUndefined()
  })
})
