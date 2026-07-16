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
  onNameChange,
  onAvatarChange,
  onAvatarClear,
  onBack,
}: Props) {
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
      setUploadError(err instanceof Error ? err.message : 'Failed to upload workspace image.')
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
      setUploadError(err instanceof Error ? err.message : 'Failed to remove workspace image.')
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
            ← Back to channels
          </button>
          <h2 className="text-2xl font-bold">Workspace settings</h2>
          <p className="mt-1 text-sm text-base-content/50">
            Customize how this workspace appears on this device. The name travels with invite
            links you copy from here; the icon stays local.
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
                <h3 className="truncate text-lg font-semibold">{workspaceName || 'Workspace'}</h3>
                <p className="text-xs text-base-content/50">
                  Workspace images are auto-resized and saved as WebP.
                </p>
              </div>
            </div>

            <label className="form-control w-full">
              <span className="label-text mb-1.5 block text-sm font-medium">Workspace name</span>
              <input
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
                placeholder="My team"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <input
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
                {uploading ? 'Processing…' : 'Upload workspace image'}
              </button>
              {workspaceAvatar && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void handleClearAvatar()}
                >
                  Remove image
                </button>
              )}
            </div>
            {uploadError && <p className="text-sm text-error">{uploadError}</p>}
          </div>
        </section>

        <section className="card mt-5 border border-base-300/80 bg-base-200/70 shadow-xl shadow-black/20 backdrop-blur-xl">
          <div className="card-body gap-3">
            <div>
              <h3 className="text-base font-semibold">Appearance</h3>
              <p className="mt-1 text-xs leading-relaxed text-base-content/50">
                Theme preference is stored only on this device.
              </p>
            </div>
            <ThemeToggle />
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
            <h3 className="text-base font-semibold">Storage &amp; sync</h3>

            <dl className="flex flex-col gap-3 text-sm" data-testid="workspace-storage">
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium text-base-content/50">On this device</dt>
                <dd data-testid="workspace-storage-total">
                  {usage
                    ? `${formatUsage(usage.totalBytes)} — ${formatUsage(usage.messagesBytes)} messages, ${formatUsage(usage.filesBytes)} in ${usage.fileCount} cached file${usage.fileCount === 1 ? '' : 's'}`
                    : 'Measuring…'}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium text-base-content/50">Shared total</dt>
                <dd data-testid="workspace-storage-shared">
                  {usage
                    ? `${formatUsage(usage.sharedFilesBytes)} across ${usage.sharedFileCount} file${usage.sharedFileCount === 1 ? '' : 's'}`
                    : 'Measuring…'}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-outline btn-primary btn-sm"
                disabled={!usage?.reclaimableBytes}
                onClick={() => {
                  if (!window.confirm('Remove unpinned full-size files from this device? Messages and previews stay available.')) return
                  void clearWorkspaceFiles(workspaceId).then(refreshUsage)
                }}
              >
                Free {usage ? formatUsage(usage.reclaimableBytes) : 'local space'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm text-error"
                data-testid="clear-local-history"
                onClick={() => {
                  if (!window.confirm('Clear local messages, previews, read state, and cached files for this workspace? Access remains, and history can re-sync from online peers.')) return
                  void clearWorkspaceData(workspaceId).then(async () => {
                    onLocalHistoryCleared()
                    await refreshUsage()
                  })
                }}
              >
                Clear local history
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
                Export backup
              </button>
            </div>
            <p className="text-xs text-base-content/50">
              Backups carry workspace-channel messages and access, so protect them like an invite
              link. History caps at 500 messages per channel. DMs and file originals are excluded;
              originals re-fetch from members who hold them. Restore from the start screen with
              “Import backup”.
            </p>

            <label className="flex cursor-pointer items-start gap-3">
              <input
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
                <span className="text-sm font-medium">Auto-download full files</span>
                <span className="text-xs leading-relaxed text-base-content/50">
                  Off: joining syncs messages and image thumbnails only; full-size files download
                  when you open them. On: every shared file downloads immediately. Applies to all
                  workspaces on this device.
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
