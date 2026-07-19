import type { PeerHandshake } from '@trystero-p2p/core'
import { selfId } from '../collab/identity'
import { loadSelfIds, rememberSelfId } from '../collab/selfIdRegistry'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { APP_ID, buildRoomId } from '../config'
import { routeDmChannel } from '../collab/dmStore'
import { FileCache } from '../collab/fileCache'
import type { ChatPayload, ReactionPayload } from '../protocol/types'
import type { Message, SharedFile, UserProfile } from '../types'
import { estimateBrowserStorageCached, hasRoomForWrite } from '../utils/browserStorage'
import { sanitizeHistoryEntries, type SignedFields } from '../collab/messageSigning'
import type { SignedReactionFields } from '../collab/reactionSigning'
import { verifyReaction } from '../collab/reactionSigning'
import { buildSenderDirectory } from '../utils/senderDirectory'
import { useLatest } from './useLatest'
import { chatPayloadToMessage, clampMessageText, createChatPayload } from './collab/wireRoomProtocol'
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
import { useAttention } from './useAttention'
import { messageFromFileMeta } from '../protocol/mappers'

export type UseCollabOptions = {
  workspaceId: string
  workspaceName: string
  activeChannelId: string
  profile: UserProfile
  workspaceSecret?: string
  onProfileChange?: (profile: UserProfile & { avatarId?: string }) => void
  avatarId?: string
  channelIds?: string[]
  onChannelsChange?: () => void
  activeView?: 'channel' | 'profile' | 'workspace'
  peerHandshake?: PeerHandshake
  /** True once the signed-in ID token is past exp — see useIdentityExpiry. */
  identityExpired?: boolean
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
    /** Signs outgoing messages; see collab/messageSigning. */
    signMessage?: (fields: Omit<SignedFields, 'senderDeviceKeyId'>) => Promise<{ senderDeviceKeyId: string; signature: string }>
    signReaction?: (fields: Omit<SignedReactionFields, 'actorDeviceKeyId'>) => Promise<{ actorDeviceKeyId: string; signature: string }>
    /** Live-handshake key→user bindings for verifying relayed history. */
    getBoundUserId?: (deviceKeyId: string) => string | undefined
  }
}

