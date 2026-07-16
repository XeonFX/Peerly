import type { useCollab } from '../hooks/useCollab'
import type { Channel, ConnectionStatus, FileTransfer, Message, P2pCapability, Peer, SharedFile, UserProfile, WorkspaceSyncProgress } from '../types'

export type CollabState = ReturnType<typeof useCollab>

export type ConnectionSlice = {
  connectionStatus: ConnectionStatus
  connectionError: string | null
  connectionNotice: string | null
  relayOnline: boolean
  rtcPeerCount: number
  p2pCapability: P2pCapability
  retryP2pCapability: () => void
  relayUrls: string[]
  isReady: boolean
}

export type ChatSlice = {
  messages: Message[]
  sharedFiles: SharedFile[]
  transfers: FileTransfer[]
  fileError: string | null
  unreadByChannel: Record<string, number>
  totalUnread: number
  sendMessage: (text: string) => void
  sendFile: (file: File) => Promise<void>
  requestFile: (file: SharedFile, channelId: string) => Promise<void>
  /** Persist every in-memory channel before backup/export or navigation. */
  flushHistory: () => void
  /** Drop in-memory history after the local persistent copy is cleared. */
  resetLocalHistory: () => void
  /** Persist a screening verdict so a file is classified once per device. */
  markFileNsfw: (fileId: string, nsfw: boolean) => void
  syncProgress: WorkspaceSyncProgress
}

export type MediaSlice = {
  inCall: boolean
  localStream: MediaStream | null
  peerStreams: Record<string, MediaStream>
  videoEnabled: boolean
  audioEnabled: boolean
  mediaError: string | null
  startCall: () => Promise<void>
  endCall: () => void
  toggleVideo: () => void
  toggleAudio: () => void
}

export type ProfileSlice = {
  selfId: string
  /** Durable id of the signed-in user (hash of OIDC iss+sub). */
  selfUserId?: string
  /** Ids that were "me" in earlier sessions — see collab/selfIdRegistry. */
  pastSelfIds: string[]
  profile: UserProfile
  peers: Peer[]
  updateProfile: (next: Partial<UserProfile> & { avatarId?: string }) => void
  setAvatar: (file: File) => Promise<void>
  clearAvatar: () => Promise<void>
}

export type WorkspaceSlice = {
  announceChannel: (channel: Channel) => Promise<void>
}
