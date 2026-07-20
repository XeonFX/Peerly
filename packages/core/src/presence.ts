/**
 * Lobby presence bookkeeping shared by Peerly / HeyHubs discovery rooms.
 * Apps own wire shapes (email hash vs not) and React hooks; this owns maps + TTL.
 */

/** Cadence for re-announcing presence on the lobby mesh. */
export const PRESENCE_INTERVAL_MS = 12_000
/** Drop a peer if no presence refresh within this window. */
export const PRESENCE_TTL_MS = 35_000

export type PresenceEntry = {
  userId: string
  name: string
  /** Optional privacy-preserving email match (Peerly friend invites). */
  emailHash?: string
  seenAt: number
}

export type PresenceIndex = {
  record: (peerId: string, entry: Omit<PresenceEntry, 'seenAt'> & { seenAt?: number }) => void
  drop: (peerId: string) => void
  prune: (now?: number) => boolean
  isUserOnline: (userId: string | undefined, now?: number) => boolean
  peerIdForUserId: (userId: string) => string | undefined
  peerIdForEmailHash: (emailHash: string) => string | undefined
  get: (peerId: string) => PresenceEntry | undefined
  clear: () => void
  /** For tests / diagnostics. */
  size: () => number
}

/**
 * Mutable presence maps. Call `record` on each presence message and `prune` on
 * a timer (typically PRESENCE_INTERVAL_MS).
 */
export function createPresenceIndex(ttlMs: number = PRESENCE_TTL_MS): PresenceIndex {
  const byPeer = new Map<string, PresenceEntry>()
  const peerByUserId = new Map<string, string>()
  const peerByEmailHash = new Map<string, string>()

  const drop = (peerId: string) => {
    const entry = byPeer.get(peerId)
    if (!entry) return
    byPeer.delete(peerId)
    if (peerByUserId.get(entry.userId) === peerId) peerByUserId.delete(entry.userId)
    if (entry.emailHash && peerByEmailHash.get(entry.emailHash) === peerId) {
      peerByEmailHash.delete(entry.emailHash)
    }
  }

  return {
    record: (peerId, raw) => {
      const userId = raw.userId.trim()
      if (!userId || !peerId) return
      // A transport peer may refresh its profile, but it must never leave its
      // old user/email reverse indexes pointing at the replacement entry.
      // Those indexes are used for directed security-sensitive messages.
      if (byPeer.has(peerId)) drop(peerId)
      const name =
        typeof raw.name === 'string' && raw.name.trim()
          ? raw.name.trim().slice(0, 80)
          : userId.slice(0, 12)
      const emailHash =
        typeof raw.emailHash === 'string' && raw.emailHash
          ? raw.emailHash.toLowerCase()
          : undefined
      const prev = peerByUserId.get(userId)
      if (prev && prev !== peerId) drop(prev)
      const entry: PresenceEntry = {
        userId,
        name,
        ...(emailHash ? { emailHash } : {}),
        seenAt: Number.isFinite(raw.seenAt) ? raw.seenAt! : Date.now(),
      }
      byPeer.set(peerId, entry)
      peerByUserId.set(userId, peerId)
      if (emailHash) peerByEmailHash.set(emailHash, peerId)
    },
    drop,
    prune: (now = Date.now()) => {
      let changed = false
      for (const [peerId, entry] of byPeer) {
        if (now - entry.seenAt <= ttlMs) continue
        drop(peerId)
        changed = true
      }
      return changed
    },
    isUserOnline: (userId, now = Date.now()) => {
      if (!userId) return false
      const peerId = peerByUserId.get(userId)
      if (!peerId) return false
      const entry = byPeer.get(peerId)
      return !!entry && now - entry.seenAt <= ttlMs
    },
    peerIdForUserId: userId => peerByUserId.get(userId),
    peerIdForEmailHash: emailHash => peerByEmailHash.get(emailHash.toLowerCase()),
    get: peerId => byPeer.get(peerId),
    clear: () => {
      byPeer.clear()
      peerByUserId.clear()
      peerByEmailHash.clear()
    },
    size: () => byPeer.size,
  }
}

export type PresencePayload = {
  userId: string
  name: string
  emailHash?: string
}

export type ParsePresenceOptions = {
  /** When true, require a 64-char hex email hash (Peerly lobby). */
  requireEmailHash?: boolean
}

const HEX64 = /^[0-9a-f]{64}$/i

/** Validate an untrusted lobby presence blob. */
export function parsePresencePayload(
  raw: unknown,
  options: ParsePresenceOptions = {}
): PresencePayload | null {
  if (typeof raw !== 'object' || raw === null) return null
  const msg = raw as Partial<PresencePayload>
  if (typeof msg.userId !== 'string' || !msg.userId.trim()) return null
  if (options.requireEmailHash) {
    if (typeof msg.emailHash !== 'string' || !HEX64.test(msg.emailHash)) return null
  } else if (msg.emailHash !== undefined) {
    if (typeof msg.emailHash !== 'string' || !HEX64.test(msg.emailHash)) return null
  }
  const name =
    typeof msg.name === 'string' && msg.name.trim()
      ? msg.name.trim().slice(0, 80)
      : msg.userId.slice(0, 12)
  return {
    userId: msg.userId.trim(),
    name,
    ...(typeof msg.emailHash === 'string' && HEX64.test(msg.emailHash)
      ? { emailHash: msg.emailHash.toLowerCase() }
      : {}),
  }
}
