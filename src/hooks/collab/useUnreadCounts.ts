import { useEffect, useMemo, useRef, useState } from 'react'
import {
  countUnreadByChannel,
  latestMessageTimestamp,
  loadReadState,
  saveReadState,
  totalUnread,
  type ReadState,
} from '../../collab/unreadStore'
import type { Message } from '../../types'

export function useUnreadCounts(
  workspaceId: string,
  messagesByChannel: Record<string, Message[]>,
  channelIds: string[],
  activeChannelId: string,
  activeView: 'channel' | 'profile' | 'workspace',
  selfId: string
) {
  const [readState, setReadState] = useState<ReadState>(() => loadReadState(workspaceId))
  const [documentVisible, setDocumentVisible] = useState(
    () => document.visibilityState === 'visible'
  )
  const channelSeenAtRef = useRef<Record<string, number>>({})

  useEffect(() => {
    const handleVisibility = () => setDocumentVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  useEffect(() => {
    setReadState(loadReadState(workspaceId))
    channelSeenAtRef.current = {}
  }, [workspaceId])

  const channelSeenAt = useMemo(() => {
    const now = Date.now()
    const next = { ...channelSeenAtRef.current }
    for (const channelId of channelIds) {
      if (next[channelId] === undefined) {
        next[channelId] = now
      }
    }
    channelSeenAtRef.current = next
    return next
  }, [channelIds])

  useEffect(() => {
    if (activeView !== 'channel' || !documentVisible) return

    const messages = messagesByChannel[activeChannelId] ?? []
    const latest = latestMessageTimestamp(messages)

    setReadState(prev => {
      const current = prev[activeChannelId]
      if (current !== undefined && latest <= current) return prev
      const next = { ...prev, [activeChannelId]: latest }
      saveReadState(workspaceId, next)
      return next
    })
  }, [activeChannelId, activeView, documentVisible, messagesByChannel, workspaceId])

  const unreadByChannel = useMemo(
    () => countUnreadByChannel(messagesByChannel, readState, selfId, channelSeenAt),
    [messagesByChannel, readState, selfId, channelSeenAt]
  )

  return {
    unreadByChannel,
    totalUnread: totalUnread(unreadByChannel),
  }
}