export function useCollab({
  workspaceId,
  workspaceName,
  activeChannelId,
  profile,
  workspaceSecret,
  onProfileChange,
  avatarId,
  channelIds = ['general'],
  onChannelsChange,
  activeView = 'channel',
  peerHandshake,
  identity,
  identityExpired = false,
}: UseCollabOptions) {
  // An expired ID token means every handshake we answer presents a dead
  // credential — each newcomer rejects us and logs an error storm on both
  // sides. Leaving the room (empty roomId joins nothing) is honest: this
  // device cannot be verified right now. Re-auth restores the id and rejoins.
  const roomId = identityExpired ? '' : buildRoomId(workspaceId)

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

  // With the room gone, the health poller stops running — clear its last
  // snapshot or the sidebar would keep claiming a connection that ended.
  const resetConnectionOnExpiry = connection.reset
  useEffect(() => {
    if (identityExpired) resetConnectionOnExpiry()
  }, [identityExpired, resetConnectionOnExpiry])

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
  const {
    resetWorkspace,
    appendMessage,
    applyMessageRevision,
    applyReaction,
    syncSenderProfiles,
    setFileNsfw,
    flushHistory,
  } = channelStore
  const files = useFileTransfer(
    activeChannelId,
    profileRef,
    identityRef,
    fileCache,
    channelStore.blobUrls,
    channelStore.upsertFileMessage,
    setFileNsfw
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
  const sanitizeEntries = useCallback(
    (entries: Parameters<typeof sanitizeHistoryEntries>[0]) =>
      sanitizeHistoryEntries(entries, deviceKeyId =>
        identityRef.current?.getBoundUserId?.(deviceKeyId)
      ),
    []
  )
  const history = useHistorySync(
    channelStore.getHistoryEntries,
    channelStore.applyHistory,
    channelIds,
    files.requestFilesFromPeers,
    sanitizeEntries
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
  const reactionAction = useRoomAction<ReactionPayload>()
  const {
    bind: bindReactionAction,
    unbind: unbindReactionAction,
    send: sendReactionPayload,
  } = reactionAction
  const callEndAction = useRoomAction<true>()
  const {
    bind: bindCallEndAction,
    unbind: unbindCallEndAction,
    send: sendCallEnd,
  } = callEndAction
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
  const attention = useAttention(unread.totalUnread, workspaceName)
  const notifyDirectMessageRef = useLatest(attention.notifyDirectMessage)

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
    onPeerCallEnd: () => {},
    onInitialPeers: () => {},
    onChannel: () => {},
    onReaction: () => {},
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
      const message = chatPayloadToMessage({ ...payload, senderUserId })
      if (message.editedAt || message.deletedAt) applyMessageRevision(message)
      else channelStore.appendMessage(message, senderDirectoryRef.current, peersRef.current)
      if (route.kind === 'dm') notifyDirectMessageRef.current(message)
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
      files.handleFileReceived(data, {
        ...meta,
        senderUserId: identityRef.current?.resolvePeerUserId?.(meta.senderId),
      })
    },
    onFileMeta: (meta, peerId) => {
      const route = routeDmChannel(meta.channelId, selfId)
      if (route.kind === 'foreign-dm') return
      if (route.kind === 'dm' && peerId !== route.peerId) return
      // Same rule as onChat: the durable id comes from the peer's verified
      // handshake or not at all — never from the payload.
      const safeMeta = {
        ...meta,
        senderUserId: identityRef.current?.resolvePeerUserId?.(peerId),
      }
      void files.handleFileMeta(safeMeta, peerId).then(() => {
        if (route.kind === 'dm') notifyDirectMessageRef.current(messageFromFileMeta(safeMeta, ''))
      })
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
    onPeerCallEnd: peerId => {
      video.onPeerCallEnd(peerId)
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
    onReaction: (payload, peerId) => {
      const route = routeDmChannel(payload.channelId, selfId)
      if (route.kind === 'foreign-dm' || (route.kind === 'dm' && route.peerId !== peerId)) return
      const actorUserId = identityRef.current?.resolvePeerUserId?.(peerId)
      void (async () => {
        // Verify exactly what was signed before replacing the claimed identity
        // with the one established by this live peer's handshake.
        if (!(await verifyReaction(payload, payload.messageId, payload.channelId))) return
        if (payload.actorUserId && actorUserId !== payload.actorUserId) return
        const boundUserId = payload.actorDeviceKeyId
          ? identityRef.current?.getBoundUserId?.(payload.actorDeviceKeyId)
          : undefined
        if (
          boundUserId &&
          actorUserId &&
          boundUserId !== actorUserId
        ) {
          return
        }
        const reaction = { ...payload, actorId: peerId, actorUserId }
        applyReaction(payload.messageId, payload.channelId, reaction)
      })()
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
      onPeerCallEnd: (...args) => handlersRef.current.onPeerCallEnd(...args),
      onInitialPeers: (...args) => handlersRef.current.onInitialPeers(...args),
      onChannel: (...args) => handlersRef.current.onChannel(...args),
      onReaction: (...args) => handlersRef.current.onReaction(...args),
    }

    const cleanup = wireRoomProtocol(room, stableHandlers, {
      bindChatAction,
      bindProfileAction,
      bindFileAction,
      bindFileMetaAction,
      bindHistoryAction,
      bindChannelAction,
      bindFileRequestAction,
      bindReactionAction,
      bindCallEndAction,
      broadcastProfile,
    })

    return () => {
      cleanup()
      unbindChatAction()
      unbindCallEndAction()
      unbindProfileAction()
      unbindFileAction()
      unbindFileMetaAction()
      unbindFileRequestAction()
      unbindHistoryAction()
      unbindChannelAction()
      unbindReactionAction()
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
    bindReactionAction,
    unbindReactionAction,
    bindCallEndAction,
    unbindCallEndAction,
    broadcastProfile,
  ])

  const sendMessage = useCallback(
    (rawText: string) => {
      const text = clampMessageText(rawText)
      if (!text) return
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

      // Sign before anything leaves or persists, so our local copy is the same
      // relayable artifact peers will verify (~1–2 ms; see messageSigning).
      void (async () => {
        const signer = identityRef.current?.signMessage
        const signed = signer
          ? {
              ...payload,
              ...(await signer({
                id: payload.id,
                type: 'text',
                text: payload.text,
                senderUserId: payload.senderUserId,
                timestamp: payload.timestamp,
                channelId: payload.channelId,
              })),
            }
          : payload
        void sendChatPayload(signed, target ? { target } : undefined)
        appendMessage(chatPayloadToMessage(signed), senderDirectoryRef.current)
      })()
    },
    // The narrow deps are the point: `channelStore` and `chatAction` are fresh
    // objects every render, and depending on them made sendMessage — and with
    // it the whole ChatSlice — churn per render.
    [sendChatPayload, appendMessage, profileRef, senderDirectoryRef]
  )

  const reviseMessage = useCallback(
    (messageId: string, nextText: string | null) => {
      const existing = channelStore.messages.find(message => message.id === messageId)
      if (!existing || existing.type !== 'text') return
      const selfUserId = identityRef.current?.selfUserId
      const ownMessage = selfUserId
        ? existing.senderUserId === selfUserId
        : existing.senderId === selfId || pastSelfIds.includes(existing.senderId)
      if (!ownMessage) return
      const channelId = existing.channelId
      const route = routeDmChannel(channelId, selfId)
      if (route.kind === 'foreign-dm') return
      const now = Date.now()
      const payload: ChatPayload = {
        id: existing.id,
        text: nextText === null ? '' : clampMessageText(nextText),
        senderId: selfId,
        senderUserId: selfUserId,
        senderName: profileRef.current.name,
        senderColor: profileRef.current.color,
        senderAvatar: profileRef.current.avatar,
        timestamp: existing.timestamp,
        editedAt: nextText === null ? existing.editedAt : now,
        deletedAt: nextText === null ? now : undefined,
        channelId,
        type: 'text',
      }
      void (async () => {
        const signer = identityRef.current?.signMessage
        const signed = signer
          ? {
              ...payload,
              ...(await signer({
                id: payload.id,
                type: 'text',
                text: payload.text,
                senderUserId: payload.senderUserId,
                timestamp: payload.timestamp,
                channelId: payload.channelId,
                editedAt: payload.editedAt,
                deletedAt: payload.deletedAt,
              })),
            }
          : payload
        const target = route.kind === 'dm' ? route.peerId : undefined
        await sendChatPayload(signed, target ? { target } : undefined)
        applyMessageRevision(chatPayloadToMessage(signed))
      })()
    },
    [applyMessageRevision, channelStore.messages, pastSelfIds, profileRef, sendChatPayload]
  )

  const editMessage = useCallback(
    (messageId: string, text: string) => reviseMessage(messageId, text),
    [reviseMessage]
  )
  const deleteMessage = useCallback(
    (messageId: string) => reviseMessage(messageId, null),
    [reviseMessage]
  )

  const toggleReaction = useCallback(
    (messageId: string, emoji: string) => {
      if (!['👍', '❤️', '😂', '🎉'].includes(emoji)) return
      const message = channelStore.messages.find(entry => entry.id === messageId)
      const signer = identityRef.current?.signReaction
      if (!message || message.deletedAt || !signer) return
      const channelId = message.channelId
      const route = routeDmChannel(channelId, selfId)
      if (route.kind === 'foreign-dm') return
      const actorUserId = identityRef.current?.selfUserId
      const existing = message.reactions?.find(
        reaction =>
          reaction.emoji === emoji &&
          (actorUserId ? reaction.actorUserId === actorUserId : reaction.actorId === selfId)
      )
      void (async () => {
        const timestamp = Date.now()
        const signed = await signer({
          messageId,
          channelId,
          emoji,
          active: !existing?.active,
          actorUserId,
          timestamp,
        })
        const payload: ReactionPayload = {
          messageId,
          channelId,
          emoji,
          active: !existing?.active,
          actorId: selfId,
          actorUserId,
          timestamp,
          ...signed,
        }
        const target = route.kind === 'dm' ? route.peerId : undefined
        await sendReactionPayload(payload, target ? { target } : undefined)
        applyReaction(messageId, channelId, payload)
      })()
    },
    [applyReaction, channelStore.messages, sendReactionPayload]
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

  const sendFiles = useCallback(
    async (selectedFiles: File[]) => {
      // Bound peak memory and thumbnail inference by processing a multi-file
      // selection in order rather than loading all originals at once.
      for (const file of selectedFiles) {
        await sendFileTransfer(file, appendChannelMessage)
      }
    },
    [appendChannelMessage, sendFileTransfer]
  )

  const requestFile = useCallback(
    async (file: SharedFile, channelId: string) => {
      if (file.url) return
      const estimate = await estimateBrowserStorageCached()
      if (!hasRoomForWrite(estimate, file.size)) {
        files.reportFileError('Not enough browser storage for this file. Free local space and try again.')
        return
      }
      // A DM attachment is asked for from the DM peer alone: broadcasting the
      // request tells every member a DM contains a file with that hash.
      const route = routeDmChannel(channelId, selfId)
      if (route.kind === 'foreign-dm') return
      const connected = room ? Object.keys(room.getPeers()) : []
      const peerIds =
        route.kind === 'dm' ? connected.filter(id => id === route.peerId) : connected
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
    messagesByChannel: channelStore.messagesByChannel,
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
    callMode: video.callMode,
    incomingCallPeerId: video.incomingCallPeerId,
    localStream: video.localStream,
    peerStreams: video.peerStreams,
    videoEnabled: video.videoEnabled,
    audioEnabled: video.audioEnabled,
    screenSharing: video.screenSharing,
    audioInputs: video.audioInputs,
    videoInputs: video.videoInputs,
    audioOutputs: video.audioOutputs,
    selectedAudioInput: video.selectedAudioInput,
    selectedVideoInput: video.selectedVideoInput,
    selectedAudioOutput: video.selectedAudioOutput,
    mediaError: video.mediaError,
    sendMessage,
    editMessage,
    deleteMessage,
    toggleReaction,
    sendFile,
    sendFiles,
    requestFile,
    flushHistory,
    resetLocalHistory: resetWorkspace,
    markFileNsfw: setFileNsfw,
    syncProgress,
    startCall: video.startCall,
    joinCall: video.joinCall,
    declineCall: video.declineCall,
    // Tell peers first: without the explicit signal, a cancelled call sits on
    // the callee's screen until the 30s incoming-call timeout (the fallback
    // for peers that crash instead of hanging up).
    endCall: () => {
      void sendCallEnd(true)
      video.endCall()
    },
    toggleVideo: video.toggleVideo,
    toggleAudio: video.toggleAudio,
    enableCamera: video.enableCamera,
    startScreenShare: video.startScreenShare,
    stopScreenShare: video.stopScreenShare,
    switchDevices: video.switchDevices,
    setAudioOutput: video.setAudioOutput,
    updateProfile: profileManager.updateProfile,
    setAvatar: profileManager.setAvatar,
    clearAvatar: profileManager.clearAvatar,
    announceChannel: channelSync.announceChannel,
    announceChannelDeletion: channelSync.announceChannelDeletion,
    unreadByChannel: unread.unreadByChannel,
    totalUnread: unread.totalUnread,
    notificationsSupported: attention.notificationsSupported,
    notificationsEnabled: attention.notificationsEnabled,
    notificationPermission: attention.notificationPermission,
    enableNotifications: attention.enableNotifications,
    disableNotifications: attention.disableNotifications,
    soundsEnabled: attention.soundsEnabled,
    enableSounds: attention.enableSounds,
    disableSounds: attention.disableSounds,
  }
}
