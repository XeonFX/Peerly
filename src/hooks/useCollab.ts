import type { PeerHandshake } from '@trystero-p2p/core'
import { selfId } from '../collab/identity'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { APP_ID, buildRoomId } from '../config'
import { routeDmChannel } from '../collab/dmStore'
import { FileCache } from '../collab/fileCache'
import type { ChatPayload } from '../protocol/types'
import type { Message, UserProfile } from '../types'
import { buildSenderDirectory } from '../utils/senderDirectory'
import { useLatest } from './useLatest'
import { chatPayloadToMessage, createChatPayload } from './collab/wireRoomProtocol'
import type { RoomProtocolHandlers } from './collab/wireRoomProtocol'
import { useChannelSync } from './collab/useChannelSync'
import { useUnreadCounts } from './collab/useUnreadCounts'
import { useConnectionHealth } from './collab/useConnectionHealth'
import { useFileTransfer } from './collab/useFileTransfer'
import { useHistorySync } from './collab/useHistorySync'
import { useMultiChannelStore } from './collab/useMultiChannelStore'
import { usePeerProfiles } from './collab/usePeerProfiles'
import { useProfileManager } from './collab/useProfileManager'
import { useRoomAction } from './collab/useRoomAction'
import { useVideoCall } from './collab/useVideoCall'
import { wireRoomProtocol } from './collab/wireRoomProtocol'
import { useRoom } from './useRoom'

