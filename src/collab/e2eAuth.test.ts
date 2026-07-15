import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  // The invite fixture carries no key material, so it works without the flag.
  it('verifies the fixed E2E invite allow-list signature', async () => {
    const invite = getE2eInvite()
    expect(await verifyAllowList(invite.allowList, invite.creatorKeyId)).toBe(true)
  })

  describe('with the bypass flag enabled (as in E2E runs)', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_E2E_AUTH_BYPASS', 'true')
    })
    afterEach(() => {
      vi.unstubAllEnvs()
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

    it('mints tokens that assert a verified email, like a real provider', async () => {
      const identity = new DeviceIdentity(memoryStore())
      const keyId = await identity.publicKeyId()
      const token = await issueE2eGoogleToken('alice@e2e.test', keyId)
      const claims = await verifyGoogleIdToken(token, {
        expectedAudience: E2E_GOOGLE_CLIENT_ID,
        expectedNonce: keyId,
        fetchJwks: getE2eJwksFetcher(),
      })
      // If the fake issuer stopped asserting this, E2E would silently stop
      // exercising the real email_verified path that production depends on.
      expect(claims.email_verified).toBe(true)
    })
  })

  describe('without the bypass flag (as in production)', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_E2E_AUTH_BYPASS', '')
    })
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    // The guard that keeps the signing key out of production bundles. If this
    // ever resolves, the key is reachable and `npm run guard:bundle` is the
    // only thing left standing between it and every deployment.
    it('refuses to reach the signing key', async () => {
      const identity = new DeviceIdentity(memoryStore())
      const keyId = await identity.publicKeyId()

      await expect(issueE2eGoogleToken('alice@e2e.test', keyId)).rejects.toThrow(
        /bypass is not enabled/i
      )
    })

    it('refuses to serve the fake JWKS', async () => {
      await expect(getE2eJwksFetcher()()).rejects.toThrow(/bypass is not enabled/i)
    })
  })
})