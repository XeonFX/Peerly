import type { Message, ReactionRecord, UserProfile } from '../types'

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
  /** Author's device key (embeds the public key) — see collab/messageSigning. */
  senderDeviceKeyId?: string
  /** ECDSA signature over the signed fields; absent on legacy messages. */
  signature?: string
  deviceGrant?: import('../collab/deviceAuthorization').DeviceGrant
  senderName: string
  senderColor: string
  senderAvatar?: string
  timestamp: number
  editedAt?: number
  deletedAt?: number
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
  /**
   * Durable identity. Never trusted from the wire: receivers overwrite it with
   * the id verified in the sending peer's handshake (see useCollab handlers).
   */
  senderUserId?: string
  /** Author's device key (embeds the public key) — see collab/messageSigning. */
  senderDeviceKeyId?: string
  /** ECDSA signature over the signed fields; absent on legacy messages. */
  signature?: string
  senderName: string
  senderColor: string
  senderAvatar?: string
  timestamp: number
  channelId: string
  /** Small inline preview (data URL). Peer-supplied: sanitize before use. */
  thumbnail?: string
}

export type HistoryFileMeta = {
  id: string
  name: string
  mimeType: string
  size: number
  /** Peer-supplied when the entry came off the wire: sanitize before use. */
  thumbnail?: string
}

/** Serializable message for history sync and local persistence. */
export type HistoryEntry = {
  id: string
  text: string
  senderId: string
  /** Durable sender identity; best-effort in relayed history (unsigned). */
  senderUserId?: string
  /** Author's device key (embeds the public key) — see collab/messageSigning. */
  senderDeviceKeyId?: string
  /** ECDSA signature over the signed fields; absent on legacy messages. */
  signature?: string
  deviceGrant?: import('../collab/deviceAuthorization').DeviceGrant
  senderName: string
  senderColor: string
  senderAvatar?: string
  timestamp: number
  editedAt?: number
  deletedAt?: number
  reactions?: ReactionRecord[]
  channelId: string
  type: 'text' | 'file'
  fileMeta?: HistoryFileMeta
}

export type ReactionPayload = ReactionRecord & {
  messageId: string
  channelId: string
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
  operation?: 'upsert' | 'delete'
  updatedAt?: number
  order?: number
}

export type CachedFile = {
  buffer: ArrayBuffer
  meta: FileMetaPayload
}

export const ACTION_IDS = {
  chat: 'chat',
  profile: 'profile',
  file: 'file',
  /** Announces file metadata/thumbnail without pushing the original body. */
  fileMeta: 'file-meta',
  /** Joiner asks holders for specific file bodies it is missing. */
  fileRequest: 'file-req',
  historySync: 'history-sync',
  channelSync: 'channel-sync',
  reaction: 'reaction',
  /** "I hung up" — clears the callee's incoming banner without the 30s timeout. */
  callEnd: 'call-end',
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
