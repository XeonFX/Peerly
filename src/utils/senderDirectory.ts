import type { Message, Peer, UserProfile } from '../types'

export type SenderInfo = {
  name: string
  color: string
  avatar?: string
}

function peerInfo(peer: Peer): SenderInfo {
  return {
    name: peer.name,
    color: peer.color,
    avatar: peer.avatar,
  }
}

function findPeerForMessage(message: Pick<Message, 'senderId' | 'senderName'>, peers: Peer[]) {
  return peers.find(peer => peer.id === message.senderId) ?? peers.find(peer => peer.name === message.senderName)
}

export function buildSenderDirectory(
  selfId: string,
  selfProfile: UserProfile,
  peers: Peer[],
  messages: Message[] = [],
  pastSelfIds: string[] = []
): Record<string, SenderInfo> {
  const self: SenderInfo = {
    name: selfProfile.name,
    color: selfProfile.color,
    avatar: selfProfile.avatar,
  }

  // Past-session ids were also "me": selfId changes every page load, so our own
  // pre-refresh messages would otherwise freeze at their stored snapshot (peers
  // recover via the name fallback below, but we are not in the peers list).
  const directory: Record<string, SenderInfo> = { [selfId]: self }
  for (const id of pastSelfIds) {
    directory[id] = self
  }

  for (const peer of peers) {
    directory[peer.id] = peerInfo(peer)
  }

  for (const message of messages) {
    const peer = findPeerForMessage(message, peers)
    if (!peer) continue

    const info = peerInfo(peer)
    if (!directory[message.senderId]) {
      directory[message.senderId] = info
    }
    if (!directory[peer.id]) {
      directory[peer.id] = info
    }
  }

  return directory
}

export function resolveSenderInfo(
  message: Pick<Message, 'senderId' | 'senderName' | 'senderColor' | 'senderAvatar'>,
  directory: Record<string, SenderInfo>,
  peers: Peer[] = []
): SenderInfo {
  const direct = directory[message.senderId]
  if (direct) {
    return {
      name: direct.name,
      color: direct.color,
      avatar: direct.avatar || message.senderAvatar,
    }
  }

  const peer = findPeerForMessage(message, peers)
  if (peer) {
    return {
      name: peer.name,
      color: peer.color,
      avatar: peer.avatar || message.senderAvatar,
    }
  }

  return {
    name: message.senderName,
    color: message.senderColor,
    avatar: message.senderAvatar,
  }
}

export function resolveSenderAvatar(
  message: Pick<Message, 'senderId' | 'senderName' | 'senderColor' | 'senderAvatar'>,
  directory: Record<string, SenderInfo>,
  peers: Peer[] = []
): string | undefined {
  return resolveSenderInfo(message, directory, peers).avatar
}

export function enrichMessage(
  message: Message,
  directory: Record<string, SenderInfo>,
  peers: Peer[] = []
): Message {
  const sender = resolveSenderInfo(message, directory, peers)

  return {
    ...message,
    senderName: sender.name,
    senderColor: sender.color,
    senderAvatar: sender.avatar || message.senderAvatar,
  }
}

export function enrichMessages(
  messages: Message[],
  directory: Record<string, SenderInfo>,
  peers: Peer[] = []
): Message[] {
  return messages.map(message => enrichMessage(message, directory, peers))
}