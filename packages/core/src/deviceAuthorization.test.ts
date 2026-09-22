import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalizePublicKey } from './deviceIdentity.js'
import {
  createDeviceAuthorization,
  deviceFingerprint,
  grantAuthorizes,
  type DeviceGrant,
} from './deviceAuthorization.js'
import type { DeviceSigner } from './textChatSigning.js'

/**
 * Device grants decide whether a second device may act for an account, so the
 * guards matter more than the happy path. The two app copies agreed on the
 * wire and disagreed on the guards; these pin the reconciliation.
 */

const config = {
  scheme: 'test-device-grant-v1',
  grantsKey: 'test-device-grants',
  metaKey: 'test-device-meta',
  changedEvent: 'test-devices-changed',
  metaChangedEvent: 'test-device-meta-changed',
}

const PAIRING = 'pairing-id-1234567890'

async function keyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  ) as Promise<CryptoKeyPair>
}

/** A signer over a raw key pair — DeviceIdentity itself needs IndexedDB. */
function signerFor(pair: CryptoKeyPair, keyId: string): DeviceSigner {
  return {
    publicKeyId: async () => keyId,
    sign: async (payload: Uint8Array) => {
      const raw = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        pair.privateKey,
        payload as BufferSource
      )
      return Buffer.from(raw).toString('base64url')
    },
  }
}

let laptop: DeviceSigner
let phone: DeviceSigner
let laptopKey: string
let phoneKey: string

beforeAll(async () => {
  const laptopKeys = await keyPair()
  const phoneKeys = await keyPair()
  laptopKey = await canonicalizePublicKey(laptopKeys.publicKey)
  phoneKey = await canonicalizePublicKey(phoneKeys.publicKey)
  laptop = signerFor(laptopKeys, laptopKey)
  phone = signerFor(phoneKeys, phoneKey)
})

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => { values.clear() },
  })
})

