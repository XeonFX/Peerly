import { MAX_FILE_BYTES, MAX_HISTORY_ENTRIES } from '../collab/constants'
import { isEmailAllowed } from '../collab/allowList'
import {
  getCustomChannels,
  isValidChannelId,
  MAX_CUSTOM_CHANNELS,
  mergeWorkspaceChannel,
} from '../collab/channelStore'
import { sanitizeHistoryEntries } from '../collab/messageSigning'
import { rememberWorkspace, snapshotWorkspace, type StoredWorkspace } from '../collab/workspaceStore'
import { verifyInviteAllowList } from '../collab/workspaceAuth'
import { clampMessageText } from '../protocol/mappers'
import type { HistoryEntry } from '../protocol/types'
import type { Channel } from '../types'
import { safeThumbnailUrl } from './avatarUrl'
import { loadLocalHistory, saveLocalHistory } from './historyStorage'
import { historyEntryToMessage } from '../protocol/mappers'

/**
 * A workspace's local record as a file the user owns.
 *
 * Serverless means there is no archive to lean on: history lives in each
 * member's browser, capped at MAX_HISTORY_ENTRIES per channel, and a cleared
 * profile is gone. Export is the escape hatch — messages (with their author
 * signatures), channel structure, and workspace access.
 *
 * File BODIES are deliberately not included: they can be re-fetched from any
 * member who holds them, thumbnails already ride inside messages, and bundling
 * originals would turn a settings click into a multi-hundred-MB download.
 *
 * Import treats the file as untrusted input, exactly like an invite link: the
 * allow-list must verify against the creator key before any access entry is
 * written; text and metadata are bounded; signatures are verified; durable
 * identity claims are stripped because key→user bindings are trustworthy only
 * after a live handshake. History merges by message id, so importing can add
 * but never overwrite.
 */

export const BACKUP_FORMAT = 'peerly-workspace-backup'
export const BACKUP_VERSION = 1
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024

const MAX_MESSAGE_ID_CHARS = 256
const MAX_SENDER_ID_CHARS = 256
const MAX_DEVICE_KEY_ID_CHARS = 512
const MAX_SIGNATURE_CHARS = 512
const MAX_THUMBNAIL_CHARS = 512 * 1024

export type WorkspaceBackup = {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exportedAt: number
  workspace: Pick<StoredWorkspace, 'workspaceId' | 'workspaceName' | 'creatorKeyId' | 'allowList'>
  channels: Channel[]
  histories: Record<string, HistoryEntry[]>
}

export function buildWorkspaceBackup(workspace: StoredWorkspace): WorkspaceBackup {
  // DM ids are made from ephemeral transport ids, so they cannot be routed
  // safely after a reload or import. Export workspace channels only rather than
  // packaging private conversations that the importer cannot correctly reopen.
  const channels = getCustomChannels(workspace.workspaceId)
  const channelIds = new Set<string>(['general', ...channels.map(channel => channel.id)])

  const histories: Record<string, HistoryEntry[]> = {}
  for (const channelId of channelIds) {
    const entries = loadLocalHistory(workspace.workspaceId, channelId)
    if (entries.length > 0) histories[channelId] = entries
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    workspace: snapshotWorkspace({
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.workspaceName,
      creatorKeyId: workspace.creatorKeyId,
      allowList: workspace.allowList,
    }),
    channels,
    histories,
  }
}

export function backupFileName(workspaceName: string, now = new Date()): string {
  const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace'
  const stamp = now.toISOString().slice(0, 10)
  return `peerly-${slug}-${stamp}.json`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' && value.length <= maxLength ? value : undefined
}

function sanitizeEntry(raw: unknown, channelId: string): HistoryEntry | null {
  if (!isRecord(raw)) return null
  const id = boundedString(raw.id, MAX_MESSAGE_ID_CHARS)
  const senderId = boundedString(raw.senderId, MAX_SENDER_ID_CHARS)
  if (!id || !senderId) return null
  if (typeof raw.timestamp !== 'number' || !Number.isFinite(raw.timestamp)) return null
  if (raw.type !== 'text' && raw.type !== 'file') return null

  const entry: HistoryEntry = {
    id,
    text: clampMessageText(raw.text),
    senderId,
    senderUserId: boundedString(raw.senderUserId, MAX_MESSAGE_ID_CHARS),
    senderDeviceKeyId: boundedString(raw.senderDeviceKeyId, MAX_DEVICE_KEY_ID_CHARS),
    signature: boundedString(raw.signature, MAX_SIGNATURE_CHARS),
    senderName: typeof raw.senderName === 'string' ? raw.senderName.slice(0, 100) : 'Unknown',
    senderColor: typeof raw.senderColor === 'string' ? raw.senderColor.slice(0, 100) : '#ababad',
    senderAvatar: undefined,
    timestamp: raw.timestamp,
    channelId,
    type: raw.type,
  }
  if (raw.type === 'file') {
    if (!isRecord(raw.fileMeta)) return null
    const meta = raw.fileMeta
    const fileId = boundedString(meta.id, MAX_MESSAGE_ID_CHARS)
    if (!fileId || typeof meta.name !== 'string') return null
    const fileSize =
      typeof meta.size === 'number' &&
      Number.isFinite(meta.size) &&
      meta.size >= 0 &&
      meta.size <= MAX_FILE_BYTES
        ? meta.size
        : 0
    const thumbnail =
      typeof meta.thumbnail === 'string' && meta.thumbnail.length <= MAX_THUMBNAIL_CHARS
        ? safeThumbnailUrl(meta.thumbnail)
        : undefined
    entry.fileMeta = {
      id: fileId,
      name: meta.name.slice(0, 255),
      mimeType:
        typeof meta.mimeType === 'string'
          ? meta.mimeType.slice(0, 255)
          : 'application/octet-stream',
      size: fileSize,
      thumbnail,
    }
  }
  return entry
}

