import { historyEntryToMessage } from '../protocol/mappers'
import type { HistoryEntry } from '../protocol/types'
import type { Message } from '../types'

export function mergeHistoryEntries(
  existing: Message[],
  incoming: HistoryEntry[],
  fileUrls?: Map<string, string>
): Message[] {
  const byId = new Map(existing.map(message => [message.id, message]))

  for (const entry of incoming) {
    const current = byId.get(entry.id)
    if (current) {
      if (
        entry.type === 'file' &&
        entry.fileMeta &&
        current.type === 'file' &&
        (!current.file?.url || current.file.url === '')
      ) {
        const url = fileUrls?.get(entry.fileMeta.id)
        if (url) {
          byId.set(entry.id, historyEntryToMessage(entry, url))
        }
      }
      continue
    }

    const url = entry.type === 'file' && entry.fileMeta ? fileUrls?.get(entry.fileMeta.id) : undefined
    byId.set(entry.id, historyEntryToMessage(entry, url))
  }

  return Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp)
}