import type { ConnectionStatus as Status } from '../types'

/**
 * Status colours come from the theme rather than hex literals, so the dot always
 * agrees with the alerts and buttons that report the same conditions.
 */
const STATUS_TONE: Record<Status | 'error', string> = {
  connecting: 'text-warning',
  ready: 'text-base-content/50',
  connected: 'text-success',
  error: 'text-error',
}

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
      className={`flex items-center gap-1.5 text-[0.7rem] font-semibold ${STATUS_TONE[statusClass]}`}
      data-testid={testId}
    >
      <span aria-hidden="true">●</span>
      {label}
    </span>
  )
}