import { useCallback, useEffect, useRef, useState } from 'react'
import { useLatest, useRoom } from '@peerly/core/react'
import type { DeviceIdentity } from '../collab/deviceIdentity'
import {
  createFriendInvite,
  createFriendInviteResponse,
  parseFriendInvitePayload,
  parseFriendInviteResponsePayload,
  parsePresencePayload,
  verifyFriendInvite,
  verifyFriendInviteResponse,
  type FriendInvitePayload,
  type FriendInviteResponsePayload,
  type PresencePayload,
} from '../collab/friendInvite'
import {
  loadIncomingInvites,
  loadOutgoingInvites,
  removeIncomingInvite,
  removeOutgoingInvite,
  saveOutgoingInvites,
  upsertIncomingInvite,
  upsertOutgoingInvite,
  type IncomingFriendInvite,
  type OutgoingFriendInvite,
} from '../collab/friendInviteStore'
import { hashEmail, isPlausibleEmail, normalizeEmail } from '../collab/emailHash'
import { LOBBY_APP_ID, LOBBY_ROOM_ID } from '../collab/mesh'
import { addFriend, isFriend, loadFriends } from '../collab/friendsStore'

/** Lobby presence cadence / TTL — same ballpark as HeyHubs. */
const PRESENCE_INTERVAL_MS = 12_000
const PRESENCE_TTL_MS = 35_000
/** Re-send undelivered (or re-deliver) invites while the peer stays online. */
const INVITE_RETRY_MS = 8_000

export type LobbyProfile = {
  userId: string
  name: string
  email: string
}

export type PresenceLobbyOptions = {
  identity: DeviceIdentity | null
  profile: LobbyProfile | null
  /** Bump friends UI when an accept lands. */
  onFriendsChanged?: () => void
}

/**
 * Shared public lobby for friend presence + email invites.
 *
 * Presence carries only email hashes. Invites are signed with the device key
 * and delivered directed when a matching peer is online. Offline targets stay
 * in the local outgoing queue until they show up (no server mailbox).
 */
