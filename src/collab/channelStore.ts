import { normalizeWorkspaceId } from '../config'
import { loadWorkspaceDms } from './dmStore'
import type { Channel } from '../types'

export const GENERAL_CHANNEL: Channel = {
  id: 'general',
  name: 'general',
  description: 'Workspace-wide chat',
  kind: 'channel',
}

const STORAGE_PREFIX = 'peerly-channels-'
const TOMBSTONE_PREFIX = 'peerly-channel-tombstones-'

export const MAX_CHANNEL_NAME_LENGTH = 48

/**
 * Channels arrive from peers and are persisted, so cap how many a peer can add.
 * Without this, one peer can fill another's localStorage quota.
 */
export const MAX_CUSTOM_CHANNELS = 100

/**
 * Channel ids become localStorage key suffixes (`peerly-history-<ws>__<id>`), so
 * a peer-supplied id must not be free-form text. Matches what slugify produces.
 */
const CHANNEL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export function isValidChannelId(id: unknown): id is string {
  return typeof id === 'string' && CHANNEL_ID_PATTERN.test(id)
}

export function slugifyChannelName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'channel'
}

function storageKey(workspaceId: string): string {
  return `${STORAGE_PREFIX}${normalizeWorkspaceId(workspaceId)}`
}

function tombstoneKey(workspaceId: string): string {
  return `${TOMBSTONE_PREFIX}${normalizeWorkspaceId(workspaceId)}`
}

function loadTombstones(workspaceId: string): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(tombstoneKey(workspaceId)) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, number>)
      : {}
  } catch {
    return {}
  }
}

function saveTombstones(workspaceId: string, tombstones: Record<string, number>): void {
  localStorage.setItem(tombstoneKey(workspaceId), JSON.stringify(tombstones))
}

function loadCustomChannels(workspaceId: string): Channel[] {
  try {
    const raw = localStorage.getItem(storageKey(workspaceId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as Channel[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        channel =>
          channel.id !== GENERAL_CHANNEL.id &&
          channel.kind !== 'dm' &&
          typeof channel.id === 'string' &&
          typeof channel.name === 'string'
      )
      .map(channel => ({
        ...channel,
        kind: 'channel' as const,
        description: channel.description ?? '',
      }))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  } catch {
    return []
  }
}

function saveCustomChannels(workspaceId: string, channels: Channel[]) {
  localStorage.setItem(storageKey(workspaceId), JSON.stringify(channels))
}

export function getCustomChannels(workspaceId: string): Channel[] {
  return loadCustomChannels(workspaceId)
}

export function loadWorkspaceChannels(workspaceId: string): Channel[] {
  return [GENERAL_CHANNEL, ...loadCustomChannels(workspaceId)]
}

export function loadAllWorkspaceChannels(workspaceId: string): Channel[] {
  return [...loadWorkspaceChannels(workspaceId), ...loadWorkspaceDms(workspaceId)]
}

export function mergeWorkspaceChannel(workspaceId: string, channel: Channel): boolean {
  if (channel.id === GENERAL_CHANNEL.id || channel.kind === 'dm') return false
  if (!isValidChannelId(channel.id)) return false

  const incomingUpdatedAt = Number.isFinite(channel.updatedAt) ? channel.updatedAt! : 0
  const tombstonedAt = loadTombstones(workspaceId)[channel.id]
  if (tombstonedAt !== undefined && tombstonedAt >= incomingUpdatedAt) return false

  const custom = loadCustomChannels(workspaceId)
  const existingIndex = custom.findIndex(entry => entry.id === channel.id)
  if (existingIndex !== -1) {
    const existing = custom[existingIndex]
    if ((existing.updatedAt ?? 0) >= incomingUpdatedAt) return false
    const next = [...custom]
    next[existingIndex] = {
      ...existing,
      name: String(channel.name).slice(0, MAX_CHANNEL_NAME_LENGTH),
      description: String(channel.description ?? '').slice(0, MAX_CHANNEL_NAME_LENGTH * 4),
      updatedAt: incomingUpdatedAt,
      order: Number.isFinite(channel.order) ? channel.order : existing.order,
    }
    saveCustomChannels(workspaceId, next)
    return true
  }
  if (custom.length >= MAX_CUSTOM_CHANNELS) return false

  saveCustomChannels(workspaceId, [
    ...custom,
    {
      id: channel.id,
      name: String(channel.name).slice(0, MAX_CHANNEL_NAME_LENGTH),
      description: String(channel.description ?? '').slice(0, MAX_CHANNEL_NAME_LENGTH * 4),
      kind: 'channel',
      updatedAt: incomingUpdatedAt,
      order: Number.isFinite(channel.order) ? channel.order : custom.length,
    },
  ])
  return true
}

export function getChannelById(channels: Channel[], channelId: string): Channel {
  return channels.find(channel => channel.id === channelId) ?? GENERAL_CHANNEL
}

export function channelIds(channels: Channel[]): string[] {
  return channels.map(channel => channel.id)
}

export function addWorkspaceChannel(workspaceId: string, rawName: string): Channel | null {
  const name = rawName.trim()
  if (!name) return null

  const id = slugifyChannelName(name)
  if (id === GENERAL_CHANNEL.id) return null

  const custom = loadCustomChannels(workspaceId)
  if (custom.some(channel => channel.id === id)) {
    return custom.find(channel => channel.id === id) ?? null
  }

  const channel: Channel = {
    id,
    name,
    description: '',
    kind: 'channel',
    updatedAt: Date.now(),
    order: custom.length,
  }
  saveCustomChannels(workspaceId, [...custom, channel])
  return channel
}

export function renameWorkspaceChannel(
  workspaceId: string,
  channelId: string,
  rawName: string
): Channel | null {
  const name = rawName.trim().slice(0, MAX_CHANNEL_NAME_LENGTH)
  if (!name || channelId === GENERAL_CHANNEL.id) return null
  const custom = loadCustomChannels(workspaceId)
  const index = custom.findIndex(channel => channel.id === channelId)
  if (index === -1) return null
  const updated = { ...custom[index], name, updatedAt: Date.now() }
  const next = [...custom]
  next[index] = updated
  saveCustomChannels(workspaceId, next)
  return updated
}

export function moveWorkspaceChannel(
  workspaceId: string,
  channelId: string,
  direction: -1 | 1
): Channel[] {
  const custom = loadCustomChannels(workspaceId).sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  )
  const index = custom.findIndex(channel => channel.id === channelId)
  const target = index + direction
  if (index === -1 || target < 0 || target >= custom.length) return custom
  ;[custom[index], custom[target]] = [custom[target], custom[index]]
  const now = Date.now()
  const reordered = custom.map((channel, order) => ({ ...channel, order, updatedAt: now }))
  saveCustomChannels(workspaceId, reordered)
  return reordered
}

export function removeWorkspaceChannel(
  workspaceId: string,
  channelId: string,
  deletedAt = Date.now()
): boolean {
  if (channelId === GENERAL_CHANNEL.id || !isValidChannelId(channelId)) return false
  const custom = loadCustomChannels(workspaceId)
  const exists = custom.some(channel => channel.id === channelId)
  const tombstones = loadTombstones(workspaceId)
  if ((tombstones[channelId] ?? 0) >= deletedAt) return false
  tombstones[channelId] = deletedAt
  saveTombstones(workspaceId, tombstones)
  if (exists) saveCustomChannels(workspaceId, custom.filter(channel => channel.id !== channelId))
  return true
}
