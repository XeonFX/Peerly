import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createDmRing,
  decideDmRingToast,
  DM_RING_TOAST_COOLDOWN_MS,
  parseDmRingPayload,
  type DmRingPayload,
} from './dmRing.js'
import { createDeviceAuthorization, type DeviceGrant } from './deviceAuthorization.js'
import { canonicalizePublicKey } from './deviceIdentity.js'
import type { DeviceSigner } from './textChatSigning.js'

const SCHEME = 'test-ring-v1'

const grants = createDeviceAuthorization({
  scheme: 'test-device-grant-v1',
  grantsKey: 'test-ring-grants',
  metaKey: 'test-ring-meta',
  changedEvent: 'test-ring-devices-changed',
  metaChangedEvent: 'test-ring-meta-changed',
})

const ring = createDmRing({ scheme: SCHEME, grants })

async function makeSigner(): Promise<DeviceSigner & { keyId: string }> {
  const keys = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  )
  const keyId = await canonicalizePublicKey(keys.publicKey)
  return {
    keyId,
    publicKeyId: async () => keyId,
    sign: async (data: Uint8Array) =>
      Buffer.from(
        await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          keys.privateKey,
          data as BufferSource
        )
      ).toString('base64url'),
  }
}

/** Alice's two devices: the one Bob recorded, and a later addition. */
let recorded: DeviceSigner & { keyId: string }
let second: DeviceSigner & { keyId: string }

beforeAll(async () => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  })
  recorded = await makeSigner()
  second = await makeSigner()
})

const good = {
  toUserId: 'bob',
  fromUserId: 'alice',
  fromName: 'Alice',
  reason: 'open' as const,
  deviceKeyId: 'P-256:test',
  sig: 'sig',
}

describe('parseDmRingPayload', () => {
  it('accepts a valid open ring', () => {
    expect(parseDmRingPayload(good)).toEqual(good)
  })

  it('rejects self-rings, including whitespace-padded ones', () => {
    // One copy compared the ids untrimmed, so ' alice' rang 'alice'.
    expect(parseDmRingPayload({ ...good, toUserId: 'alice', fromUserId: 'alice' })).toBeNull()
    expect(parseDmRingPayload({ ...good, toUserId: ' alice ', fromUserId: 'alice' })).toBeNull()
  })

  it('rejects unknown reasons', () => {
    expect(parseDmRingPayload({ ...good, reason: 'wave' })).toBeNull()
  })

  it('clips previews on message rings', () => {
    const parsed = parseDmRingPayload({ ...good, reason: 'message', preview: 'x'.repeat(200) })
    expect(parsed?.preview).toHaveLength(120)
  })

  it('carries an attached grant through', () => {
    // Dropping it here is what silently broke rings from a second device.
    const deviceGrant = { v: 1, userId: 'alice' } as unknown as DeviceGrant
    expect(parseDmRingPayload({ ...good, deviceGrant })?.deviceGrant).toEqual(deviceGrant)
    expect(parseDmRingPayload({ ...good, deviceGrant: 'nonsense' })?.deviceGrant).toBeUndefined()
  })
})

describe('signed DM rings', () => {
  it('authenticates every displayed field and carries no room credential', async () => {
    const payload = await ring.sign(recorded, {
      toUserId: 'bob',
      fromUserId: 'alice',
      fromName: 'Alice',
      reason: 'message',
      preview: 'hello',
    })
    expect('code' in payload).toBe(false)
    expect(await ring.verify(payload)).toBe(true)
    expect(await ring.verify({ ...payload, preview: 'tampered' })).toBe(false)
    expect(await ring.verify({ ...payload, fromName: 'Mallory' })).toBe(false)
  })

  it('rejects a ring signed under another app scheme', async () => {
    const other = createDmRing({ scheme: 'other-app-ring-v1', grants })
    const payload = await other.sign(recorded, {
      toUserId: 'bob', fromUserId: 'alice', fromName: 'Alice', reason: 'open',
    })
    expect(await other.verify(payload)).toBe(true)
    expect(await ring.verify(payload)).toBe(false)
  })
})

