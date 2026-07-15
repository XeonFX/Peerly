import { normalizeWorkspaceId } from '../config'
import type { Message } from '../types'

export type ReadState = Record<string, number>

const STORAGE_PREFIX = 'flux-read-'

function storageKey(workspaceId: string): string {
  return `${STORAGE_PREFIX}${normalizeWorkspaceId(workspaceId)}`
}

export function loadReadState(workspaceId: string): ReadState {
  try {
    const raw = localStorage.getItem(storageKey(workspaceId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ReadState
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch {
    return {}
  }
}

export function saveReadState(workspaceId: string, state: ReadState): void {
  localStorage.setItem(storageKey(workspaceId), JSON.stringify(state))
}

export function latestMessageTimestamp(messages: Message[]): number {
  if (messages.length === 0) return Date.now()
  return Math.max(...messages.map(message => message.timestamp))
}

function unreadThreshold(lastReadAt: number | undefined, channelSeenAt: number | undefined): number {
  return Math.max(lastReadAt ?? 0, channelSeenAt ?? 0)
}

export function countUnreadMessages(
  messages: Message[],
  lastReadAt: number | undefined,
  selfId: string,
  channelSeenAt?: number
): number {
  const threshold = unreadThreshold(lastReadAt, channelSeenAt)
  return messages.filter(
    message => message.timestamp > threshold && message.senderId !== selfId
  ).length
}

export function countUnreadByChannel(
  messagesByChannel: Record<string, Message[]>,
  readState: ReadState,
  selfId: string,
  channelSeenAt: Record<string, number> = {}
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const [channelId, messages] of Object.entries(messagesByChannel)) {
    counts[channelId] = countUnreadMessages(
      messages,
      readState[channelId],
      selfId,
      channelSeenAt[channelId]
    )
  }
  return counts
}

export function totalUnread(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0)
}