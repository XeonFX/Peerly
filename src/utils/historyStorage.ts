import { toHistoryEntry } from '../protocol/mappers'
import type { HistoryEntry } from '../protocol/types'
import type { Message } from '../types'

const STORAGE_PREFIX = 'flux-history-'

export function historyStorageKey(workspaceId: string, channelId: string): string {
  return `${STORAGE_PREFIX}${workspaceId}__${channelId}`
}

export function loadLocalHistory(workspaceId: string, channelId: string): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(historyStorageKey(workspaceId, channelId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as HistoryEntry[]
  } catch {
    return []
  }
}

export function saveLocalHistory(
  workspaceId: string,
  channelId: string,
  messages: Message[]
): void {
  const entries = messages.map(toHistoryEntry)
  try {
    localStorage.setItem(historyStorageKey(workspaceId, channelId), JSON.stringify(entries))
  } catch {
    // quota exceeded — keep in-memory state only
  }
}