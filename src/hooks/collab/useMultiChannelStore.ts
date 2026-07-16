import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { MAX_HISTORY_ENTRIES } from '../../collab/constants'
import { toHistoryEntry } from '../../protocol/mappers'
import type { HistoryEntry } from '../../protocol/types'
import type { Message, Peer } from '../../types'
import { enrichMessage, type SenderInfo } from '../../utils/senderDirectory'
import {
  entriesToMessages,
  restoreChannelFromStorage,
} from '../../collab/channelHydration'
import { FileCache } from '../../collab/fileCache'
import { BlobUrlRegistry } from '../../utils/blobUrls'
import { saveLocalHistory } from '../../utils/historyStorage'

/**
 * Bound what a channel retains. Peers supply history, so without a cap one peer
 * can grow another's memory and localStorage without limit. Newest wins.
 */
function capHistory(messages: Message[]): Message[] {
  return messages.length > MAX_HISTORY_ENTRIES
    ? messages.slice(messages.length - MAX_HISTORY_ENTRIES)
    : messages
}

export function useMultiChannelStore(
  workspaceId: string,
  activeChannelId: string,
  fileCache: FileCache,
  channelIds: string[]
) {
  const channelIdsRef = useRef(channelIds)
  channelIdsRef.current = channelIds
  const [messagesByChannel, setMessagesByChannel] = useState<Record<string, Message[]>>({})
  const messagesByChannelRef = useRef(messagesByChannel)
  messagesByChannelRef.current = messagesByChannel

  const blobUrlsRef = useRef(new BlobUrlRegistry())
  const loadedChannelsRef = useRef<Set<string>>(new Set())
  /** Incremented on reset; in-flight restores from an older epoch are dropped. */
  const epochRef = useRef(0)
  /** Forces the load effects to re-run after a reset marks channels unloaded. */
  const [reloadTick, setReloadTick] = useState(0)

  const messages = useMemo(
    () => messagesByChannel[activeChannelId] ?? [],
    [messagesByChannel, activeChannelId]
  )

  const persistChannelMessages = useCallback(
    (channelId: string, channelMessages: Message[]) => {
      if (channelMessages.length > 0) {
        saveLocalHistory(workspaceId, channelId, channelMessages)
      }
    },
    [workspaceId]
  )

  const updateChannelMessages = useCallback(
    (channelId: string, updater: (current: Message[]) => Message[]) => {
      setMessagesByChannel(prev => {
        const current = prev[channelId] ?? []
        const next = updater(current)
        if (next === current) return prev
        return { ...prev, [channelId]: next }
      })
    },
    []
  )

  const appendMessage = useCallback(
    (message: Message, directory?: Record<string, SenderInfo>, peers: Peer[] = []) => {
      const nextMessage = directory ? enrichMessage(message, directory, peers) : message
      updateChannelMessages(nextMessage.channelId, current => {
        if (current.some(existing => existing.id === nextMessage.id)) return current
        const next = capHistory([...current, nextMessage])
        if (nextMessage.type === 'file') {
          persistChannelMessages(nextMessage.channelId, next)
        }
        return next
      })
    },
    [persistChannelMessages, updateChannelMessages]
  )

  const upsertFileMessage = useCallback(
    (message: Message, directory?: Record<string, SenderInfo>, peers: Peer[] = []) => {
      const nextMessage = directory ? enrichMessage(message, directory, peers) : message
      updateChannelMessages(nextMessage.channelId, current => {
        if (current.some(existing => existing.id === nextMessage.id)) {
          const next = current.map(existing =>
            existing.id === nextMessage.id &&
            existing.type === 'file' &&
            (!existing.file?.url || existing.file.url === '')
              ? nextMessage
              : existing
          )
          if (nextMessage.type === 'file') {
            persistChannelMessages(nextMessage.channelId, next)
          }
          return next
        }
        const next = [...current, nextMessage]
        if (nextMessage.type === 'file') {
          persistChannelMessages(nextMessage.channelId, next)
        }
        return next
      })
    },
    [persistChannelMessages, updateChannelMessages]
  )

  const getHistoryEntries = useCallback((channelId: string): HistoryEntry[] => {
    const channelMessages = (messagesByChannelRef.current[channelId] ?? []).filter(
      message => message.channelId === channelId
    )
    return capHistory(channelMessages).map(toHistoryEntry)
  }, [])

  /** Returns ids of files referenced by history whose bodies we don't have yet. */
  const applyHistory = useCallback(
    async (entries: HistoryEntry[]): Promise<string[]> => {
      if (entries.length === 0) return []

      const entriesByChannel = new Map<string, HistoryEntry[]>()
      for (const entry of entries) {
        const bucket = entriesByChannel.get(entry.channelId) ?? []
        bucket.push(entry)
        entriesByChannel.set(entry.channelId, bucket)
      }

      const missingFileIds: string[] = []

      for (const [channelId, channelEntries] of entriesByChannel) {
        const current = messagesByChannelRef.current[channelId] ?? []
        const merged = capHistory(
          await entriesToMessages(channelEntries, fileCache, blobUrlsRef.current, current)
        )
        setMessagesByChannel(prev => ({ ...prev, [channelId]: merged }))

        for (const message of merged) {
          if (message.type === 'file' && message.file && !message.file.url) {
            missingFileIds.push(message.file.id)
          }
        }
      }

      return missingFileIds
    },
    [fileCache]
  )

  const mergeChannelMessages = useCallback((existing: Message[], restored: Message[]): Message[] => {
    if (restored.length === 0) return existing
    const byId = new Map(existing.map(message => [message.id, message]))
    for (const message of restored) {
      if (!byId.has(message.id)) {
        byId.set(message.id, message)
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp)
  }, [])

  const loadChannel = useCallback(
    async (channelId: string) => {
      if (loadedChannelsRef.current.has(channelId)) return
      loadedChannelsRef.current.add(channelId)

      // Restoring is async and creates blob URLs as it goes, while a reset can
      // revoke them at any moment. Without this guard the two interleave: a
      // restore that started before a reset lands after it and writes messages
      // whose blob URLs the reset already revoked. The file name and `blob:`
      // src still look correct, so it reads as "the file is there" while every
      // preview is broken and every download 404s.
      const startedAt = epochRef.current

      const restored = await restoreChannelFromStorage(
        workspaceId,
        channelId,
        fileCache,
        blobUrlsRef.current
      )

      // A reset happened while we were reading; this data and its URLs are dead.
      if (startedAt !== epochRef.current) return

      setMessagesByChannel(prev => {
        const existing = prev[channelId] ?? []
        const merged = mergeChannelMessages(existing, restored)
        if (merged === existing) return prev
        return { ...prev, [channelId]: merged }
      })
    },
    [fileCache, mergeChannelMessages, workspaceId]
  )

  const syncSenderProfiles = useCallback(
    (directory: Record<string, SenderInfo>, peers: Peer[] = []) => {
    setMessagesByChannel(prev => {
      let changed = false
      const nextChannels: Record<string, Message[]> = {}

      for (const [channelId, channelMessages] of Object.entries(prev)) {
        const updated = channelMessages.map(message => {
          const enriched = enrichMessage(message, directory, peers)
          if (
            enriched.senderName === message.senderName &&
            enriched.senderColor === message.senderColor &&
            enriched.senderAvatar === message.senderAvatar
          ) {
            return message
          }
          changed = true
          return enriched
        })
        nextChannels[channelId] = updated
      }

      return changed ? nextChannels : prev
    })
  },
    []
  )

  /**
   * Record a screening verdict on a file message, wherever it lives, and
   * persist it — `undefined` means "never checked", so writing `false` is what
   * stops every later mount from re-running the classifier.
   */
  const setFileNsfw = useCallback(
    (fileId: string, nsfw: boolean) => {
      for (const [channelId, channelMessages] of Object.entries(messagesByChannelRef.current)) {
        const target = channelMessages.find(
          message => message.type === 'file' && message.file?.id === fileId
        )
        if (!target || target.file?.nsfw === nsfw) continue
        updateChannelMessages(channelId, current => {
          const next = current.map(message =>
            message.type === 'file' && message.file?.id === fileId
              ? { ...message, file: { ...message.file!, nsfw } }
              : message
          )
          persistChannelMessages(channelId, next)
          return next
        })
      }
    },
    [persistChannelMessages, updateChannelMessages]
  )

  const resetWorkspace = useCallback(() => {
    // Bump synchronously so any in-flight restore is invalidated before it can
    // write. Revoking and clearing the messages that referenced those URLs must
    // happen together, or state is left pointing at revoked URLs.
    epochRef.current += 1
    blobUrlsRef.current.revokeAll()
    loadedChannelsRef.current = new Set()
    setMessagesByChannel({})
    // Channels were just marked unloaded; re-run the load effects to rebuild them.
    setReloadTick(tick => tick + 1)
  }, [])

  useEffect(() => {
    void loadChannel(activeChannelId)
  }, [activeChannelId, loadChannel, reloadTick])

  useEffect(() => {
    for (const channelId of channelIdsRef.current) {
      if (channelId !== activeChannelId) {
        void loadChannel(channelId)
      }
    }
  }, [activeChannelId, channelIds, loadChannel, reloadTick])

  useEffect(() => {
    const flushHistory = () => {
      for (const [channelId, channelMessages] of Object.entries(messagesByChannelRef.current)) {
        persistChannelMessages(channelId, channelMessages)
      }
    }

    const id = window.setTimeout(flushHistory, 400)
    window.addEventListener('beforeunload', flushHistory)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('beforeunload', flushHistory)
    }
  }, [messagesByChannel, persistChannelMessages])

  // Deliberately no revokeAll() on unmount.
  //
  // The registry, the message state, and `loadedChannelsRef` all outlive a
  // remount, but the blob URLs would not: revoking here killed every URL, and
  // the remount then skipped rebuilding them because the channel was already
  // marked loaded — leaving messages pointing at dead blob: URLs. Previews broke
  // and downloads 404'd, while the file name and `blob:` src still looked right.
  // StrictMode does exactly this on every dev mount; so does any real remount.
  //
  // These URLs are released when the document unloads. Within a session they are
  // bounded: `create()` revokes the previous URL for an id, and switching
  // workspace goes through resetWorkspace(), which revokes and clears the
  // messages that referenced them together.

  return {
    messages,
    messagesByChannel,
    appendMessage,
    syncSenderProfiles,
    upsertFileMessage,
    getHistoryEntries,
    applyHistory,
    resetWorkspace,
    setFileNsfw,
    blobUrls: blobUrlsRef,
  }
}