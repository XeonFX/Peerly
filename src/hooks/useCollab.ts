import type { PeerHandshake } from '@trystero-p2p/core'
import { selfId } from '../collab/identity'
import { loadSelfIds, rememberSelfId } from '../collab/selfIdRegistry'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { APP_ID, buildRoomId } from '../config'
import { routeDmChannel } from '../collab/dmStore'
import { FileCache } from '../collab/fileCache'
import type { ChatPayload } from '../protocol/types'
import type { Message, SharedFile, UserProfile } from '../types'
import { estimateBrowserStorage, hasRoomForWrite } from '../utils/browserStorage'
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
  activeView: 'channel' | 'profile' | 'workspace' = 'channel',
  peerHandshake?: PeerHandshake,
  identity?: {
    /** Durable id of the signed-in user; stamped into messages we send. */
    selfUserId?: string
    /**
     * Handshake-verified peerId -> user id. Live incoming messages take their
     * senderUserId from here and ONLY here — payload claims are discarded,
     * because any verified member could otherwise write history as someone
     * else. (Relayed history stays best-effort; it is unsigned either way.)
     */
    resolvePeerUserId?: (peerId: string) => string | undefined
  }
) {
  const roomId = buildRoomId(workspaceId)

  // Ids that were "me" in earlier sessions of this workspace. The current id is
  // registered for future sessions; this one resolves itself directly.
  const pastSelfIds = useMemo(
    () => loadSelfIds(workspaceId).filter(id => id !== selfId),
    [workspaceId]
  )
  useEffect(() => {
    rememberSelfId(workspaceId, selfId)
  }, [workspaceId])

  const activeChannelRef = useRef(activeChannelId)
  activeChannelRef.current = activeChannelId

  const identityRef = useRef(identity)
  identityRef.current = identity

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
  const fileCache = useMemo(() => new FileCache(), [])
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
  const {
    reset: resetPeers,
    bindProfileAction,
    unbindProfileAction,
    broadcastProfile,
  } = peers
  const channelSync = useChannelSync(workspaceId, onChannelsChange)
  const { bindChannelAction, unbindChannelAction } = channelSync
  const channelStore = useMultiChannelStore(workspaceId, activeChannelId, fileCache, channelIds)
  const { resetWorkspace, appendMessage, syncSenderProfiles } = channelStore
  const files = useFileTransfer(
    activeChannelId,
    profileRef,
    fileCache,
    channelStore.blobUrls,
    channelStore.upsertFileMessage
  )
  const {
    reset: resetFileTransfer,
    bindFileAction,
    bindFileRequestAction,
    bindFileMetaAction,
    unbindFileAction,
    unbindFileRequestAction,
    unbindFileMetaAction,
    sendFile: sendFileTransfer,
  } = files
  const history = useHistorySync(
    channelStore.getHistoryEntries,
    channelStore.applyHistory,
    channelIds,
    files.requestFilesFromPeers
  )
  const {
    reset: resetHistory,
    syncFromPeers,
    bindHistoryAction,
    unbindHistoryAction,
    progress: syncProgress,
  } = history
  const video = useVideoCall(room)
  const { reset: resetVideo } = video
  const chatAction = useRoomAction<ChatPayload>()
  const { bind: bindChatAction, unbind: unbindChatAction, send: sendChatPayload } = chatAction
  const { reset: resetConnection } = connection

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
        Object.values(channelStore.messagesByChannel).flat(),
        pastSelfIds,
        identity?.selfUserId
      ),
    [displayProfile, peers.peers, channelStore.messagesByChannel, pastSelfIds, identity?.selfUserId]
  )
  const senderDirectoryRef = useLatest(senderDirectory)
  const peersRef = useLatest(peers.peers)

  useEffect(() => {
    syncSenderProfiles(senderDirectory, peers.peers)
  }, [senderDirectory, peers.peers, syncSenderProfiles])

  const handlersRef = useRef<RoomProtocolHandlers>({
    onProfile: () => {},
    onChat: () => {},
    onFileProgress: () => {},
    onFile: () => {},
    onFileMeta: () => {},
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
      peers.upsertPeer(peerId, peerProfile, identityRef.current?.resolvePeerUserId?.(peerId))
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
      // senderId was stamped with the transport peerId by wireRoomProtocol, so
      // this lookup binds the message to the identity verified in that peer's
      // handshake. The payload's own senderUserId is deliberately not a
      // fallback: a verified member must not be able to write as someone else.
      const senderUserId = identityRef.current?.resolvePeerUserId?.(payload.senderId)
      channelStore.appendMessage(
        chatPayloadToMessage({ ...payload, senderUserId }),
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
    onFileMeta: (meta, peerId) => {
      const route = routeDmChannel(meta.channelId, selfId)
      if (route.kind === 'foreign-dm') return
      if (route.kind === 'dm' && peerId !== route.peerId) return
      void files.handleFileMeta(meta, peerId)
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
    resetPeers()
    resetWorkspace()
    resetFileTransfer()
    resetHistory()
    resetConnection()
    resetVideo()
  }, [
    workspaceId,
    fileCache,
    resetPeers,
    resetWorkspace,
    resetFileTransfer,
    resetHistory,
    resetConnection,
    resetVideo,
  ])

  useEffect(() => {
    const peerIds = room ? Object.keys(room.getPeers()) : []
    if (peerIds.length > 0) {
      void syncFromPeers(peerIds, [activeChannelId], true)
    }
  }, [activeChannelId, room, syncFromPeers])

  useEffect(() => {
    if (!room) return

    const stableHandlers: RoomProtocolHandlers = {
      onProfile: (...args) => handlersRef.current.onProfile(...args),
      onChat: (...args) => handlersRef.current.onChat(...args),
      onFileProgress: (...args) => handlersRef.current.onFileProgress(...args),
      onFile: (...args) => handlersRef.current.onFile(...args),
      onFileMeta: (...args) => handlersRef.current.onFileMeta(...args),
      onHistoryRequest: channelId => handlersRef.current.onHistoryRequest(channelId),
      onFileRequest: (...args) => handlersRef.current.onFileRequest(...args),
      onPeerJoin: (...args) => handlersRef.current.onPeerJoin(...args),
      onPeerLeave: (...args) => handlersRef.current.onPeerLeave(...args),
      onPeerStream: (...args) => handlersRef.current.onPeerStream(...args),
      onInitialPeers: (...args) => handlersRef.current.onInitialPeers(...args),
      onChannel: (...args) => handlersRef.current.onChannel(...args),
    }

    const cleanup = wireRoomProtocol(room, stableHandlers, {
      bindChatAction,
      bindProfileAction,
      bindFileAction,
      bindFileMetaAction,
      bindHistoryAction,
      bindChannelAction,
      bindFileRequestAction,
      broadcastProfile,
    })

    return () => {
      cleanup()
      unbindChatAction()
      unbindProfileAction()
      unbindFileAction()
      unbindFileMetaAction()
      unbindFileRequestAction()
      unbindHistoryAction()
      unbindChannelAction()
    }
  }, [
    room,
    bindChatAction,
    unbindChatAction,
    bindProfileAction,
    unbindProfileAction,
    bindFileAction,
    bindFileMetaAction,
    unbindFileAction,
    unbindFileMetaAction,
    bindFileRequestAction,
    unbindFileRequestAction,
    bindHistoryAction,
    unbindHistoryAction,
    bindChannelAction,
    unbindChannelAction,
    broadcastProfile,
  ])

  const sendMessage = useCallback(
    (text: string) => {
      const channelId = activeChannelRef.current
      const route = routeDmChannel(channelId, selfId)
      // Never broadcast a message meant for a DM we can't resolve a peer for.
      if (route.kind === 'foreign-dm') return

      const payload = createChatPayload(
        text,
        profileRef.current,
        selfId,
        channelId,
        identityRef.current?.selfUserId
      )
      const target = route.kind === 'dm' ? route.peerId : undefined
      void sendChatPayload(payload, target ? { target } : undefined)
      appendMessage(chatPayloadToMessage(payload), senderDirectoryRef.current)
    },
    // The narrow deps are the point: `channelStore` and `chatAction` are fresh
    // objects every render, and depending on them made sendMessage — and with
    // it the whole ChatSlice — churn per render.
    [sendChatPayload, appendMessage, profileRef, senderDirectoryRef]
  )

  const appendChannelMessage = useCallback(
    (message: Message) => {
      appendMessage(message, senderDirectoryRef.current, peersRef.current)
    },
    [appendMessage, senderDirectoryRef, peersRef]
  )

  const sendFile = useCallback(
    async (file: File) => {
      await sendFileTransfer(file, appendChannelMessage)
    },
    [appendChannelMessage, sendFileTransfer]
  )

  const requestFile = useCallback(
    async (file: SharedFile) => {
      if (file.url) return
      const estimate = await estimateBrowserStorage()
      if (!hasRoomForWrite(estimate, file.size)) {
        files.reportFileError('Not enough browser storage for this file. Free local space and try again.')
        return
      }
      const peerIds = room ? Object.keys(room.getPeers()) : []
      if (peerIds.length === 0) {
        files.reportFileError('This original is waiting for a peer who has it.')
        return
      }
      files.reportFileError(null)
      await files.requestFilesFromPeers(peerIds, [file.id])
    },
    [files, room]
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
    selfUserId: identity?.selfUserId,
    pastSelfIds,
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
    p2pCapability: connection.p2pCapability,
    retryP2pCapability: connection.retryP2pCapability,
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
    requestFile,
    syncProgress,
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
