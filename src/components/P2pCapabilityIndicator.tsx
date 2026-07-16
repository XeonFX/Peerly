import type { P2pCapability } from '../types'
import { useI18n } from '../i18n'

type Props = {
  capability: P2pCapability
  rtcPeerCount: number
  connectionError?: string | null
  compact?: boolean
  onRetry?: () => void
}

const PATH_BLOCKED_PATTERN = /TURN server is needed|blocks peer-to-peer|strict NAT|firewall/i

function presentation({ capability, rtcPeerCount, connectionError }: Props) {
  if (rtcPeerCount > 0) {
    return {
      tone: 'success',
      label: 'P2P active',
      detail: `${rtcPeerCount} direct peer connection${rtcPeerCount === 1 ? '' : 's'} verified on this network.`,
    }
  }
  if (connectionError && PATH_BLOCKED_PATTERN.test(connectionError)) {
    return {
      tone: 'error',
      label: 'P2P path blocked',
      detail: 'Signaling found a teammate, but this network could not open a direct path. TURN fallback is required.',
    }
  }
  if (capability.status === 'available') {
    return { tone: 'success', label: 'P2P ready', detail: capability.detail }
  }
  if (capability.status === 'unavailable') {
    return { tone: 'error', label: 'P2P unavailable', detail: capability.detail }
  }
  return { tone: 'warning', label: 'Checking P2P…', detail: capability.detail }
}

export function P2pCapabilityIndicator(props: Props) {
  const { tr } = useI18n()
  const state = presentation(props)
  const detail = props.rtcPeerCount > 0
    ? tr(
        props.rtcPeerCount === 1
          ? '{count} direct peer connection verified on this network.'
          : '{count} direct peer connections verified on this network.',
        { count: props.rtcPeerCount }
      )
    : tr(state.detail)
  const toneClass =
    state.tone === 'success'
      ? 'border-success/25 bg-success/10 text-success'
      : state.tone === 'error'
        ? 'border-error/30 bg-error/10 text-error'
        : 'border-warning/30 bg-warning/10 text-warning'

  if (props.compact) {
    return (
      <div
        className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${toneClass}`}
        data-testid="p2p-capability"
        title={detail}
      >
        <span aria-hidden="true" className="text-[0.65rem]">●</span>
        <span className="min-w-0 flex-1 text-[0.68rem] font-semibold">{tr(state.label.replace('…', ''))}{state.label.endsWith('…') ? '…' : ''}</span>
        {props.rtcPeerCount === 0 && props.capability.status === 'available' && (
          <span className="text-[0.6rem] font-normal opacity-70">{tr('local check')}</span>
        )}
      </div>
    )
  }

  return (
    <section
      className="card border border-base-300/80 bg-base-200/70"
      data-testid="p2p-capability-card"
    >
      <div className="card-body gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">{tr('Connectivity')}</p>
            <h3 className="mt-1 text-base font-semibold">{tr(state.label.replace('…', ''))}{state.label.endsWith('…') ? '…' : ''}</h3>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${toneClass}`}>
            ● {tr(state.tone === 'success' ? 'Ready' : state.tone === 'error' ? 'Attention' : 'Testing')}
          </span>
        </div>
        <p className="text-sm leading-relaxed text-base-content/60">{detail}</p>
        {props.rtcPeerCount === 0 && props.capability.status === 'available' && (
          <p className="text-xs leading-relaxed text-base-content/45">
            {tr('This local test catches disabled WebRTC. Strict NAT and corporate firewalls can only be confirmed when another device attempts to connect.')}
          </p>
        )}
        {props.onRetry && props.capability.status === 'unavailable' && (
          <button type="button" className="btn btn-outline btn-sm self-start" onClick={props.onRetry}>
            {tr('Test again')}
          </button>
        )}
      </div>
    </section>
  )
}
