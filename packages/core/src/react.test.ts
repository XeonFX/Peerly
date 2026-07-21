import { describe, expect, it } from 'vitest'
import { roomErrorKindForJoinError } from './react.js'

describe('roomErrorKindForJoinError', () => {
  it('treats post-SDP churn as a reconnect when TURN is configured', () => {
    expect(roomErrorKindForJoinError('ice-failed', true)).toBe('ice-failed')
  })

  it('offers TURN advice only when the build has no TURN server', () => {
    expect(roomErrorKindForJoinError('ice-failed', false)).toBe('needs-turn')
  })

  it('preserves password mismatches and leaves other diagnostics generic', () => {
    expect(roomErrorKindForJoinError('password-mismatch', true)).toBe('password-mismatch')
    expect(roomErrorKindForJoinError('needs-turn', true)).toBe('needs-turn')
    expect(roomErrorKindForJoinError('handshake-timeout', true)).toBe('generic')
    expect(roomErrorKindForJoinError('unknown', true)).toBe('generic')
  })
})
