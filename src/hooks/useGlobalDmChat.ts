import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMessageOutbox } from './useMessageOutbox'
import {
  ALLOWED_REACTIONS,
  DEFAULT_HISTORY_CAP,
  PRESENCE_INTERVAL_MS,
  recordSyncActivity,
  signTextChat,
  signTextReaction,
  syncPayloadBytes,
  verifyTextChat,
  verifyTextReaction,
  type RelayChannelAction,
} from '@peerly/core'
import { useHistoryPersistence, useConversationState, useDurableChannel, useLatest, useRoom } from '@peerly/core/react'
import type { DeviceIdentity } from '../collab/deviceIdentity'
import { LOBBY_APP_ID } from '../collab/mesh'
import {
  loadGlobalDmHistory,
  loadGlobalDmReactions,
  mergeGlobalDmMessages,
  mergeGlobalDmReactions,
  saveGlobalDmHistory,
  upsertGlobalDmMessage,
  type GlobalDmMessage,
  type GlobalDmReaction,
} from '../collab/globalDmHistory'
import type { LobbyProfile } from './usePresenceLobby'
import { CONTENT_BACKEND, PUBLIC_NETWORK_ENV } from '../config'
import { findAuthorizingDeviceGrant, findDeviceGrant, grantAuthorizes, verifyDeviceGrant } from '../collab/deviceAuthorization'
import { MAX_FILE_BYTES, FILE_TOO_LARGE_ERROR } from '../collab/constants'
import { hashFileBytes, fileContentMatchesId } from '../utils/fileHash'
import { safeFileMimeType } from '../utils/fileType'
import { makeMediaThumbnail } from '../utils/imageThumbnail'
import { loadFileBlob, saveFileBlob } from '../utils/fileStore'
import { BlobUrlRegistry } from '../utils/blobUrls'
import { safeThumbnailUrl } from '../utils/avatarUrl'
import { authorizeDmContent } from '../realtime/content'

const CHAT_SCHEME = 'peerly-gdm-v2'
const MAX_TEXT = 4000
const PRIVATE_HANDSHAKE_TIMEOUT_MS = 12_000

export type GlobalDmTransfer = {
  id: string
  name: string
  percent: number
  direction: 'send' | 'receive'
}

export type GlobalDmChatOptions = {
  roomCode: string | null
  identity: DeviceIdentity | null
  profile: LobbyProfile | null
  friendUserId: string | null
  /** Device key captured by the accepted friend credential. */
  friendDeviceKeyId: string | null
  friendName: string | null
  /** Ring friend on lobby so they join this room. */
  ringFriend?: (reason: 'open' | 'message', preview?: string) => boolean
}

/**
 * 1:1 friend DM over a private Trystero room (code from dmRoomCode).
 * History is device-local; live peers can also push their history snapshot.
 */
