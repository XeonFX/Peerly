import type { RelayCoordinator } from './coordination.js'

export type RelayChannelPeer = { memberId: string }
export type RelayChannelPeers = Record<string, RelayChannelPeer>

export type RelayChannelAction<T> = {
  send(value: T, options?: { target?: string }): Promise<void>
  onMessage: ((value: T, meta: { peerId: string }) => void) | null
}

export type RelayChannelRoom = {
  makeAction<T>(event: string): RelayChannelAction<T>
  getPeers(): RelayChannelPeers
  onPeerJoin: ((peerId: string) => void) | null
  onPeerLeave: ((peerId: string) => void) | null
  leave(): void
}

/**
 * A bounded, server-forwarded data channel with the small subset of Trystero's
 * Room API used by the public lobbies. Private conversations remain WebRTC;
 * public discovery no longer creates peer connections or exposes peer IPs.
 */
export function createRelayChannel(
  coordinator: RelayCoordinator,
  channel: string,
  memberId: string
): RelayChannelRoom {
  const actions = new Map<string, RelayChannelAction<unknown>>()
  let peers: RelayChannelPeers = {}
  let ownConnectionId: string | undefined
  let closed = false

  const room: RelayChannelRoom = {
    makeAction<T>(event: string): RelayChannelAction<T> {
      const existing = actions.get(event)
      if (existing) return existing as RelayChannelAction<T>
      const action: RelayChannelAction<T> = {
        onMessage: null,
        async send(value, options) {
          if (closed) return
          const messageId = typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`
          coordinator.publishChannel(
            channel,
            event,
            messageId,
            JSON.stringify(value),
            options?.target
          )
        },
      }
      actions.set(event, action as RelayChannelAction<unknown>)
      return action
    },
    getPeers: () => peers,
    onPeerJoin: null,
    onPeerLeave: null,
    leave() {
      if (closed) return
      closed = true
      coordinator.unwatchChannel(channel)
      unsubscribe()
      for (const peerId of Object.keys(peers)) room.onPeerLeave?.(peerId)
      peers = {}
      actions.clear()
    },
  }

  const unsubscribe = coordinator.subscribe(event => {
    if (closed) return
    if (event.type === 'status') {
      ownConnectionId = event.connectionId
      if (event.available) coordinator.watchChannel(channel, memberId)
      return
    }
    if (event.type === 'channel.snapshot' && event.channel === channel) {
      const next: RelayChannelPeers = {}
      for (const member of event.members) {
        if (member.connectionId !== ownConnectionId) {
          next[member.connectionId] = { memberId: member.memberId }
        }
      }
      const previousIds = new Set(Object.keys(peers))
      peers = next
      for (const peerId of Object.keys(next)) {
        if (!previousIds.delete(peerId)) room.onPeerJoin?.(peerId)
      }
      for (const peerId of previousIds) room.onPeerLeave?.(peerId)
      return
    }
    if (event.type === 'channel.message' && event.channel === channel) {
      if (event.senderConnectionId === ownConnectionId) return
      const action = actions.get(event.event)
      if (!action?.onMessage) return
      try {
        action.onMessage(JSON.parse(event.data), { peerId: event.senderConnectionId })
      } catch {
        // Malformed channel payloads are untrusted input and are ignored.
      }
    }
  })

  coordinator.watchChannel(channel, memberId)
  return room
}
