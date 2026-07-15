import { useCallback, useRef } from 'react'

import { HISTORY_REQUEST_TIMEOUT_MS } from '../../collab/constants'
import type { HistoryEntry, HistoryRequest } from '../../protocol/types'

type HistoryAction = {
  requestMany: (
    data: HistoryRequest,
    options: { targets: string[]; timeoutMs?: number }
  ) => Promise<
    Array<
      | { peerId: string; status: 'fulfilled'; value: HistoryEntry[] }
      | { peerId: string; status: 'timeout' | 'rejected' | 'disconnected'; error?: Error }
    >
  >
}

function syncKey(channelId: string, peerId: string): string {
  return `${channelId}:${peerId}`
}

export function useHistorySync(
  getHistoryEntries: (channelId: string) => HistoryEntry[],
  /** Resolves to ids of file bodies referenced by history but not held locally. */
  applyHistory: (entries: HistoryEntry[]) => Promise<string[]>,
  channelIds: string[],
  requestFilesFromPeers: (peerIds: string[], fileIds: string[]) => Promise<void>
) {
  const requestFilesRef = useRef(requestFilesFromPeers)
  requestFilesRef.current = requestFilesFromPeers
  const channelIdsRef = useRef(channelIds)
  channelIdsRef.current = channelIds
  const historyActionRef = useRef<HistoryAction | null>(null)
  const syncingChannelsRef = useRef<Set<string>>(new Set())
  const historySyncedRef = useRef<Set<string>>(new Set())

  const reset = useCallback(() => {
    historySyncedRef.current = new Set()
    syncingChannelsRef.current = new Set()
  }, [])

  const bindHistoryAction = useCallback((action: HistoryAction) => {
    historyActionRef.current = action
  }, [])

  const unbindHistoryAction = useCallback(() => {
    historyActionRef.current = null
  }, [])

  const onPeerLeave = useCallback((peerId: string) => {
    for (const channelId of channelIdsRef.current) {
      historySyncedRef.current.delete(syncKey(channelId, peerId))
    }
  }, [])

  const requestFromPeers = useCallback(
    async (peerIds: string[], channelId: string, force = false) => {
      const historyAction = historyActionRef.current
      if (!historyAction || peerIds.length === 0) return

      const newPeers = force
        ? peerIds
        : peerIds.filter(id => !historySyncedRef.current.has(syncKey(channelId, id)))
      if (newPeers.length === 0) return

      const results = await historyAction.requestMany(
        { channelId },
        { targets: newPeers, timeoutMs: HISTORY_REQUEST_TIMEOUT_MS }
      )

      const entries: HistoryEntry[] = []
      const respondingPeers: string[] = []
      for (const result of results) {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
          entries.push(...result.value)
          respondingPeers.push(result.peerId)
          historySyncedRef.current.add(syncKey(channelId, result.peerId))
        }
      }

      // History carries file metadata but not bodies; pull only the ones we lack.
      const missingFileIds = await applyHistory(entries)
      if (missingFileIds.length > 0 && respondingPeers.length > 0) {
        await requestFilesRef.current(respondingPeers, missingFileIds)
      }
    },
    [applyHistory]
  )

  const syncFromPeers = useCallback(
    async (
      peerIds: string[],
      targetChannelIds: string[] = channelIdsRef.current,
      force = false
    ) => {
      if (peerIds.length === 0) return

      await Promise.all(
        targetChannelIds.map(async channelId => {
          if (syncingChannelsRef.current.has(channelId)) return
          syncingChannelsRef.current.add(channelId)
          try {
            await requestFromPeers(peerIds, channelId, force)
          } catch (err) {
            console.warn('[Peerly] History sync failed:', err)
          } finally {
            syncingChannelsRef.current.delete(channelId)
          }
        })
      )
    },
    [requestFromPeers]
  )

  return {
    getHistoryEntries,
    syncFromPeers,
    onPeerLeave,
    bindHistoryAction,
    unbindHistoryAction,
    reset,
  }
}