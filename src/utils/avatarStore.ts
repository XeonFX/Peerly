import { createIndexedDbStore } from './indexedDbStore'

const store = createIndexedDbStore('flux-avatars', 'avatars')

export async function saveAvatar(id: string, blob: Blob): Promise<void> {
  const buffer = await blob.arrayBuffer()
  await store.put(id, blob.type || 'image/webp', buffer)
}

export async function loadAvatar(id: string): Promise<Blob | null> {
  return store.getBlob(id)
}

export async function deleteAvatar(id: string): Promise<void> {
  await store.remove(id)
}

export async function loadAvatarDataUrl(id: string): Promise<string | null> {
  const blob = await loadAvatar(id)
  if (!blob) return null
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}