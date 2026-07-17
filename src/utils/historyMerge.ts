import { isAcceptableRevision, mergeReactionsByActorKey } from '@peerly/core'
import { historyEntryToMessage } from '../protocol/mappers'
import type { HistoryEntry } from '../protocol/types'
import type { Message, ReactionRecord } from '../types'

function mergeReactions(
  current: ReactionRecord[] = [],
  incoming: ReactionRecord[] = []
): ReactionRecord[] {
  return mergeReactionsByActorKey(current, incoming, reaction => {
    return reaction.actorUserId ?? reaction.actorDeviceKeyId ?? reaction.actorId
  })
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
      const sameAuthor =
        (entry.senderUserId && entry.senderUserId === current.senderUserId) ||
        (entry.senderDeviceKeyId && entry.senderDeviceKeyId === current.senderDeviceKeyId)
      if (
        sameAuthor &&
        isAcceptableRevision(current, entry, { strict: true })
      ) {
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
