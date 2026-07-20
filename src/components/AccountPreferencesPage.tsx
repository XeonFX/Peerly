import { useState } from 'react'
import { ThemeToggle } from './ThemeToggle'
import { useI18n } from '../i18n'
import { loadDmNotificationsEnabled, saveDmNotificationsEnabled } from '../collab/notificationPreference'

type Props = { email: string; onSignOut: () => void }

export function AccountPreferencesPage({ email, onSignOut }: Props) {
  const { locale, setLocale, t, tr } = useI18n()
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

  return (
    <main className="h-full overflow-y-auto" data-testid="account-preferences-page">
      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold">{tr('Profile & preferences')}</h1>
          <p className="mt-1 text-sm text-base-content/60">
            {tr('These preferences apply across Peerly, not to a single workspace.')}
          </p>
        </header>
        <section className="card border border-base-300/80 bg-base-200/70 shadow-xl shadow-black/10">
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
