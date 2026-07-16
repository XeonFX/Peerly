export type ChannelKind = 'channel' | 'dm'

export type Channel = {
  id: string
  name: string
  description: string
  kind: ChannelKind
  peerId?: string
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
  senderName: string
  senderColor: string
  senderAvatar?: string
  timestamp: number
  channelId: string
  type: 'text' | 'file'
  file?: SharedFile
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
  name: string
  color: string
  avatar?: string
}

export type ConnectionStatus = 'connecting' | 'ready' | 'connected' | 'error'

export type P2pCapability = {
  status: 'checking' | 'available' | 'unavailable'
  detail: string
}

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
