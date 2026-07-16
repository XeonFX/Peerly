import { describe, expect, it } from 'vitest'
import {
  loadDmNotificationsEnabled,
  NOTIFICATION_PREFERENCE_KEY,
  saveDmNotificationsEnabled,
} from './notificationPreference'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: key => void values.delete(key),
    clear: () => values.clear(),
    key: index => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    },
  }
}

describe('notificationPreference', () => {
  it('defaults off and persists only an explicit opt-in', () => {
    const storage = memoryStorage()
    expect(loadDmNotificationsEnabled(storage)).toBe(false)

    saveDmNotificationsEnabled(true, storage)
    expect(storage.getItem(NOTIFICATION_PREFERENCE_KEY)).toBe('enabled')
    expect(loadDmNotificationsEnabled(storage)).toBe(true)

    saveDmNotificationsEnabled(false, storage)
    expect(storage.getItem(NOTIFICATION_PREFERENCE_KEY)).toBeNull()
  })
})
