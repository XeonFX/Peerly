import { beforeAll, describe, expect, it } from 'vitest'
import {
  decideDmRingToast,
  DM_RING_TOAST_COOLDOWN_MS,
  parseDmRingPayload,
  signDmRing,
  verifyDmRing,
} from './dmRing.js'
import { canonicalizePublicKey } from './deviceIdentity.js'

let signer: { publicKeyId: () => Promise<string>; sign: (data: Uint8Array) => Promise<string> }

beforeAll(async () => {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])
  const keyId = await canonicalizePublicKey(keys.publicKey)
  signer = {
    publicKeyId: async () => keyId,
    sign: async data => Buffer.from(await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      keys.privateKey,
      data as BufferSource
    )).toString('base64url'),
  }
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
    expect(parseDmRingPayload(good)).toEqual({
      ...good,
      preview: undefined,
    })
  })

  it('rejects self-rings and unknown reasons', () => {
    expect(parseDmRingPayload({ ...good, toUserId: 'alice', fromUserId: 'alice' })).toBeNull()
    expect(parseDmRingPayload({ ...good, reason: 'wave' })).toBeNull()
  })

  it('clips previews on message rings', () => {
    const parsed = parseDmRingPayload({
      ...good,
      reason: 'message',
      preview: 'x'.repeat(200),
    })
    expect(parsed?.preview).toHaveLength(120)
  })
})

describe('signed DM rings', () => {
  it('authenticates all displayed fields and contains no room credential', async () => {
    const ring = await signDmRing(signer, 'test-ring-v1', {
      toUserId: 'bob',
      fromUserId: 'alice',
      fromName: 'Alice',
      reason: 'message',
      preview: 'hello',
    })
    expect('code' in ring).toBe(false)
    expect(await verifyDmRing('test-ring-v1', ring)).toBe(true)
    expect(await verifyDmRing('test-ring-v1', { ...ring, preview: 'tampered' })).toBe(false)
  })
})

describe('decideDmRingToast', () => {
  const t0 = 1_000_000

  it('shows the first open-ring', () => {
    expect(decideDmRingToast('open', undefined, t0)).toBe('show')
  })

  it('skips further open-rings while the toast is still visible', () => {
    const entry = { toastVisible: true, shownAt: t0 }
    expect(decideDmRingToast('open', entry, t0 + 6_000)).toBe('skip')
  })

  it('replaces when a message arrives while toast is visible', () => {
    const entry = { toastVisible: true, shownAt: t0 }
    expect(decideDmRingToast('message', entry, t0 + 1_000)).toBe('replace')
  })

  it('re-shows open after cooldown once toast is gone', () => {
    const entry = { toastVisible: false, shownAt: t0 }
    expect(decideDmRingToast('open', entry, t0 + DM_RING_TOAST_COOLDOWN_MS - 1)).toBe(
      'skip'
    )
    expect(decideDmRingToast('open', entry, t0 + DM_RING_TOAST_COOLDOWN_MS)).toBe('show')
  })
})
