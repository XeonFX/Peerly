import { useCallback, useRef, useState } from 'react'

import { HISTORY_REQUEST_TIMEOUT_MS } from '../../collab/constants'
import type { HistoryEntry, HistoryRequest } from '../../protocol/types'
import { loadFileSyncMode } from '../../collab/syncPreferences'
import { estimateBrowserStorageCached, storagePressure } from '../../utils/browserStorage'
import type { WorkspaceSyncProgress } from '../../types'
import { recordSyncActivity, syncPayloadBytes } from '@peerly/core'

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
  requestFilesFromPeers: (peerIds: string[], fileIds: string[]) => Promise<void>,
  sanitizeEntries?: (entries: HistoryEntry[]) => Promise<HistoryEntry[]>
) {
  const sanitizeEntriesRef = useRef(sanitizeEntries)
  sanitizeEntriesRef.current = sanitizeEntries

  const [progress, setProgress] = useState<WorkspaceSyncProgress>({
    phase: 'idle',
    completedChannels: 0,
    totalChannels: 0,
    receivedEntries: 0,
    missingOriginals: 0,
  })
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
    setProgress({
      phase: 'idle',
      completedChannels: 0,
      totalChannels: 0,
      receivedEntries: 0,
      missingOriginals: 0,
    })
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
      if (!historyAction || peerIds.length === 0) return { entries: 0, missing: 0, requested: false }

      const newPeers = force
        ? peerIds
        : peerIds.filter(id => !historySyncedRef.current.has(syncKey(channelId, id)))
      if (newPeers.length === 0) return { entries: 0, missing: 0, requested: false }

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
          recordSyncActivity({
            direction: 'received', kind: 'history',
            peer: { peerId: result.peerId, relationship: 'workspace-member' },
            itemCount: result.value.length,
            bytes: syncPayloadBytes(result.value),
            summary: `${channelId} · ${result.value.length} messages and file records`,
          })
        }
      }

      // Relayed entries are only as honest as whichever member served them:
      // verify author signatures, drop tampered entries, and strip identity
      // claims that no live handshake ever vouched for (see messageSigning).
      const vetted = sanitizeEntriesRef.current
        ? await sanitizeEntriesRef.current(entries)
        : entries

      // History carries file metadata but not bodies; pull only the ones we lack.
      const missingFileIds = await applyHistory(vetted)
      let requested = false
      const mode = loadFileSyncMode()
      const storage = await estimateBrowserStorageCached()
      const pressure = storagePressure(storage.usageBytes, storage.quotaBytes)
      if (
        mode === 'auto' &&
        pressure !== 'warning' &&
        pressure !== 'critical' &&
        missingFileIds.length > 0 &&
        respondingPeers.length > 0
      ) {
        requested = true
        await requestFilesRef.current(respondingPeers, missingFileIds)
      }
      return { entries: entries.length, missing: missingFileIds.length, requested }
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

      const targets = targetChannelIds.filter(channelId => !syncingChannelsRef.current.has(channelId))
      if (targets.length === 0) return
      let completedChannels = 0
      let receivedEntries = 0
      let missingOriginals = 0
      let requestedOriginals = false
      setProgress({
        phase: 'history',
        completedChannels: 0,
        totalChannels: targets.length,
        receivedEntries: 0,
        missingOriginals: 0,
        message: 'Comparing messages and file metadata…',
      })

      await Promise.all(
        targets.map(async channelId => {
          syncingChannelsRef.current.add(channelId)
          try {
            const result = await requestFromPeers(peerIds, channelId, force)
            receivedEntries += result.entries
            missingOriginals += result.missing
            requestedOriginals ||= result.requested
          } catch (err) {
            console.warn('[Peerly] History sync failed:', err)
          } finally {
            syncingChannelsRef.current.delete(channelId)
            completedChannels += 1
            setProgress({
              phase: 'history',
              completedChannels,
              totalChannels: targets.length,
              receivedEntries,
              missingOriginals,
              message: `Synced ${completedChannels} of ${targets.length} channels`,
            })
          }
        })
      )
      const mode = loadFileSyncMode()
      setProgress({
        phase: requestedOriginals ? 'originals' : mode === 'auto' && missingOriginals > 0 ? 'paused' : 'ready',
        completedChannels,
        totalChannels: targets.length,
        receivedEntries,
        missingOriginals,
        message: requestedOriginals
          ? `Requested ${missingOriginals} missing original${missingOriginals === 1 ? '' : 's'}`
          : mode === 'auto' && missingOriginals > 0
            ? 'Original downloads paused because browser storage is low'
            : missingOriginals > 0
              ? `${missingOriginals} original${missingOriginals === 1 ? '' : 's'} available on demand`
              : 'Workspace is up to date',
      })
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
    progress,
  }
}
