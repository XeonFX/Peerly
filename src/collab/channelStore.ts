import { normalizeWorkspaceId } from '../config'
import { loadWorkspaceDms } from './dmStore'
import type { Channel } from '../types'

export const GENERAL_CHANNEL: Channel = {
  id: 'general',
  name: 'general',
  description: 'Workspace-wide chat',
  kind: 'channel',
}

const STORAGE_PREFIX = 'flux-channels-'

export const MAX_CHANNEL_NAME_LENGTH = 48

/**
 * Channels arrive from peers and are persisted, so cap how many a peer can add.
 * Without this, one peer can fill another's localStorage quota.
 */
export const MAX_CUSTOM_CHANNELS = 100

/**
 * Channel ids become localStorage key suffixes (`flux-history-<ws>__<id>`), so
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

  const custom = loadCustomChannels(workspaceId)
  if (custom.some(entry => entry.id === channel.id)) return false
  if (custom.length >= MAX_CUSTOM_CHANNELS) return false

  saveCustomChannels(workspaceId, [
    ...custom,
    {
      id: channel.id,
      name: String(channel.name).slice(0, MAX_CHANNEL_NAME_LENGTH),
      description: String(channel.description ?? '').slice(0, MAX_CHANNEL_NAME_LENGTH * 4),
      kind: 'channel',
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
  }
  saveCustomChannels(workspaceId, [...custom, channel])
  return channel
}