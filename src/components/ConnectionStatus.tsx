import type { ConnectionStatus as Status } from '../types'
import { getConnectionLabel } from '../utils/connectionLabel'

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