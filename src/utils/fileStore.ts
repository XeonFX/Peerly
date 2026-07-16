import { createIndexedDbStore } from './indexedDbStore'
import { BlobUrlRegistry } from './blobUrls'
import { safeFileMimeType } from './fileType'
import { notifyStorageChanged } from './browserStorage'

const store = createIndexedDbStore('peerly-files', 'files')

export async function saveFileBlob(id: string, mimeType: string, buffer: ArrayBuffer): Promise<void> {
  await store.put(id, mimeType, buffer)
  notifyStorageChanged()
}

export async function loadFileBlob(
  id: string
): Promise<{ mimeType: string; buffer: ArrayBuffer } | null> {
  return store.get(id)
}

export async function loadFileUrls(
  ids: string[],
  registry: BlobUrlRegistry
): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  await Promise.all(
    ids.map(async id => {
      const stored = await loadFileBlob(id)
      if (!stored) return
      // Stored types are only as trustworthy as whoever sent the file; re-pin.
      const blob = new Blob([stored.buffer], { type: safeFileMimeType(stored.mimeType) })
      urls.set(id, registry.create(id, blob))
    })
  )
  return urls
}

/** Ids of every cached file blob, without loading any bytes. */
export async function listFileBlobIds(): Promise<string[]> {
  return store.keys()
}

export async function deleteFileBlobs(ids: string[]): Promise<void> {
  await Promise.all(ids.map(id => store.remove(id)))
  if (ids.length > 0) notifyStorageChanged()
}
