export type ClockFormat = '24-hour' | '12-hour'

export const DEFAULT_CLOCK_FORMAT: ClockFormat = '24-hour'

export type TimestampFormatOptions = {
  clockFormat?: ClockFormat
  includeDate?: boolean
  locale?: Intl.LocalesArgument
  timeZone?: string
}

const CLOCK_FORMAT_STORAGE_SUFFIX = 'clock-format'

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
    includeDate = false,
    locale,
    timeZone,
  } = options
  const formatterOptions: Intl.DateTimeFormatOptions = {
    ...dateTimeOptions(clockFormat, timeZone),
    ...(includeDate
      ? { year: 'numeric', month: 'short', day: 'numeric' }
      : {}),
  }
  return new Intl.DateTimeFormat(locale, formatterOptions).format(timestamp)
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
