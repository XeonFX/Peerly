export const NOTIFICATION_PREFERENCE_KEY = 'peerly-dm-notifications'

export function loadDmNotificationsEnabled(storage: Storage = localStorage): boolean {
  return storage.getItem(NOTIFICATION_PREFERENCE_KEY) === 'enabled'
}

export function saveDmNotificationsEnabled(
  enabled: boolean,
  storage: Storage = localStorage
): void {
  if (enabled) storage.setItem(NOTIFICATION_PREFERENCE_KEY, 'enabled')
  else storage.removeItem(NOTIFICATION_PREFERENCE_KEY)
}
