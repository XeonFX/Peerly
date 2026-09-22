import type { P2pCapability } from './p2pCapability.js'

/**
 * What a connectivity indicator should be saying, given everything known.
 *
 * The local probe (see p2pCapability) proves only that this browser can open a
 * data channel to itself. It cannot see a strict NAT or a corporate firewall,
 * so it reports "available" on networks where nothing will actually connect —
 * which is exactly the case a user needs told about.
 *
 * So the ordering here is by how much each signal actually knows:
 *
 *  1. a live peer, which settles it — a path demonstrably works
 *  2. a connection error naming a blocked path, which is the network telling
 *     us what the probe could not
 *  3. the local probe, which is a floor rather than a verdict
 *
 * Only one app was looking at (2), so the other showed a confident "P2P ready"
 * to users whose connections were failing.
 */
export type P2pIndicatorTone = 'success' | 'error' | 'warning'

export type P2pIndicatorState =
  /** A direct connection to at least one peer is up. */
  | 'active'
  /** Signaling worked but no direct path could be opened; TURN is required. */
  | 'blocked'
  /** The local probe passed. Says nothing about this network. */
  | 'ready'
  /** The local probe failed: WebRTC is missing or disabled. */
  | 'unavailable'
  /** The probe has not finished. */
  | 'checking'

export type P2pIndicatorInput = {
  capability: P2pCapability
  /** Verified direct connections right now. */
  peerCount: number
  /** Last transport error, if the app tracks one. */
  connectionError?: string | null
}

/**
 * Phrases a transport error uses when the path itself is the problem, as
 * opposed to the many ways a single attempt can fail transiently.
 */
const PATH_BLOCKED = /TURN server is needed|blocks peer-to-peer|strict NAT|firewall/i

const TONES: Record<P2pIndicatorState, P2pIndicatorTone> = {
  active: 'success',
  blocked: 'error',
  ready: 'success',
  unavailable: 'error',
  checking: 'warning',
}

/**
 * The state to render. Apps supply their own wording and styling — this only
 * decides which of the five situations they are in.
 */
export function p2pIndicatorState(input: P2pIndicatorInput): P2pIndicatorState {
  if (input.peerCount > 0) return 'active'
  if (input.connectionError && PATH_BLOCKED.test(input.connectionError)) return 'blocked'
  if (input.capability.status === 'available') return 'ready'
  if (input.capability.status === 'unavailable') return 'unavailable'
  return 'checking'
}

export function p2pIndicatorTone(state: P2pIndicatorState): P2pIndicatorTone {
  return TONES[state]
}

/**
 * Whether to add the caveat that a passing local probe is not proof. True only
 * where the indicator is otherwise saying something reassuring on the strength
 * of the probe alone.
 */
export function p2pProbeIsUnproven(state: P2pIndicatorState): boolean {
  return state === 'ready'
}