describe('createDeviceAuthorization', () => {
  const store = () => createDeviceAuthorization(config)

  it('signs a grant its issuer can verify', async () => {
    const grants = store()
    const grant = await grants.sign(laptop, {
      userId: 'user-1', subjectDeviceKeyId: phoneKey as DeviceGrant['subjectDeviceKeyId'], pairingId: PAIRING,
    })
    expect(grant.issuerDeviceKeyId).toBe(laptopKey)
    expect(await grants.verify(grant)).toBe(true)
  })

  it('refuses to sign a grant from a device to itself', async () => {
    // Self-vouching proves nothing, and would let one compromised key
    // manufacture its own authorization.
    await expect(store().sign(laptop, {
      userId: 'user-1', subjectDeviceKeyId: laptopKey as DeviceGrant['subjectDeviceKeyId'], pairingId: PAIRING,
    })).rejects.toThrow(/distinct device keys/)
  })

  it('rejects a grant whose account or subject was edited after signing', async () => {
    const grants = store()
    const grant = await grants.sign(laptop, {
      userId: 'user-1', subjectDeviceKeyId: phoneKey as DeviceGrant['subjectDeviceKeyId'], pairingId: PAIRING,
    })
    expect(await grants.verify({ ...grant, userId: 'user-2' })).toBe(false)
    expect(await grants.verify({ ...grant, subjectDeviceKeyId: laptopKey as DeviceGrant['subjectDeviceKeyId'] })).toBe(false)
  })

  it('rejects oversized fields before touching the signature', async () => {
    // One app bounded these and the other did not, so unbounded key and
    // signature strings from the wire reached the crypto layer.
    const grants = store()
    const grant = await grants.sign(laptop, {
      userId: 'user-1', subjectDeviceKeyId: phoneKey as DeviceGrant['subjectDeviceKeyId'], pairingId: PAIRING,
    })
    expect(await grants.verify({ ...grant, sig: 'a'.repeat(513) })).toBe(false)
    expect(await grants.verify({ ...grant, userId: 'u'.repeat(257) })).toBe(false)
    expect(await grants.verify({ ...grant, pairingId: 'too-short' })).toBe(false)
  })

  it('refuses to store a grant that does not verify', async () => {
    const grants = store()
    const grant = await grants.sign(laptop, {
      userId: 'user-1', subjectDeviceKeyId: phoneKey as DeviceGrant['subjectDeviceKeyId'], pairingId: PAIRING,
    })
    expect(await grants.save({ ...grant, userId: 'user-2' })).toBe(false)
    expect(await grants.load('user-2')).toEqual([])
  })

  it('lists a device only once both directions exist', async () => {
    // A one-way grant is a half-finished pairing: we vouched for a device
    // that never vouched back, so it must not appear as approved.
    const grants = store()
    const outward = await grants.sign(laptop, {
      userId: 'user-1', subjectDeviceKeyId: phoneKey as DeviceGrant['subjectDeviceKeyId'], pairingId: PAIRING,
    })
    expect(await grants.save(outward)).toBe(true)
    expect(await grants.listApproved('user-1', laptopKey)).toEqual([])

    const back = await grants.sign(phone, {
      userId: 'user-1', subjectDeviceKeyId: laptopKey as DeviceGrant['subjectDeviceKeyId'], pairingId: PAIRING,
    })
    expect(await grants.save(back)).toBe(true)
    const approved = await grants.listApproved('user-1', laptopKey)
    expect(approved.map(device => device.deviceKeyId)).toEqual([phoneKey])
    expect(approved[0]?.label).toBe(deviceFingerprint(phoneKey))
  })

  it('revokes both directions of a pairing', async () => {
    // Leaving the inbound half would let the revoked device keep proving it
    // belongs to this account.
    const grants = store()
    await grants.save(await grants.sign(laptop, {
      userId: 'user-1', subjectDeviceKeyId: phoneKey as DeviceGrant['subjectDeviceKeyId'], pairingId: PAIRING,
    }))
    await grants.save(await grants.sign(phone, {
      userId: 'user-1', subjectDeviceKeyId: laptopKey as DeviceGrant['subjectDeviceKeyId'], pairingId: PAIRING,
    }))
    grants.revoke('user-1', laptopKey, phoneKey)
    expect(await grants.load('user-1')).toEqual([])
  })

  it('finds a grant by issuer, with or without a subject', async () => {
    const grants = store()
    await grants.save(await grants.sign(laptop, {
      userId: 'user-1', subjectDeviceKeyId: phoneKey as DeviceGrant['subjectDeviceKeyId'], pairingId: PAIRING,
    }))
    expect(grants.find('user-1', laptopKey)?.subjectDeviceKeyId).toBe(phoneKey)
    expect(grants.find('user-1', laptopKey, phoneKey)).toBeDefined()
    expect(grants.find('user-1', laptopKey, 'other-key')).toBeUndefined()
    expect(grants.findAuthorizing('user-1', phoneKey)?.issuerDeviceKeyId).toBe(laptopKey)
  })

  it('replaces an earlier grant for the same pair rather than accumulating', async () => {
    const grants = store()
    await grants.save(await grants.sign(laptop, {
      userId: 'user-1', subjectDeviceKeyId: phoneKey as DeviceGrant['subjectDeviceKeyId'], pairingId: PAIRING,
    }))
    await grants.save(await grants.sign(laptop, {
      userId: 'user-1', subjectDeviceKeyId: phoneKey as DeviceGrant['subjectDeviceKeyId'], pairingId: `${PAIRING}-2`,
    }))
    const stored = await grants.load('user-1')
    expect(stored).toHaveLength(1)
    expect(stored[0]?.pairingId).toBe(`${PAIRING}-2`)
  })

  it('keeps a recognisable label when a blank one is recorded', async () => {
    // Re-pairing sends no label; overwriting would replace a name the user
    // chose with a fingerprint.
    const grants = store()
    grants.remember(phoneKey, 'Kitchen laptop')
    grants.remember(phoneKey, '   ')
    await grants.save(await grants.sign(laptop, {
      userId: 'user-1', subjectDeviceKeyId: phoneKey as DeviceGrant['subjectDeviceKeyId'], pairingId: PAIRING,
    }))
    await grants.save(await grants.sign(phone, {
      userId: 'user-1', subjectDeviceKeyId: laptopKey as DeviceGrant['subjectDeviceKeyId'], pairingId: PAIRING,
    }))
    expect((await grants.listApproved('user-1', laptopKey))[0]?.label).toBe('Kitchen laptop')
  })

  it('ignores a label for no device', () => {
    expect(() => store().remember('', 'Nowhere')).not.toThrow()
  })

  it('keeps grants from another app out', async () => {
    // The scheme is signed in, so a grant minted by the other product must
    // not verify here even though the shape is identical.
    const mine = store()
    const theirs = createDeviceAuthorization({ ...config, scheme: 'other-app-grant-v1' })
    const foreign = await theirs.sign(laptop, {
      userId: 'user-1', subjectDeviceKeyId: phoneKey as DeviceGrant['subjectDeviceKeyId'], pairingId: PAIRING,
    })
    expect(await theirs.verify(foreign)).toBe(true)
    expect(await mine.verify(foreign)).toBe(false)
  })

  it('answers only the exact claim it was asked about', () => {
    const grant = {
      v: 1, userId: 'user-1', issuerDeviceKeyId: laptopKey, subjectDeviceKeyId: phoneKey,
      createdAt: 1, pairingId: PAIRING, sig: 'x',
    } as DeviceGrant
    expect(grantAuthorizes(grant, 'user-1', laptopKey, phoneKey)).toBe(true)
    expect(grantAuthorizes(grant, 'user-2', laptopKey, phoneKey)).toBe(false)
    expect(grantAuthorizes(grant, 'user-1', phoneKey, laptopKey)).toBe(false)
    expect(grantAuthorizes(undefined, 'user-1', laptopKey, phoneKey)).toBe(false)
  })
})
