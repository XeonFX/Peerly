/**
 * Lobby presence bookkeeping shared by consumer discovery rooms.
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
  /** Deployment-keyed capability; safe to announce because it cannot be publicly precomputed. */
  rendezvousId?: string
  seenAt: number
}

export type PresenceIndex = {
  record: (peerId: string, entry: Omit<PresenceEntry, 'seenAt'> & { seenAt?: number }) => void
  drop: (peerId: string) => void
  prune: (now?: number) => boolean
  isUserOnline: (userId: string | undefined, now?: number) => boolean
  peerIdForUserId: (userId: string) => string | undefined
  peerIdsForUserId: (userId: string) => string[]
  peerIdForEmailHash: (emailHash: string) => string | undefined
  peerIdsForEmailHash: (emailHash: string) => string[]
  peerIdsForRendezvousId: (rendezvousId: string) => string[]
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
  const peersByUserId = new Map<string, Set<string>>()
  const peersByEmailHash = new Map<string, Set<string>>()
  const peersByRendezvousId = new Map<string, Set<string>>()

  const removeFromIndex = (index: Map<string, Set<string>>, key: string, peerId: string) => {
    const peers = index.get(key)
    if (!peers) return
    peers.delete(peerId)
    if (peers.size === 0) index.delete(key)
  }

  const addToIndex = (index: Map<string, Set<string>>, key: string, peerId: string) => {
    const peers = index.get(key) ?? new Set<string>()
    peers.delete(peerId)
    peers.add(peerId)
    index.set(key, peers)
  }

  const drop = (peerId: string) => {
    const entry = byPeer.get(peerId)
    if (!entry) return
    byPeer.delete(peerId)
    removeFromIndex(peersByUserId, entry.userId, peerId)
    if (entry.emailHash) removeFromIndex(peersByEmailHash, entry.emailHash, peerId)
    if (entry.rendezvousId) removeFromIndex(peersByRendezvousId, entry.rendezvousId, peerId)
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
      const rendezvousId =
        typeof raw.rendezvousId === 'string' && raw.rendezvousId
          ? raw.rendezvousId
          : undefined
      const entry: PresenceEntry = {
        userId,
        name,
        ...(emailHash ? { emailHash } : {}),
        ...(rendezvousId ? { rendezvousId } : {}),
        seenAt: Number.isFinite(raw.seenAt) ? raw.seenAt! : Date.now(),
      }
      byPeer.set(peerId, entry)
      addToIndex(peersByUserId, userId, peerId)
      if (emailHash) addToIndex(peersByEmailHash, emailHash, peerId)
      if (rendezvousId) addToIndex(peersByRendezvousId, rendezvousId, peerId)
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
      return [...(peersByUserId.get(userId) ?? [])].some(peerId => {
        const entry = byPeer.get(peerId)
        return !!entry && now - entry.seenAt <= ttlMs
      })
    },
    peerIdForUserId: userId => [...(peersByUserId.get(userId) ?? [])].at(-1),
    peerIdsForUserId: userId => [...(peersByUserId.get(userId) ?? [])],
    peerIdForEmailHash: emailHash => [...(peersByEmailHash.get(emailHash.toLowerCase()) ?? [])].at(-1),
    peerIdsForEmailHash: emailHash => [...(peersByEmailHash.get(emailHash.toLowerCase()) ?? [])],
    peerIdsForRendezvousId: rendezvousId => [...(peersByRendezvousId.get(rendezvousId) ?? [])],
    get: peerId => byPeer.get(peerId),
    clear: () => {
      byPeer.clear()
      peersByUserId.clear()
      peersByEmailHash.clear()
      peersByRendezvousId.clear()
    },
    size: () => byPeer.size,
  }
}

export type PresencePayload = {
  userId: string
  name: string
  emailHash?: string
  rendezvousId?: string
}

export type ParsePresenceOptions = {
  /** When true, require a 64-char hex email hash (Peerly lobby). */
  requireEmailHash?: boolean
  requireRendezvousId?: boolean
}

const HEX64 = /^[0-9a-f]{64}$/i
const CAPABILITY = /^[A-Za-z0-9_-]{32,128}$/

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
  if (options.requireRendezvousId) {
    if (typeof msg.rendezvousId !== 'string' || !CAPABILITY.test(msg.rendezvousId)) return null
  } else if (msg.rendezvousId !== undefined) {
    if (typeof msg.rendezvousId !== 'string' || !CAPABILITY.test(msg.rendezvousId)) return null
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
    ...(typeof msg.rendezvousId === 'string' && CAPABILITY.test(msg.rendezvousId)
      ? { rendezvousId: msg.rendezvousId }
      : {}),
  }
}
