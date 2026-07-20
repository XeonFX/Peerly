/**
 * Metadata-only visibility into P2P transfers. Applications deliberately pass
 * summaries, counts, and byte estimates — never message bodies or room secrets.
 */

export type SyncDirection = 'sent' | 'received'
export type SyncDataKind =
  | 'account-data'
  | 'board'
  | 'channels'
  | 'file'
  | 'history'
  | 'message'
  | 'profile'
  | 'reaction'

export type SyncRelationship =
  | 'approved-device'
  | 'friend'
  | 'workspace-member'
  | 'stranger'
  | 'unknown'

export type SyncPeer = {
  peerId?: string
  userId?: string
  deviceKeyId?: string
  name?: string
  avatar?: string
  deviceLabel?: string
  relationship: SyncRelationship
}

export type SyncActivity = {
  id: string
  at: number
  direction: SyncDirection
  kind: SyncDataKind
  peer: SyncPeer
  itemCount?: number
  bytes?: number
  /** Metadata-only wording such as "General · 12 messages". */
  summary: string
}

export type SyncActivityInput = Omit<SyncActivity, 'id' | 'at'> & { at?: number }

const MAX_ACTIVITIES = 200
const activities: SyncActivity[] = []
const listeners = new Set<(activity: SyncActivity) => void>()

function boundedInteger(value: number | undefined): number | undefined {
  return Number.isFinite(value) && value! >= 0 ? Math.floor(value!) : undefined
}

export function syncPayloadBytes(value: unknown): number {
  try {
    const json = typeof value === 'string' ? value : JSON.stringify(value)
    return new TextEncoder().encode(json ?? '').byteLength
  } catch {
    return 0
  }
}

export function recordSyncActivity(input: SyncActivityInput): SyncActivity {
  const activity: SyncActivity = {
    ...input,
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `sync-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    at: Number.isFinite(input.at) ? input.at! : Date.now(),
    itemCount: boundedInteger(input.itemCount),
    bytes: boundedInteger(input.bytes),
    summary: String(input.summary).slice(0, 160),
    peer: {
      relationship: input.peer.relationship,
      ...(input.peer.peerId ? { peerId: input.peer.peerId.slice(0, 256) } : {}),
      ...(input.peer.userId ? { userId: input.peer.userId.slice(0, 256) } : {}),
      ...(input.peer.deviceKeyId ? { deviceKeyId: input.peer.deviceKeyId.slice(0, 512) } : {}),
      ...(input.peer.name ? { name: input.peer.name.slice(0, 80) } : {}),
      ...(input.peer.avatar ? { avatar: input.peer.avatar.slice(0, 4096) } : {}),
      ...(input.peer.deviceLabel ? { deviceLabel: input.peer.deviceLabel.slice(0, 80) } : {}),
    },
  }
  activities.push(activity)
  if (activities.length > MAX_ACTIVITIES) activities.splice(0, activities.length - MAX_ACTIVITIES)
  for (const listener of listeners) listener(activity)
  return activity
}

export function getSyncActivities(): SyncActivity[] {
  return [...activities].reverse()
}

export function clearSyncActivities(): void {
  activities.length = 0
}

export function subscribeSyncActivities(listener: (activity: SyncActivity) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
