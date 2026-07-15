import { describe, expect, it } from 'vitest'
import { verifyAllowList } from './allowList'
import type { KvStore } from '../utils/kvStore'
import { getE2eInvite, issueE2eGoogleToken, E2E_GOOGLE_CLIENT_ID, getE2eJwksFetcher } from './e2eAuth'
import { DeviceIdentity } from './deviceIdentity'
import { verifyGoogleIdToken } from './googleIdToken'

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

describe('e2eAuth', () => {
  it('verifies the fixed E2E invite allow-list signature', async () => {
    const invite = getE2eInvite()
    expect(await verifyAllowList(invite.allowList, invite.creatorKeyId)).toBe(true)
  })

  it('issues a Google token bound to a device key', async () => {
    const identity = new DeviceIdentity(memoryStore())
    const keyId = await identity.publicKeyId()
    const token = await issueE2eGoogleToken('alice@e2e.test', keyId)
    const claims = await verifyGoogleIdToken(token, {
      expectedAudience: E2E_GOOGLE_CLIENT_ID,
      expectedNonce: keyId,
      fetchJwks: getE2eJwksFetcher(),
    })
    expect(claims.email).toBe('alice@e2e.test')
  })
})