describe('rings from a second device', () => {
  /** Alice's recorded device authorising her new one. */
  async function grantForSecond(): Promise<DeviceGrant> {
    return grants.sign(recorded, {
      userId: 'alice',
      subjectDeviceKeyId: second.keyId as DeviceGrant['subjectDeviceKeyId'],
      pairingId: 'pairing-id-1234567890',
    })
  }

  async function ringFromSecond(deviceGrant?: DeviceGrant): Promise<DmRingPayload> {
    return ring.sign(second, {
      toUserId: 'bob',
      fromUserId: 'alice',
      fromName: 'Alice',
      reason: 'open',
      ...(deviceGrant ? { deviceGrant } : {}),
    })
  }

  it('accepts a ring backed by a valid grant', async () => {
    const payload = await ringFromSecond(await grantForSecond())
    expect(await ring.verify(payload)).toBe(true)
    expect(ring.authorizedBy(payload, recorded.keyId)).toBe(true)
  })

  it('binds the grant into the signature', async () => {
    // Otherwise a captured ring could be re-sent with a different grant.
    const payload = await ringFromSecond(await grantForSecond())
    const stripped = { ...payload }
    delete stripped.deviceGrant
    expect(await ring.verify(stripped)).toBe(false)
  })

  it('rejects a grant that is about someone else', async () => {
    const foreign = await grants.sign(recorded, {
      userId: 'mallory',
      subjectDeviceKeyId: second.keyId as DeviceGrant['subjectDeviceKeyId'],
      pairingId: 'pairing-id-1234567890',
    })
    expect(await ring.verify(await ringFromSecond(foreign))).toBe(false)
  })

  it('rejects a grant that is about a different device', async () => {
    // Any valid grant would otherwise do, whoever actually signed the ring.
    const third = await makeSigner()
    const elsewhere = await grants.sign(recorded, {
      userId: 'alice',
      subjectDeviceKeyId: third.keyId as DeviceGrant['subjectDeviceKeyId'],
      pairingId: 'pairing-id-1234567890',
    })
    expect(await ring.verify(await ringFromSecond(elsewhere))).toBe(false)
  })

  it('refuses an unbacked ring from an unrecognised device', async () => {
    const payload = await ringFromSecond()
    expect(await ring.verify(payload)).toBe(true)
    // Correctly signed, but by a device the recipient has no reason to trust.
    expect(ring.authorizedBy(payload, recorded.keyId)).toBe(false)
  })

  it('trusts the recorded device with no grant at all', async () => {
    const payload = await ring.sign(recorded, {
      toUserId: 'bob', fromUserId: 'alice', fromName: 'Alice', reason: 'open',
    })
    expect(ring.authorizedBy(payload, recorded.keyId)).toBe(true)
  })

  it('trusts nobody when no device was ever recorded', async () => {
    const payload = await ringFromSecond(await grantForSecond())
    expect(ring.authorizedBy(payload, undefined)).toBe(false)
  })
})

describe('decideDmRingToast', () => {
  const t0 = 1_000_000

  it('shows the first open-ring', () => {
    expect(decideDmRingToast('open', undefined, t0)).toBe('show')
  })

  it('skips further open-rings while the toast is still visible', () => {
    expect(decideDmRingToast('open', { toastVisible: true, shownAt: t0 }, t0 + 6_000)).toBe('skip')
  })

  it('replaces when a message arrives while the toast is visible', () => {
    expect(decideDmRingToast('message', { toastVisible: true, shownAt: t0 }, t0 + 1_000)).toBe('replace')
  })

  it('re-shows open after cooldown once the toast is gone', () => {
    const entry = { toastVisible: false, shownAt: t0 }
    expect(decideDmRingToast('open', entry, t0 + DM_RING_TOAST_COOLDOWN_MS - 1)).toBe('skip')
    expect(decideDmRingToast('open', entry, t0 + DM_RING_TOAST_COOLDOWN_MS)).toBe('show')
  })
})
