import { getRelaySockets as getNostrSockets } from '@trystero-p2p/nostr'
import { getSignalingStrategy } from './signaling'

type SocketMap = ReturnType<typeof getNostrSockets>

let wsGetSockets: (() => SocketMap) | null = null

if (getSignalingStrategy() === 'ws-relay') {
  void import('@trystero-p2p/ws-relay').then(module => {
    wsGetSockets = module.getRelaySockets
  })
}

function getRelaySockets(): SocketMap {
  if (getSignalingStrategy() === 'ws-relay') {
    return wsGetSockets?.() ?? {}
  }
  return getNostrSockets()
}

export function getConnectedRelayUrls(): string[] {
  if (getSignalingStrategy() === 'supabase') {
    return ['supabase-realtime']
  }

  const sockets = getRelaySockets()
  return Object.entries(sockets)
    .filter(([, socket]) => (socket as WebSocket).readyState === WebSocket.OPEN)
    .map(([url]) => url)
}

export function isRelayOnline(): boolean {
  if (getSignalingStrategy() === 'supabase') return true
  return getConnectedRelayUrls().length > 0
}