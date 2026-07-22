import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeviceIdentity, verifyWithDeviceKeyId } from './deviceIdentity.js'
import {
  clearRuntimeNetworkCredentials,
  configureRuntimeAuthCredentialProvider,
  getRuntimeNetworkCredentials,
} from './runtimeCredentials.js'
import type { KvStore } from './kvStore.js'

function memoryStore<T>(): KvStore<T> {
  const values = new Map<string, T>()
  return {
    get: async key => values.get(key),
    set: async (key, value) => { values.set(key, value) },
    delete: async key => { values.delete(key) },
  }
}

afterEach(() => {
  configureRuntimeAuthCredentialProvider(null)
  clearRuntimeNetworkCredentials()
  vi.restoreAllMocks()
})

describe('runtime network credentials', () => {
  it('binds the request to the live device key and caches a still-valid result', async () => {
    const signer = new DeviceIdentity(memoryStore<CryptoKeyPair>())
    const expiresAt = Date.now() + 5 * 60_000
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1
      const headers = new Headers(init?.headers)
      const providerId = headers.get('x-peerly-provider')
      const deviceKeyId = headers.get('x-peerly-device-key')
      const timestamp = headers.get('x-peerly-request-ts')
      const nonce = headers.get('x-peerly-request-nonce')
      const signature = headers.get('x-peerly-request-signature')
      expect(headers.get('authorization')).toBe('Bearer signed-id-token')
      expect(providerId).toBe('google')
      expect(deviceKeyId).toMatch(/^P-256:/)
      expect(timestamp).toMatch(/^\d+$/)
      expect(nonce?.length).toBeGreaterThanOrEqual(16)
      expect(signature).toBeTruthy()
      const proof = new TextEncoder().encode([
        'peerly-network-credentials-v1',
        providerId,
        deviceKeyId,
        timestamp,
        nonce,
      ].join('\n'))
      expect(await verifyWithDeviceKeyId(deviceKeyId!, proof, signature!)).toBe(true)
      return Response.json({ relayTicket: 'ticket', expiresAt })
    }))
    configureRuntimeAuthCredentialProvider(() => ({
      token: 'signed-id-token',
      providerId: 'google',
      signer,
    }))

    await expect(getRuntimeNetworkCredentials()).resolves.toEqual({
      relayTicket: 'ticket',
      expiresAt,
    })
    await expect(getRuntimeNetworkCredentials()).resolves.toEqual({
      relayTicket: 'ticket',
      expiresAt,
    })
    expect(calls).toBe(1)
  })

  it('does not call the endpoint without a complete credential', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    configureRuntimeAuthCredentialProvider(() => null)
    await expect(getRuntimeNetworkCredentials()).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects expired endpoint responses', async () => {
    const signer = new DeviceIdentity(memoryStore<CryptoKeyPair>())
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ expiresAt: Date.now() - 1 })))
    configureRuntimeAuthCredentialProvider(() => ({ token: 'token', providerId: 'google', signer }))
    await expect(getRuntimeNetworkCredentials()).resolves.toBeNull()
  })
})
