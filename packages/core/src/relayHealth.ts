import { getRelaySockets as getNostrSockets } from '@trystero-p2p/nostr'
import type { SignalingStrategy } from './signaling.js'

type SocketMap = ReturnType<typeof getNostrSockets>

export type RelayHealth = {
  getConnectedRelayUrls(): string[]
  isRelayOnline(): boolean
}

/**
 * Relay-socket visibility for one signaling strategy. A factory rather than
 * module-level state because the strategy is the app's build-time choice and a
 * library cannot read the app's env at import time.
 */
export function createRelayHealth(strategy: SignalingStrategy): RelayHealth {
  let wsGetSockets: (() => SocketMap) | null = null

  if (strategy === 'ws-relay') {
    void import('@trystero-p2p/ws-relay').then(module => {
      wsGetSockets = module.getRelaySockets
    })
  }

  function getRelaySockets(): SocketMap {
    if (strategy === 'ws-relay') {
      return wsGetSockets?.() ?? {}
    }
    return getNostrSockets()
  }

  function getConnectedRelayUrls(): string[] {
    if (strategy === 'supabase') {
      return ['supabase-realtime']
    }

    const sockets = getRelaySockets()
    return Object.entries(sockets)
      .filter(([, socket]) => (socket as WebSocket).readyState === WebSocket.OPEN)
      .map(([url]) => url)
  }

  function isRelayOnline(): boolean {
    if (strategy === 'supabase') return true
    return getConnectedRelayUrls().length > 0
  }

  return { getConnectedRelayUrls, isRelayOnline }
}
