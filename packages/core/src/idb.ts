/**
 * Shared IndexedDB "open (create store on first use)" boilerplate. Every store
 * in this codebase — key/value (out-of-line keys) or keyPath-based records —
 * opens a single-store, version-1 database the same way; this is just that
 * part factored out so each store only has to define its own get/set/put/etc.
 */
export function openIndexedDb(
  dbName: string,
  storeName: string,
  options?: { keyPath?: string }
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, options?.keyPath ? { keyPath: options.keyPath } : undefined)
      }
    }
  })
}
