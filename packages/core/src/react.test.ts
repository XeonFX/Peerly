import { describe, expect, it } from 'vitest'
import {
  privateRoomRecoveryDelayMs,
  roomErrorKindForJoinError,
  safeJoinErrorLog,
} from './react.js'

describe('privateRoomRecoveryDelayMs', () => {
  it('elects one peer to recover first and staggers the other peer', () => {
    expect(privateRoomRecoveryDelayMs(0, 'alice-peer', 'bob-peer')).toBe(1_000)
    expect(privateRoomRecoveryDelayMs(0, 'bob-peer', 'alice-peer')).toBe(5_000)
  })

  it('uses bounded backoff when a remote peer id is unavailable', () => {
    expect(privateRoomRecoveryDelayMs(1, 'local')).toBe(3_000)
    expect(privateRoomRecoveryDelayMs(99, 'local')).toBe(8_000)
  })
})

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

  it('never copies a secret room id into support diagnostics', () => {
    const log = safeJoinErrorLog({
      error: 'could not connect after exchanging SDP',
      appId: 'peerly-collab-v1',
      peerId: 'peer-1',
      roomId: 'workspace-secret',
    } as { error: string; appId: string; peerId: string }, 'fallback')
    expect(log).toEqual({
      error: 'could not connect after exchanging SDP',
      appId: 'peerly-collab-v1',
      peerId: 'peer-1',
      kind: 'ice-failed',
    })
    expect(JSON.stringify(log)).not.toContain('workspace-secret')
  })
})
