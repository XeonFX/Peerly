import type { WorkspaceSyncProgress } from '../types'
import { Icon } from './Icon'
import { useI18n } from '../i18n'

export function SyncStatusBar({ progress }: { progress: WorkspaceSyncProgress }) {
  const { tr } = useI18n()
  if (progress.phase === 'idle' || progress.phase === 'ready') return null
  const determinate = progress.totalChannels > 0
  const value = determinate ? progress.completedChannels : undefined
  const toneClass = progress.phase === 'paused'
    ? 'progress-warning'
    : progress.phase === 'error'
      ? 'progress-error'
      : 'progress-primary'

  return (
    <div className="sync-status" role="status" aria-live="polite" data-testid="sync-status">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="sync-status-icon" aria-hidden="true">
          <Icon name={progress.phase === 'paused' ? 'pause' : 'refresh'} size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-xs">
            {tr(progress.phase === 'paused' ? 'Full-size file sync paused' : 'Syncing workspace')}
          </strong>
          <span className="block truncate text-[0.7rem] text-base-content/55">
            {progress.message}
          </span>
        </span>
      </div>
      <progress
        className={`progress ${toneClass} h-1.5 w-28 max-sm:w-20`}
        value={value}
        max={determinate ? progress.totalChannels : undefined}
        aria-label={progress.message ?? tr('Workspace sync progress')}
      />
    </div>
  )
}
