import { useRef, useState } from 'react'
import { uploadAvatar, removeAvatar } from '../../collab/avatarService'
import { WORKSPACE_COLOR } from '../../config'
import { Avatar } from '../Avatar'

type Props = {
  workspaceName: string
  workspaceAvatar?: string
  workspaceAvatarId?: string
  onNameChange: (name: string) => void
  onAvatarChange: (avatarId: string, preview: string) => void
  onAvatarClear: () => void
  onBack: () => void
}

export function WorkspaceSettingsPanel({
  workspaceName,
  workspaceAvatar,
  workspaceAvatarId,
  onNameChange,
  onAvatarChange,
  onAvatarClear,
  onBack,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
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
      </div>
    </div>
  )
}
