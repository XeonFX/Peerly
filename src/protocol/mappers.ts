import { safeThumbnailUrl } from '../utils/avatarUrl'
import type { Message, SharedFile } from '../types'
import type { ChatPayload, FileMetaPayload, HistoryEntry } from './types'

export function chatPayloadToMessage(payload: ChatPayload): Message {
  return { ...payload, type: 'text' }
}

export function messageFromFileMeta(meta: FileMetaPayload, url: string): Message {
  return {
    id: meta.id,
    text: `Shared ${meta.name}`,
    senderId: meta.senderId,
    senderName: meta.senderName,
    senderColor: meta.senderColor,
    senderAvatar: meta.senderAvatar,
    timestamp: meta.timestamp,
    channelId: meta.channelId,
    type: 'file',
    file: {
      id: meta.id,
      name: meta.name,
      mimeType: meta.mimeType,
      size: meta.size,
      url,
      thumbnail: safeThumbnailUrl(meta.thumbnail),
    },
  }
}

export function toHistoryEntry(message: Message): HistoryEntry {
  const entry: HistoryEntry = {
    id: message.id,
    text: message.text,
    senderId: message.senderId,
    senderUserId: message.senderUserId,
    senderName: message.senderName,
    senderColor: message.senderColor,
    senderAvatar: message.senderAvatar,
    timestamp: message.timestamp,
    channelId: message.channelId,
    type: message.type,
  }

  if (message.type === 'file' && message.file) {
    entry.fileMeta = {
      id: message.file.id,
      name: message.file.name,
      mimeType: message.file.mimeType,
      size: message.file.size,
      thumbnail: message.file.thumbnail,
    }
  }

  return entry
}

export function historyEntryToMessage(entry: HistoryEntry, url?: string): Message {
  if (entry.type === 'file' && entry.fileMeta) {
    const file: SharedFile = {
      id: entry.fileMeta.id,
      name: entry.fileMeta.name,
      mimeType: entry.fileMeta.mimeType,
      size: entry.fileMeta.size,
      url: url ?? '',
      thumbnail: safeThumbnailUrl(entry.fileMeta.thumbnail),
    }
    return {
      id: entry.id,
      text: entry.text,
      senderId: entry.senderId,
      senderUserId: entry.senderUserId,
      senderName: entry.senderName,
      senderColor: entry.senderColor,
      senderAvatar: entry.senderAvatar,
      timestamp: entry.timestamp,
      channelId: entry.channelId,
      type: 'file',
      file,
    }
  }

  return {
    id: entry.id,
    text: entry.text,
    senderId: entry.senderId,
    senderUserId: entry.senderUserId,
    senderName: entry.senderName,
    senderColor: entry.senderColor,
    senderAvatar: entry.senderAvatar,
    timestamp: entry.timestamp,
    channelId: entry.channelId,
    type: 'text',
  }
}

export function fileMetaFromHistoryEntry(entry: HistoryEntry): FileMetaPayload | null {
  if (entry.type !== 'file' || !entry.fileMeta) return null
  return {
    id: entry.fileMeta.id,
    name: entry.fileMeta.name,
    mimeType: entry.fileMeta.mimeType,
    size: entry.fileMeta.size,
    thumbnail: entry.fileMeta.thumbnail,
    senderId: entry.senderId,
    senderName: entry.senderName,
    senderColor: entry.senderColor,
    senderAvatar: entry.senderAvatar,
    timestamp: entry.timestamp,
    channelId: entry.channelId,
  }
}