import { normalizeWorkspaceId } from '../config'
import type { Channel, Peer } from '../types'

export const DM_PREFIX = 'dm-'
const DM_SEP = '::'
const STORAGE_PREFIX = 'peerly-dms-'

function storageKey(workspaceId: string): string {
  return `${STORAGE_PREFIX}${normalizeWorkspaceId(workspaceId)}`
}

export function buildDmChannelId(selfId: string, peerId: string): string {
  const [first, second] = [selfId, peerId].sort()
  return `${DM_PREFIX}${first}${DM_SEP}${second}`
}

export function isDmChannelId(channelId: string): boolean {
  return channelId.startsWith(DM_PREFIX)
}

/** The other participant, or null if this isn't a DM or we aren't in it. */
export function getDmPeerId(channelId: string, selfId: string): string | null {
  if (!isDmChannelId(channelId)) return null
  const body = channelId.slice(DM_PREFIX.length)
  const splitAt = body.indexOf(DM_SEP)
  if (splitAt === -1) return null

  const first = body.slice(0, splitAt)
  const second = body.slice(splitAt + DM_SEP.length)
  if (first === selfId) return second
  if (second === selfId) return first
  return null
}

/**
 * How a channel id should be routed for this user. `getDmPeerId` alone is
 * ambiguous — null means both "ordinary channel" and "someone else's DM", and
 * callers that treat it as falsy fail open on the second. Make the cases
 * explicit so a DM between two other peers is impossible to handle by accident.
 */
export type DmRouting =
  | { kind: 'channel' }
  | { kind: 'dm'; peerId: string }
  | { kind: 'foreign-dm' }

export function routeDmChannel(channelId: string, selfId: string): DmRouting {
  if (!isDmChannelId(channelId)) return { kind: 'channel' }
  const peerId = getDmPeerId(channelId, selfId)
  return peerId ? { kind: 'dm', peerId } : { kind: 'foreign-dm' }
}

function loadDmChannels(workspaceId: string): Channel[] {
  try {
    const raw = localStorage.getItem(storageKey(workspaceId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as Channel[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      channel =>
        channel.kind === 'dm' &&
        isDmChannelId(channel.id) &&
        typeof channel.peerId === 'string' &&
        typeof channel.name === 'string'
    )
  } catch {
    return []
  }
}

function saveDmChannels(workspaceId: string, channels: Channel[]) {
  localStorage.setItem(storageKey(workspaceId), JSON.stringify(channels))
}

export function loadWorkspaceDms(workspaceId: string): Channel[] {
  return loadDmChannels(workspaceId)
}

export function createDmChannel(peer: Peer, selfId: string): Channel {
  return {
    id: buildDmChannelId(selfId, peer.id),
    name: peer.name,
    description: 'Private conversation',
    kind: 'dm',
    peerId: peer.id,
  }
}

export function ensureDmChannel(workspaceId: string, peer: Peer, selfId: string): Channel {
  const channel = createDmChannel(peer, selfId)
  const existing = loadDmChannels(workspaceId).find(entry => entry.id === channel.id)
  if (existing) {
    return { ...existing, name: peer.name }
  }
  saveDmChannels(workspaceId, [...loadDmChannels(workspaceId), channel])
  return channel
}

export function mergeDmChannel(workspaceId: string, channel: Channel): boolean {
  if (channel.kind !== 'dm' || !channel.peerId || !isDmChannelId(channel.id)) return false

  const dms = loadDmChannels(workspaceId)
  if (dms.some(entry => entry.id === channel.id)) return false

  saveDmChannels(workspaceId, [
    ...dms,
    {
      id: channel.id,
      name: channel.name,
      description: channel.description ?? 'Private conversation',
      kind: 'dm',
      peerId: channel.peerId,
    },
  ])
  return true
}

/** Closing a DM is local UI state; the peer keeps their copy and can message again. */
export function removeDmChannel(workspaceId: string, channelId: string): boolean {
  const dms = loadDmChannels(workspaceId)
  if (!dms.some(channel => channel.id === channelId)) return false
  saveDmChannels(workspaceId, dms.filter(channel => channel.id !== channelId))
  return true
}
