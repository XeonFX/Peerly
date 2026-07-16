/** Generic key/value IndexedDB store — out-of-line keys, structured-clone values. */
export type KvStore<T> = {
  get(key: string): Promise<T | null>
  set(key: string, value: T): Promise<void>
}

export function createKvStore<T>(dbName: string, storeName: string): KvStore<T> {
  function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName)
        }
      }
    })
  }

  async function get(key: string): Promise<T | null> {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly')
      const request = tx.objectStore(storeName).get(key)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        db.close()
        resolve((request.result as T | undefined) ?? null)
      }
    })
  }

  async function set(key: string, value: T): Promise<void> {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite')
      tx.objectStore(storeName).put(value, key)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    })
  }

  return { get, set }
}
