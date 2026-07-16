import type { Message, UserProfile } from '../types'

/** Wire format for live chat messages. */
export type ChatPayload = {
  id: string
  text: string
  senderId: string
  /**
   * Durable identity (see collab/userId). Never trusted from the wire: the
   * receiver overwrites it with the id verified during that peer's handshake.
   */
  senderUserId?: string
  senderName: string
  senderColor: string
  senderAvatar?: string
  timestamp: number
  channelId: string
  type: 'text'
}

/** Wire format for file transfer metadata. */
export type FileMetaPayload = {
  /**
   * SHA-256 of the file's bytes, hex-encoded (see utils/fileHash.ts) — not a
   * random id. `handleFileReceived` recomputes this hash and rejects the file
   * if it doesn't match, so no peer can serve different content under an id
   * than the id promises. Keep it derived from content if you touch this: a
   * random id here would silently reopen that hole.
   */
  id: string
  name: string
  mimeType: string
  size: number
  senderId: string
  senderName: string
  senderColor: string
  senderAvatar?: string
  timestamp: number
  channelId: string
}

export type HistoryFileMeta = {
  id: string
  name: string
  mimeType: string
  size: number
}

/** Serializable message for history sync and local persistence. */
export type HistoryEntry = {
  id: string
  text: string
  senderId: string
  senderName: string
  senderColor: string
  senderAvatar?: string
  timestamp: number
  channelId: string
  type: 'text' | 'file'
  fileMeta?: HistoryFileMeta
}

export type HistoryRequest = {
  channelId: string
}

/** Wire format for syncing custom workspace channels between peers. */
export type ChannelPayload = {
  id: string
  name: string
  description?: string
  kind?: 'channel' | 'dm'
  peerId?: string
}

export type CachedFile = {
  buffer: ArrayBuffer
  meta: FileMetaPayload
}

export const ACTION_IDS = {
  chat: 'chat',
  profile: 'profile',
  file: 'file',
  /** Joiner asks holders for specific file bodies it is missing. */
  fileRequest: 'file-req',
  historySync: 'history-sync',
  channelSync: 'channel-sync',
} as const

export type SenderFields = Pick<
  Message,
  'senderId' | 'senderName' | 'senderColor' | 'senderAvatar'
>

export function senderFromProfile(profile: UserProfile, senderId: string): SenderFields {
  return {
    senderId,
    senderName: profile.name,
    senderColor: profile.color,
    senderAvatar: profile.avatar,
  }
}