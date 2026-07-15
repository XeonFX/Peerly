import type { Message, Peer, UserProfile } from '../types'
import { buildSenderDirectory, resolveSenderAvatar as resolveFromDirectory } from './senderDirectory'

export function peersById(peers: Peer[]): Record<string, Peer> {
  return Object.fromEntries(peers.map(peer => [peer.id, peer]))
}

export function resolveSenderAvatar(
  message: Pick<Message, 'senderId' | 'senderName' | 'senderColor' | 'senderAvatar'>,
  selfId: string,
  selfProfile: UserProfile,
  peerMap: Record<string, Peer>
): string | undefined {
  const peers = Object.values(peerMap)
  const directory = buildSenderDirectory(selfId, selfProfile, peers)
  return resolveFromDirectory(message, directory, peers)
}