/**
 * How much of a workspace's file history to pull automatically when joining
 * or reconnecting.
 *
 * - 'ondemand' (default): history sync carries text and image thumbnails;
 *   full file bodies transfer only when the user asks for one.
 * - 'auto': also fetch every referenced file body immediately, like a
 *   traditional client. Costs bandwidth and cache space up front.
 *
 * Device-wide rather than per-workspace: it expresses "what this device's
 * connection and disk can afford", not a property of any workspace.
 */
const STORAGE_KEY = 'peerly-file-sync'

export type FileSyncMode = 'ondemand' | 'auto'

export function loadFileSyncMode(): FileSyncMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'auto' ? 'auto' : 'ondemand'
  } catch {
    return 'ondemand'
  }
}

export function saveFileSyncMode(mode: FileSyncMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // Preference only; the default keeps working.
  }
}
