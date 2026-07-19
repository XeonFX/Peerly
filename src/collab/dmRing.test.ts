import { describe, expect, it } from 'vitest'
import { parseDmRingPayload } from './dmRing'

describe('parseDmRingPayload re-export', () => {
  it('accepts a valid payload', () => {
    const code = 'a'.repeat(32)
    expect(
      parseDmRingPayload({
        toUserId: 'bob',
        fromUserId: 'alice',
        fromName: 'Alice',
        code,
        reason: 'open',
      })
    ).toMatchObject({ toUserId: 'bob', code })
  })
})
