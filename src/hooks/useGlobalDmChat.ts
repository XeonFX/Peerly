import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_HISTORY_CAP,
  PRESENCE_INTERVAL_MS,
  recordSyncActivity,
  signTextChat,
  syncPayloadBytes,
  verifyTextChat,
} from '@peerly/core'
import { useLatest, useRoom } from '@peerly/core/react'
import type { DeviceIdentity } from '../collab/deviceIdentity'
import { LOBBY_APP_ID } from '../collab/mesh'
import {
  loadGlobalDmHistory,
  saveGlobalDmHistory,
  upsertGlobalDmMessage,
  type GlobalDmMessage,
} from '../collab/globalDmHistory'
import type { LobbyProfile } from './usePresenceLobby'
import { findAuthorizingDeviceGrant, findDeviceGrant, grantAuthorizes, verifyDeviceGrant } from '../collab/deviceAuthorization'

const CHAT_SCHEME = 'peerly-gdm-v2'
const MAX_TEXT = 4000

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
  const [peerCount, setPeerCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const messagesRef = useRef(messages)
  messagesRef.current = messages

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

  const { room } = useRoom({
    appId: LOBBY_APP_ID,
    roomId: roomCode ?? '',
    password: roomCode ?? '',
    env: import.meta.env,
    onError: message => setError(message),
  })

  // Load local history when the room code changes.
  useEffect(() => {
    if (!roomCode) {
      setMessages([])
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
      if (!cancelled) setMessages(verified)
    })()
    setError(null)
    return () => {
      cancelled = true
    }
  }, [roomCode, profileRef, friendUserIdRef, verifyWire])

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
        setMessages(verified)
      })()
    }
    window.addEventListener('peerly-device-data-synced', reload)
    return () => window.removeEventListener('peerly-device-data-synced', reload)
  }, [roomCode, profileRef, friendUserIdRef, verifyWire])

  // Persist on change.
  useEffect(() => {
    if (!roomCode) return
    saveGlobalDmHistory(roomCode, messages)
  }, [roomCode, messages])

  const sendersRef = useRef<{
    chat: (msg: GlobalDmMessage, to?: string) => void
    hist: (msgs: GlobalDmMessage[], to?: string) => void
    histReq: (to: string) => void
  } | null>(null)

  useEffect(() => {
    if (!room || !roomCode) {
      sendersRef.current = null
      setPeerCount(0)
      return
    }

    const chatAction = room.makeAction<GlobalDmMessage>('gdm')
    const histAction = room.makeAction<GlobalDmMessage[]>('gdmhist')
    const histReqAction = room.makeAction<true>('gdmreq')

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
        return upsertGlobalDmMessage(prev, wire)
      })
      if (wire.authorUserId === friendUserIdRef.current) recordSyncActivity({
        direction: 'received', kind: 'message',
        peer: { peerId, userId: wire.authorUserId, name: friendNameRef.current ?? undefined, relationship: 'friend' },
        itemCount: 1, bytes: syncPayloadBytes(wire), summary: wire.editedAt || wire.deletedAt ? 'Direct-message revision' : 'Direct message',
      })
    }

    sendersRef.current = {
      chat: (msg, to) => void chatAction.send(msg, to ? { target: to } : undefined),
      hist: (msgs, to) => void histAction.send(msgs, to ? { target: to } : undefined),
      histReq: to => void histReqAction.send(true, { target: to }),
    }

    chatAction.onMessage = (msg, { peerId }) => {
      void mergeWire(msg, peerId)
    }

    histAction.onMessage = (msgs, { peerId }) => {
      if (!Array.isArray(msgs)) return
      void (async () => {
        for (const msg of msgs) {
          await mergeWire(msg, peerId)
        }
      })()
    }

    histReqAction.onMessage = (_msg, { peerId }) => {
      const snapshot = messagesRef.current.slice(-DEFAULT_HISTORY_CAP)
      if (snapshot.length) void histAction.send(snapshot, { target: peerId })
    }

    const refresh = () => {
      setPeerCount(Object.keys(room.getPeers()).length)
    }

    room.onPeerJoin = (peerId: string) => {
      refresh()
      // Offer our history to late joiners.
      const snapshot = messagesRef.current.slice(-DEFAULT_HISTORY_CAP)
      if (snapshot.length) void histAction.send(snapshot, { target: peerId })
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
      histAction.onMessage = null
      histReqAction.onMessage = null
      room.onPeerJoin = null
      room.onPeerLeave = null
      sendersRef.current = null
    }
  }, [room, roomCode, ringFriendRef, profileRef, friendUserIdRef, friendNameRef, verifyWire])

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
        setMessages(prev => upsertGlobalDmMessage(prev, wire))
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
    }) as GlobalDmMessage
    wire.deviceGrant = deviceGrant
    setMessages(prev => upsertGlobalDmMessage(prev, wire))
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
    sendMessage,
    editMessage: (messageId: string, text: string) => reviseMessage(messageId, text),
    deleteMessage: (messageId: string) => reviseMessage(messageId, null),
    friendUserId: friendUserIdRef.current,
  }
}
