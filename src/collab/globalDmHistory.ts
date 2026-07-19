import type { TextChatWire } from '@peerly/core'

/**
 * Device-local history for global friend DMs, keyed by dm room code.
 * No server queue — offline peers only get history from a peer who still holds it.
 */

const STORAGE_PREFIX = 'peerly-gdm-hist-v1-'
export const GLOBAL_DM_HISTORY_CAP = 500

export type GlobalDmMessage = TextChatWire & {
  /** Durable OIDC user id of the author when known. */
  authorUserId?: string
}

function storageKey(roomCode: string): string {
  return `${STORAGE_PREFIX}${roomCode.toLowerCase()}`
}

export function loadGlobalDmHistory(roomCode: string): GlobalDmMessage[] {
  if (!roomCode) return []
  try {
    const raw = localStorage.getItem(storageKey(roomCode))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (m): m is GlobalDmMessage =>
          !!m &&
          typeof m === 'object' &&
          typeof (m as GlobalDmMessage).id === 'string' &&
          typeof (m as GlobalDmMessage).text === 'string' &&
          typeof (m as GlobalDmMessage).ts === 'number'
      )
      .slice(-GLOBAL_DM_HISTORY_CAP)
  } catch {
    return []
  }
}

export function saveGlobalDmHistory(roomCode: string, messages: GlobalDmMessage[]): void {
  if (!roomCode) return
  try {
    const trimmed = messages.slice(-GLOBAL_DM_HISTORY_CAP)
    localStorage.setItem(storageKey(roomCode), JSON.stringify(trimmed))
  } catch {
    // quota
  }
}

export function upsertGlobalDmMessage(
  messages: GlobalDmMessage[],
  next: GlobalDmMessage
): GlobalDmMessage[] {
  const idx = messages.findIndex(m => m.id === next.id)
  if (idx === -1) {
    return [...messages, next].sort((a, b) => a.ts - b.ts).slice(-GLOBAL_DM_HISTORY_CAP)
  }
  const prev = messages[idx]!
  // Prefer newer edit/delete revisions.
  const prevScore = (prev.editedAt ?? 0) + (prev.deletedAt ?? 0)
  const nextScore = (next.editedAt ?? 0) + (next.deletedAt ?? 0)
  if (nextScore < prevScore) return messages
  const copy = messages.slice()
  copy[idx] = next
  return copy
}
