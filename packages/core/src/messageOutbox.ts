export type OutboxEntry<T> = { scope: string; id: string; payload: T; failed: boolean; queuedAt: number }
let lastQueuedAt = 0
export interface OutboxStorage {
  list<T>(scope: string): Promise<OutboxEntry<T>[]>
  put<T>(entry: OutboxEntry<T>): Promise<void>
  remove(scope: string, id: string): Promise<void>
}

export function createIndexedDbOutboxStorage(databaseName: string): OutboxStorage {
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('messages', { keyPath: ['scope', 'id'] }).createIndex('scope', 'scope')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', mode)
    const request = run(tx.objectStore('messages'))
    tx.oncomplete = () => { db.close(); resolve(request.result) }
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Outbox transaction aborted')) }
    tx.onerror = () => { db.close(); reject(tx.error ?? request.error) }
  })
}
return {
  list: scope => transaction('readonly', store => store.index('scope').getAll(scope)),
  put: async entry => { await transaction('readwrite', store => store.put(entry)) },
  remove: async (scope, id) => { await transaction('readwrite', store => store.delete([scope, id])) },
}
}

/** Records are immutable apart from delivery status. Retrying uses the same
 * signed payload/id; a lost ACK must never create a new logical message. */
export function createMessageOutbox<T extends { id: string }>(storage: OutboxStorage) {
  const running = new Map<string, Promise<void>>()
  const cancelled = new Set<string>()
  return {
    list: (scope: string) => storage.list<T>(scope),
    async remove(scope: string, id: string) {
      await storage.remove(scope, id)
      if (running.has(scope)) cancelled.add(`${scope}:${id}`)
    },
    async enqueue(scope: string, payload: T) {
      if ((await storage.list<T>(scope)).length >= 100) throw new Error('Too many pending messages. Retry pending messages first.')
      lastQueuedAt = Math.max(Date.now(), lastQueuedAt + 1)
      cancelled.delete(`${scope}:${payload.id}`)
      await storage.put({ scope, id: payload.id, payload, failed: false, queuedAt: lastQueuedAt })
    },
    async flush(scope: string, deliver: (payload: T) => Promise<void>, current: () => boolean,
      changed: () => void = () => {}): Promise<void> {
      if (running.has(scope)) return running.get(scope)!
      const operation = (async () => {
        while (current()) {
          const entries = (await storage.list<T>(scope)).sort((a, b) => a.queuedAt - b.queuedAt)
          if (!entries.length) return
          for (const entry of entries) {
            if (!current()) return
            const key = `${scope}:${entry.id}`
            if (cancelled.has(key) || !(await storage.list<T>(scope)).some(item => item.id === entry.id)) continue
            try {
              await deliver(entry.payload)
              await storage.remove(scope, entry.id)
            } catch {
              if (!cancelled.has(key) && (await storage.list<T>(scope)).some(item => item.id === entry.id)) {
                await storage.put({ ...entry, failed: true })
                if (cancelled.has(key)) await storage.remove(scope, entry.id)
              }
              changed()
              return
            }
            changed()
          }
        }
      })()
      running.set(scope, operation)
      try { await operation } finally {
        running.delete(scope)
        for (const key of cancelled) if (key.startsWith(`${scope}:`)) cancelled.delete(key)
      }
    },
  }
}
