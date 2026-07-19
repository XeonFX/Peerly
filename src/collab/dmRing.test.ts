import { describe, expect, it } from 'vitest'
import { parseDmRingPayload } from './dmRing'

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
