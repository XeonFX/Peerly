import { fileMetaFromHistoryEntry } from '../protocol/mappers'
import { safeFileMimeType } from '../utils/fileType'
import type { HistoryEntry } from '../protocol/types'
import type { Message } from '../types'
import type { FileCache } from './fileCache'
import type { BlobUrlRegistry } from '../utils/blobUrls'
import { loadFileBlob, loadFileUrls } from '../utils/fileStore'
import { loadLocalHistory } from '../utils/historyStorage'
import { mergeHistoryEntries } from '../utils/historyMerge'

export function fileIdsFromEntries(entries: HistoryEntry[]): string[] {
  return entries
    .filter(entry => entry.type === 'file' && entry.fileMeta)
    .map(entry => entry.fileMeta!.id)
}

export async function entriesToMessages(
  entries: HistoryEntry[],
  fileCache: FileCache,
  registry: BlobUrlRegistry,
  existingMessages: Message[] = []
): Promise<Message[]> {
  const fileIds = fileIdsFromEntries(entries)
  const fileUrls = new Map<string, string>()
  const missingFileIds: string[] = []

  for (const id of fileIds) {
    const cached = fileCache.get(id)
    if (cached) {
      // Anything persisted before the type was sanitized, or received from an
      // older peer, is re-pinned here rather than trusted on restore.
      const blob = new Blob([cached.buffer], { type: safeFileMimeType(cached.meta.mimeType) })
      fileUrls.set(id, registry.create(id, blob))
    } else {
      missingFileIds.push(id)
    }
  }

  if (missingFileIds.length > 0) {
    const loaded = await loadFileUrls(missingFileIds, registry)
    for (const [id, url] of loaded) {
      fileUrls.set(id, url)
    }
  }

  return mergeHistoryEntries(existingMessages, entries, fileUrls)
}

export async function cacheFilesFromEntries(entries: HistoryEntry[], fileCache: FileCache): Promise<void> {
  for (const entry of entries) {
    const meta = fileMetaFromHistoryEntry(entry)
    if (!meta || fileCache.has(meta.id)) continue
    const storedFile = await loadFileBlob(meta.id)
    if (!storedFile) continue
    await fileCache.set(meta, storedFile.buffer, { persist: false })
  }
}

export async function restoreChannelFromStorage(
  workspaceId: string,
  channelId: string,
  fileCache: FileCache,
  registry: BlobUrlRegistry
): Promise<Message[]> {
  const stored = loadLocalHistory(workspaceId, channelId)
  if (stored.length === 0) return []

  await cacheFilesFromEntries(stored, fileCache)
  return entriesToMessages(stored, fileCache, registry)
}