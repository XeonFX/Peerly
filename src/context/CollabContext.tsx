import type { PeerHandshake } from '@trystero-p2p/core'
import type { SignedFields } from '../collab/messageSigning'
import { useMemo, type ReactNode } from 'react'
import { useCollab } from '../hooks/useCollab'
import type { UserProfile } from '../types'
import {
  ChatContext,
  ConnectionContext,
  MediaContext,
  ProfileContext,
  WorkspaceContext,
} from './collabContexts'
import type { ChatSlice, ConnectionSlice, MediaSlice, ProfileSlice, WorkspaceSlice } from './collabTypes'

export type {
  ChatSlice,
  CollabState,
  ConnectionSlice,
  MediaSlice,
  ProfileSlice,
  WorkspaceSlice,
} from './collabTypes'

type CollabProviderProps = {
  workspaceId: string
  channelId: string
  channelIds: string[]
  activeView: 'channel' | 'profile' | 'workspace'
  profile: UserProfile
  avatarId?: string
  workspaceSecret?: string
  peerHandshake?: PeerHandshake
  /** Durable id of the signed-in user; stamped into messages we send. */
  selfUserId?: string
  /** Handshake-verified peerId -> user id; the only trusted source for peers. */
  resolvePeerUserId?: (peerId: string) => string | undefined
  /** Signs outgoing messages so relayed history is tamper-evident. */
  signMessage?: (fields: Omit<SignedFields, 'senderDeviceKeyId'>) => Promise<{ senderDeviceKeyId: string; signature: string }>
  /** Live-handshake key bindings; gates identity claims in relayed history. */
  getBoundUserId?: (deviceKeyId: string) => string | undefined
  onProfileChange?: (profile: UserProfile & { avatarId?: string }) => void
  onChannelsChange?: () => void
  children: ReactNode
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
  selfUserId,
  resolvePeerUserId,
  signMessage,
  getBoundUserId,
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
    peerHandshake,
    { selfUserId, resolvePeerUserId, signMessage, getBoundUserId }
  )

  const connection = useMemo<ConnectionSlice>(
    () => ({
      connectionStatus: collab.connectionStatus,
      connectionError: collab.connectionError,
      connectionNotice: collab.connectionNotice,
      relayOnline: collab.relayOnline,
      rtcPeerCount: collab.rtcPeerCount,
      p2pCapability: collab.p2pCapability,
      retryP2pCapability: collab.retryP2pCapability,
      relayUrls: collab.relayUrls,
      isReady: collab.isReady,
    }),
    [
      collab.connectionStatus,
      collab.connectionError,
      collab.connectionNotice,
      collab.relayOnline,
      collab.rtcPeerCount,
      collab.p2pCapability,
      collab.retryP2pCapability,
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
      markFileNsfw: collab.markFileNsfw,
      requestFile: collab.requestFile,
      syncProgress: collab.syncProgress,
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
      collab.markFileNsfw,
      collab.requestFile,
      collab.syncProgress,
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
      selfUserId: collab.selfUserId,
      pastSelfIds: collab.pastSelfIds,
      profile: collab.profile,
      peers: collab.peers,
      updateProfile: collab.updateProfile,
      setAvatar: collab.setAvatar,
      clearAvatar: collab.clearAvatar,
    }),
    [
      collab.selfId,
      collab.selfUserId,
      collab.pastSelfIds,
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
