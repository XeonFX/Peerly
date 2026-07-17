import { useRelayDiagnostics } from '../../hooks/useRelayDiagnostics'
import { useI18n } from '../../i18n'
import { Icon } from '../Icon'

/**
 * Per-relay signaling health. The sidebar counts open sockets, which relays
 * can satisfy while rejecting every publish (proof-of-work demands,
 * web-of-trust gates). This card shows the echo-probe truth: which relays
 * actually carried a signaling event back, and what the rest said instead.
 */
export function RelayHealthCard() {
  const { tr } = useI18n()
  const { applicable, status, results, recheck } = useRelayDiagnostics()

  if (!applicable) return null

  const healthy = results.filter(result => result.ok).length

  return (
    <section
      className="card mt-5 border border-base-300/80 bg-base-200/70 shadow-xl shadow-black/20 backdrop-blur-xl"
      data-testid="relay-health-card"
    >
      <div className="card-body gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">{tr('Signaling relays')}</h3>
          <button
            type="button"
            className="btn btn-sm"
            onClick={recheck}
            disabled={status === 'checking'}
            data-testid="relay-recheck"
          >
            {status === 'checking' ? `${tr('Checking')}…` : tr('Re-check')}
          </button>
        </div>
        <p className="text-xs leading-relaxed text-base-content/65">
          {tr('An open connection is not enough — each relay is tested by publishing a signaling event and requiring it back. A relay can look connected while rejecting everything.')}
        </p>
        {status === 'done' && (
          <>
            <p className="text-sm" data-testid="relay-health-summary">
              {tr('{healthy} of {total} relays carrying signaling', {
                healthy,
                total: results.length,
              })}
            </p>
            <ul className="flex flex-col gap-1.5 text-sm">
              {results.map(result => (
                <li key={result.url} className="flex min-w-0 items-center gap-2">
                  <span className={result.ok ? 'text-success' : 'text-error'}>
                    <Icon name={result.ok ? 'check' : 'x'} size={14} />
                  </span>
                  <span className="truncate font-mono text-xs">{result.url}</span>
                  <span className="shrink-0 text-xs text-base-content/60">
                    {result.ok ? `${result.ms} ms` : result.detail ?? tr('failed')}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {status === 'checking' && results.length === 0 && (
          <p className="text-sm text-base-content/60">{tr('Checking')}…</p>
        )}
      </div>
    </section>
  )
}
