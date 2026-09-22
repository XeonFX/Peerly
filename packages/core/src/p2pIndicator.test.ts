import { describe, expect, it } from 'vitest'
import {
  p2pIndicatorState,
  p2pIndicatorTone,
  p2pProbeIsUnproven,
  type P2pCapability,
} from './index.js'

const available: P2pCapability = { status: 'available', detail: '' }
const unavailable: P2pCapability = { status: 'unavailable', detail: '' }
const checking: P2pCapability = { status: 'checking', detail: '' }

describe('p2pIndicatorState', () => {
  it('trusts a live connection over anything the probe said', () => {
    expect(p2pIndicatorState({ capability: unavailable, peerCount: 2 })).toBe('active')
    expect(p2pIndicatorState({
      capability: unavailable, peerCount: 1, connectionError: 'strict NAT',
    })).toBe('active')
  })

  it('reports a blocked path over a passing local probe', () => {
    // The probe only proves this browser can talk to itself. A network that
    // says it blocked the path knows more, and one app was ignoring it —
    // showing a confident "ready" to users whose connections were failing.
    expect(p2pIndicatorState({
      capability: available,
      peerCount: 0,
      connectionError: 'This network blocks peer-to-peer connections.',
    })).toBe('blocked')
  })

  it.each([
    'A TURN server is needed on this network',
    'strict NAT detected',
    'blocked by a corporate firewall',
  ])('recognises a path-level failure: %s', message => {
    expect(p2pIndicatorState({
      capability: available, peerCount: 0, connectionError: message,
    })).toBe('blocked')
  })

  it('does not read a one-off failure as a blocked path', () => {
    // Single attempts fail for many reasons; only the path-level phrasing
    // should downgrade an otherwise passing probe.
    expect(p2pIndicatorState({
      capability: available, peerCount: 0, connectionError: 'Peer left before answering',
    })).toBe('ready')
  })

  it('falls back to what the probe found', () => {
    expect(p2pIndicatorState({ capability: available, peerCount: 0 })).toBe('ready')
    expect(p2pIndicatorState({ capability: unavailable, peerCount: 0 })).toBe('unavailable')
    expect(p2pIndicatorState({ capability: checking, peerCount: 0 })).toBe('checking')
  })
})

describe('presentation of a state', () => {
  it('reads as reassuring only when something actually worked', () => {
    expect(p2pIndicatorTone('active')).toBe('success')
    expect(p2pIndicatorTone('ready')).toBe('success')
    expect(p2pIndicatorTone('blocked')).toBe('error')
    expect(p2pIndicatorTone('unavailable')).toBe('error')
    expect(p2pIndicatorTone('checking')).toBe('warning')
  })

  it('caveats the probe only where the probe is all there is', () => {
    expect(p2pProbeIsUnproven('ready')).toBe(true)
    expect(p2pProbeIsUnproven('active')).toBe(false)
    expect(p2pProbeIsUnproven('blocked')).toBe(false)
  })
})
