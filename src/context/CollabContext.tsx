import type { PeerHandshake } from '@trystero-p2p/core'
import type { SignedFields } from '../collab/messageSigning'
import type { SignedReactionFields } from '../collab/reactionSigning'
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
  workspaceName: string
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
  signReaction?: (fields: Omit<SignedReactionFields, 'actorDeviceKeyId'>) => Promise<{ actorDeviceKeyId: string; signature: string }>
  /** Live-handshake key bindings; gates identity claims in relayed history. */
  getBoundUserId?: (deviceKeyId: string) => string | undefined
  onProfileChange?: (profile: UserProfile & { avatarId?: string }) => void
  onChannelsChange?: () => void
  children: ReactNode
}

export function CollabProvider({
  workspaceId,
  workspaceName,
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
  signReaction,
  getBoundUserId,
  onProfileChange,
  onChannelsChange,
  children,
}: CollabProviderProps) {
  const collab = useCollab({
    workspaceId,
    workspaceName,
    activeChannelId: channelId,
    profile,
    workspaceSecret,
    onProfileChange,
    avatarId,
    channelIds,
    onChannelsChange,
    activeView,
    peerHandshake,
    identity: { selfUserId, resolvePeerUserId, signMessage, signReaction, getBoundUserId },
  })

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
      editMessage: collab.editMessage,
      deleteMessage: collab.deleteMessage,
      toggleReaction: collab.toggleReaction,
      sendFile: collab.sendFile,
      sendFiles: collab.sendFiles,
      flushHistory: collab.flushHistory,
      resetLocalHistory: collab.resetLocalHistory,
      markFileNsfw: collab.markFileNsfw,
      requestFile: collab.requestFile,
      syncProgress: collab.syncProgress,
      notificationsSupported: collab.notificationsSupported,
      notificationsEnabled: collab.notificationsEnabled,
      notificationPermission: collab.notificationPermission,
      enableNotifications: collab.enableNotifications,
      disableNotifications: collab.disableNotifications,
    }),
    [
      collab.messages,
      collab.sharedFiles,
      collab.transfers,
      collab.fileError,
      collab.unreadByChannel,
      collab.totalUnread,
      collab.sendMessage,
      collab.editMessage,
      collab.deleteMessage,
      collab.toggleReaction,
      collab.sendFile,
      collab.sendFiles,
      collab.flushHistory,
      collab.resetLocalHistory,
      collab.markFileNsfw,
      collab.requestFile,
      collab.syncProgress,
      collab.notificationsSupported,
      collab.notificationsEnabled,
      collab.notificationPermission,
      collab.enableNotifications,
      collab.disableNotifications,
    ]
  )

  const media = useMemo<MediaSlice>(
    () => ({
      inCall: collab.inCall,
      incomingCallPeerId: collab.incomingCallPeerId,
      localStream: collab.localStream,
      peerStreams: collab.peerStreams,
      videoEnabled: collab.videoEnabled,
      audioEnabled: collab.audioEnabled,
      screenSharing: collab.screenSharing,
      audioInputs: collab.audioInputs,
      videoInputs: collab.videoInputs,
      selectedAudioInput: collab.selectedAudioInput,
      selectedVideoInput: collab.selectedVideoInput,
      mediaError: collab.mediaError,
      startCall: collab.startCall,
      declineCall: collab.declineCall,
      endCall: collab.endCall,
      toggleVideo: collab.toggleVideo,
      toggleAudio: collab.toggleAudio,
      startScreenShare: collab.startScreenShare,
      stopScreenShare: collab.stopScreenShare,
      switchDevices: collab.switchDevices,
    }),
    [
      collab.inCall,
      collab.incomingCallPeerId,
      collab.localStream,
      collab.peerStreams,
      collab.videoEnabled,
      collab.audioEnabled,
      collab.screenSharing,
      collab.audioInputs,
      collab.videoInputs,
      collab.selectedAudioInput,
      collab.selectedVideoInput,
      collab.mediaError,
      collab.startCall,
      collab.declineCall,
      collab.endCall,
      collab.toggleVideo,
      collab.toggleAudio,
      collab.startScreenShare,
      collab.stopScreenShare,
      collab.switchDevices,
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
      announceChannelDeletion: collab.announceChannelDeletion,
    }),
    [collab.announceChannel, collab.announceChannelDeletion]
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
