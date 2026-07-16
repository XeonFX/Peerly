import { useEffect, useRef, useState } from 'react'
import { uploadAvatar, removeAvatar } from '../../collab/avatarService'
import { loadFileSyncMode, saveFileSyncMode, type FileSyncMode } from '../../collab/syncPreferences'
import { WORKSPACE_COLOR } from '../../config'
import {
  clearWorkspaceData,
  clearWorkspaceFiles,
  estimateWorkspaceUsage,
  formatUsage,
  type WorkspaceUsage,
} from '../../utils/workspaceUsage'
import { loadWorkspaces } from '../../collab/workspaceStore'
import { backupFileName, buildWorkspaceBackup } from '../../utils/workspaceBackup'
import { Avatar } from '../Avatar'
import { BrowserStorageCard } from '../BrowserStorageCard'
import type { useBrowserStorage } from '../../hooks/useBrowserStorage'
import type { P2pCapability } from '../../types'
import { P2pCapabilityIndicator } from '../P2pCapabilityIndicator'
import { ThemeToggle } from '../ThemeToggle'
import { useI18n } from '../../i18n'

type Props = {
  workspaceId: string
  workspaceName: string
  workspaceAvatar?: string
  workspaceAvatarId?: string
  browserStorage: ReturnType<typeof useBrowserStorage>
  p2pCapability: P2pCapability
  rtcPeerCount: number
  connectionError: string | null
  onRetryP2p: () => void
  onBeforeExport: () => void
  onLocalHistoryCleared: () => void
  notificationsSupported: boolean
  notificationsEnabled: boolean
  notificationPermission: NotificationPermission | 'unsupported'
  onEnableNotifications: () => Promise<void>
  onDisableNotifications: () => void
  soundsEnabled: boolean
  onEnableSounds: () => Promise<boolean>
  onDisableSounds: () => void
  onNameChange: (name: string) => void
  onAvatarChange: (avatarId: string, preview: string) => void
  onAvatarClear: () => void
  onBack: () => void
}

