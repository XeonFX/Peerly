import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KvStore } from '../utils/kvStore'
import { DeviceIdentity } from './deviceIdentity'
import {
  listApprovedDevices,
  loadDeviceGrants,
  revokeDevice,
  saveDeviceGrant,
  signDeviceGrant,
  verifyDeviceGrant,
} from './deviceAuthorization'

function memoryKeys(): KvStore<CryptoKeyPair> {
  const values = new Map<string, CryptoKeyPair>()
  return { get: async key => values.get(key) ?? null, set: async (key, value) => void values.set(key, value) }
}

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    key: (index: number) => [...values.keys()][index] ?? null,
    clear: () => values.clear(),
    get length() { return values.size },
  })
})

describe('device authorization', () => {
  it('requires two valid reciprocal grants and revokes them locally', async () => {
    const first = new DeviceIdentity(memoryKeys())
    const second = new DeviceIdentity(memoryKeys())
    const firstKey = await first.publicKeyId()
    const secondKey = await second.publicKeyId()
    const pairingId = 'pairing-id-1234567890'
    const forward = await signDeviceGrant(first, 'user-1', secondKey, pairingId)
    const backward = await signDeviceGrant(second, 'user-1', firstKey, pairingId)
    expect(await verifyDeviceGrant(forward)).toBe(true)
    expect(await saveDeviceGrant(forward)).toBe(true)
    expect(await listApprovedDevices('user-1', firstKey)).toEqual([])
    expect(await saveDeviceGrant(backward)).toBe(true)
    expect((await listApprovedDevices('user-1', firstKey))[0]?.deviceKeyId).toBe(secondKey)
    revokeDevice('user-1', firstKey, secondKey)
    expect(await loadDeviceGrants('user-1')).toEqual([])
  })

  it('rejects a tampered grant', async () => {
    const first = new DeviceIdentity(memoryKeys())
    const second = new DeviceIdentity(memoryKeys())
    const grant = await signDeviceGrant(first, 'user-1', await second.publicKeyId(), 'pairing-id-1234567890')
    expect(await verifyDeviceGrant({ ...grant, userId: 'user-2' })).toBe(false)
  })
})
