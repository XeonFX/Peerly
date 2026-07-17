import { probeNostrRelays, type RelayProbeResult } from '@peerly/core'
import { getNostrRelayConfig } from '../config'
import { getSignalingStrategy } from './signaling'

/**
 * Shared, session-wide relay health state. An open WebSocket is not health:
 * relays have rotted in place by accepting the socket and rejecting every
 * publish (proof-of-work demands, web-of-trust gates), which a socket count
 * cannot see. This store holds the results of real echo probes
 * (@peerly/core's probeNostrRelays) so both the sidebar summary and the
 * settings card render from one measurement.
 *
 * Probes open two short-lived sockets per relay, so they run once per
 * session automatically plus on explicit re-check — never on an interval;
 * public relays throttle exactly that.
 */

export type RelayDiagnostics = {
  status: 'idle' | 'checking' | 'done'
  results: RelayProbeResult[]
  checkedAt: number | null
}

let state: RelayDiagnostics = { status: 'idle', results: [], checkedAt: null }
const listeners = new Set<() => void>()

function setState(next: RelayDiagnostics): void {
  state = next
  for (const listener of listeners) listener()
}

export function getRelayDiagnostics(): RelayDiagnostics {
  return state
}

export function subscribeRelayDiagnostics(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Probing is meaningful only for Nostr — ws-relay/Supabase are one host you run. */
export function relayDiagnosticsApplicable(): boolean {
  return getSignalingStrategy() === 'nostr'
}

export async function recheckRelays(): Promise<void> {
  if (!relayDiagnosticsApplicable() || state.status === 'checking') return
  setState({ ...state, status: 'checking' })
  const results = await probeNostrRelays(getNostrRelayConfig().urls)
  setState({ status: 'done', results, checkedAt: Date.now() })
}

let scheduled = false

/** One automatic probe per session, shortly after signaling settles. */
export function scheduleSessionRelayProbe(delayMs = 8_000): void {
  if (scheduled || !relayDiagnosticsApplicable()) return
  scheduled = true
  window.setTimeout(() => void recheckRelays(), delayMs)
}

/** Test helper. */
export function resetRelayDiagnostics(): void {
  scheduled = false
  state = { status: 'idle', results: [], checkedAt: null }
}
