import type { ConnectionStatus as Status } from '../types'

type Props = {
  relayOnline: boolean
  connectionStatus: Status
  rtcPeerCount?: number
  variant?: 'badge' | 'text'
  testId?: string
}

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

export function ConnectionStatus({
  relayOnline,
  connectionStatus,
  rtcPeerCount = 0,
  variant = 'badge',
  testId,
}: Props) {
  const label = getConnectionLabel(relayOnline, connectionStatus, rtcPeerCount)
  const statusClass = relayOnline ? connectionStatus : 'error'

  if (variant === 'text') {
    return <span data-testid={testId}>{label}</span>
  }

  return (
    <span
      className={`connection-status status-${statusClass}`}
      data-testid={testId}
    >
      ● {label}
    </span>
  )
}