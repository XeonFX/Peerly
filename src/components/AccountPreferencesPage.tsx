import { useEffect, useRef, useState } from 'react'
import { ThemeToggle } from './ThemeToggle'
import { useI18n } from '../i18n'
import { loadDmNotificationsEnabled, saveDmNotificationsEnabled } from '../collab/notificationPreference'
import { PEER_COLORS } from '../config'
import type { UserProfile } from '../types'
import {
  removeAvatar,
  resolveAvatarPreview,
  uploadAvatar,
} from '../collab/avatarService'
import { Avatar } from './Avatar'
import { useClockFormat } from '@peerly/core/react'

type Props = {
  email: string
  profile: UserProfile
  avatarId?: string
  onProfileChange: (profile: UserProfile & { avatarId?: string }) => void
  onBack?: () => void
  onSignOut: () => void
}

export function AccountPreferencesPage({
  email,
  profile,
  avatarId,
  onProfileChange,
  onBack,
  onSignOut,
}: Props) {
  const { locale, setLocale, t, tr } = useI18n()
  const { clockFormat, dateFormat, setClockFormat, setDateFormat } = useClockFormat()
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [avatarPreview, setAvatarPreview] = useState(profile.avatar)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    () => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  )
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () => loadDmNotificationsEnabled() && typeof Notification !== 'undefined' && Notification.permission === 'granted'
  )

  const toggleNotifications = async () => {
    if (notificationsEnabled) {
      saveDmNotificationsEnabled(false)
      setNotificationsEnabled(false)
      return
    }
    if (typeof Notification === 'undefined') return
    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
    const enabled = permission === 'granted'
    saveDmNotificationsEnabled(enabled)
    setNotificationsEnabled(enabled)
  }

  useEffect(() => {
    if (profile.avatar) {
      setAvatarPreview(profile.avatar)
      return
    }
    let cancelled = false
    void resolveAvatarPreview(avatarId).then(preview => {
      if (!cancelled) setAvatarPreview(preview)
    })
    return () => {
      cancelled = true
    }
  }, [avatarId, profile.avatar])

  const changeProfile = (patch: Partial<UserProfile> & { avatarId?: string }) => {
    onProfileChange({
      ...profile,
      avatar: avatarPreview,
      ...patch,
      ...(Object.prototype.hasOwnProperty.call(patch, 'avatarId') ? { avatarId: patch.avatarId } : { avatarId }),
    })
  }

  const handleAvatar = async (file: File) => {
    setUploading(true)
    setUploadError(null)
    try {
      const uploaded = await uploadAvatar(file, avatarId)
      setAvatarPreview(uploaded.dataUrl)
      changeProfile({ avatar: uploaded.dataUrl, avatarId: uploaded.avatarId })
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : tr('Failed to upload avatar.'))
    } finally {
      setUploading(false)
    }
  }

  const clearAvatar = async () => {
    setUploadError(null)
    try {
      await removeAvatar(avatarId)
      setAvatarPreview(undefined)
      changeProfile({ avatar: undefined, avatarId: undefined })
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : tr('Failed to remove avatar.'))
    }
  }

  return (
    <main className="h-full overflow-y-auto" data-testid="account-preferences-page">
      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
        <header className="mb-6">
          {onBack && (
            <button
              type="button"
              className="btn btn-ghost btn-sm mb-3 -ml-2"
              onClick={onBack}
              data-testid="profile-back"
            >
              ← {tr('Back')}
            </button>
          )}
          <h1 className="text-2xl font-bold">{tr('Profile & preferences')}</h1>
          <p className="mt-1 text-sm text-base-content/60">
            {tr('These preferences apply across Peerly, not to a single workspace.')}
          </p>
        </header>
        <section className="card border border-base-300/80 bg-base-200/70 shadow-xl shadow-black/10">
          <div className="card-body gap-5">
            <div className="flex items-center gap-4">
              <Avatar
                name={profile.name}
                color={profile.color}
                avatar={avatarPreview}
                size="lg"
              />
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold">{profile.name}</h2>
                <p className="truncate text-xs text-base-content/60">{email}</p>
              </div>
            </div>

            <label className="form-control w-full">
              <span className="label-text mb-1.5 block text-sm font-medium">{tr('Display name')}</span>
              <input
                id="account-profile-name"
                name="profileDisplayName"
                type="text"
                className="input input-bordered w-full"
                value={profile.name}
                onChange={event => changeProfile({ name: event.target.value })}
                placeholder={tr('Your name')}
                data-testid="profile-name"
              />
            </label>

            <label className="form-control w-full">
              <span className="label-text mb-1.5 block text-sm font-medium">{tr('Your color')}</span>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  id="account-profile-color"
                  name="profileColor"
                  type="color"
                  className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-base-300 bg-base-100 p-1"
                  value={profile.color}
                  onChange={event => changeProfile({ color: event.target.value })}
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
                      onClick={() => changeProfile({ color })}
                      aria-label={tr('Use color {color}', { color })}
                      aria-pressed={profile.color === color}
                    />
                  ))}
                </div>
              </div>
            </label>

            <div className="flex flex-wrap gap-2">
              <input
                ref={avatarInputRef}
                id="account-profile-avatar"
                name="profileAvatar"
                type="file"
                accept="image/*"
                hidden
                data-testid="avatar-input"
                onChange={event => {
                  const file = event.target.files?.[0]
                  if (file) void handleAvatar(file)
                  event.target.value = ''
                }}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={uploading}
                onClick={() => avatarInputRef.current?.click()}
              >
                {uploading ? `${tr('Processing')}…` : tr('Upload avatar')}
              </button>
              {(avatarPreview || avatarId) && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void clearAvatar()}>
                  {tr('Remove avatar')}
                </button>
              )}
            </div>
            {uploadError && <p className="text-sm text-error">{uploadError}</p>}
          </div>
        </section>
        <section className="card mt-5 border border-base-300/80 bg-base-200/70 shadow-xl shadow-black/10">
          <div className="card-body gap-4">
            <div>
              <h2 className="text-base font-semibold">{tr('Appearance')}</h2>
              <p className="mt-1 text-xs text-base-content/60">
                {tr('Theme and language are stored on this device.')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
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
              <label className="flex items-center gap-2 text-sm">
                <span>{tr('Date format')}</span>
                <select
                  id="date-format"
                  name="dateFormat"
                  className="select select-bordered select-sm"
                  value={dateFormat}
                  onChange={event => setDateFormat(event.target.value as 'day-first' | 'month-first' | 'iso')}
                  data-testid="date-format-select"
                >
                  <option value="day-first">DD/MM/YYYY</option>
                  <option value="month-first">MM/DD/YYYY</option>
                  <option value="iso">YYYY-MM-DD</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <span>{tr('Time format')}</span>
                <select
                  id="clock-format"
                  name="clockFormat"
                  className="select select-bordered select-sm"
                  value={clockFormat}
                  onChange={event => setClockFormat(event.target.value as '24-hour' | '12-hour')}
                  data-testid="clock-format-select"
                >
                  <option value="24-hour">{tr('24-hour')}</option>
                  <option value="12-hour">{tr('12-hour')}</option>
                </select>
              </label>
            </div>
          </div>
        </section>
        <section className="card mt-5 border border-base-300/80 bg-base-200/70 shadow-xl shadow-black/10">
          <div className="card-body gap-3">
            <h2 className="text-base font-semibold">{tr('Notifications')}</h2>
            <p className="text-xs text-base-content/60">
              {tr('Browser notifications announce direct messages and friend requests while Peerly is in the background.')}
            </p>
            {notificationPermission === 'unsupported' ? (
              <p className="text-sm text-base-content/60">{tr('This browser does not support notifications.')}</p>
            ) : notificationPermission === 'denied' ? (
              <p className="text-sm text-warning">{tr('Notifications are blocked in browser settings. Allow them for this site, then reload.')}</p>
            ) : (
              <button type="button" className={`btn btn-sm w-fit ${notificationsEnabled ? 'btn-outline' : 'btn-primary'}`} onClick={() => void toggleNotifications()} data-testid="account-notification-toggle">
                {tr(notificationsEnabled ? 'Turn off notifications' : 'Turn on notifications')}
              </button>
            )}
          </div>
        </section>
        <section className="card mt-5 border border-base-300/80 bg-base-200/70 shadow-xl shadow-black/10">
          <div className="card-body gap-3">
            <h2 className="text-base font-semibold">{tr('Account')}</h2>
            <p className="text-sm text-base-content/65">{email}</p>
            <button type="button" className="btn btn-outline btn-sm w-fit" onClick={onSignOut} data-testid="account-sign-out">{tr('Sign out')}</button>
          </div>
        </section>
      </div>
    </main>
  )
}
