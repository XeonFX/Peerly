import { useCallback, useEffect, useRef, useState } from 'react'
import { signTextChat, verifyTextChat, type TextChatWire } from '@peerly/core'
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

const CHAT_SCHEME = 'peerly-gdm-v1'
const MAX_TEXT = 4000

export type GlobalDmChatOptions = {
  roomCode: string | null
  identity: DeviceIdentity | null
  profile: LobbyProfile | null
  friendUserId: string | null
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
  ringFriend,
}: GlobalDmChatOptions) {
  const profileRef = useLatest(profile)
  const identityRef = useLatest(identity)
  const ringFriendRef = useLatest(ringFriend)
  const friendUserIdRef = useLatest(friendUserId)

  const [messages, setMessages] = useState<GlobalDmMessage[]>([])
  const [peerCount, setPeerCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const messagesRef = useRef(messages)
  messagesRef.current = messages

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
    setMessages(loadGlobalDmHistory(roomCode))
    setError(null)
  }, [roomCode])

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

    const mergeWire = async (wire: GlobalDmMessage) => {
      if (!(await verifyTextChat(CHAT_SCHEME, wire as TextChatWire))) return
      setMessages(prev => upsertGlobalDmMessage(prev, wire))
    }

    sendersRef.current = {
      chat: (msg, to) => void chatAction.send(msg, to ? { target: to } : undefined),
      hist: (msgs, to) => void histAction.send(msgs, to ? { target: to } : undefined),
      histReq: to => void histReqAction.send(true, { target: to }),
    }

    chatAction.onMessage = msg => {
      void mergeWire(msg)
    }

    histAction.onMessage = msgs => {
      if (!Array.isArray(msgs)) return
      void (async () => {
        for (const msg of msgs) {
          await mergeWire(msg)
        }
      })()
    }

    histReqAction.onMessage = (_msg, { peerId }) => {
      const snapshot = messagesRef.current.slice(-100)
      if (snapshot.length) void histAction.send(snapshot, { target: peerId })
    }

    const refresh = () => {
      setPeerCount(Object.keys(room.getPeers()).length)
    }

    room.onPeerJoin = (peerId: string) => {
      refresh()
      // Offer our history to late joiners.
      const snapshot = messagesRef.current.slice(-100)
      if (snapshot.length) void histAction.send(snapshot, { target: peerId })
    }
    room.onPeerLeave = () => refresh()
    refresh()

    // Ring until they join.
    const ringTimer = window.setInterval(() => {
      if (Object.keys(room.getPeers()).length > 0) return
      ringFriendRef.current?.('open')
    }, 12_000)
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
  }, [room, roomCode, ringFriendRef])

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
        })
        const wire: GlobalDmMessage = { ...signed, authorUserId: me.userId }
        setMessages(prev => upsertGlobalDmMessage(prev, wire))
        sendersRef.current?.chat(wire)
        ringFriendRef.current?.('message', trimmed)
      } catch (err) {
        console.error('Failed to send DM:', err)
        setError('Could not send message.')
      }
    },
    [profileRef, identityRef, roomCode, ringFriendRef]
  )

  return {
    messages,
    peerCount,
    partnerInRoom: peerCount > 0,
    error,
    sendMessage,
    friendUserId: friendUserIdRef.current,
  }
}
