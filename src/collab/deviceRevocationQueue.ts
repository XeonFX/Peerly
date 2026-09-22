export const REVOCATIONS_CHANGED = 'peerly-revocations-changed'
export type PendingRevocation = { deviceKeyId: string; label: string }

/** Intents outlive the local device grants and are removed only after the
 * server ACK. Scope them to both the account and the initiating device. */
export function createDeviceRevocationQueue(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  const running = new Map<string, Promise<void>>()
  const key = (userId: string, issuer: string) => `peerly-pending-revocations-v1:${userId}:${issuer}`
  const read = (userId: string, issuer: string): PendingRevocation[] => {
    const raw = storage.getItem(key(userId, issuer))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('Invalid pending revocations')
    return parsed.filter((entry): entry is PendingRevocation => entry &&
      typeof entry.deviceKeyId === 'string' && typeof entry.label === 'string')
  }
  const write = (userId: string, issuer: string, entries: PendingRevocation[]) => {
    storage.setItem(key(userId, issuer), JSON.stringify(entries))
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(REVOCATIONS_CHANGED))
  }
  return {
    read,
    enqueue(userId: string, issuer: string, entry: PendingRevocation) {
      const pending = read(userId, issuer).filter(item => item.deviceKeyId !== entry.deviceKeyId)
      write(userId, issuer, [...pending, entry])
    },
    async flush(userId: string, issuer: string, revoke: (deviceKeyId: string) => Promise<void>,
      isCurrent = () => true): Promise<void> {
      const id = key(userId, issuer)
      if (running.has(id)) return running.get(id)!
      const operation = (async () => {
        for (const entry of read(userId, issuer)) {
          if (!isCurrent()) return
          await revoke(entry.deviceKeyId)
          write(userId, issuer, read(userId, issuer).filter(item => item.deviceKeyId !== entry.deviceKeyId))
        }
      })()
      running.set(id, operation)
      try { await operation } finally { running.delete(id) }
    },
  }
}

// Access storage only when invoked (module also loads in non-browser tests).
export const deviceRevocationQueue = createDeviceRevocationQueue({
  getItem: key => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
})