export function usePresenceLobby({ identity, profile, onFriendsChanged }: PresenceLobbyOptions) {
  const profileRef = useLatest(profile)
  const identityRef = useLatest(identity)
  const onFriendsChangedRef = useLatest(onFriendsChanged)

  const [outgoing, setOutgoing] = useState<OutgoingFriendInvite[]>(() => loadOutgoingInvites())
  const [incoming, setIncoming] = useState<IncomingFriendInvite[]>(() => loadIncomingInvites())
  const [onlineCount, setOnlineCount] = useState(0)
  const [lobbyError, setLobbyError] = useState<string | null>(null)

  const presenceByPeerRef = useRef(
    new Map<string, PresencePayload & { seenAt: number }>()
  )
  /** emailHash → peerId for directed invite delivery. */
  const peerByEmailHashRef = useRef(new Map<string, string>())
  /** userId → peerId for directed responses. */
  const peerByUserIdRef = useRef(new Map<string, string>())
  const connectedPeersRef = useRef(0)
  const myEmailHashRef = useRef<string>('')

  const sendersRef = useRef<{
    presence: (msg: PresencePayload, to?: string) => void
    invite: (msg: FriendInvitePayload, to: string) => void
    inviteResp: (msg: FriendInviteResponsePayload, to: string) => void
  } | null>(null)

  const roomEnabled = Boolean(profile?.userId && profile.email && identity)
  const { room } = useRoom({
    appId: LOBBY_APP_ID,
    roomId: roomEnabled ? LOBBY_ROOM_ID : '',
    env: import.meta.env,
    onError: message => {
      if (connectedPeersRef.current === 0) setLobbyError(message)
    },
  })

  // Keep my email hash in sync for inbound matching.
  useEffect(() => {
    if (!profile?.email) {
      myEmailHashRef.current = ''
      return
    }
    void hashEmail(profile.email).then(h => {
      myEmailHashRef.current = h
    })
  }, [profile?.email])

  useEffect(() => {
    if (!room || !roomEnabled) {
      sendersRef.current = null
      return
    }

    const presenceByPeer = presenceByPeerRef.current
    const peerByEmailHash = peerByEmailHashRef.current
    const peerByUserId = peerByUserIdRef.current

    const presenceAction = room.makeAction<PresencePayload>('pres')
    const inviteAction = room.makeAction<FriendInvitePayload>('finv')
    const inviteRespAction = room.makeAction<FriendInviteResponsePayload>('finvr')

    const announcePresence = (to?: string) => {
      const me = profileRef.current
      const hash = myEmailHashRef.current
      if (!me || !hash) return
      const payload: PresencePayload = {
        userId: me.userId,
        name: me.name,
        emailHash: hash,
      }
      void presenceAction.send(payload, to ? { target: to } : undefined)
    }

    const recordPresence = (peerId: string, parsed: PresencePayload) => {
      const me = profileRef.current
      if (me && parsed.userId === me.userId) return
      const prev = peerByUserId.get(parsed.userId)
      if (prev && prev !== peerId) {
        presenceByPeer.delete(prev)
      }
      presenceByPeer.set(peerId, { ...parsed, seenAt: Date.now() })
      peerByUserId.set(parsed.userId, peerId)
      peerByEmailHash.set(parsed.emailHash, peerId)
    }

    const dropPeer = (peerId: string) => {
      const entry = presenceByPeer.get(peerId)
      if (!entry) return
      presenceByPeer.delete(peerId)
      if (peerByUserId.get(entry.userId) === peerId) {
        peerByUserId.delete(entry.userId)
      }
      if (peerByEmailHash.get(entry.emailHash) === peerId) {
        peerByEmailHash.delete(entry.emailHash)
      }
    }

    const prunePresence = () => {
      const now = Date.now()
      for (const [peerId, entry] of presenceByPeer) {
        if (now - entry.seenAt <= PRESENCE_TTL_MS) continue
        dropPeer(peerId)
      }
    }

    const deliverPendingInvites = () => {
      const now = Date.now()
      setOutgoing(prev => {
        let changed = false
        const next = prev.map(item => {
          const peerId = peerByEmailHash.get(item.toEmailHash)
          if (!peerId) return item
          if (item.lastSentAt && now - item.lastSentAt < INVITE_RETRY_MS) return item
          void inviteAction.send(item.payload, { target: peerId })
          changed = true
          return { ...item, lastSentAt: now }
        })
        if (changed) saveOutgoingInvites(next)
        return changed ? next : prev
      })
    }

    sendersRef.current = {
      presence: (msg, to) => void presenceAction.send(msg, to ? { target: to } : undefined),
      invite: (msg, to) => void inviteAction.send(msg, { target: to }),
      inviteResp: (msg, to) => void inviteRespAction.send(msg, { target: to }),
    }

    const refreshCounts = () => {
      const peers = Object.keys(room.getPeers()).length
      connectedPeersRef.current = peers
      setOnlineCount(peers + 1)
      if (peers > 0) setLobbyError(null)
    }

    presenceAction.onMessage = (msg, { peerId }) => {
      const parsed = parsePresencePayload(msg)
      if (!parsed) return
      recordPresence(peerId, parsed)
      // New peer might match a pending invite.
      deliverPendingInvites()
    }

    inviteAction.onMessage = (msg, { peerId }) => {
      void (async () => {
        const parsed = parseFriendInvitePayload(msg)
        if (!parsed) return
        if (!(await verifyFriendInvite(parsed))) return
        const me = profileRef.current
        const myHash = myEmailHashRef.current
        if (!me || !myHash || parsed.toEmailHash !== myHash) return
        if (parsed.fromUserId === me.userId) return
        // Already friends — auto-ack so their outgoing queue clears.
        if (isFriend(loadFriends(), parsed.fromUserId)) {
          const id = identityRef.current
          if (id) {
            try {
              const resp = await createFriendInviteResponse(id, {
                inviteId: parsed.inviteId,
                accept: true,
                fromUserId: me.userId,
                fromName: me.name,
                fromEmail: me.email,
                toUserId: parsed.fromUserId,
              })
              void inviteRespAction.send(resp, { target: peerId })
            } catch {
              // ignore
            }
          }
          return
        }
        recordPresence(peerId, {
          userId: parsed.fromUserId,
          name: parsed.fromName,
          emailHash: parsed.fromEmailHash,
        })
        setIncoming(prev =>
          upsertIncomingInvite(prev, {
            inviteId: parsed.inviteId,
            fromUserId: parsed.fromUserId,
            fromName: parsed.fromName,
            fromEmailHash: parsed.fromEmailHash,
            payload: parsed,
            receivedAt: Date.now(),
          })
        )
      })()
    }

    inviteRespAction.onMessage = (msg, { peerId: _peerId }) => {
      void (async () => {
        const parsed = parseFriendInviteResponsePayload(msg)
        if (!parsed) return
        if (!(await verifyFriendInviteResponse(parsed))) return
        const me = profileRef.current
        const id = identityRef.current
        if (!me || !id) return
        if (parsed.toUserId !== me.userId) return

        // Capture typed target email before removing the pending row.
        const out = loadOutgoingInvites().find(o => o.inviteId === parsed.inviteId)
        setOutgoing(prev => removeOutgoingInvite(prev, parsed.inviteId))

        if (!parsed.accept) return

        const email = normalizeEmail(parsed.fromEmail ?? out?.toEmail ?? '')
        if (!email || !isPlausibleEmail(email)) return
        if (isFriend(loadFriends(), parsed.fromUserId)) {
          onFriendsChangedRef.current?.()
          return
        }
        await addFriend(loadFriends(), id, {
          ownerUserId: me.userId,
          subjectUserId: parsed.fromUserId,
          subjectName: parsed.fromName || email,
          subjectEmail: email,
        })
        onFriendsChangedRef.current?.()
      })()
    }

    room.onPeerJoin = (peerId: string) => {
      refreshCounts()
      announcePresence(peerId)
    }
    room.onPeerLeave = (peerId: string) => {
      dropPeer(peerId)
      refreshCounts()
    }

    // Hash may still be computing on first join — announce once ready.
    void hashEmail(profileRef.current?.email ?? '').then(h => {
      myEmailHashRef.current = h
      announcePresence()
    })
    refreshCounts()

    const presenceTimer = setInterval(() => {
      prunePresence()
      announcePresence()
      deliverPendingInvites()
    }, PRESENCE_INTERVAL_MS)

    return () => {
      clearInterval(presenceTimer)
      presenceAction.onMessage = null
      inviteAction.onMessage = null
      inviteRespAction.onMessage = null
      room.onPeerJoin = null
      room.onPeerLeave = null
      sendersRef.current = null
      presenceByPeer.clear()
      peerByEmailHash.clear()
      peerByUserId.clear()
      connectedPeersRef.current = 0
      setOnlineCount(0)
    }
  }, [room, roomEnabled, profileRef, identityRef, onFriendsChangedRef])

  const inviteByEmail = useCallback(
    async (toEmail: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      const me = profileRef.current
      const id = identityRef.current
      if (!me || !id) return { ok: false, error: 'Not signed in' }
      if (!isPlausibleEmail(toEmail)) return { ok: false, error: 'Enter a valid email' }
      const normalized = normalizeEmail(toEmail)
      if (normalized === normalizeEmail(me.email)) {
        return { ok: false, error: 'That is your own email' }
      }

      // Already friends with someone who has this email?
      const friends = loadFriends()
      for (const f of friends.own.values()) {
        if (normalizeEmail(f.subjectEmail ?? '') === normalized) {
          return { ok: false, error: 'Already friends' }
        }
      }

      const inviteId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `inv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

      try {
        const payload = await createFriendInvite(id, {
          inviteId,
          fromUserId: me.userId,
          fromName: me.name,
          fromEmail: me.email,
          toEmail: normalized,
        })
        const entry: OutgoingFriendInvite = {
          inviteId,
          toEmail: normalized,
          toEmailHash: payload.toEmailHash,
          payload,
          createdAt: Date.now(),
          lastSentAt: 0,
        }
        setOutgoing(prev => upsertOutgoingInvite(prev, entry))

        const peerId = peerByEmailHashRef.current.get(payload.toEmailHash)
        if (peerId && sendersRef.current) {
          // peerByEmailHashRef is live; inviteByEmail runs outside the effect.
          sendersRef.current.invite(payload, peerId)
          setOutgoing(prev => {
            const next = prev.map(i =>
              i.inviteId === inviteId ? { ...i, lastSentAt: Date.now() } : i
            )
            saveOutgoingInvites(next)
            return next
          })
        }
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'Could not create invite' }
      }
    },
    [profileRef, identityRef]
  )

  const acceptInvite = useCallback(
    async (inviteId: string): Promise<boolean> => {
      const me = profileRef.current
      const id = identityRef.current
      if (!me || !id) return false
      const entry = loadIncomingInvites().find(i => i.inviteId === inviteId)
      if (!entry) return false

      try {
        const resp = await createFriendInviteResponse(id, {
          inviteId: entry.inviteId,
          accept: true,
          fromUserId: me.userId,
          fromName: me.name,
          fromEmail: me.email,
          toUserId: entry.fromUserId,
        })
        const peerId = peerByUserIdRef.current.get(entry.fromUserId)
        if (peerId && sendersRef.current) {
          sendersRef.current.inviteResp(resp, peerId)
        }

        if (!isFriend(loadFriends(), entry.fromUserId)) {
          await addFriend(loadFriends(), id, {
            ownerUserId: me.userId,
            subjectUserId: entry.fromUserId,
            subjectName: entry.fromName,
            subjectEmail: entry.payload.fromEmail,
          })
        }
        setIncoming(prev => removeIncomingInvite(prev, inviteId))
        onFriendsChangedRef.current?.()
        return true
      } catch {
        return false
      }
    },
    [profileRef, identityRef, onFriendsChangedRef]
  )

  const declineInvite = useCallback(
    async (inviteId: string): Promise<boolean> => {
      const me = profileRef.current
      const id = identityRef.current
      if (!me || !id) return false
      const entry = loadIncomingInvites().find(i => i.inviteId === inviteId)
      if (!entry) return false
      try {
        const resp = await createFriendInviteResponse(id, {
          inviteId: entry.inviteId,
          accept: false,
          fromUserId: me.userId,
          fromName: me.name,
          fromEmail: me.email,
          toUserId: entry.fromUserId,
        })
        const peerId = peerByUserIdRef.current.get(entry.fromUserId)
        if (peerId && sendersRef.current) {
          sendersRef.current.inviteResp(resp, peerId)
        }
        setIncoming(prev => removeIncomingInvite(prev, inviteId))
        return true
      } catch {
        return false
      }
    },
    [profileRef, identityRef]
  )

  const cancelOutgoing = useCallback((inviteId: string) => {
    setOutgoing(prev => removeOutgoingInvite(prev, inviteId))
  }, [])

  return {
    onlineCount,
    lobbyError,
    outgoing,
    incoming,
    inviteByEmail,
    acceptInvite,
    declineInvite,
    cancelOutgoing,
  }
}
