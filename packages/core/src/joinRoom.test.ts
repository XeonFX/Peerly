import { describe, expect, it } from 'vitest'
import {
  classifyJoinError,
  DEFAULT_HANDSHAKE_TIMEOUT_MS,
  isRecoverableJoinError,
} from './joinRoom.js'

describe('classifyJoinError', () => {
  it('detects password mismatch', () => {
    expect(classifyJoinError('incorrect room password')).toBe('password-mismatch')
  })

  it('detects post-SDP ICE failure (TURN advice path)', () => {
    expect(
      classifyJoinError(
        'could not connect to peer abc after exchanging SDP; check that your TURN server URLs and credentials are reachable by both peers'
      )
    ).toBe('needs-turn')
  })

  it('detects handshake timeout separately from TURN', () => {
    expect(classifyJoinError('Trystero: handshake timed out after 10000ms')).toBe(
      'handshake-timeout'
    )
  })

  it('detects Chrome RTP extension renegotiation collision', () => {
    expect(
      classifyJoinError(
        'InvalidAccessError: Failed to execute \'setRemoteDescription\' on \'RTCPeerConnection\': Failed to set remote offer sdp: RTP extension ID reassignment not supported (collision on active MID 2, id=7)'
      )
    ).toBe('sdp-collision')
  })

  it('does not mis-label unknown messages as TURN', () => {
    expect(classifyJoinError('relay websocket closed')).toBe('unknown')
  })
})

describe('isRecoverableJoinError', () => {
  it('rejoins local wedges without rebuilding a room for one unreachable peer', () => {
    expect(isRecoverableJoinError('handshake-timeout')).toBe(true)
    expect(isRecoverableJoinError('sdp-collision')).toBe(true)
    expect(isRecoverableJoinError('needs-turn')).toBe(false)
    expect(isRecoverableJoinError('password-mismatch')).toBe(false)
    expect(isRecoverableJoinError('unknown')).toBe(false)
  })
})

describe('DEFAULT_HANDSHAKE_TIMEOUT_MS', () => {
  it('is longer than Trystero library default (10s) so TURN ICE can finish', () => {
    expect(DEFAULT_HANDSHAKE_TIMEOUT_MS).toBeGreaterThan(10_000)
    expect(DEFAULT_HANDSHAKE_TIMEOUT_MS).toBeLessThanOrEqual(60_000)
  })
})
