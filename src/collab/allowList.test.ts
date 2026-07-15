import { describe, expect, it } from 'vitest'
import type { KvStore } from '../utils/kvStore'
import { DeviceIdentity } from './deviceIdentity'
import { isEmailAllowed, newerAllowList, signAllowList, verifyAllowList } from './allowList'

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

describe('signed allow-list', () => {
  it('verifies against the signer key and rejects a different key', async () => {
    const creator = new DeviceIdentity(memoryStore())
    const mallory = new DeviceIdentity(memoryStore())

    const list = await signAllowList(creator, ['Alice@Example.com', 'bob@example.com'])

    expect(await verifyAllowList(list, await creator.publicKeyId())).toBe(true)
    expect(await verifyAllowList(list, await mallory.publicKeyId())).toBe(false)
  })

  it('rejects a list whose emails were edited after signing', async () => {
    const creator = new DeviceIdentity(memoryStore())
    const list = await signAllowList(creator, ['alice@example.com'])
    const creatorKeyId = await creator.publicKeyId()

    // A member (or the room's relay) tries to sneak an extra email in.
    const tampered = { ...list, emails: [...list.emails, 'attacker@evil.com'] }

    expect(await verifyAllowList(tampered, creatorKeyId)).toBe(false)
  })

  it('rejects a list whose signedAt was rolled back to defeat newest-wins', async () => {
    const creator = new DeviceIdentity(memoryStore())
    const list = await signAllowList(creator, ['alice@example.com'])
    const creatorKeyId = await creator.publicKeyId()

    const tampered = { ...list, signedAt: list.signedAt - 1_000_000 }

    expect(await verifyAllowList(tampered, creatorKeyId)).toBe(false)
  })

  it('canonicalizes emails: case, whitespace, and duplicates', async () => {
    const creator = new DeviceIdentity(memoryStore())
    const list = await signAllowList(creator, [' Alice@Example.com ', 'alice@example.com', 'BOB@x.com'])

    expect(list.emails).toEqual(['alice@example.com', 'bob@x.com'])
    expect(await verifyAllowList(list, await creator.publicKeyId())).toBe(true)
  })

  it('checks membership case-insensitively', async () => {
    const creator = new DeviceIdentity(memoryStore())
    const list = await signAllowList(creator, ['alice@example.com'])

    expect(isEmailAllowed(list, 'Alice@Example.com')).toBe(true)
    expect(isEmailAllowed(list, 'mallory@example.com')).toBe(false)
  })

  it('newerAllowList keeps the most recently signed list', () => {
    const older = { emails: ['a@x.com'], signedAt: 100, signature: 's1' }
    const newer = { emails: ['a@x.com', 'b@x.com'], signedAt: 200, signature: 's2' }

    expect(newerAllowList(older, newer)).toBe(newer)
    expect(newerAllowList(newer, older)).toBe(newer)
  })
})
