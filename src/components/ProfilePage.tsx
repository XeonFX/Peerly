import { useRef, useState } from 'react'
import { PEER_COLORS } from '../config'
import type { ConnectionStatus, UserProfile } from '../types'
import { Avatar } from './Avatar'
import { ConnectionStatus as ConnectionStatusLabel } from './ConnectionStatus'

type Props = {
  profile: UserProfile
  workspace: string
  roomId: string
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
  roomId,
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
    <div className="profile-page" data-testid="profile-page">
      <header className="profile-page-header">
        <button type="button" className="btn-back" onClick={onBack} data-testid="profile-back">
          ← Back to channels
        </button>
        <h2>Your profile</h2>
        <p>Customize how teammates see you in this workspace.</p>
      </header>

      <div className="profile-page-body">
        <section className="profile-card profile-identity">
          <div className="profile-hero">
            <Avatar name={profile.name} color={profile.color} avatar={profile.avatar} size="lg" />
            <div>
              <h3>{profile.name}</h3>
              <p>Avatar images are auto-resized and saved as WebP.</p>
            </div>
          </div>

          <label className="profile-field">
            <span>Display name</span>
            <input
              type="text"
              value={profile.name}
              onChange={e => onNameChange(e.target.value)}
              data-testid="profile-name"
              placeholder="Your name"
            />
          </label>

          <label className="profile-field">
            <span>Your color</span>
            <div className="color-picker-row">
              <input
                type="color"
                value={profile.color}
                onChange={e => onColorChange(e.target.value)}
                data-testid="profile-color"
              />
              <div className="color-presets">
                {PEER_COLORS.map(color => (
                  <button
                    key={color}
                    type="button"
                    className={`color-swatch ${profile.color === color ? 'active' : ''}`}
                    style={{ background: color }}
                    onClick={() => onColorChange(color)}
                    data-testid={`color-preset-${color}`}
                    title={color}
                  />
                ))}
              </div>
            </div>
          </label>

          <div className="profile-avatar-actions">
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
              className="btn-profile"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? 'Processing…' : 'Upload avatar'}
            </button>
            {profile.avatar && (
              <button type="button" className="btn-profile subtle" onClick={onAvatarClear}>
                Remove avatar
              </button>
            )}
          </div>
          {uploadError && <p className="profile-error">{uploadError}</p>}
        </section>

        <section className="profile-card profile-meta">
          <h3>Workspace info</h3>
          <dl className="profile-details">
            <div>
              <dt>Workspace</dt>
              <dd data-testid="profile-workspace">{workspace}</dd>
            </div>
            <div>
              <dt>Room</dt>
              <dd>{roomId}</dd>
            </div>
            <div>
              <dt>Your peer ID</dt>
              <dd className="mono">{selfId}</dd>
            </div>
            <div>
              <dt>Protection</dt>
              <dd>Invite-only (verified accounts)</dd>
            </div>
            <div>
              <dt>Invite link</dt>
              <dd>
                <input
                  readOnly
                  value={inviteLink}
                  data-testid="invite-link"
                  onFocus={e => e.target.select()}
                />
              </dd>
            </div>
            <div>
              <dt>Connection</dt>
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
        </section>
      </div>
    </div>
  )
}