import { describe, expect, it } from 'vitest'
import type { KvStore } from '../utils/kvStore'
import { DeviceIdentity, verifyWithDeviceKeyId } from './deviceIdentity'

function memoryStore(): KvStore<CryptoKeyPair> {
  const map = new Map<string, CryptoKeyPair>()
  return {
    async get(key) {
      return map.get(key) ?? null
    },
    async set(key, value) {
      map.set(key, value)
    },
  }
}

describe('DeviceIdentity', () => {
  it('generates a keypair lazily and persists it across instances sharing a store', async () => {
    const store = memoryStore()
    const a = new DeviceIdentity(store)
    const idFromA = await a.publicKeyId()

    const b = new DeviceIdentity(store)
    const idFromB = await b.publicKeyId()

    expect(idFromB).toBe(idFromA)
  })

  it('caches in memory: the same instance never regenerates', async () => {
    const identity = new DeviceIdentity(memoryStore())
    const first = await identity.publicKeyId()
    const second = await identity.publicKeyId()
    expect(second).toBe(first)
  })

  it('produces a signature that verifies against its own public key id', async () => {
    const identity = new DeviceIdentity(memoryStore())
    const keyId = await identity.publicKeyId()
    const data = new TextEncoder().encode('prove you hold this key right now')

    const signature = await identity.sign(data)

    expect(await verifyWithDeviceKeyId(keyId, data, signature)).toBe(true)
  })

  it('rejects a signature from a different device key', async () => {
    const alice = new DeviceIdentity(memoryStore())
    const mallory = new DeviceIdentity(memoryStore())
    const data = new TextEncoder().encode('challenge')

    const malloryKeyId = await mallory.publicKeyId()
    const malloryOwnSignature = await mallory.sign(data)

    // Mallory signs correctly with her own key but claims to be Alice's key id.
    const aliceKeyId = await alice.publicKeyId()
    expect(await verifyWithDeviceKeyId(aliceKeyId, data, malloryOwnSignature)).toBe(false)
    expect(await verifyWithDeviceKeyId(malloryKeyId, data, malloryOwnSignature)).toBe(true)
  })

  it('rejects a signature over different data (no replay across challenges)', async () => {
    const identity = new DeviceIdentity(memoryStore())
    const keyId = await identity.publicKeyId()
    const signature = await identity.sign(new TextEncoder().encode('challenge A'))

    expect(
      await verifyWithDeviceKeyId(keyId, new TextEncoder().encode('challenge B'), signature)
    ).toBe(false)
  })

  it('treats a malformed key id as unverified rather than throwing', async () => {
    await expect(
      verifyWithDeviceKeyId('not-a-real-key-id', new Uint8Array([1]), 'bogus')
    ).resolves.toBe(false)
  })
})
