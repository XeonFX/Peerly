import type { TransportState } from './types.js'

/**
 * Whether the Durable Objects control socket is up, readable from outside the
 * transport.
 *
 * The other signaling strategies answer this through their relay library's
 * module-level socket map, which is what the connection indicator polls. The
 * DO transport had no equivalent, so that poll found no sockets and the app
 * reported "Signaling offline" the entire time it was connected and working —
 * a fault invisible to every test that did not run a real browser.
 *
 * Module state for the same reason the relay libraries use it: the indicator
 * is far from the transport, and threading a handle through every layer
 * between them would be a worse trade than one value scoped to one page.
 */
let current: TransportState = 'offline'

export function publishRealtimeTransportState(state: TransportState): void {
  current = state
}

export function realtimeTransportState(): TransportState {
  return current
}

/**
 * `ready` alone. The intermediate states are real progress but nothing can be
 * signalled through them yet, and reporting them as online would replace an
 * indicator that is wrong in one direction with one that is wrong in the other.
 */
export function isRealtimeTransportOnline(): boolean {
  return current === 'ready'
}
