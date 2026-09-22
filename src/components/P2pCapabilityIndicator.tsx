import {
  p2pIndicatorState,
  p2pIndicatorTone,
  p2pProbeIsUnproven,
  type P2pIndicatorState,
} from '@peerly/core'
import type { P2pCapability } from '../types'
import { useI18n } from '../i18n'

/**
 * Which of the five connectivity situations we are in is decided in
 * `@peerly/core`; the wording and styling are this app's.
 */
type Props = {
  capability: P2pCapability
  rtcPeerCount: number
  connectionError?: string | null
  compact?: boolean
  onRetry?: () => void
}

const LABELS: Record<P2pIndicatorState, string> = {
  active: 'P2P active',
  blocked: 'P2P path blocked',
  ready: 'P2P ready',
  unavailable: 'P2P unavailable',
  checking: 'Checking P2P',
}

const TONE_CLASS = {
  success: 'border-success/25 bg-success/10 text-success',
  error: 'border-error/30 bg-error/10 text-error',
  warning: 'border-warning/30 bg-warning/10 text-warning',
} as const

const TONE_BADGE = { success: 'Ready', error: 'Attention', warning: 'Testing' } as const

export function P2pCapabilityIndicator(props: Props) {
  const { tr } = useI18n()
  const state = p2pIndicatorState({
    capability: props.capability,
    peerCount: props.rtcPeerCount,
    connectionError: props.connectionError,
  })
  const tone = p2pIndicatorTone(state)
  const toneClass = TONE_CLASS[tone]
  const label = `${tr(LABELS[state])}${state === 'checking' ? '…' : ''}`

  const detail =
    state === 'active'
      ? tr(
          props.rtcPeerCount === 1
            ? '{count} direct peer connection verified on this network.'
            : '{count} direct peer connections verified on this network.',
          { count: props.rtcPeerCount }
        )
      : state === 'blocked'
        ? tr('Signaling found a teammate, but this network could not open a direct path. TURN fallback is required.')
        : tr(props.capability.detail)

  if (props.compact) {
    return (
      <div
        className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${toneClass}`}
        data-testid="p2p-capability"
        title={detail}
      >
        <span aria-hidden="true" className="text-[0.65rem]">●</span>
        <span className="min-w-0 flex-1 text-[0.68rem] font-semibold">{label}</span>
        {p2pProbeIsUnproven(state) && (
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
            <h3 className="mt-1 text-base font-semibold">{label}</h3>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${toneClass}`}>
            ● {tr(TONE_BADGE[tone])}
          </span>
        </div>
        <p className="text-sm leading-relaxed text-base-content/60">{detail}</p>
        {p2pProbeIsUnproven(state) && (
          <p className="text-xs leading-relaxed text-base-content/45">
            {tr('This local test catches disabled WebRTC. Strict NAT and corporate firewalls can only be confirmed when another device attempts to connect.')}
          </p>
        )}
        {props.onRetry && state === 'unavailable' && (
          <button type="button" className="btn btn-outline btn-sm self-start" onClick={props.onRetry}>
            {tr('Test again')}
          </button>
        )}
      </div>
    </section>
  )
}