export type ImportResult = {
  workspaceName: string
  importedMessages: number
  importedChannels: number
}

export async function applyWorkspaceBackup(
  raw: unknown,
  expectedEmail?: string
): Promise<ImportResult> {
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT) {
    throw new Error('Not a Peerly workspace backup file')
  }
  if (raw.version !== BACKUP_VERSION) {
    throw new Error(`Unsupported backup version: ${String(raw.version)}`)
  }
  const workspace = raw.workspace
  if (
    !isRecord(workspace) ||
    typeof workspace.workspaceId !== 'string' ||
    typeof workspace.workspaceName !== 'string' ||
    typeof workspace.creatorKeyId !== 'string' ||
    !isRecord(workspace.allowList)
  ) {
    throw new Error('Backup is missing workspace access data')
  }

  // Same rule as invite links and the workspace store: access is granted only
  // by a list that verifies against the creator key — a backup file is no more
  // trustworthy than a pasted URL.
  const access = {
    workspaceId: workspace.workspaceId,
    workspaceName: workspace.workspaceName.slice(0, 100),
    creatorKeyId: workspace.creatorKeyId,
    allowList: workspace.allowList as StoredWorkspace['allowList'],
  }
  if (!(await verifyInviteAllowList(access))) {
    throw new Error('Backup allow-list signature does not verify — file rejected')
  }
  if (expectedEmail && !isEmailAllowed(access.allowList, expectedEmail)) {
    throw new Error(`${expectedEmail} is not invited to this backup's workspace`)
  }
  rememberWorkspace(snapshotWorkspace(access))

  let importedChannels = 0
  if (Array.isArray(raw.channels)) {
    const channels = raw.channels
      .filter(
        (channel): channel is Channel =>
          isRecord(channel) &&
          channel.kind !== 'dm' &&
          isValidChannelId(channel.id) &&
          typeof channel.name === 'string'
      )
      .slice(0, MAX_CUSTOM_CHANNELS)
    for (const channel of channels) {
      if (mergeWorkspaceChannel(access.workspaceId, channel)) importedChannels++
    }
  }

  let importedMessages = 0
  if (isRecord(raw.histories)) {
    const allowedChannelIds = new Set([
      'general',
      ...getCustomChannels(access.workspaceId).map(channel => channel.id),
    ])
    for (const [channelId, entriesRaw] of Object.entries(raw.histories).slice(
      0,
      MAX_CUSTOM_CHANNELS + 1
    )) {
      if (!allowedChannelIds.has(channelId) || !Array.isArray(entriesRaw)) continue
      const structurallySafe = entriesRaw
        .slice(-MAX_HISTORY_ENTRIES)
        .map(entry => sanitizeEntry(entry, channelId))
        .filter((entry): entry is HistoryEntry => entry !== null)
      // A backup cannot prove a device-key→person binding: that trust is earned
      // only during a live token + possession-proof handshake. Verification
      // still drops altered signed entries; valid/legacy entries keep their
      // content but lose any durable identity claim until the device is met.
      const entries = await sanitizeHistoryEntries(structurallySafe, () => undefined)

      const existing = loadLocalHistory(access.workspaceId, channelId)
      const byId = new Map(existing.map(entry => [entry.id, entry]))
      let addedMessages = 0
      for (const entry of entries) {
        if (!byId.has(entry.id)) {
          byId.set(entry.id, entry)
          addedMessages++
        }
      }
      const merged = [...byId.values()]
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-MAX_HISTORY_ENTRIES)
      const saved = saveLocalHistory(
        access.workspaceId,
        channelId,
        merged.map(entry => historyEntryToMessage(entry))
      )
      if (saved) importedMessages += addedMessages
    }
  }

  return {
    workspaceName: access.workspaceName,
    importedMessages,
    importedChannels,
  }
}
