import { isValidDmSecret } from './dmRoomCode.js'

export type DmCredential = {
  secret: string
  deviceKeyId: string
}

export type DmCredentialStore = {
  get: (userId: string) => DmCredential | undefined
  set: (userId: string, credential: DmCredential) => void
  remove: (userId: string) => void
}

/** Device-local DM credentials. Keep separate from exportable friend attestations. */
export function createDmCredentialStore(storageKey: string): DmCredentialStore {
  const readAll = (): Record<string, DmCredential> => {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as unknown
      if (typeof parsed !== 'object' || parsed === null) return {}
      const valid: Record<string, DmCredential> = {}
      for (const [userId, value] of Object.entries(parsed)) {
        if (typeof value !== 'object' || value === null || !userId) continue
        const item = value as Partial<DmCredential>
        const secret = item.secret
        if (typeof secret !== 'string' || !isValidDmSecret(secret)) continue
        if (typeof item.deviceKeyId !== 'string' || !item.deviceKeyId || item.deviceKeyId.length > 512) continue
        valid[userId] = { secret: secret.toLowerCase(), deviceKeyId: item.deviceKeyId }
      }
      return valid
    } catch {
      return {}
    }
  }
  const writeAll = (value: Record<string, DmCredential>) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value))
    } catch {
      // Private mode / quota: friendship remains, but secure DMs stay unavailable.
    }
  }
  return {
    get: userId => readAll()[userId],
    set: (userId, credential) => {
      if (!userId || !isValidDmSecret(credential.secret)) return
      if (!credential.deviceKeyId || credential.deviceKeyId.length > 512) return
      writeAll({
        ...readAll(),
        [userId]: { secret: credential.secret.toLowerCase(), deviceKeyId: credential.deviceKeyId },
      })
    },
    remove: userId => {
      const all = readAll()
      if (!(userId in all)) return
      delete all[userId]
      writeAll(all)
    },
  }
}
