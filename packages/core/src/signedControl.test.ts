import { describe, expect, it } from 'vitest'
import { DeviceIdentity } from './deviceIdentity.js'
import type { KvStore } from './kvStore.js'
import { createSignedControlReplayGuard, signControl, verifySignedControl } from './signedControl.js'

function identity(): DeviceIdentity {
  const values = new Map<string, CryptoKeyPair>()
  const store: KvStore<CryptoKeyPair> = {
    get: async key => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value) },
  }
  return new DeviceIdentity(store)
}

describe('signed control', () => {
  it('verifies a fresh message and rejects payload tampering', async () => {
    const now = Date.now()
    const message = await signControl(identity(), 'test-control-v1', 'presence', 'user-1', { online: true }, { now })
    await expect(verifySignedControl(message, 'test-control-v1', 'presence', now)).resolves.toEqual(message)
    await expect(verifySignedControl({ ...message, payload: { online: false } }, 'test-control-v1', 'presence', now))
      .resolves.toBeNull()
  })

  it('rejects stale/future messages and duplicate nonces', async () => {
    const now = Date.now()
    const message = await signControl(identity(), 'test-control-v1', 'presence', 'user-1', {}, { now })
    await expect(verifySignedControl(message, 'test-control-v1', 'presence', now + 3 * 60_000)).resolves.toBeNull()
    await expect(verifySignedControl(message, 'test-control-v1', 'presence', now - 31_000)).resolves.toBeNull()
    const guard = createSignedControlReplayGuard()
    expect(guard.accept(message)).toBe(true)
    expect(guard.accept(message)).toBe(false)
  })
})
