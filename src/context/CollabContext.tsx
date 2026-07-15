import type { PeerHandshake } from '@trystero-p2p/core'
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useCollab } from '../hooks/useCollab'
import type {
  Channel,
  ConnectionStatus,
  FileTransfer,
  Message,
  Peer,
  SharedFile,
  UserProfile,
} from '../types'

type CollabState = ReturnType<typeof useCollab>

export type ConnectionSlice = {
  connectionStatus: ConnectionStatus
  connectionError: string | null
  connectionNotice: string | null
  relayOnline: boolean
  rtcPeerCount: number
  roomId: string
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
  profile: UserProfile
  peers: Peer[]
  updateProfile: (next: Partial<UserProfile> & { avatarId?: string }) => void
  setAvatar: (file: File) => Promise<void>
  clearAvatar: () => Promise<void>
}

export type WorkspaceSlice = {
  announceChannel: (channel: Channel) => Promise<void>
}

const ConnectionContext = createContext<ConnectionSlice | null>(null)
const ChatContext = createContext<ChatSlice | null>(null)
const MediaContext = createContext<MediaSlice | null>(null)
const ProfileContext = createContext<ProfileSlice | null>(null)
const WorkspaceContext = createContext<WorkspaceSlice | null>(null)

type CollabProviderProps = {
  workspaceId: string
  channelId: string
  channelIds: string[]
  activeView: 'channel' | 'profile'
  profile: UserProfile
  avatarId?: string
  workspaceSecret?: string
  peerHandshake?: PeerHandshake
  onProfileChange?: (profile: UserProfile & { avatarId?: string }) => void
  onChannelsChange?: () => void
  children: ReactNode
}

function useSlice<T>(context: React.Context<T | null>, name: string): T {
  const value = useContext(context)
  if (!value) {
    throw new Error(`${name} must be used within CollabProvider`)
  }
  return value
}

export function CollabProvider({
  workspaceId,
  channelId,
  channelIds,
  activeView,
  profile,
  avatarId,
  workspaceSecret,
  peerHandshake,
  onProfileChange,
  onChannelsChange,
  children,
}: CollabProviderProps) {
  const collab = useCollab(
    workspaceId,
    channelId,
    profile,
    workspaceSecret,
    onProfileChange,
    avatarId,
    channelIds,
    onChannelsChange,
    activeView,
    peerHandshake
  )

  const connection = useMemo<ConnectionSlice>(
    () => ({
      connectionStatus: collab.connectionStatus,
      connectionError: collab.connectionError,
      connectionNotice: collab.connectionNotice,
      relayOnline: collab.relayOnline,
      rtcPeerCount: collab.rtcPeerCount,
      roomId: collab.roomId,
      relayUrls: collab.relayUrls,
      isReady: collab.isReady,
    }),
    [
      collab.connectionStatus,
      collab.connectionError,
      collab.connectionNotice,
      collab.relayOnline,
      collab.rtcPeerCount,
      collab.roomId,
      collab.relayUrls,
      collab.isReady,
    ]
  )

  const chat = useMemo<ChatSlice>(
    () => ({
      messages: collab.messages,
      sharedFiles: collab.sharedFiles,
      transfers: collab.transfers,
      fileError: collab.fileError,
      unreadByChannel: collab.unreadByChannel,
      totalUnread: collab.totalUnread,
      sendMessage: collab.sendMessage,
      sendFile: collab.sendFile,
    }),
    [
      collab.messages,
      collab.sharedFiles,
      collab.transfers,
      collab.fileError,
      collab.unreadByChannel,
      collab.totalUnread,
      collab.sendMessage,
      collab.sendFile,
    ]
  )

  const media = useMemo<MediaSlice>(
    () => ({
      inCall: collab.inCall,
      localStream: collab.localStream,
      peerStreams: collab.peerStreams,
      videoEnabled: collab.videoEnabled,
      audioEnabled: collab.audioEnabled,
      mediaError: collab.mediaError,
      startCall: collab.startCall,
      endCall: collab.endCall,
      toggleVideo: collab.toggleVideo,
      toggleAudio: collab.toggleAudio,
    }),
    [
      collab.inCall,
      collab.localStream,
      collab.peerStreams,
      collab.videoEnabled,
      collab.audioEnabled,
      collab.mediaError,
      collab.startCall,
      collab.endCall,
      collab.toggleVideo,
      collab.toggleAudio,
    ]
  )

  const profileSlice = useMemo<ProfileSlice>(
    () => ({
      selfId: collab.selfId,
      profile: collab.profile,
      peers: collab.peers,
      updateProfile: collab.updateProfile,
      setAvatar: collab.setAvatar,
      clearAvatar: collab.clearAvatar,
    }),
    [
      collab.selfId,
      collab.profile,
      collab.peers,
      collab.updateProfile,
      collab.setAvatar,
      collab.clearAvatar,
    ]
  )

  const workspaceSlice = useMemo<WorkspaceSlice>(
    () => ({
      announceChannel: collab.announceChannel,
    }),
    [collab.announceChannel]
  )

  return (
    <ConnectionContext.Provider value={connection}>
      <ChatContext.Provider value={chat}>
        <MediaContext.Provider value={media}>
          <ProfileContext.Provider value={profileSlice}>
            <WorkspaceContext.Provider value={workspaceSlice}>{children}</WorkspaceContext.Provider>
          </ProfileContext.Provider>
        </MediaContext.Provider>
      </ChatContext.Provider>
    </ConnectionContext.Provider>
  )
}

export function useConnectionSlice(): ConnectionSlice {
  return useSlice(ConnectionContext, 'useConnectionSlice')
}

export function useChatSlice(): ChatSlice {
  return useSlice(ChatContext, 'useChatSlice')
}

export function useMediaSlice(): MediaSlice {
  return useSlice(MediaContext, 'useMediaSlice')
}

export function useProfileSlice(): ProfileSlice {
  return useSlice(ProfileContext, 'useProfileSlice')
}

export function useWorkspaceSlice(): WorkspaceSlice {
  return useSlice(WorkspaceContext, 'useWorkspaceSlice')
}

/** @deprecated Prefer scoped hooks: useConnectionSlice, useChatSlice, useMediaSlice, useProfileSlice */
export function useCollabContext(): CollabState {
  const connection = useConnectionSlice()
  const chat = useChatSlice()
  const media = useMediaSlice()
  const profile = useProfileSlice()
  const workspace = useWorkspaceSlice()
  return { ...connection, ...chat, ...media, ...profile, ...workspace }
}