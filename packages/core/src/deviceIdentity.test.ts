import { describe, expect, it } from 'vitest'
import { DeviceIdentity } from './deviceIdentity.js'
import type { KvStore } from './kvStore.js'

describe('DeviceIdentity', () => {
  it('uses one keypair for concurrent first access', async () => {
    let stored: CryptoKeyPair | null = null
    let writes = 0
    const store: KvStore<CryptoKeyPair> = {
      async get() {
        await Promise.resolve()
        return stored
      },
      async set(_key, value) {
        writes += 1
        await Promise.resolve()
        stored = value
      },
    }
    const identity = new DeviceIdentity(store)

    const ids = await Promise.all(Array.from({ length: 8 }, () => identity.publicKeyId()))

    expect(new Set(ids).size).toBe(1)
    expect(writes).toBe(1)
  })
})
