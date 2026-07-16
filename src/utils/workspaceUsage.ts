import { deleteFileBlobs, listFileBlobIds } from './fileStore'
import { notifyStorageChanged } from './browserStorage'

/**
 * Per-workspace footprint on this device, and the knife to trim it.
 *
 * Two stores matter: localStorage (messages, channels, read state — cheap) and
 * the IndexedDB file cache (file bodies — the real weight). File bodies are
 * content-addressed and shared across workspaces, so attribution goes through
 * each workspace's stored history: a blob "belongs" to every workspace whose
 * messages reference it, and clearing one workspace only deletes blobs no
 * OTHER workspace still references.
 */

const HISTORY_PREFIX = 'peerly-history-'

/** Everything except history, which needs the `__` channel separator. */
const WORKSPACE_KEY_BUILDERS: ((workspaceId: string) => string)[] = [
  ws => `peerly-channels-${ws}`,
  ws => `peerly-dms-${ws}`,
  ws => `peerly-read-${ws}`,
  ws => `peerly-self-ids:${ws}`,
]

export type WorkspaceUsage = {
  /** localStorage bytes: messages, channels, DMs, read state. */
  messagesBytes: number
  /** IndexedDB file-cache bytes attributed to this workspace's history. */
  filesBytes: number
  fileCount: number
  /** Logical bytes referenced by workspace history, cached here or not. */
  sharedFilesBytes: number
  sharedFileCount: number
  /** Cached bytes that can actually be deleted without affecting another workspace. */
  reclaimableBytes: number
  totalBytes: number
}

function historyKeyPrefix(workspaceId: string): string {
  return `${HISTORY_PREFIX}${workspaceId}__`
}

function localStorageKeysFor(workspaceId: string): string[] {
  const keys: string[] = []
  const prefix = historyKeyPrefix(workspaceId)
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(prefix)) keys.push(key)
  }
  for (const build of WORKSPACE_KEY_BUILDERS) {
    if (localStorage.getItem(build(workspaceId)) !== null) keys.push(build(workspaceId))
  }
  return keys
}

/** File ids and sizes referenced by a workspace's stored history. */
function referencedFiles(workspaceId: string): Map<string, number> {
  const files = new Map<string, number>()
  const prefix = historyKeyPrefix(workspaceId)
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith(prefix)) continue
    try {
      const messages = JSON.parse(localStorage.getItem(key) ?? '[]')
      if (!Array.isArray(messages)) continue
      for (const message of messages) {
        const file = message?.file
        if (file && typeof file.id === 'string') {
          files.set(file.id, typeof file.size === 'number' ? file.size : 0)
        }
      }
    } catch {
      // A corrupt channel is a display problem elsewhere; not a sizing error.
    }
  }
  return files
}

function otherWorkspaceIds(excludeWorkspaceId: string): string[] {
  const ids = new Set<string>()
  const exclude = historyKeyPrefix(excludeWorkspaceId)
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith(HISTORY_PREFIX) || key.startsWith(exclude)) continue
    const rest = key.slice(HISTORY_PREFIX.length)
    const sep = rest.indexOf('__')
    if (sep > 0) ids.add(rest.slice(0, sep))
  }
  return [...ids]
}

export async function estimateWorkspaceUsage(workspaceId: string): Promise<WorkspaceUsage> {
  let messagesBytes = 0
  for (const key of localStorageKeysFor(workspaceId)) {
    // UTF-16 storage: two bytes per code unit is the honest floor.
    messagesBytes += (key.length + (localStorage.getItem(key)?.length ?? 0)) * 2
  }

  const referenced = referencedFiles(workspaceId)
  const sharedFilesBytes = [...referenced.values()].reduce((sum, size) => sum + size, 0)
  let filesBytes = 0
  let fileCount = 0
  let reclaimableBytes = 0
  if (referenced.size > 0) {
    const cached = new Set(await listFileBlobIds())
    const referencedElsewhere = new Set<string>()
    for (const otherId of otherWorkspaceIds(workspaceId)) {
      for (const id of referencedFiles(otherId).keys()) referencedElsewhere.add(id)
    }
    for (const [id, size] of referenced) {
      if (cached.has(id)) {
        filesBytes += size
        fileCount++
        if (!referencedElsewhere.has(id)) reclaimableBytes += size
      }
    }
  }

  return {
    messagesBytes,
    filesBytes,
    fileCount,
    sharedFilesBytes,
    sharedFileCount: referenced.size,
    reclaimableBytes,
    totalBytes: messagesBytes + filesBytes,
  }
}

