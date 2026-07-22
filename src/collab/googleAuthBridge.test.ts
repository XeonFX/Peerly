import { afterEach, describe, expect, it, vi } from 'vitest'
import { getGoogleAuthBridgeOrigin } from './googleAuthBridge'

describe('getGoogleAuthBridgeOrigin', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('uses the configured build origin', () => {
    vi.stubEnv('VITE_GOOGLE_AUTH_BRIDGE_ORIGIN', 'https://auth.example.test')
    expect(getGoogleAuthBridgeOrigin()).toBe('https://auth.example.test')
  })

  it('keeps direct sign-in when no bridge is configured', () => {
    vi.stubEnv('VITE_GOOGLE_AUTH_BRIDGE_ORIGIN', '')
    expect(getGoogleAuthBridgeOrigin()).toBeUndefined()
  })

  it('keeps production sign-in direct when the configured bridge is the current origin', () => {
    vi.stubEnv('VITE_GOOGLE_AUTH_BRIDGE_ORIGIN', 'https://peerly.cc')
    expect(getGoogleAuthBridgeOrigin('https://peerly.cc')).toBeUndefined()
  })
})
