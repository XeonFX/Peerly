import { describe, expect, it } from 'vitest'
import {
  clockFormatPreferenceKey,
  DEFAULT_CLOCK_FORMAT,
  formatClockTime,
  formatMessageTimestamp,
  loadClockFormat,
  saveClockFormat,
} from './format'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

describe('message timestamp formatting', () => {
  const timestamp = Date.UTC(2026, 6, 28, 14, 5)

  it('uses a 24-hour clock by default', () => {
    expect(formatClockTime(timestamp, { locale: 'en-GB', timeZone: 'UTC' })).toBe('14:05')
  })

  it('supports a 12-hour clock', () => {
    expect(
      formatClockTime(timestamp, {
        clockFormat: '12-hour',
        locale: 'en-US',
        timeZone: 'UTC',
      })
    ).toBe('02:05 PM')
  })

  it('adds the date only when requested', () => {
    expect(
      formatMessageTimestamp(timestamp, {
        includeDate: true,
        locale: 'en-GB',
        timeZone: 'UTC',
      })
    ).toBe('28 Jul 2026, 14:05')
    expect(
      formatMessageTimestamp(timestamp, {
        locale: 'en-GB',
        timeZone: 'UTC',
      })
    ).toBe('14:05')
  })
})

describe('clock format preference', () => {
  it('defaults to 24-hour and persists a valid selection per app', () => {
    const storage = memoryStorage()
    expect(loadClockFormat('peerly', storage)).toBe(DEFAULT_CLOCK_FORMAT)

    saveClockFormat('peerly', '12-hour', storage)

    expect(storage.getItem(clockFormatPreferenceKey('peerly'))).toBe('12-hour')
    expect(loadClockFormat('peerly', storage)).toBe('12-hour')
    expect(loadClockFormat('heyhubs', storage)).toBe(DEFAULT_CLOCK_FORMAT)
  })

  it('ignores corrupted values', () => {
    const storage = memoryStorage()
    storage.setItem(clockFormatPreferenceKey('peerly'), 'invalid')
    expect(loadClockFormat('peerly', storage)).toBe(DEFAULT_CLOCK_FORMAT)
  })
})
