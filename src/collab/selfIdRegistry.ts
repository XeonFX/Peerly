/**
 * Which Trystero peer ids have been "me" in a workspace, on this browser.
 *
 * selfId is random per page load, so a message sent before a refresh carries a
 * sender id that matches nothing afterwards. Peers' old messages recover via
 * the name fallback in senderDirectory, but our own can't — we are not in the
 * peers list — so they froze at the name/avatar snapshot stored in the message
 * and ignored later profile changes. Remembering our past ids lets the sender
 * directory map those messages to the live profile like any current one.
 */

const KEY_PREFIX = 'peerly-self-ids:'

/** Plenty for "sessions whose messages are still in retained history". */
const MAX_IDS = 50

function storageKey(workspaceId: string): string {
  return `${KEY_PREFIX}${workspaceId}`
}

export function loadSelfIds(workspaceId: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(workspaceId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    return []
  }
}

export function rememberSelfId(workspaceId: string, selfId: string): void {
  try {
    const ids = loadSelfIds(workspaceId).filter(id => id !== selfId)
    ids.push(selfId)
    localStorage.setItem(storageKey(workspaceId), JSON.stringify(ids.slice(-MAX_IDS)))
  } catch {
    // Storage full or unavailable: old messages fall back to their snapshot,
    // which is the pre-registry behaviour, not an error worth surfacing.
  }
}
