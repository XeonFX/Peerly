import type { Message, Peer, UserProfile } from '../types'

export type SenderInfo = {
  name: string
  color: string
  avatar?: string
}

/**
 * Durable-identity entries share the sender-id record under a `user:` prefix.
 * Transport ids never contain a colon, so the namespaces cannot collide, and
 * every existing consumer of the record keeps working unchanged.
 */
export function userKey(userId: string): string {
  return `user:${userId}`
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
  pastSelfIds: string[] = [],
  selfUserId?: string
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
    if (peer.userId) {
      directory[userKey(peer.userId)] = peerInfo(peer)
    }
  }

  // After the peers so it wins a shared-id collision: if a peer carries my own
  // user id, that is me on another device, and "me" should render as this
  // device's live profile.
  if (selfUserId) {
    directory[userKey(selfUserId)] = self
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
  message: Pick<Message, 'senderId' | 'senderUserId' | 'senderName' | 'senderColor' | 'senderAvatar'>,
  directory: Record<string, SenderInfo>,
  peers: Peer[] = []
): SenderInfo {
  // Durable identity first: it survives refreshes and devices, and for live
  // messages it was stamped from the sender's verified handshake.
  const byUser = message.senderUserId ? directory[userKey(message.senderUserId)] : undefined
  if (byUser) {
    return {
      name: byUser.name,
      color: byUser.color,
      avatar: byUser.avatar || message.senderAvatar,
    }
  }

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
  message: Pick<Message, 'senderId' | 'senderUserId' | 'senderName' | 'senderColor' | 'senderAvatar'>,
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
    // Backfill the durable id when the transport id still matches a live peer:
    // this heals messages that raced the handshake's userId derivation.
    senderUserId:
      message.senderUserId ?? peers.find(peer => peer.id === message.senderId)?.userId,
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