import type { Peer } from '../types'

/**
 * Present a person once even when they have several browser tabs/devices in
 * the room. Transport peer ids remain device-scoped; verified user ids are the
 * only safe key for aggregating them.
 *
 * Direct P2P peers should be passed before relay-only peers so actions retain a
 * live, authenticated transport target.
 */
export function aggregatePeersByUserId(
  peers: readonly Peer[],
  selfUserId?: string
): Peer[] {
  const aggregated: Peer[] = []
  const indexByUserId = new Map<string, number>()

  for (const peer of peers) {
    if (peer.userId && peer.userId === selfUserId) continue
    if (!peer.userId) {
      aggregated.push(peer)
      continue
    }

    const existingIndex = indexByUserId.get(peer.userId)
    if (existingIndex === undefined) {
      indexByUserId.set(peer.userId, aggregated.length)
      aggregated.push(peer)
      continue
    }

    const existing = aggregated[existingIndex]
    if (existing?.presenceOnly && !peer.presenceOnly) {
      aggregated[existingIndex] = peer
    }
  }

  return aggregated
}
