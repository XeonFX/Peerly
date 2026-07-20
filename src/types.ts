export type ChannelKind = 'channel' | 'dm'

export type Channel = {
  id: string
  name: string
  description: string
  kind: ChannelKind
  peerId?: string
  /** Last-write timestamp for best-effort P2P rename/reorder reconciliation. */
  updatedAt?: number
  /** Stable sort position for custom workspace channels. */
  order?: number
}

export type UserProfile = {
  name: string
  color: string
  avatar?: string
}

export type Message = {
  id: string
  text: string
  senderId: string
  /** Durable identity of the sender — stable across sessions and devices. */
  senderUserId?: string
  /** Author's device key (embeds the public key) — see collab/messageSigning. */
  senderDeviceKeyId?: string
  /** ECDSA signature over the signed fields; absent on legacy messages. */
  signature?: string
  /** Approval from the original device when this revision came from another device. */
  deviceGrant?: import('./collab/deviceAuthorization').DeviceGrant
  senderName: string
  senderColor: string
  senderAvatar?: string
  timestamp: number
  editedAt?: number
  deletedAt?: number
  reactions?: ReactionRecord[]
  channelId: string
  type: 'text' | 'file'
  file?: SharedFile
}

export type ReactionRecord = {
  emoji: string
  active: boolean
  actorId: string
  actorUserId?: string
  actorDeviceKeyId?: string
  signature?: string
  timestamp: number
}

export type SharedFile = {
  id: string
  name: string
  mimeType: string
  size: number
  /** Blob URL of the full body; '' until the body is fetched/cached locally. */
  url: string
  /** Small inline preview (data URL) that travels with metadata and history. */
  thumbnail?: string
  /** Flagged by the local NSFW screen on receipt; UI blurs until revealed. */
  nsfw?: boolean
}

export type Peer = {
  id: string
  /** Durable identity verified during this peer's handshake; never wire-claimed. */
  userId?: string
  /** Visible through the workspace relay, but not yet authenticated over P2P. */
  presenceOnly?: boolean
  name: string
  color: string
  avatar?: string
}

export type ConnectionStatus = 'connecting' | 'ready' | 'connected' | 'error'

// Moved to @peerly/core alongside probeP2pCapability.
export type { P2pCapability } from '@peerly/core'

export type FileTransfer = {
  id: string
  name: string
  percent: number
  direction: 'send' | 'receive'
  peerId: string
}

export type WorkspaceSyncProgress = {
  phase: 'idle' | 'history' | 'originals' | 'ready' | 'paused' | 'error'
  completedChannels: number
  totalChannels: number
  receivedEntries: number
  missingOriginals: number
  message?: string
}
