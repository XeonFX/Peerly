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
  url: string
}

export type Peer = {
  id: string
  name: string
  color: string
  avatar?: string
}

export type ConnectionStatus = 'connecting' | 'ready' | 'connected' | 'error'

export type FileTransfer = {
  id: string
  name: string
  percent: number
  direction: 'send' | 'receive'
  peerId: string
}