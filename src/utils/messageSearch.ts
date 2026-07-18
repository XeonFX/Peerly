import type { Channel, Message } from '../types'

export type MessageSearchHit = { channel: Channel; message: Message }

/** Minimum query length before searching, and the result cap. */
export const MIN_SEARCH_QUERY = 2
export const MAX_SEARCH_RESULTS = 50

/**
 * Case-insensitive substring search over every channel's in-memory history
 * (there is no server index). Skips deleted and non-text messages, returns
 * newest-first, and caps the result count. Pure so it is unit-testable.
 */
export function searchMessages(
  channels: Channel[],
  messagesByChannel: Record<string, Message[]>,
  query: string,
  max: number = MAX_SEARCH_RESULTS
): MessageSearchHit[] {
  const q = query.trim().toLowerCase()
  if (q.length < MIN_SEARCH_QUERY) return []
  const hits: MessageSearchHit[] = []
  for (const channel of channels) {
    for (const message of messagesByChannel[channel.id] ?? []) {
      if (message.deletedAt || !message.text) continue
      if (message.text.toLowerCase().includes(q)) hits.push({ channel, message })
    }
  }
  hits.sort((a, b) => b.message.timestamp - a.message.timestamp)
  return hits.slice(0, max)
}
