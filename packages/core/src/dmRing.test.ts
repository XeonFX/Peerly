import { describe, expect, it } from 'vitest'
import {
  decideDmRingToast,
  DM_RING_TOAST_COOLDOWN_MS,
  parseDmRingPayload,
} from './dmRing.js'

const good = {
  toUserId: 'bob',
  fromUserId: 'alice',
  fromName: 'Alice',
  code: 'a'.repeat(32),
  reason: 'open' as const,
}

describe('parseDmRingPayload', () => {
  it('accepts a valid open ring', () => {
    expect(parseDmRingPayload(good)).toEqual({
      ...good,
      code: 'a'.repeat(32),
      preview: undefined,
    })
  })

  it('rejects bad codes and self-rings', () => {
    expect(parseDmRingPayload({ ...good, code: 'short' })).toBeNull()
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
