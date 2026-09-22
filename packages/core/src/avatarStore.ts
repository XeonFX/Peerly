import { createBlobStore } from './blobStore.js'

/**
 * Per-account avatar blobs, keyed by an app-scoped store name.
 *
 * Both apps kept a byte-identical copy of this differing only in that name,
 * which is the shape of duplication worth lifting: no behaviour to reconcile,
 * only a constant to parameterise.
 */
export type AvatarStore = {
  save(id: string, blob: Blob): Promise<void>
  load(id: string): Promise<Blob | null>
  remove(id: string): Promise<void>
  /** A `data:` URL, for rendering without holding an object URL open. */
  loadDataUrl(id: string): Promise<string | null>
}

export function createAvatarStore(app: string): AvatarStore {
  const store = createBlobStore(`${app}-avatars`, 'avatars')

  return {
    async save(id, blob) {
      // Fall back to webp rather than storing a blank type: the value is read
      // back verbatim when reconstructing the Blob.
      await store.put(id, blob.type || 'image/webp', await blob.arrayBuffer())
    },
    load: id => store.getBlob(id),
    remove: id => store.remove(id),
    async loadDataUrl(id) {
      const blob = await store.getBlob(id)
      if (!blob) return null
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
    },
  }
}
