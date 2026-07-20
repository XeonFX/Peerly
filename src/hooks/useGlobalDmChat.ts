import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_HISTORY_CAP,
  PRESENCE_INTERVAL_MS,
  recordSyncActivity,
  signTextChat,
  signTextReaction,
  syncPayloadBytes,
  verifyTextChat,
  verifyTextReaction,
} from '@peerly/core'
import { useLatest, useRoom } from '@peerly/core/react'
import type { DeviceIdentity } from '../collab/deviceIdentity'
import { LOBBY_APP_ID } from '../collab/mesh'
import {
  loadGlobalDmHistory,
  loadGlobalDmReactions,
  mergeGlobalDmReactions,
  saveGlobalDmHistory,
  upsertGlobalDmMessage,
  type GlobalDmMessage,
  type GlobalDmReaction,
} from '../collab/globalDmHistory'
import type { LobbyProfile } from './usePresenceLobby'
import { findAuthorizingDeviceGrant, findDeviceGrant, grantAuthorizes, verifyDeviceGrant } from '../collab/deviceAuthorization'
import { MAX_FILE_BYTES, FILE_TOO_LARGE_ERROR } from '../collab/constants'
import { hashFileBytes, fileContentMatchesId } from '../utils/fileHash'
import { safeFileMimeType } from '../utils/fileType'
import { makeMediaThumbnail } from '../utils/imageThumbnail'
import { loadFileBlob, saveFileBlob } from '../utils/fileStore'
import { BlobUrlRegistry } from '../utils/blobUrls'
import { safeThumbnailUrl } from '../utils/avatarUrl'

