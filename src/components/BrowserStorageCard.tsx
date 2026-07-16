import type { BrowserStorageEstimate, StoragePressure } from '../utils/browserStorage'
import { formatBytes } from '../utils/format'

type Props = {
  estimate: BrowserStorageEstimate
  pressure: StoragePressure
  onRefresh: () => void
  onRequestPersistence: () => Promise<boolean>
  requestingPersistence: boolean
}
const pressureCopy: Record<StoragePressure, string> = {
  ok: 'There is room for cached files and previews.',
  notice: 'Storage is filling up. Consider removing originals you no longer need offline.',
  warning: 'Storage is running low. Automatic original-file downloads are paused.',
  critical: 'Storage is almost full. Background media sync is paused to keep messages working.',
}

export function BrowserStorageCard({
  estimate,
  pressure,
  onRefresh,
  onRequestPersistence,
  requestingPersistence,
}: Props) {
  const percent = estimate.usageRatio === undefined ? undefined : Math.round(estimate.usageRatio * 100)
  const hasNumbers = estimate.usageBytes !== undefined && estimate.quotaBytes !== undefined

  return (
    <section
      className={`storage-overview card border bg-base-100 shadow-sm ${
        pressure === 'critical'
          ? 'border-error/40'
          : pressure === 'warning'
            ? 'border-warning/50'
            : 'border-base-300/80'
      }`}
      data-testid="browser-storage-card"
    >
      <div className="card-body gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Browser storage</p>
            <h3 className="mt-1 text-xl font-semibold tracking-tight">
              {estimate.availableBytes === undefined
                ? 'Availability unknown'
                : `${formatBytes(estimate.availableBytes)} available`}
            </h3>
            <p className="mt-1 text-sm text-base-content/55">
              {hasNumbers
                ? `${formatBytes(estimate.usageBytes!)} used of approximately ${formatBytes(estimate.quotaBytes!)}`
                : estimate.supported
                  ? 'The browser did not provide a quota estimate.'
                  : 'Storage estimates are unavailable in this browser.'}
            </p>
          </div>
          {percent !== undefined && (
            <span className={`storage-pressure-pill storage-pressure-${pressure}`}>
              {percent}% used
            </span>
          )}
        </div>

        {percent !== undefined && (
          <div>
            <progress
              className={`progress h-2.5 w-full ${
                pressure === 'critical'
                  ? 'progress-error'
                  : pressure === 'warning'
                    ? 'progress-warning'
                    : 'progress-primary'
              }`}
              value={percent}
              max={100}
              aria-label={`${percent}% of browser storage used`}
            />
            <p className="mt-2 text-xs leading-relaxed text-base-content/55">
              {pressureCopy[pressure]} Browser quota is an estimate, not a guaranteed reservation.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh}>
            Refresh estimate
          </button>
          {estimate.supported && estimate.persisted === false && (
            <button
              type="button"
              className="btn btn-outline btn-primary btn-sm"
              disabled={requestingPersistence}
              onClick={() => void onRequestPersistence()}
              title="Ask the browser not to evict Peerly data automatically. This does not increase quota."
            >
              {requestingPersistence ? 'Requesting…' : 'Protect local data'}
            </button>
          )}
          {estimate.persisted && (
            <span className="badge badge-success badge-soft gap-1 self-center">✓ Local data protected</span>
          )}
        </div>
      </div>
    </section>
  )
}

export function StoragePressureBanner({
  pressure,
  availableBytes,
  onManage,
}: {
  pressure: StoragePressure
  availableBytes?: number
  onManage: () => void
}) {
  if (pressure === 'ok') return null
  const serious = pressure === 'warning' || pressure === 'critical'
  return (
    <div
      className={`storage-pressure-banner ${serious ? 'storage-pressure-banner-urgent' : ''}`}
      role={pressure === 'critical' ? 'alert' : 'status'}
      aria-live={pressure === 'critical' ? 'assertive' : 'polite'}
      data-testid="storage-pressure-banner"
    >
      <span aria-hidden="true">{pressure === 'critical' ? '⚠️' : '◔'}</span>
      <span className="min-w-0 flex-1">
        <strong>{pressure === 'critical' ? 'Browser storage almost full' : 'Browser storage is getting low'}</strong>
        {availableBytes !== undefined && ` · approximately ${formatBytes(availableBytes)} available`}
        {serious && ' · background file downloads are paused'}
      </span>
      <button type="button" className="btn btn-sm btn-ghost" onClick={onManage}>
        Manage storage
      </button>
    </div>
  )
}
