import { openIndexedDb } from './idb.js'

type BlobRecord = {
  id: string
  mimeType: string
  buffer: ArrayBuffer
}

/**
 * Generic keyPath-based blob store (id + mime type + raw bytes) — used for
 * anything a peer needs to persist and later hand back out as a Blob/data
 * URL: chat file bodies, avatar images, and so on. Distinct from `kvStore`
 * (out-of-line keys, structured-clone values, used for things like the
 * device keypair) even though both build on the same `openIndexedDb` helper.
 */
export function createBlobStore(dbName: string, storeName: string) {
  function openDb(): Promise<IDBDatabase> {
    return openIndexedDb(dbName, storeName, { keyPath: 'id' })
  }

  async function put(id: string, mimeType: string, buffer: ArrayBuffer): Promise<void> {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite')
      const store = tx.objectStore(storeName)
      const record: BlobRecord = { id, mimeType, buffer }
      const request = store.put(record)
      request.onerror = () => {
        db.close()
        reject(request.error)
      }
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => {
        db.close()
        reject(tx.error)
      }
    })
  }

  async function get(id: string): Promise<{ mimeType: string; buffer: ArrayBuffer } | null> {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly')
      const store = tx.objectStore(storeName)
      const request = store.get(id)
      request.onerror = () => {
        db.close()
        reject(request.error)
      }
      request.onsuccess = () => {
        const record = request.result as BlobRecord | undefined
        db.close()
        if (!record) {
          resolve(null)
          return
        }
        resolve({ mimeType: record.mimeType, buffer: record.buffer })
      }
    })
  }

  async function remove(id: string): Promise<void> {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite')
      const store = tx.objectStore(storeName)
      const request = store.delete(id)
      request.onerror = () => {
        db.close()
        reject(request.error)
      }
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => {
        db.close()
        reject(tx.error)
      }
    })
  }

  /** Ids only — never materializes the stored buffers. */
  async function keys(): Promise<string[]> {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly')
      const request = tx.objectStore(storeName).getAllKeys()
      request.onerror = () => {
        db.close()
        reject(request.error)
      }
      request.onsuccess = () => {
        db.close()
        resolve((request.result as IDBValidKey[]).filter((k): k is string => typeof k === 'string'))
      }
    })
  }

  async function getBlob(id: string): Promise<Blob | null> {
    const record = await get(id)
    if (!record) return null
    return new Blob([record.buffer], { type: record.mimeType })
  }

  return { put, get, remove, getBlob, keys }
}