const CHAT_SCHEME = 'peerly-gdm-v2'
const MAX_TEXT = 4000
const REACTION_EMOJIS = new Set(['👍', '❤️', '😂', '🎉'])

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

  const [messages, setMessages] = useState<GlobalDmMessage[]>([])
  const [reactions, setReactions] = useState<GlobalDmReaction[]>([])
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({})
  const [transfers, setTransfers] = useState<GlobalDmTransfer[]>([])
  const [peerCount, setPeerCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const reactionsRef = useRef(reactions)
  reactionsRef.current = reactions
  const blobUrlsRef = useRef(new BlobUrlRegistry())

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
    if (!REACTION_EMOJIS.has(wire.emoji) || !(await verifyTextReaction(CHAT_SCHEME, wire))) return false
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
    env: import.meta.env,
    onError: message => setError(message),
  })

  // Load local history when the room code changes.
  useEffect(() => {
    blobUrlsRef.current.revokeAll()
    setAttachmentUrls({})
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
        setMessages(verified)
        setReactions(safeReactions)
        for (const wire of verified) {
          if (wire.attachment) void materializeAttachment(wire.attachment)
        }
      }
    })()
    setError(null)
    return () => {
      cancelled = true
    }
  }, [roomCode, profileRef, friendUserIdRef, verifyWire, verifyReaction, materializeAttachment])

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
        setMessages(verified)
        setReactions(safeReactions)
        for (const wire of verified) if (wire.attachment) void materializeAttachment(wire.attachment)
      })()
    }
    window.addEventListener('peerly-device-data-synced', reload)
    return () => window.removeEventListener('peerly-device-data-synced', reload)
  }, [roomCode, profileRef, friendUserIdRef, verifyWire, verifyReaction, materializeAttachment])

  // Persist on change.
  useEffect(() => {
    if (!roomCode) return
    saveGlobalDmHistory(roomCode, messages, reactions)
  }, [roomCode, messages, reactions])

  const sendersRef = useRef<{
    chat: (msg: GlobalDmMessage, to?: string) => void
    reaction: (reaction: GlobalDmReaction, to?: string) => void
    hist: (payload: { messages: GlobalDmMessage[]; reactions: GlobalDmReaction[] }, to?: string) => void
    histReq: (to: string) => void
    file: (data: ArrayBuffer, attachment: NonNullable<GlobalDmMessage['attachment']>, to?: string) => Promise<void>
    fileReq: (id: string, to: string) => void
  } | null>(null)

  useEffect(() => {
    if (!room || !roomCode) {
      sendersRef.current = null
      setPeerCount(0)
      return
    }

    const chatAction = room.makeAction<GlobalDmMessage>('gdm')
    const reactionAction = room.makeAction<GlobalDmReaction>('gdmreact')
    type HistoryPayload = GlobalDmMessage[] | { messages: GlobalDmMessage[]; reactions: GlobalDmReaction[] }
    const histAction = room.makeAction<HistoryPayload>('gdmhist')
    const histReqAction = room.makeAction<true>('gdmreq')
    const fileAction = room.makeAction<ArrayBuffer>('gdmfile')
    const fileReqAction = room.makeAction<string>('gdmfilereq')

    const mergeWire = async (wire: GlobalDmMessage, peerId?: string) => {
      if (!(await verifyWire(wire))) return
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
      if (!wire.deletedAt && wire.attachment && !(await materializeAttachment(wire.attachment)) && peerId) {
        void fileReqAction.send(wire.attachment.id, { target: peerId })
      }
      if (wire.authorUserId === friendUserIdRef.current) recordSyncActivity({
        direction: 'received', kind: 'message',
        peer: { peerId, userId: wire.authorUserId, name: friendNameRef.current ?? undefined, relationship: 'friend' },
        itemCount: 1, bytes: syncPayloadBytes(wire), summary: wire.editedAt || wire.deletedAt ? 'Direct-message revision' : 'Direct message',
      })
    }

    const mergeReaction = async (wire: GlobalDmReaction, peerId?: string) => {
      if (!(await verifyReaction(wire))) return
      if (!messagesRef.current.some(message => message.id === wire.messageId && !message.deletedAt)) return
      setReactions(current => mergeGlobalDmReactions(current, [wire]))
      if (wire.authorUserId === friendUserIdRef.current) recordSyncActivity({
        direction: 'received', kind: 'reaction',
        peer: { peerId, userId: wire.authorUserId, name: friendNameRef.current ?? undefined, relationship: 'friend' },
        itemCount: 1, bytes: syncPayloadBytes(wire), summary: `Direct-message reaction ${wire.emoji}`,
      })
    }

    sendersRef.current = {
      chat: (msg, to) => void chatAction.send(msg, to ? { target: to } : undefined),
      reaction: (reaction, to) => void reactionAction.send(reaction, to ? { target: to } : undefined),
      hist: (payload, to) => void histAction.send(payload, to ? { target: to } : undefined),
      histReq: to => void histReqAction.send(true, { target: to }),
      file: (data, attachment, to) => fileAction.send(data, { metadata: attachment, ...(to ? { target: to } : {}) }),
      fileReq: (id, to) => void fileReqAction.send(id, { target: to }),
    }

    chatAction.onMessage = (msg, { peerId }) => {
      void mergeWire(msg, peerId)
    }

    reactionAction.onMessage = (reaction, { peerId }) => {
      void mergeReaction(reaction, peerId)
    }

    histAction.onMessage = (payload, { peerId }) => {
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

    histReqAction.onMessage = (_msg, { peerId }) => {
      const snapshot = messagesRef.current.slice(-DEFAULT_HISTORY_CAP)
      if (snapshot.length || reactionsRef.current.length) void histAction.send({ messages: snapshot, reactions: reactionsRef.current }, { target: peerId })
    }

    fileAction.onReceiveProgress = (percent, { metadata }) => {
      const attachment = metadata as GlobalDmMessage['attachment']
      if (!attachment || typeof attachment.id !== 'string') return
      setTransfers(current => [
        ...current.filter(transfer => transfer.id !== attachment.id || transfer.direction !== 'receive'),
        { id: attachment.id, name: attachment.name, percent, direction: 'receive' },
      ])
    }
    fileAction.onMessage = (data, { metadata }) => {
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
    fileReqAction.onMessage = (id, { peerId }) => {
      if (typeof id !== 'string' || !messagesRef.current.some(message => !message.deletedAt && message.attachment?.id === id)) return
      const attachment = messagesRef.current.find(message => !message.deletedAt && message.attachment?.id === id)?.attachment
      if (!attachment) return
      void loadFileBlob(id).then(stored => {
        if (stored) return fileAction.send(stored.buffer, { metadata: attachment, target: peerId })
      })
    }

    const refresh = () => {
      setPeerCount(Object.keys(room.getPeers()).length)
    }

    room.onPeerJoin = (peerId: string) => {
      refresh()
      // Offer our history to late joiners.
      const snapshot = messagesRef.current.slice(-DEFAULT_HISTORY_CAP)
      if (snapshot.length || reactionsRef.current.length) void histAction.send({ messages: snapshot, reactions: reactionsRef.current }, { target: peerId })
    }
    room.onPeerLeave = () => refresh()
    refresh()

    // Ring until they join (same cadence as lobby presence).
    const ringTimer = window.setInterval(() => {
      if (Object.keys(room.getPeers()).length > 0) return
      ringFriendRef.current?.('open')
    }, PRESENCE_INTERVAL_MS)
    ringFriendRef.current?.('open')

    return () => {
      window.clearInterval(ringTimer)
      chatAction.onMessage = null
      reactionAction.onMessage = null
      histAction.onMessage = null
      histReqAction.onMessage = null
      fileAction.onMessage = null
      fileAction.onReceiveProgress = null
      fileReqAction.onMessage = null
      room.onPeerJoin = null
      room.onPeerLeave = null
      sendersRef.current = null
    }
  }, [room, roomCode, ringFriendRef, profileRef, friendUserIdRef, friendNameRef, verifyWire, verifyReaction, materializeAttachment])

  const sendMessage = useCallback(
    async (text: string) => {
      const me = profileRef.current
      const id = identityRef.current
      const code = roomCode
      if (!me || !id || !code) return
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
        setMessages(prev => {
          const next = upsertGlobalDmMessage(prev, wire)
          messagesRef.current = next
          return next
        })
        sendersRef.current?.chat(wire)
        recordSyncActivity({
          direction: 'sent', kind: 'message',
          peer: { userId: friendUserIdRef.current ?? undefined, name: friendNameRef.current ?? undefined, relationship: 'friend' },
          itemCount: 1, bytes: syncPayloadBytes(wire), summary: 'Direct message',
        })
        ringFriendRef.current?.('message', trimmed)
      } catch (err) {
        console.error('Failed to send DM:', err)
        setError('Could not send message.')
      }
    },
    [profileRef, identityRef, roomCode, ringFriendRef, friendUserIdRef, friendNameRef]
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
        setMessages(current => {
          const next = upsertGlobalDmMessage(current, signed)
          messagesRef.current = next
          return next
        })
        sendersRef.current?.chat(signed)
        if (sendersRef.current) {
          setTransfers(current => [...current.filter(transfer => transfer.id !== fileId), { id: fileId, name: attachment.name, percent: 0, direction: 'send' }])
          await sendersRef.current.file(buffer, attachment)
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
  }, [profileRef, identityRef, roomCode, friendUserIdRef, friendNameRef, ringFriendRef])

  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    if (!REACTION_EMOJIS.has(emoji)) return
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
      setReactions(current => mergeGlobalDmReactions(current, [wire]))
      sendersRef.current?.reaction(wire)
      recordSyncActivity({
        direction: 'sent', kind: 'reaction', peer: { userId: friendUserIdRef.current ?? undefined, name: friendNameRef.current ?? undefined, relationship: 'friend' },
        itemCount: 1, bytes: syncPayloadBytes(wire), summary: `Direct-message reaction ${emoji}`,
      })
    } catch (err) {
      console.error('Failed to react to DM:', err)
      setError('Could not update reaction.')
    }
  }, [profileRef, identityRef, friendUserIdRef, friendNameRef])

  const reviseMessage = useCallback(async (messageId: string, nextText: string | null) => {
    const me = profileRef.current
    const id = identityRef.current
    const existing = messagesRef.current.find(message => message.id === messageId)
    if (!me || !id || !existing || existing.authorUserId !== me.userId) return
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
    setMessages(prev => {
      const next = upsertGlobalDmMessage(prev, wire)
      messagesRef.current = next
      return next
    })
    sendersRef.current?.chat(wire)
    recordSyncActivity({
      direction: 'sent', kind: 'message',
      peer: { userId: friendUserIdRef.current ?? undefined, name: friendNameRef.current ?? undefined, relationship: 'friend' },
      itemCount: 1, bytes: syncPayloadBytes(wire), summary: nextText === null ? 'Direct-message deletion' : 'Direct-message edit',
    })
  }, [identityRef, profileRef, friendUserIdRef, friendNameRef])

  return {
    messages,
    peerCount,
    partnerInRoom: peerCount > 0,
    error,
    reactions,
    attachmentUrls,
    transfers,
    sendMessage,
    sendFiles,
    toggleReaction,
    editMessage: (messageId: string, text: string) => reviseMessage(messageId, text),
    deleteMessage: (messageId: string) => reviseMessage(messageId, null),
    friendUserId: friendUserIdRef.current,
  }
}
