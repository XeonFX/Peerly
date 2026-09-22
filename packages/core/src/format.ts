export type ClockFormat = '24-hour' | '12-hour'
export type DateFormat = 'day-first' | 'month-first' | 'iso'

export const DEFAULT_CLOCK_FORMAT: ClockFormat = '24-hour'
export const DEFAULT_DATE_FORMAT: DateFormat = 'day-first'

export type TimestampFormatOptions = {
  clockFormat?: ClockFormat
  dateFormat?: DateFormat
  includeDate?: boolean
  locale?: Intl.LocalesArgument
  timeZone?: string
}

const CLOCK_FORMAT_STORAGE_SUFFIX = 'clock-format'
const DATE_FORMAT_STORAGE_SUFFIX = 'date-format'

function dateTimeOptions(
  clockFormat: ClockFormat,
  timeZone?: string
): Intl.DateTimeFormatOptions {
  return {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: clockFormat === '24-hour' ? 'h23' : 'h12',
    timeZone,
  }
}

/** Locale-aware message time with an explicit, user-selected clock format. */
export function formatClockTime(
  timestamp: number,
  options: Omit<TimestampFormatOptions, 'includeDate'> = {}
): string {
  const { clockFormat = DEFAULT_CLOCK_FORMAT, locale, timeZone } = options
  return new Intl.DateTimeFormat(
    locale,
    dateTimeOptions(clockFormat, timeZone)
  ).format(timestamp)
}

/**
 * A conversation timestamp. The first group on a calendar day includes its
 * date; later groups display only the clock time.
 */
export function formatMessageTimestamp(
  timestamp: number,
  options: TimestampFormatOptions = {}
): string {
  const {
    clockFormat = DEFAULT_CLOCK_FORMAT,
    dateFormat = DEFAULT_DATE_FORMAT,
    includeDate = false,
    locale,
    timeZone,
  } = options
  const time = formatClockTime(timestamp, { clockFormat, locale, timeZone })
  if (!includeDate) return time

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone,
    })
      .formatToParts(timestamp)
      .map(part => [part.type, part.value])
  )
  const date = dateFormat === 'iso'
    ? `${parts.year}-${parts.month}-${parts.day}`
    : dateFormat === 'month-first'
      ? `${parts.month}/${parts.day}/${parts.year}`
      : `${parts.day}/${parts.month}/${parts.year}`
  return `${date}, ${time}`
}

export function clockFormatPreferenceKey(appId: string): string {
  return `${appId}-${CLOCK_FORMAT_STORAGE_SUFFIX}`
}

export function loadClockFormat(
  appId: string,
  storage: Storage = localStorage
): ClockFormat {
  const stored = storage.getItem(clockFormatPreferenceKey(appId))
  return stored === '12-hour' || stored === '24-hour'
    ? stored
    : DEFAULT_CLOCK_FORMAT
}

export function saveClockFormat(
  appId: string,
  clockFormat: ClockFormat,
  storage: Storage = localStorage
): void {
  storage.setItem(clockFormatPreferenceKey(appId), clockFormat)
}

export function dateFormatPreferenceKey(appId: string): string {
  return `${appId}-${DATE_FORMAT_STORAGE_SUFFIX}`
}

export function loadDateFormat(
  appId: string,
  storage: Storage = localStorage
): DateFormat {
  const stored = storage.getItem(dateFormatPreferenceKey(appId))
  return stored === 'day-first' || stored === 'month-first' || stored === 'iso'
    ? stored
    : DEFAULT_DATE_FORMAT
}

export function saveDateFormat(
  appId: string,
  dateFormat: DateFormat,
  storage: Storage = localStorage
): void {
  storage.setItem(dateFormatPreferenceKey(appId), dateFormat)
}
