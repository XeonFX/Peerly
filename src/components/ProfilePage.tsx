import { useRef, useState } from 'react'
import { PEER_COLORS } from '../config'
import type { ConnectionStatus, UserProfile } from '../types'
import { Avatar } from './Avatar'
import { ConnectionStatus as ConnectionStatusLabel } from './ConnectionStatus'

type Props = {
  profile: UserProfile
  workspace: string
  selfId: string
  relayOnline: boolean
  connectionStatus: ConnectionStatus
  rtcPeerCount: number
  inviteLink: string
  onNameChange: (name: string) => void
  onColorChange: (color: string) => void
  onAvatarChange: (file: File) => Promise<void>
  onAvatarClear: () => void
  onBack: () => void
}

export function ProfilePage({
  profile,
  workspace,
  selfId,
  relayOnline,
  connectionStatus,
  rtcPeerCount,
  inviteLink,
  onNameChange,
  onColorChange,
  onAvatarChange,
  onAvatarClear,
  onBack,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleAvatar = async (file: File) => {
    setUploadError(null)
    setUploading(true)
    try {
      await onAvatarChange(file)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload avatar.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto" data-testid="profile-page">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="mb-6">
          <button
            type="button"
            className="btn btn-ghost btn-sm mb-3 -ml-2"
            onClick={onBack}
            data-testid="profile-back"
          >
            ← Back to channels
          </button>
          <h2 className="text-2xl font-bold outline-none" tabIndex={-1} data-view-heading>
            Your profile
          </h2>
          <p className="mt-1 text-sm text-base-content/65">
            Customize how teammates see you in this workspace.
          </p>
        </header>

        <div className="flex flex-col gap-5">
          <section className="card border border-base-300/80 bg-base-200/70 shadow-xl shadow-black/20 backdrop-blur-xl">
            <div className="card-body gap-5">
              <div className="flex items-center gap-4">
                <Avatar
                  name={profile.name}
                  color={profile.color}
                  avatar={profile.avatar}
                  size="lg"
                />
                <div className="min-w-0">
                  <h3 className="truncate text-lg font-semibold">{profile.name}</h3>
                  <p className="text-xs text-base-content/65">
                    Avatar images are auto-resized and saved as WebP.
                  </p>
                </div>
              </div>

              <label className="form-control w-full">
                <span className="label-text mb-1.5 block text-sm font-medium">Display name</span>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={profile.name}
                  onChange={e => onNameChange(e.target.value)}
                  data-testid="profile-name"
                  placeholder="Your name"
                />
              </label>

              <label className="form-control w-full">
                <span className="label-text mb-1.5 block text-sm font-medium">Your color</span>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="color"
                    className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-base-300 bg-base-100 p-1"
                    value={profile.color}
                    onChange={e => onColorChange(e.target.value)}
                    data-testid="profile-color"
                  />
                  <div className="flex flex-wrap gap-2">
                    {PEER_COLORS.map(color => (
                      <button
                        key={color}
                        type="button"
                        className={`h-7 w-7 rounded-full transition-transform hover:scale-110 ${
                          profile.color === color
                            ? 'ring-2 ring-primary ring-offset-2 ring-offset-base-200'
                            : ''
                        }`}
                        style={{ background: color }}
                        onClick={() => onColorChange(color)}
                        data-testid={`color-preset-${color}`}
                        title={color}
                        aria-label={`Use color ${color}`}
                        aria-pressed={profile.color === color}
                      />
                    ))}
                  </div>
                </div>
              </label>

              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  data-testid="avatar-input"
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
                  {uploading ? 'Processing…' : 'Upload avatar'}
                </button>
                {profile.avatar && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={onAvatarClear}>
                    Remove avatar
                  </button>
                )}
              </div>
              {uploadError && <p className="text-sm text-error">{uploadError}</p>}
            </div>
          </section>

          <section className="card border border-base-300/80 bg-base-200/70 shadow-xl shadow-black/20 backdrop-blur-xl">
            <div className="card-body gap-4">
              <h3 className="text-base font-semibold">Workspace info</h3>
              <dl className="flex flex-col gap-3 text-sm">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium text-base-content/65">Workspace</dt>
                  <dd data-testid="profile-workspace">{workspace}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium text-base-content/65">Your peer ID</dt>
                  <dd className="font-mono text-xs break-all">{selfId}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium text-base-content/65">Protection</dt>
                  <dd>Invite-only (verified accounts)</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium text-base-content/65">Invite link</dt>
                  <dd>
                    <input
                      readOnly
                      className="input input-bordered input-sm w-full font-mono text-xs"
                      value={inviteLink}
                      data-testid="invite-link"
                      onFocus={e => e.target.select()}
                    />
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium text-base-content/65">Connection</dt>
                  <dd data-testid="profile-connection">
                    <ConnectionStatusLabel
                      relayOnline={relayOnline}
                      connectionStatus={connectionStatus}
                      rtcPeerCount={rtcPeerCount}
                      variant="text"
                    />
                  </dd>
                </div>
              </dl>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