export function useCollab(
  workspaceId: string,
  activeChannelId: string,
  profile: UserProfile,
  workspaceSecret?: string,
  onProfileChange?: (profile: UserProfile & { avatarId?: string }) => void,
  avatarId?: string,
  channelIds: string[] = ['general'],
  onChannelsChange?: () => void,
  activeView: 'channel' | 'profile' = 'channel',
  peerHandshake?: PeerHandshake
) {
  const roomId = buildRoomId(workspaceId)
  const activeChannelRef = useRef(activeChannelId)
  activeChannelRef.current = activeChannelId

  const [displayProfile, setDisplayProfile] = useState(profile)

  useEffect(() => {
    setDisplayProfile(profile)
  }, [profile])

  const handleProfileChange = useCallback(
    (next: UserProfile & { avatarId?: string }) => {
      setDisplayProfile({
        name: next.name,
        color: next.color,
        avatar: next.avatar,
      })
      onProfileChange?.(next)
    },
    [onProfileChange]
  )

  const profileRef = useLatest(displayProfile)
  const fileCache = useMemo(() => new FileCache(), [workspaceId])
  const setErrorRef = useRef<(message: string) => void>(() => {})

  const { room } = useRoom(
    APP_ID,
    roomId,
    workspaceSecret ?? '',
    message => setErrorRef.current(message),
    peerHandshake
  )

  const connection = useConnectionHealth(room)
  setErrorRef.current = connection.setError

  const peers = usePeerProfiles(displayProfile)
  const channelSync = useChannelSync(workspaceId, onChannelsChange)
  const channelStore = useMultiChannelStore(workspaceId, activeChannelId, fileCache, channelIds)
  const files = useFileTransfer(
    activeChannelId,
    profileRef,
    fileCache,
    channelStore.blobUrls,
    channelStore.upsertFileMessage
  )
  const history = useHistorySync(
    channelStore.getHistoryEntries,
    channelStore.applyHistory,
    channelIds,
    files.requestFilesFromPeers
  )
  const video = useVideoCall(room)
  const chatAction = useRoomAction<ChatPayload>()

  const profileManager = useProfileManager(displayProfile, avatarId, handleProfileChange)
  const unread = useUnreadCounts(
    workspaceId,
    channelStore.messagesByChannel,
    channelIds,
    activeChannelId,
    activeView,
    selfId
  )

  const senderDirectory = useMemo(
    () =>
      buildSenderDirectory(
        selfId,
        displayProfile,
        peers.peers,
        Object.values(channelStore.messagesByChannel).flat()
      ),
    [displayProfile, peers.peers, channelStore.messagesByChannel]
  )
  const senderDirectoryRef = useLatest(senderDirectory)
  const peersRef = useLatest(peers.peers)

  useEffect(() => {
    channelStore.syncSenderProfiles(senderDirectory, peers.peers)
  }, [senderDirectory, peers.peers, channelStore])

  const handlersRef = useRef<RoomProtocolHandlers>({
    onProfile: () => {},
    onChat: () => {},
    onFileProgress: () => {},
    onFile: () => {},
    onHistoryRequest: () => [],
    onFileRequest: () => {},
    onPeerJoin: () => {},
    onPeerLeave: () => {},
    onPeerStream: () => {},
    onInitialPeers: () => {},
    onChannel: () => {},
  })

  handlersRef.current = {
    onProfile: (peerProfile, peerId) => {
      peers.upsertPeer(peerId, peerProfile)
      connection.markConnected()
    },
    onChat: payload => {
      const route = routeDmChannel(payload.channelId, selfId)
      if (route.kind === 'foreign-dm') return
      if (
        route.kind === 'dm' &&
        payload.senderId !== route.peerId &&
        payload.senderId !== selfId
      ) {
        return
      }
      channelStore.appendMessage(
        chatPayloadToMessage(payload),
        senderDirectoryRef.current,
        peersRef.current
      )
    },
    onFileProgress: (percent, peerId, meta) => {
      files.handleReceiveProgress(percent, peerId, meta)
    },
    onFile: (data, meta) => {
      const route = routeDmChannel(meta.channelId, selfId)
      if (route.kind === 'foreign-dm') return
      if (route.kind === 'dm' && meta.senderId !== route.peerId && meta.senderId !== selfId) {
        return
      }
      files.handleFileReceived(data, meta)
    },
    onHistoryRequest: channelId => channelStore.getHistoryEntries(channelId),
    onFileRequest: (fileIds, peerId) => {
      void files.handleFileRequest(fileIds, peerId)
    },
    onPeerJoin: peerId => {
      peers.upsertPeer(peerId)
      connection.markConnected()
      // History sync pulls whatever file bodies this peer is actually missing;
      // no blanket re-send of every cached file to every joiner.
      void history.syncFromPeers([peerId])
      void channelSync.broadcastAllToPeer(peerId)
      video.onPeerJoin(peerId)
    },
    onPeerLeave: peerId => {
      peers.removePeer(peerId)
      history.onPeerLeave(peerId)
      video.onPeerLeave(peerId)
    },
    onPeerStream: (stream, peerId) => {
      video.onPeerStream(stream, peerId)
    },
    onInitialPeers: peerIds => {
      connection.setRtcPeerCount(peerIds.length)
      connection.setConnectionStatus(peerIds.length > 0 ? 'connected' : 'ready')
      if (peerIds.length > 0) {
        void history.syncFromPeers(peerIds)
        for (const peerId of peerIds) {
          void channelSync.broadcastAllToPeer(peerId)
        }
      }
    },
    onChannel: (payload, peerId) => {
      channelSync.handleChannel(payload, peerId)
    },
  }

  useEffect(() => {
    fileCache.clear()
    peers.reset()
    channelStore.resetWorkspace()
    files.reset()
    history.reset()
    connection.reset()
    video.reset()
  }, [workspaceId])

  useEffect(() => {
    const peerIds = room ? Object.keys(room.getPeers()) : []
    if (peerIds.length > 0) {
      void history.syncFromPeers(peerIds, [activeChannelId], true)
    }
  }, [activeChannelId, room])

  useEffect(() => {
    if (!room) return

    const stableHandlers: RoomProtocolHandlers = {
      onProfile: (...args) => handlersRef.current.onProfile(...args),
      onChat: (...args) => handlersRef.current.onChat(...args),
      onFileProgress: (...args) => handlersRef.current.onFileProgress(...args),
      onFile: (...args) => handlersRef.current.onFile(...args),
      onHistoryRequest: channelId => handlersRef.current.onHistoryRequest(channelId),
      onFileRequest: (...args) => handlersRef.current.onFileRequest(...args),
      onPeerJoin: (...args) => handlersRef.current.onPeerJoin(...args),
      onPeerLeave: (...args) => handlersRef.current.onPeerLeave(...args),
      onPeerStream: (...args) => handlersRef.current.onPeerStream(...args),
      onInitialPeers: (...args) => handlersRef.current.onInitialPeers(...args),
      onChannel: (...args) => handlersRef.current.onChannel(...args),
    }

    const cleanup = wireRoomProtocol(
      room,
      stableHandlers,
      {
        bindChatAction: chatAction.bind,
        bindProfileAction: peers.bindProfileAction,
        bindFileAction: files.bindFileAction,
        bindHistoryAction: history.bindHistoryAction,
        bindChannelAction: channelSync.bindChannelAction,
        bindFileRequestAction: files.bindFileRequestAction,
        broadcastProfile: peers.broadcastProfile,
      }
    )

    return () => {
      cleanup()
      chatAction.unbind()
      peers.unbindProfileAction()
      files.unbindFileAction()
      files.unbindFileRequestAction()
      history.unbindHistoryAction()
      channelSync.unbindChannelAction()
    }
  }, [room])

  const sendMessage = useCallback(
    (text: string) => {
      const channelId = activeChannelRef.current
      const route = routeDmChannel(channelId, selfId)
      // Never broadcast a message meant for a DM we can't resolve a peer for.
      if (route.kind === 'foreign-dm') return

      const payload = createChatPayload(text, profileRef.current, selfId, channelId)
      const target = route.kind === 'dm' ? route.peerId : undefined
      void chatAction.send(payload, target ? { target } : undefined)
      channelStore.appendMessage(chatPayloadToMessage(payload), senderDirectoryRef.current)
    },
    [channelStore, chatAction, profileRef]
  )

  const appendChannelMessage = useCallback(
    (message: Message) => {
      channelStore.appendMessage(message, senderDirectoryRef.current, peersRef.current)
    },
    [channelStore]
  )

  const sendFile = useCallback(
    async (file: File) => {
      await files.sendFile(file, appendChannelMessage)
    },
    [appendChannelMessage, files]
  )

  const sharedFiles = useMemo(
    () =>
      channelStore.messages
        .filter(message => message.type === 'file' && message.file)
        .map(message => message.file!),
    [channelStore.messages]
  )

  return {
    selfId,
    profile: displayProfile,
    peers: peers.peers,
    messages: channelStore.messages,
    sharedFiles,
    transfers: files.transfers,
    fileError: files.fileError,
    connectionStatus: connection.connectionStatus,
    connectionError: connection.connectionError,
    connectionNotice: connection.connectionNotice,
    relayOnline: connection.relayOnline,
    rtcPeerCount: connection.rtcPeerCount,
    roomId,
    relayUrls: connection.relayUrls,
    isReady: connection.isReady,
    inCall: video.inCall,
    localStream: video.localStream,
    peerStreams: video.peerStreams,
    videoEnabled: video.videoEnabled,
    audioEnabled: video.audioEnabled,
    mediaError: video.mediaError,
    sendMessage,
    sendFile,
    startCall: video.startCall,
    endCall: video.endCall,
    toggleVideo: video.toggleVideo,
    toggleAudio: video.toggleAudio,
    updateProfile: profileManager.updateProfile,
    setAvatar: profileManager.setAvatar,
    clearAvatar: profileManager.clearAvatar,
    announceChannel: channelSync.announceChannel,
    unreadByChannel: unread.unreadByChannel,
    totalUnread: unread.totalUnread,
  }
}