/**
 * Usage for many workspaces in one pass: parse each history once and hit
 * IndexedDB for the blob-id list once, instead of per badge — the per-badge
 * version re-parsed every other workspace's history for the shared-blob
 * calculation, which is O(workspaces squared) on the picker.
 */
export async function estimateWorkspacesUsage(
  workspaceIds: string[]
): Promise<Map<string, WorkspaceUsage>> {
  const usages = new Map<string, WorkspaceUsage>()
  if (workspaceIds.length === 0) return usages

  const cached = new Set(await listFileBlobIds())
  const references = new Map<string, Map<string, number>>()
  const allIds = new Set([...workspaceIds, ...otherWorkspaceIds('')])
  for (const id of allIds) references.set(id, referencedFiles(id))

  for (const workspaceId of workspaceIds) {
    let messagesBytes = 0
    for (const key of localStorageKeysFor(workspaceId)) {
      messagesBytes += (key.length + (localStorage.getItem(key)?.length ?? 0)) * 2
    }

    const referenced = references.get(workspaceId) ?? new Map<string, number>()
    const sharedFilesBytes = [...referenced.values()].reduce((sum, size) => sum + size, 0)
    let filesBytes = 0
    let fileCount = 0
    let reclaimableBytes = 0
    for (const [id, size] of referenced) {
      if (!cached.has(id)) continue
      filesBytes += size
      fileCount++
      const referencedElsewhere = [...references.entries()].some(
        ([otherId, ids]) => otherId !== workspaceId && ids.has(id)
      )
      if (!referencedElsewhere) reclaimableBytes += size
    }

    usages.set(workspaceId, {
      messagesBytes,
      filesBytes,
      fileCount,
      sharedFilesBytes,
      sharedFileCount: referenced.size,
      reclaimableBytes,
      totalBytes: messagesBytes + filesBytes,
    })
  }
  return usages
}

/**
 * Reclaim original file bodies while retaining messages, thumbnails, read state,
 * workspace access, and the metadata needed to fetch those originals again.
 */
export async function clearWorkspaceFiles(workspaceId: string): Promise<number> {
  const mine = referencedFiles(workspaceId)
  if (mine.size === 0) return 0

  const keepIds = new Set<string>()
  for (const otherId of otherWorkspaceIds(workspaceId)) {
    for (const id of referencedFiles(otherId).keys()) keepIds.add(id)
  }
  const cached = new Set(await listFileBlobIds())
  const deletable = [...mine.keys()].filter(id => cached.has(id) && !keepIds.has(id))
  await deleteFileBlobs(deletable)
  notifyStorageChanged()
  return deletable.reduce((sum, id) => sum + (mine.get(id) ?? 0), 0)
}

/**
 * Delete this workspace's local data: message history, read state, DM index,
 * and every cached file body that no other workspace's history references.
 * Access (the workspace-store entry with the signed allow-list) is untouched —
 * rejoining re-syncs from whoever is online.
 */
export async function clearWorkspaceData(workspaceId: string): Promise<void> {
  await clearWorkspaceFiles(workspaceId)

  for (const key of localStorageKeysFor(workspaceId)) {
    localStorage.removeItem(key)
  }
  notifyStorageChanged()
}

const UNITS = ['B', 'KB', 'MB', 'GB']

export function formatUsage(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${UNITS[unit]}`
}
