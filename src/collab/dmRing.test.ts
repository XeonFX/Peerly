import { describe, expect, it } from 'vitest'
import { parseDmRingPayload } from './dmRing'

describe('parseDmRingPayload re-export', () => {
  it('accepts a valid payload', () => {
    expect(
      parseDmRingPayload({
        toUserId: 'bob',
        fromUserId: 'alice',
        fromName: 'Alice',
        reason: 'open',
        deviceKeyId: 'P-256:test',
        sig: 'sig',
      })
    ).toMatchObject({ toUserId: 'bob' })
  })
})
