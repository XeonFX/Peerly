import type { BrowserStorageEstimate, StoragePressure } from '../utils/browserStorage'
import { formatBytes } from '../utils/format'
import { Icon } from './Icon'
import { useI18n } from '../i18n'

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
  const { tr } = useI18n()
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
            <p className="eyebrow">{tr('Browser storage')}</p>
            <h3 className="mt-1 text-xl font-semibold tracking-tight">
              {estimate.availableBytes === undefined
                ? tr('Availability unknown')
                : `${formatBytes(estimate.availableBytes)} ${tr('available')}`}
            </h3>
            <p className="mt-1 text-sm text-base-content/55">
              {hasNumbers
                ? `${formatBytes(estimate.usageBytes!)} ${tr('used')} / ~${formatBytes(estimate.quotaBytes!)}`
                : estimate.supported
                  ? tr('The browser did not provide a quota estimate.')
                  : tr('Storage estimates are unavailable in this browser.')}
            </p>
          </div>
          {percent !== undefined && (
            <span className={`storage-pressure-pill storage-pressure-${pressure}`}>
              {percent}% {tr('used')}
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
              aria-label={`${percent}% ${tr('used')} — ${tr('Browser storage')}`}
            />
            <p className="mt-2 text-xs leading-relaxed text-base-content/55">
              {tr(pressureCopy[pressure])} {tr('Browser quota is an estimate, not a guaranteed reservation.')}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh}>
            {tr('Refresh estimate')}
          </button>
          {estimate.supported && estimate.persisted === false && (
            <button
              type="button"
              className="btn btn-outline btn-primary btn-sm"
              disabled={requestingPersistence}
              onClick={() => void onRequestPersistence()}
              title={tr('Ask the browser not to evict Peerly data automatically. This does not increase quota.')}
            >
              {requestingPersistence ? `${tr('Requesting')}…` : tr('Protect local data')}
            </button>
          )}
          {estimate.persisted && (
            <span className="badge badge-success badge-soft gap-1 self-center">
              <Icon name="check" size={14} /> {tr('Local data protected')}
            </span>
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
  const { tr } = useI18n()
  if (pressure === 'ok') return null
  const serious = pressure === 'warning' || pressure === 'critical'
  return (
    <div
      className={`storage-pressure-banner ${serious ? 'storage-pressure-banner-urgent' : ''}`}
      role={pressure === 'critical' ? 'alert' : 'status'}
      aria-live={pressure === 'critical' ? 'assertive' : 'polite'}
      data-testid="storage-pressure-banner"
    >
      <Icon name={pressure === 'critical' ? 'alert-triangle' : 'gauge'} size={17} />
      <span className="min-w-0 flex-1">
        <strong>{tr(pressure === 'critical' ? 'Browser storage almost full' : 'Browser storage is getting low')}</strong>
        {availableBytes !== undefined && ` · ~${formatBytes(availableBytes)} ${tr('available')}`}
        {serious && ` · ${tr('background file downloads are paused')}`}
      </span>
      <button type="button" className="btn btn-sm btn-ghost" onClick={onManage}>
        {tr('Manage storage')}
      </button>
    </div>
  )
}