export function WorkspaceSettingsPanel({
  workspaceId,
  workspaceName,
  workspaceAvatar,
  workspaceAvatarId,
  browserStorage,
  p2pCapability,
  rtcPeerCount,
  connectionError,
  onRetryP2p,
  onBeforeExport,
  onLocalHistoryCleared,
  notificationsSupported,
  notificationsEnabled,
  notificationPermission,
  onEnableNotifications,
  onDisableNotifications,
  soundsEnabled,
  onEnableSounds,
  onDisableSounds,
  onNameChange,
  onAvatarChange,
  onAvatarClear,
  onBack,
}: Props) {
  const { locale, setLocale, t, tr } = useI18n()
  const fileRef = useRef<HTMLInputElement>(null)
  const [usage, setUsage] = useState<WorkspaceUsage | null>(null)
  const [syncMode, setSyncMode] = useState<FileSyncMode>(() => loadFileSyncMode())

  const refreshUsage = async () => {
    setUsage(await estimateWorkspaceUsage(workspaceId))
    await browserStorage.refresh(true)
  }

  useEffect(() => {
    let cancelled = false
    void estimateWorkspaceUsage(workspaceId).then(next => {
      if (!cancelled) setUsage(next)
    })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  // Local draft so the field can be cleared while typing without persisting an
  // empty name; only trimmed non-empty values are saved.
  const [nameDraft, setNameDraft] = useState(workspaceName)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleAvatar = async (file: File) => {
    setUploadError(null)
    setUploading(true)
    try {
      const { avatarId, dataUrl } = await uploadAvatar(file, workspaceAvatarId)
      onAvatarChange(avatarId, dataUrl)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : tr('Failed to upload workspace image.'))
    } finally {
      setUploading(false)
    }
  }

  const handleClearAvatar = async () => {
    setUploadError(null)
    try {
      await removeAvatar(workspaceAvatarId)
      onAvatarClear()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : tr('Failed to remove workspace image.'))
    }
  }

  return (
    <div className="flex-1 overflow-y-auto" data-testid="workspace-settings-page">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="mb-6">
          <button
            type="button"
            className="btn btn-ghost btn-sm mb-3 -ml-2"
            onClick={onBack}
            data-testid="workspace-settings-back"
          >
            ← {tr('Back to channels')}
          </button>
          <h2 className="text-2xl font-bold outline-none" tabIndex={-1} data-view-heading>
            {tr('Workspace settings')}
          </h2>
          <p className="mt-1 text-sm text-base-content/65">
            {tr('Customize how this workspace appears on this device. The name travels with invite links you copy from here; the icon stays local.')}
          </p>
        </header>

        <section className="card border border-base-300/80 bg-base-200/70 shadow-xl shadow-black/20 backdrop-blur-xl">
          <div className="card-body gap-5">
            <div className="flex items-center gap-4">
              <Avatar
                name={workspaceName}
                color={WORKSPACE_COLOR}
                avatar={workspaceAvatar}
                size="lg"
              />
              <div className="min-w-0">
                <h3 className="truncate text-lg font-semibold">{workspaceName || tr('Workspace')}</h3>
                <p className="text-xs text-base-content/65">
                  {tr('Workspace images are auto-resized and saved as WebP.')}
                </p>
              </div>
            </div>

            <label className="form-control w-full">
              <span className="label-text mb-1.5 block text-sm font-medium">{tr('Workspace name')}</span>
              <input
                id="workspace-settings-name"
                name="workspaceName"
                type="text"
                className="input input-bordered w-full"
                value={nameDraft}
                onChange={e => {
                  setNameDraft(e.target.value)
                  const trimmed = e.target.value.trim()
                  if (trimmed) onNameChange(trimmed)
                }}
                onBlur={() => {
                  if (!nameDraft.trim()) setNameDraft(workspaceName)
                }}
                data-testid="workspace-name"
                placeholder={tr('My team')}
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <input
                id="workspace-settings-avatar"
                name="workspaceAvatar"
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                data-testid="workspace-avatar-input"
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) void handleAvatar(file)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? `${tr('Processing')}…` : tr('Upload workspace image')}
              </button>
              {workspaceAvatar && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void handleClearAvatar()}
                >
                  {tr('Remove image')}
                </button>
              )}
            </div>
            {uploadError && <p className="text-sm text-error">{uploadError}</p>}
          </div>
        </section>

        <section
          className="card mt-5 border border-base-300/80 bg-base-200/70 shadow-xl shadow-black/20 backdrop-blur-xl"
          data-testid="appearance-settings"
        >
          <div className="card-body gap-3">
            <div>
              <h3 className="text-base font-semibold">{tr('Appearance')}</h3>
              <p className="mt-1 text-xs leading-relaxed text-base-content/65">
                {tr('Theme preference is stored only on this device.')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <ThemeToggle />
              <label className="flex items-center gap-2 text-sm">
                <span>{t('settings.language', 'Language')}</span>
                <select
                  id="app-locale"
                  name="locale"
                  className="select select-bordered select-sm"
                  value={locale}
                  onChange={event => setLocale(event.target.value as 'en' | 'pl')}
                  data-testid="locale-select"
                >
                  <option value="en">English</option>
                  <option value="pl">Polski</option>
                </select>
              </label>
            </div>
          </div>
        </section>

        <section
          className="card mt-5 border border-base-300/80 bg-base-200/70 shadow-xl shadow-black/20 backdrop-blur-xl"
          data-testid="notification-settings"
        >
          <div className="card-body gap-3">
            <div>
              <h3 className="text-base font-semibold">
                {t('settings.attention.title', 'Attention & notifications')}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-base-content/65">
                {t(
                  'settings.attention.description',
                  'Unread counts appear in the tab and favicon automatically. Browser notifications are optional and only announce direct messages while Peerly is in the background.'
                )}
              </p>
            </div>
            {!notificationsSupported ? (
              <p className="text-sm text-base-content/60">{tr('This browser does not support notifications.')}</p>
            ) : notificationPermission === 'denied' ? (
              <p className="text-sm text-warning">
                {tr('Notifications are blocked in browser settings. Allow them for this site, then reload.')}
              </p>
            ) : (
              <button
                type="button"
                className={`btn btn-sm w-fit ${notificationsEnabled ? 'btn-outline' : 'btn-primary'}`}
                data-testid="notification-toggle"
                onClick={() =>
                  notificationsEnabled
                    ? onDisableNotifications()
                    : void onEnableNotifications()
                }
              >
                {notificationsEnabled
                  ? t('settings.attention.disable', 'Turn off DM notifications')
                  : t('settings.attention.enable', 'Turn on DM notifications')}
              </button>
            )}
            <button
              type="button"
              className={`btn btn-sm w-fit ${soundsEnabled ? 'btn-outline' : 'btn-primary'}`}
              onClick={() =>
                soundsEnabled ? onDisableSounds() : void onEnableSounds()
              }
              data-testid="attention-sound-toggle"
              aria-pressed={soundsEnabled}
            >
              {tr(soundsEnabled ? 'Turn off attention sounds' : 'Turn on attention sounds')}
            </button>
            <p className="text-xs leading-relaxed text-base-content/65">
              {tr('Plays a short background DM chime and repeats a gentle ringtone for incoming calls.')}
            </p>
          </div>
        </section>

        <div className="mt-5">
          <P2pCapabilityIndicator
            capability={p2pCapability}
            rtcPeerCount={rtcPeerCount}
            connectionError={connectionError}
            onRetry={onRetryP2p}
          />
        </div>

        <section className="card mt-5 border border-base-300/80 bg-base-200/70 shadow-xl shadow-black/20 backdrop-blur-xl">
          <div className="card-body gap-4">
            <h3 className="text-base font-semibold">{tr('Storage & sync')}</h3>

            <dl className="flex flex-col gap-3 text-sm" data-testid="workspace-storage">
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium text-base-content/65">{tr('On this device')}</dt>
                <dd data-testid="workspace-storage-total">
                  {usage
                    ? `${formatUsage(usage.totalBytes)} — ${formatUsage(usage.messagesBytes)} ${tr('messages')}, ${formatUsage(usage.filesBytes)} / ${usage.fileCount} ${tr(usage.fileCount === 1 ? 'cached file' : 'cached files')}`
                    : `${tr('Measuring')}…`}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium text-base-content/65">{tr('Shared total')}</dt>
                <dd data-testid="workspace-storage-shared">
                  {usage
                    ? `${formatUsage(usage.sharedFilesBytes)} ${tr('across')} ${usage.sharedFileCount} ${tr(usage.sharedFileCount === 1 ? 'file' : 'files')}`
                    : `${tr('Measuring')}…`}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-outline btn-primary btn-sm"
                disabled={!usage?.reclaimableBytes}
                onClick={() => {
                  if (!window.confirm(tr('Remove unpinned full-size files from this device? Messages and previews stay available.'))) return
                  void clearWorkspaceFiles(workspaceId).then(refreshUsage)
                }}
              >
                {tr('Free')} {usage ? formatUsage(usage.reclaimableBytes) : tr('local space')}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm text-error"
                data-testid="clear-local-history"
                onClick={() => {
                  if (!window.confirm(tr('Clear local messages, previews, read state, and cached files for this workspace? Access remains, and history can re-sync from online peers.'))) return
                  void clearWorkspaceData(workspaceId).then(async () => {
                    onLocalHistoryCleared()
                    await refreshUsage()
                  })
                }}
              >
                {tr('Clear local history')}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                data-testid="export-backup"
                onClick={() => {
                  onBeforeExport()
                  const stored = loadWorkspaces().find(w => w.workspaceId === workspaceId)
                  if (!stored) return
                  const blob = new Blob([JSON.stringify(buildWorkspaceBackup(stored), null, 2)], {
                    type: 'application/json',
                  })
                  const url = URL.createObjectURL(blob)
                  const link = document.createElement('a')
                  link.href = url
                  link.download = backupFileName(stored.workspaceName)
                  document.body.appendChild(link)
                  link.click()
                  link.remove()
                  window.setTimeout(() => URL.revokeObjectURL(url), 0)
                }}
              >
                {tr('Export backup')}
              </button>
            </div>
            <p className="text-xs text-base-content/65">
              {tr('Backups carry workspace-channel messages and access, so protect them like an invite link. History caps at 500 messages per channel. DMs and file originals are excluded; originals re-fetch from members who hold them. Restore from the start screen with “Import backup”.')}
            </p>

            <label className="flex cursor-pointer items-start gap-3">
              <input
                id="auto-download-files"
                name="autoDownloadFiles"
                type="checkbox"
                className="toggle toggle-primary toggle-sm mt-0.5"
                checked={syncMode === 'auto'}
                data-testid="sync-mode-toggle"
                onChange={e => {
                  const mode: FileSyncMode = e.target.checked ? 'auto' : 'ondemand'
                  setSyncMode(mode)
                  saveFileSyncMode(mode)
                }}
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{tr('Auto-download full files')}</span>
                <span className="text-xs leading-relaxed text-base-content/65">
                  {tr('Off: joining syncs messages and image thumbnails only; full-size files download when you open them. On: every shared file downloads immediately. Applies to all workspaces on this device.')}
                </span>
              </span>
            </label>
          </div>
        </section>

        <div className="mt-5">
          <BrowserStorageCard
            estimate={browserStorage.estimate}
            pressure={browserStorage.pressure}
            onRefresh={() => void browserStorage.refresh(true)}
            onRequestPersistence={browserStorage.requestPersistence}
            requestingPersistence={browserStorage.requestingPersistence}
          />
        </div>
      </div>
    </div>
  )
}
