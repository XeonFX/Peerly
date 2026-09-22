export const DEFAULT_MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000

export type ConsecutiveMessageGroup<T> = {
  authorId: string
  /** True when this is the first group in the viewer's local calendar day. */
  startsDay: boolean
  messages: T[]
}

export type GroupConsecutiveMessagesOptions<T> = {
  authorId: (message: T) => string
  timestamp: (message: T) => number
  maxGapMs?: number
}

function localCalendarDay(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/**
 * Groups adjacent messages from one author into one visual block.
 *
 * A local calendar-day boundary always starts a new block. A short inactivity
 * window prevents messages sent hours apart by the same person from looking
 * like one uninterrupted thought.
 */
export function groupConsecutiveMessages<T>(
  messages: readonly T[],
  options: GroupConsecutiveMessagesOptions<T>
): ConsecutiveMessageGroup<T>[] {
  const { authorId, timestamp, maxGapMs = DEFAULT_MESSAGE_GROUP_WINDOW_MS } = options
  const groups: ConsecutiveMessageGroup<T>[] = []

  for (const message of messages) {
    const messageAuthorId = authorId(message)
    const messageTimestamp = timestamp(message)
    const messageDay = localCalendarDay(messageTimestamp)
    const previousGroup = groups.at(-1)
    const previousMessage = previousGroup?.messages.at(-1)
    const previousTimestamp =
      previousMessage === undefined ? undefined : timestamp(previousMessage)
    const startsDay =
      previousTimestamp === undefined ||
      localCalendarDay(previousTimestamp) !== messageDay
    const gap =
      previousTimestamp === undefined ? Number.POSITIVE_INFINITY : messageTimestamp - previousTimestamp
    const continuesPreviousGroup =
      previousGroup !== undefined &&
      !startsDay &&
      previousGroup.authorId === messageAuthorId &&
      gap >= 0 &&
      gap <= maxGapMs

    if (continuesPreviousGroup) {
      previousGroup.messages.push(message)
      continue
    }

    groups.push({
      authorId: messageAuthorId,
      startsDay,
      messages: [message],
    })
  }

  return groups
}
