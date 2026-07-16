import { historyEntryToMessage } from '../protocol/mappers'
import type { HistoryEntry } from '../protocol/types'
import type { Message, ReactionRecord } from '../types'

function mergeReactions(
  current: ReactionRecord[] = [],
  incoming: ReactionRecord[] = []
): ReactionRecord[] {
  const latest = new Map<string, ReactionRecord>()
  for (const reaction of [...current, ...incoming]) {
    const actor = reaction.actorUserId ?? reaction.actorDeviceKeyId ?? reaction.actorId
    const key = `${actor}\n${reaction.emoji}`
    if ((latest.get(key)?.timestamp ?? -1) < reaction.timestamp) latest.set(key, reaction)
  }
  return [...latest.values()]
}

export function mergeHistoryEntries(
  existing: Message[],
  incoming: HistoryEntry[],
  fileUrls?: Map<string, string>
): Message[] {
  const byId = new Map(existing.map(message => [message.id, message]))

  for (const entry of incoming) {
    const current = byId.get(entry.id)
    if (current) {
      const mergedReactions = mergeReactions(current.reactions, entry.reactions)
      const incomingRevision = Math.max(entry.editedAt ?? 0, entry.deletedAt ?? 0)
      const currentRevision = Math.max(current.editedAt ?? 0, current.deletedAt ?? 0)
      const sameAuthor =
        (entry.senderUserId && entry.senderUserId === current.senderUserId) ||
        (entry.senderDeviceKeyId && entry.senderDeviceKeyId === current.senderDeviceKeyId)
      if (incomingRevision > currentRevision && sameAuthor) {
        byId.set(entry.id, { ...historyEntryToMessage(entry), reactions: mergedReactions })
        continue
      }
      if (
        entry.type === 'file' &&
        entry.fileMeta &&
        current.type === 'file' &&
        (!current.file?.url || current.file.url === '')
      ) {
        const url = fileUrls?.get(entry.fileMeta.id)
        if (url) {
          byId.set(entry.id, historyEntryToMessage(entry, url))
          continue
        }
      }
      if ((entry.reactions?.length ?? 0) > 0) {
        byId.set(entry.id, { ...current, reactions: mergedReactions })
      }
      continue
    }

    const url = entry.type === 'file' && entry.fileMeta ? fileUrls?.get(entry.fileMeta.id) : undefined
    byId.set(entry.id, historyEntryToMessage(entry, url))
  }

  return Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp)
}
