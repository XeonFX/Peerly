import type { ConnectionStatus as Status } from '../types'

export function getConnectionLabel(
  relayOnline: boolean,
  connectionStatus: Status,
  rtcPeerCount = 0
): string {
  if (!relayOnline) return 'Signaling offline'
  if (connectionStatus === 'connecting') return 'Connecting…'
  if (connectionStatus === 'ready') return 'Waiting for peers'
  if (connectionStatus === 'connected') {
    return `Connected (${rtcPeerCount} peer${rtcPeerCount === 1 ? '' : 's'})`
  }
  if (connectionStatus === 'error') return 'Connection problem'
  return 'Unknown'
}