export function useGlobalDmChat({
  roomCode,
  identity,
  profile,
  friendUserId,
  friendDeviceKeyId,
  friendName,
  ringFriend,
}: GlobalDmChatOptions) {
  const profileRef = useLatest(profile)
  const identityRef = useLatest(identity)
  const ringFriendRef = useLatest(ringFriend)
  const friendUserIdRef = useLatest(friendUserId)
  const friendDeviceKeyIdRef = useLatest(friendDeviceKeyId)
  const friendNameRef = useLatest(friendName)
  const roomCodeRef = useLatest(roomCode)

  const scope = profile?.userId && roomCode ? `${profile.userId}:${roomCode}` : null
  const [messages, setMessages, isCurrentConversation] = useConversationState<GlobalDmMessage[]>(scope, () => [])
  const [reactions, setReactions] = useConversationState<GlobalDmReaction[]>(scope, () => [])
  const [historyReady, setHistoryReady] = useConversationState(scope, () => false)
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({})
  const [transfers, setTransfers] = useState<GlobalDmTransfer[]>([])
  const [peerCount, setPeerCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const reactionsRef = useRef(reactions)
  reactionsRef.current = reactions
  const blobUrlsRef = useRef(new BlobUrlRegistry())
  /** Messages composed before Trystero actions have been bound to this room. */
  const pendingOutboundRef = useRef<GlobalDmMessage[]>([])
  const pendingOutboundRoomRef = useRef<string | null>(null)

  useEffect(() => () => blobUrlsRef.current.revokeAll(), [])

  const materializeAttachment = useCallback(async (attachment: NonNullable<GlobalDmMessage['attachment']>) => {
    const existing = blobUrlsRef.current.get(attachment.id)
    if (existing) {
      setAttachmentUrls(urls => urls[attachment.id] ? urls : { ...urls, [attachment.id]: existing })
      return true
    }
    const stored = await loadFileBlob(attachment.id)
    if (!stored) return false
    const mimeType = safeFileMimeType(attachment.mimeType)
    const url = blobUrlsRef.current.create(attachment.id, new Blob([stored.buffer], { type: mimeType }))
    setAttachmentUrls(urls => ({ ...urls, [attachment.id]: url }))
    return true
  }, [])

  const verifyWire = useCallback(async (wire: GlobalDmMessage) => {
    if (!(await verifyTextChat(CHAT_SCHEME, wire))) return false
    const me = profileRef.current?.userId
    const friend = friendUserIdRef.current
    const currentKey = await identityRef.current?.publicKeyId()
    const trustedFriendKey = friendDeviceKeyIdRef.current
    if (!wire.authorUserId || !currentKey) return false
    if (wire.authorUserId === me) {
      if (wire.deviceKeyId === currentKey) {
        if (!wire.deviceGrant) return true
        const localGrant = findDeviceGrant(wire.authorUserId, wire.deviceGrant.issuerDeviceKeyId, currentKey)
        return Boolean(localGrant && localGrant.sig === wire.deviceGrant.sig && await verifyDeviceGrant(wire.deviceGrant))
      }
      const localGrant = findDeviceGrant(wire.authorUserId, wire.deviceKeyId, currentKey)
      if (!wire.editedAt && !wire.deletedAt) return Boolean(localGrant)
      return Boolean(wire.deviceGrant && localGrant && wire.deviceGrant.sig === localGrant.sig &&
        await verifyDeviceGrant(wire.deviceGrant))
    }
    if (wire.authorUserId === friend && trustedFriendKey) {
      if (wire.deviceKeyId === trustedFriendKey) {
        return !wire.deviceGrant || (
          grantAuthorizes(
            wire.deviceGrant,
            wire.authorUserId,
            wire.deviceGrant.issuerDeviceKeyId,
            trustedFriendKey
          ) && await verifyDeviceGrant(wire.deviceGrant)
        )
      }
      return Boolean(wire.deviceGrant &&
        grantAuthorizes(wire.deviceGrant, wire.authorUserId, trustedFriendKey, wire.deviceKeyId) &&
        await verifyDeviceGrant(wire.deviceGrant))
    }
    return false
  }, [profileRef, friendUserIdRef, friendDeviceKeyIdRef, identityRef])

  const verifyReaction = useCallback(async (wire: GlobalDmReaction) => {
    if (!ALLOWED_REACTIONS.has(wire.emoji) || !(await verifyTextReaction(CHAT_SCHEME, wire))) return false
    const me = profileRef.current?.userId
    const friend = friendUserIdRef.current
    if (wire.authorUserId !== me && wire.authorUserId !== friend) return false
    if (wire.authorUserId === friend) {
      const trustedKey = friendDeviceKeyIdRef.current
      return Boolean(trustedKey && (wire.deviceKeyId === trustedKey || (
        wire.deviceGrant &&
        grantAuthorizes(wire.deviceGrant, wire.authorUserId, trustedKey, wire.deviceKeyId) &&
        await verifyDeviceGrant(wire.deviceGrant)
      )))
    }
    const currentKey = await identityRef.current?.publicKeyId()
    return Boolean(currentKey && (wire.deviceKeyId === currentKey || findDeviceGrant(wire.authorUserId, wire.deviceKeyId, currentKey)))
  }, [profileRef, friendUserIdRef, friendDeviceKeyIdRef, identityRef])

  const { room } = useRoom({
    appId: LOBBY_APP_ID,
    roomId: roomCode ?? '',
    password: roomCode ?? '',
    env: PUBLIC_NETWORK_ENV,
    handshakeTimeoutMs: PRIVATE_HANDSHAKE_TIMEOUT_MS,
    recoverIceFailures: true,
    onError: message => setError(message),
  })
  const authorizeDurableContent = useCallback(
    () => authorizeDmContent(roomCode ?? '', friendUserId ?? ''),
    [friendUserId, roomCode]
  )
  const { room: durableRoom } = useDurableChannel({
    enabled:
      CONTENT_BACKEND === 'durable-objects' &&
      Boolean(roomCode && profile && friendUserId),
    authorize: authorizeDurableContent,
    endpointPrefix: '/api/realtime/content/',
    encryptionSecret: roomCode ?? undefined,
    onError: message => setError(message),
  })
  const contentRoom =
    CONTENT_BACKEND === 'durable-objects' ? durableRoom : room

  // Load local history when the room code changes.
  useEffect(() => {
    blobUrlsRef.current.revokeAll()
    setAttachmentUrls({})
    pendingOutboundRef.current = []
    pendingOutboundRoomRef.current = roomCode
    if (!roomCode) {
      setMessages([])
      setReactions([])
      return
    }
    let cancelled = false
    const me = profileRef.current?.userId
    const friend = friendUserIdRef.current
    const stored = loadGlobalDmHistory(roomCode)
    void (async () => {
      const verified: GlobalDmMessage[] = []
      for (const wire of stored) {
        if (!wire.authorUserId || (wire.authorUserId !== me && wire.authorUserId !== friend)) continue
        if (await verifyWire(wire)) verified.push(wire)
      }
      const safeReactions: GlobalDmReaction[] = []
      for (const reaction of loadGlobalDmReactions(roomCode)) {
        if (await verifyReaction(reaction)) safeReactions.push(reaction)
      }
      if (!cancelled) {
        setHistoryReady(true)
        setMessages(current => {
          const next = mergeGlobalDmMessages(current, verified)
          messagesRef.current = next
          return next
        })
        setReactions(current => mergeGlobalDmReactions(current, safeReactions))
        for (const wire of verified) {
          if (wire.attachment) void materializeAttachment(wire.attachment)
        }
      }
    })()
    setError(null)
    return () => {
      cancelled = true
    }
  }, [roomCode, profileRef, friendUserIdRef, verifyWire, verifyReaction, materializeAttachment, setMessages, setReactions, setHistoryReady])

  useEffect(() => {
    const reload = () => {
      if (!roomCode) return
      const me = profileRef.current?.userId
      const friend = friendUserIdRef.current
      void (async () => {
        const verified: GlobalDmMessage[] = []
        for (const wire of loadGlobalDmHistory(roomCode)) {
          if (wire.authorUserId && (wire.authorUserId === me || wire.authorUserId === friend) && await verifyWire(wire)) verified.push(wire)
        }
        const safeReactions: GlobalDmReaction[] = []
        for (const reaction of loadGlobalDmReactions(roomCode)) {
          if (await verifyReaction(reaction)) safeReactions.push(reaction)
        }
        setMessages(current => {
          const next = mergeGlobalDmMessages(current, verified)
          messagesRef.current = next
          return next
        })
        setReactions(current => mergeGlobalDmReactions(current, safeReactions))
        for (const wire of verified) if (wire.attachment) void materializeAttachment(wire.attachment)
      })()
    }
    window.addEventListener('peerly-device-data-synced', reload)
    return () => window.removeEventListener('peerly-device-data-synced', reload)
  }, [roomCode, profileRef, friendUserIdRef, verifyWire, verifyReaction, materializeAttachment, setMessages, setReactions])

  const historyValue = useMemo(() => ({ messages, reactions }), [messages, reactions])
  const historyPersistence = useHistoryPersistence(scope, Boolean(roomCode && historyReady), historyValue,
    value => saveGlobalDmHistory(roomCode!, value.messages, value.reactions))

  const sendersRef = useRef<{
    chat: (msg: GlobalDmMessage, to?: string, messageId?: string) => Promise<void>
    reaction: (reaction: GlobalDmReaction, to?: string) => Promise<void>
    file: (data: ArrayBuffer, attachment: NonNullable<GlobalDmMessage['attachment']>, to?: string) => Promise<void>
    fileReq: (id: string, to: string) => void
  } | null>(null)

  useEffect(() => {
    if (!contentRoom || !roomCode) {
      sendersRef.current = null
      setPeerCount(0)
      return
    }

    const chatAction: RelayChannelAction<GlobalDmMessage> =
      CONTENT_BACKEND === 'durable-objects'
        ? durableRoom!.makeAction<GlobalDmMessage>('gdm')
        : room!.makeAction<GlobalDmMessage>('gdm')
    const reactionAction: RelayChannelAction<GlobalDmReaction> =
      CONTENT_BACKEND === 'durable-objects'
        ? durableRoom!.makeAction<GlobalDmReaction>('gdmreact')
        : room!.makeAction<GlobalDmReaction>('gdmreact')
    type HistoryPayload = GlobalDmMessage[] | { messages: GlobalDmMessage[]; reactions: GlobalDmReaction[] }
    // Durable history is replayed by the server after authorization. P2P
    // snapshots remain available only in the explicit rollback transport.
    const histAction: RelayChannelAction<HistoryPayload> | null =
      CONTENT_BACKEND === 'p2p'
        ? room!.makeAction<HistoryPayload>('gdmhist')
        : null
    const histReqAction: RelayChannelAction<true> | null =
      CONTENT_BACKEND === 'p2p'
        ? room!.makeAction<true>('gdmreq')
        : null
    const fileAction = room?.makeAction<ArrayBuffer>('gdmfile') ?? null
    const fileReqAction = room?.makeAction<string>('gdmfilereq') ?? null

    const mergeWire = async (wire: GlobalDmMessage, peerId?: string) => {
      if (!isCurrentConversation() || !(await verifyWire(wire)) || !isCurrentConversation()) return
      const me = profileRef.current
      const friend = friendUserIdRef.current
      if (!wire.authorUserId || (wire.authorUserId !== me?.userId && wire.authorUserId !== friend)) {
        return
      }
      setMessages(prev => {
        const existing = prev.find(message => message.id === wire.id)
        if (existing && (wire.editedAt || wire.deletedAt)) {
          const sameDevice = wire.deviceKeyId === existing.deviceKeyId
          const approved = Boolean(wire.authorUserId && existing.authorUserId === wire.authorUserId &&
            grantAuthorizes(wire.deviceGrant, wire.authorUserId, existing.deviceKeyId, wire.deviceKeyId))
          if (!sameDevice && !approved) return prev
        }
        const next = upsertGlobalDmMessage(prev, wire)
        messagesRef.current = next
        return next
      })
      if (
        fileReqAction &&
        !wire.deletedAt &&
        wire.attachment &&
        !(await materializeAttachment(wire.attachment))
      ) {
        void fileReqAction.send(
          wire.attachment.id,
          CONTENT_BACKEND === 'p2p' && peerId ? { target: peerId } : undefined
        )
      }
      if (wire.authorUserId === friendUserIdRef.current) recordSyncActivity({
        direction: 'received', kind: 'message',
        peer: { peerId, userId: wire.authorUserId, name: friendNameRef.current ?? undefined, relationship: 'friend' },
        itemCount: 1, bytes: syncPayloadBytes(wire), summary: wire.editedAt || wire.deletedAt ? 'Direct-message revision' : 'Direct message',
      })
    }

    const mergeReaction = async (wire: GlobalDmReaction, peerId?: string) => {
      if (!isCurrentConversation() || !(await verifyReaction(wire)) || !isCurrentConversation()) return
      if (!messagesRef.current.some(message => message.id === wire.messageId && !message.deletedAt)) return
      setReactions(current => mergeGlobalDmReactions(current, [wire]))
      if (wire.authorUserId === friendUserIdRef.current) recordSyncActivity({
        direction: 'received', kind: 'reaction',
        peer: { peerId, userId: wire.authorUserId, name: friendNameRef.current ?? undefined, relationship: 'friend' },
        itemCount: 1, bytes: syncPayloadBytes(wire), summary: `Direct-message reaction ${wire.emoji}`,
      })
    }

    sendersRef.current = {
      chat: (msg, to, messageId) => chatAction.send(msg, { ...(messageId ? { messageId } : {}), ...(to ? { target: to } : {}) }),
      reaction: (reaction, to) =>
        reactionAction.send(reaction, to ? { target: to } : undefined),
      file: (data, attachment, to) =>
        fileAction
          ? fileAction.send(data, {
              metadata: attachment,
              ...(CONTENT_BACKEND === 'p2p' && to ? { target: to } : {}),
            })
          : Promise.reject(new Error('p2p-file-channel-unavailable')),
      fileReq: (id, to) => {
        if (fileReqAction) {
          void fileReqAction.send(
            id,
            CONTENT_BACKEND === 'p2p' ? { target: to } : undefined
          )
        }
      },
    }

    // A workspace-profile popup can create a message during the render where
    // the DM opens. Do not lose it merely because this room's actions were one
    // passive-effect behind the UI; flush as soon as the action is safe to use.
    if (pendingOutboundRoomRef.current === roomCode) {
      const pending = pendingOutboundRef.current
      pendingOutboundRef.current = []
      for (const message of pending) {
        void chatAction.send(message).catch(() => {
          setError('Could not send message.')
        })
      }
    }

    chatAction.onMessage = (msg, { peerId }) => {
      void mergeWire(msg, peerId)
    }

    reactionAction.onMessage = (reaction, { peerId }) => {
      void mergeReaction(reaction, peerId)
    }

    if (histAction) histAction.onMessage = (payload, { peerId }) => {
      // v1 peers sent a bare message array. Continue accepting it so a rolling
      // deployment does not temporarily make existing DM history disappear.
      const historyMessages = Array.isArray(payload) ? payload : payload?.messages
      const historyReactions = Array.isArray(payload) ? [] : payload?.reactions
      if (!Array.isArray(historyMessages) || !Array.isArray(historyReactions)) return
      void (async () => {
        for (const msg of historyMessages) {
          await mergeWire(msg, peerId)
        }
        for (const reaction of historyReactions) await mergeReaction(reaction, peerId)
      })()
    }

    if (histReqAction && histAction) histReqAction.onMessage = (_msg, { peerId }) => {
      const snapshot = messagesRef.current.slice(-DEFAULT_HISTORY_CAP)
      if (snapshot.length || reactionsRef.current.length) void histAction.send({ messages: snapshot, reactions: reactionsRef.current }, { target: peerId })
    }

    if (fileAction) fileAction.onReceiveProgress = (percent, { metadata }) => {
      const attachment = metadata as GlobalDmMessage['attachment']
      if (!attachment || typeof attachment.id !== 'string') return
      setTransfers(current => [
        ...current.filter(transfer => transfer.id !== attachment.id || transfer.direction !== 'receive'),
        { id: attachment.id, name: attachment.name, percent, direction: 'receive' },
      ])
    }
    if (fileAction) fileAction.onMessage = (data, { metadata }) => {
      const claimed = metadata as GlobalDmMessage['attachment']
      if (!claimed || typeof claimed.id !== 'string') return
      const attachment = messagesRef.current.find(message => message.attachment?.id === claimed.id)?.attachment
      if (!attachment || data.byteLength > MAX_FILE_BYTES || data.byteLength !== attachment.size) return
      void (async () => {
        if (!(await fileContentMatchesId(data, attachment.id))) return
        const mimeType = safeFileMimeType(attachment.mimeType)
        await saveFileBlob(attachment.id, mimeType, data)
        const url = blobUrlsRef.current.create(attachment.id, new Blob([data], { type: mimeType }))
        setAttachmentUrls(urls => ({ ...urls, [attachment.id]: url }))
        setTransfers(current => current.filter(transfer => transfer.id !== attachment.id))
        recordSyncActivity({
          direction: 'received', kind: 'file', peer: { userId: friendUserIdRef.current ?? undefined, name: friendNameRef.current ?? undefined, relationship: 'friend' },
          itemCount: 1, bytes: data.byteLength, summary: `${attachment.name} · direct-message attachment`,
        })
      })()
    }
    if (fileReqAction) fileReqAction.onMessage = (id, { peerId }) => {
      if (typeof id !== 'string' || !messagesRef.current.some(message => !message.deletedAt && message.attachment?.id === id)) return
      const attachment = messagesRef.current.find(message => !message.deletedAt && message.attachment?.id === id)?.attachment
      if (!attachment) return
      void loadFileBlob(id).then(stored => {
        if (stored && fileAction) {
          return fileAction.send(stored.buffer, {
            metadata: attachment,
            target: peerId,
          })
        }
      })
    }

    const refresh = () => {
      setPeerCount(Object.keys(contentRoom.getPeers()).length)
    }

    contentRoom.onPeerJoin = (peerId: string) => {
      refresh()
      if (histAction) {
        // In rollback mode, late joiners need a peer-provided snapshot.
        const snapshot = messagesRef.current.slice(-DEFAULT_HISTORY_CAP)
        if (snapshot.length || reactionsRef.current.length) {
          void histAction.send(
            { messages: snapshot, reactions: reactionsRef.current },
            { target: peerId }
          )
        }
      }
    }
    contentRoom.onPeerLeave = () => refresh()
    refresh()

    if (CONTENT_BACKEND === 'durable-objects' && room && fileReqAction) {
      // Message metadata can arrive through durable replay before WebRTC has a
      // usable data channel. Retry missing file bodies when a direct peer
      // finally joins instead of treating the first zero-peer request as final.
      room.onPeerJoin = peerId => {
        for (const message of messagesRef.current) {
          const attachment = message.deletedAt ? undefined : message.attachment
          if (!attachment) continue
          void materializeAttachment(attachment).then(available => {
            if (!available) {
              void fileReqAction.send(attachment.id, { target: peerId })
            }
          })
        }
      }
    }

    // Ring until they join (same cadence as lobby presence).
    const ringTimer = window.setInterval(() => {
      if (Object.keys(contentRoom.getPeers()).length > 0) return
      ringFriendRef.current?.('open')
    }, PRESENCE_INTERVAL_MS)
    ringFriendRef.current?.('open')

    return () => {
      window.clearInterval(ringTimer)
      chatAction.onMessage = null
      reactionAction.onMessage = null
      if (histAction) histAction.onMessage = null
      if (histReqAction) histReqAction.onMessage = null
      if (fileAction) {
        fileAction.onMessage = null
        fileAction.onReceiveProgress = null
      }
      if (fileReqAction) fileReqAction.onMessage = null
      contentRoom.onPeerJoin = null
      contentRoom.onPeerLeave = null
      if (CONTENT_BACKEND === 'durable-objects' && room) {
        room.onPeerJoin = null
      }
      sendersRef.current = null
    }
  }, [contentRoom, durableRoom, room, roomCode, ringFriendRef, profileRef, friendUserIdRef, friendNameRef, verifyWire, verifyReaction, materializeAttachment, setMessages, setReactions, isCurrentConversation])

  const outboxScope = profile?.userId && roomCode ? `dm:${profile.userId}:${roomCode}` : null
  const outbox = useMessageOutbox<GlobalDmMessage>(outboxScope, Boolean(contentRoom && roomCode), async wire => {
    const sender = sendersRef.current
    if (!sender || !roomCode) throw new Error('Conversation is connecting')
    await sender.chat(wire, undefined, wire.id)
    // A send may finish after navigation. Persist its original conversation;
    // never merge the currently open conversation into that history.
    const stillCurrent = roomCodeRef.current === roomCode
    const nextMessages = upsertGlobalDmMessage(mergeGlobalDmMessages(loadGlobalDmHistory(roomCode), stillCurrent ? messagesRef.current : []), wire)
    const saved = saveGlobalDmHistory(roomCode, nextMessages, stillCurrent ? reactionsRef.current : loadGlobalDmReactions(roomCode))
    if (!saved) throw new Error('Could not save local history')
    if (!stillCurrent) return
    messagesRef.current = nextMessages
    setMessages(nextMessages)
    recordSyncActivity({ direction: 'sent', kind: 'message',
      peer: { userId: friendUserIdRef.current ?? undefined, name: friendNameRef.current ?? undefined, relationship: 'friend' },
      itemCount: 1, bytes: syncPayloadBytes(wire), summary: 'Direct message' })
  })
  const enqueueMessage = outbox.enqueue
  const sendMessage = useCallback(
    async (text: string) => {
      const me = profileRef.current
      const id = identityRef.current
      const code = roomCode
      if (!me || !id || !code) throw new Error('Conversation is not ready')
      const trimmed = text.trim().slice(0, MAX_TEXT)
      if (!trimmed) return
      try {
        const signed = await signTextChat(id, CHAT_SCHEME, {
          id:
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
              ? crypto.randomUUID()
              : `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          ts: Date.now(),
          text: trimmed,
          name: me.name,
          authorUserId: me.userId,
        })
        const wire: GlobalDmMessage = signed
        wire.deviceGrant = findAuthorizingDeviceGrant(me.userId, wire.deviceKeyId)
        await enqueueMessage(wire)
        ringFriendRef.current?.('message', trimmed)
      } catch (err) {
        console.error('Failed to send DM:', err)
        setError('Could not send message.')
        throw err
      }
    },
    [profileRef, identityRef, roomCode, ringFriendRef, enqueueMessage]
  )

  const sendFiles = useCallback(async (files: File[]) => {
    const me = profileRef.current
    const id = identityRef.current
    if (!me || !id || !roomCode) return
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        setError(FILE_TOO_LARGE_ERROR)
        continue
      }
      try {
        setError(null)
        const buffer = await file.arrayBuffer()
        const mimeType = safeFileMimeType(file.type)
        const [fileId, thumbnail] = await Promise.all([
          hashFileBytes(buffer),
          makeMediaThumbnail(buffer, mimeType),
        ])
        const attachment = {
          id: fileId,
          name: (file.name.trim() || 'attachment').slice(0, 255),
          mimeType,
          size: buffer.byteLength,
          thumbnail: safeThumbnailUrl(thumbnail),
        }
        const signed = await signTextChat(id, CHAT_SCHEME, {
          id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `f-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          ts: Date.now(),
          text: '',
          name: me.name,
          authorUserId: me.userId,
          attachment,
        }) as GlobalDmMessage
        signed.deviceGrant = findAuthorizingDeviceGrant(me.userId, signed.deviceKeyId)
        await saveFileBlob(fileId, mimeType, buffer)
        const url = blobUrlsRef.current.create(fileId, new Blob([buffer], { type: mimeType }))
        setAttachmentUrls(urls => ({ ...urls, [fileId]: url }))
        const sender = sendersRef.current
        if (sender) {
          await sender.chat(signed)
        } else {
          if (pendingOutboundRoomRef.current !== roomCode) {
            pendingOutboundRoomRef.current = roomCode
            pendingOutboundRef.current = []
          }
          pendingOutboundRef.current = upsertGlobalDmMessage(
            pendingOutboundRef.current,
            signed
          )
        }
        setMessages(current => {
          const next = upsertGlobalDmMessage(current, signed)
          messagesRef.current = next
          return next
        })
        if (sender) {
          setTransfers(current => [...current.filter(transfer => transfer.id !== fileId), { id: fileId, name: attachment.name, percent: 0, direction: 'send' }])
          await sender.file(buffer, attachment)
          setTransfers(current => current.filter(transfer => transfer.id !== fileId))
        }
        recordSyncActivity({
          direction: 'sent', kind: 'file', peer: { userId: friendUserIdRef.current ?? undefined, name: friendNameRef.current ?? undefined, relationship: 'friend' },
          itemCount: 1, bytes: buffer.byteLength, summary: `${attachment.name} · direct-message attachment`,
        })
        ringFriendRef.current?.('message', `📎 ${attachment.name}`)
      } catch (err) {
        console.error('Failed to send DM attachment:', err)
        setError('Could not send attachment.')
      }
    }
  }, [profileRef, identityRef, roomCode, friendUserIdRef, friendNameRef, ringFriendRef, setMessages])

  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    if (!ALLOWED_REACTIONS.has(emoji)) return
    const me = profileRef.current
    const id = identityRef.current
    const message = messagesRef.current.find(item => item.id === messageId)
    if (!me || !id || !message || message.deletedAt) return
    const previous = reactionsRef.current.find(reaction =>
      reaction.messageId === messageId && reaction.authorUserId === me.userId && reaction.emoji === emoji
    )
    try {
      const wire = await signTextReaction(id, CHAT_SCHEME, {
        messageId,
        emoji,
        active: !previous?.active,
        ts: Date.now(),
        authorUserId: me.userId,
      }) as GlobalDmReaction
      wire.deviceGrant = findAuthorizingDeviceGrant(me.userId, wire.deviceKeyId)
      const sender = sendersRef.current
      if (!sender) {
        setError('Could not update reaction.')
        return
      }
      await sender.reaction(wire)
      setReactions(current => mergeGlobalDmReactions(current, [wire]))
      recordSyncActivity({
        direction: 'sent', kind: 'reaction', peer: { userId: friendUserIdRef.current ?? undefined, name: friendNameRef.current ?? undefined, relationship: 'friend' },
        itemCount: 1, bytes: syncPayloadBytes(wire), summary: `Direct-message reaction ${emoji}`,
      })
    } catch (err) {
      console.error('Failed to react to DM:', err)
      setError('Could not update reaction.')
    }
  }, [profileRef, identityRef, friendUserIdRef, friendNameRef, setReactions])

  const reviseMessage = useCallback(async (messageId: string, nextText: string | null) => {
    try {
      const me = profileRef.current
      const id = identityRef.current
      const existing = messagesRef.current.find(message => message.id === messageId)
      const sender = sendersRef.current
      if (!me || !id || !existing || existing.authorUserId !== me.userId || !sender) return
      const currentKey = await id.publicKeyId()
      const deviceGrant = currentKey === existing.deviceKeyId
        ? undefined
        : findDeviceGrant(me.userId, existing.deviceKeyId, currentKey)
      if (currentKey !== existing.deviceKeyId && !deviceGrant) return
      const now = Date.now()
      const wire = await signTextChat(id, CHAT_SCHEME, {
        id: existing.id,
        ts: existing.ts,
        text: nextText === null ? '' : nextText.trim().slice(0, MAX_TEXT),
        name: me.name,
        authorUserId: me.userId,
        editedAt: nextText === null ? existing.editedAt : now,
        deletedAt: nextText === null ? now : undefined,
        attachment: existing.attachment,
      }) as GlobalDmMessage
      wire.deviceGrant = deviceGrant
      await sender.chat(wire)
      setMessages(prev => {
        const next = upsertGlobalDmMessage(prev, wire)
        messagesRef.current = next
        return next
      })
      recordSyncActivity({
        direction: 'sent', kind: 'message',
        peer: { userId: friendUserIdRef.current ?? undefined, name: friendNameRef.current ?? undefined, relationship: 'friend' },
        itemCount: 1, bytes: syncPayloadBytes(wire), summary: nextText === null ? 'Direct-message deletion' : 'Direct-message edit',
      })
    } catch (err) {
      console.error('Failed to revise DM:', err)
      setError('Could not update message.')
    }
  }, [identityRef, profileRef, friendUserIdRef, friendNameRef, setMessages])

  return {
    messages,
    peerCount,
    partnerInRoom: peerCount > 0,
    error: historyPersistence.error ?? outbox.error ?? error,
    reactions,
    attachmentUrls,
    transfers,
    sendMessage,
    pendingMessages: outbox.entries.map(entry => ({ id: entry.id, text: entry.payload.text, failed: entry.failed })),
    cancelPendingMessage: outbox.cancel,
    retryPendingMessages: async () => { historyPersistence.retry(); await outbox.retry() },
    sendFiles,
    toggleReaction,
    editMessage: (messageId: string, text: string) => reviseMessage(messageId, text),
    deleteMessage: (messageId: string) => reviseMessage(messageId, null),
    friendUserId: friendUserIdRef.current,
  }
}
