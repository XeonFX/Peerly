import { toHistoryEntry } from '../protocol/mappers'
import type { HistoryEntry } from '../protocol/types'
import type { Message } from '../types'

const STORAGE_PREFIX = 'peerly-history-'
// Keep failed writes available to backup/export for this browser session.
// A WeakMap also isolates injected Storage instances in tests and embeds.
const unsaved = new WeakMap<Storage, Map<string, HistoryEntry[]>>()
const unavailableStorage = new Map<string, HistoryEntry[]>()
function pending(): Map<string, HistoryEntry[]> {
  try {
    const storage = localStorage
    let entries = unsaved.get(storage)
    if (!entries) { entries = new Map(); unsaved.set(storage, entries) }
    return entries
  } catch {
    return unavailableStorage
  }
}

export function historyStorageKey(workspaceId: string, channelId: string): string {
  return `${STORAGE_PREFIX}${workspaceId}__${channelId}`
}

export function loadLocalHistory(workspaceId: string, channelId: string): HistoryEntry[] {
  const latest = pending().get(historyStorageKey(workspaceId, channelId))
  if (latest) return latest
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
): boolean {
  const entries = messages.map(toHistoryEntry)
  const key = historyStorageKey(workspaceId, channelId)
  pending().set(key, entries)
  try {
    localStorage.setItem(key, JSON.stringify(entries))
    pending().delete(key)
    return true
  } catch {
    // The caller must surface this failure. Export still sees the latest data.
    return false
  }
}

export function clearUnsavedWorkspaceHistory(workspaceId: string): void {
  for (const key of pending().keys()) {
    if (key.startsWith(`${STORAGE_PREFIX}${workspaceId}__`)) pending().delete(key)
  }
}
