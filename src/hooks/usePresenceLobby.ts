import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createPresenceIndex,
  createLobbyIdentityClient,
  lookupRendezvousId,
  PRESENCE_INTERVAL_MS,
  signControl,
  verifySignedControl,
  verifyOidcDeviceBinding,
  type OidcDeviceAttestation,
  type PresencePayload,
  type SignedControl,
} from '@peerly/core'
import { useLatest, useRelayChannel } from '@peerly/core/react'
import { NETWORK_APP_ID, PUBLIC_NETWORK_ENV } from '../config'
import type { DeviceIdentity } from '../collab/deviceIdentity'
import { defaultJwksFetcher, getIdentityProvider } from '../collab/identityProviders'
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
import { isPlausibleEmail, normalizeEmail } from '../collab/emailHash'
import {
  parseDmRingPayload,
  ringAuthorizedBy,
  signDmRing,
  verifyDmRing,
  type DmRingPayload,
  type DmRingReason,
} from '../collab/dmRing'
import { findDeviceGrant } from '../collab/deviceAuthorization'
import { LOBBY_ROOM_ID } from '../collab/mesh'
import {
  addFriend,
  dmDeviceKeyForFriend,
  dmSecretForFriend,
  isFriend,
  listFriends,
  loadFriends,
} from '../collab/friendsStore'
import {
  createWorkspaceInvite,
  parseWorkspaceInvitePayload,
  verifyWorkspaceInvite,
  workspaceInviteAllowsEmail,
  type WorkspaceInvitePayload,
} from '../collab/workspaceInvite'
import {
  loadIncomingWorkspaceInvites,
  loadOutgoingWorkspaceInvites,
  dismissIncomingWorkspaceInvite,
  isWorkspaceInviteDismissed,
  saveOutgoingWorkspaceInvites,
  upsertIncomingWorkspaceInvite,
  upsertOutgoingWorkspaceInvite,
  type IncomingWorkspaceInvite,
  type OutgoingWorkspaceInvite,
} from '../collab/workspaceInviteStore'
import type { WorkspaceInvite } from '../collab/inviteLink'
import { createPrivateLobbyActions } from '../collab/privateLobbyActions'

const PRESENCE_SCHEME = 'peerly-presence-v1'

/** Re-send undelivered (or re-deliver) invites while the peer stays online. */
const INVITE_RETRY_MS = 8_000

export type LobbyProfile = {
  userId: string
  name: string
  email: string
  color?: string
  avatar?: string
}

export type PresenceLobbyOptions = {
  identity: DeviceIdentity | null
  profile: LobbyProfile | null
  /** Fresh OIDC token bound to `identity` by its nonce. */
  attestation: OidcDeviceAttestation | null
  /** Bump friends UI when an accept lands. */
  onFriendsChanged?: () => void
  /** Friend rang this device to open a global DM room. */
  onDmRing?: (ring: DmRingPayload) => void
  /** Called once when a previously unseen valid friend request is received. */
  onFriendInvite?: (invite: IncomingFriendInvite) => void
  /** Called once when a previously unseen valid workspace invitation arrives. */
  onWorkspaceInvite?: (invite: IncomingWorkspaceInvite) => void
}

/**
 * Relay-forwarded public lobby for friend presence + email invites.
 *
 * Presence carries a short-lived Worker-certified identity without OIDC tokens or emails. Invites are signed with the device key
 * and delivered directed when a matching peer is online. Offline targets stay
 * in the local outgoing queue until they show up (no server mailbox).
 */
export function usePresenceLobby({
  identity,
  profile,
  attestation,
  onFriendsChanged,
  onDmRing,
  onFriendInvite,
  onWorkspaceInvite,
}: PresenceLobbyOptions) {
  const profileRef = useLatest(profile)
  const identityRef = useLatest(identity)
  const attestationRef = useLatest(attestation)
  const onFriendsChangedRef = useLatest(onFriendsChanged)
  const onDmRingRef = useLatest(onDmRing)
  const onFriendInviteRef = useLatest(onFriendInvite)
  const onWorkspaceInviteRef = useLatest(onWorkspaceInvite)

  const [outgoing, setOutgoing] = useState<OutgoingFriendInvite[]>(() => loadOutgoingInvites())
  const [incoming, setIncoming] = useState<IncomingFriendInvite[]>(() => loadIncomingInvites())
  const [outgoingWorkspace, setOutgoingWorkspace] = useState<OutgoingWorkspaceInvite[]>(
    () => loadOutgoingWorkspaceInvites()
  )
  const [incomingWorkspace, setIncomingWorkspace] = useState<IncomingWorkspaceInvite[]>(
    () => loadIncomingWorkspaceInvites()
  )
  const [onlineCount, setOnlineCount] = useState(0)
  const [lobbyError, setLobbyError] = useState<string | null>(null)
  const [presenceVersion, setPresenceVersion] = useState(0)

  const presenceIndexRef = useRef(createPresenceIndex())
  const connectedPeersRef = useRef(0)
  const myRendezvousIdRef = useRef<string>('')

  const sendersRef = useRef<{
    invite: (msg: FriendInvitePayload, to: string) => void
    inviteResp: (msg: FriendInviteResponsePayload, to: string) => void
    dmRing: (msg: DmRingPayload, to: string) => void
    workspaceInvite: (msg: WorkspaceInvitePayload, to: string) => void
  } | null>(null)

  const roomEnabled = Boolean(profile?.userId && profile.email && identity && attestation)
  const { room } = useRelayChannel({
    appId: `${NETWORK_APP_ID}-lobby-v1`,
    channel: roomEnabled ? `peerly:presence:${LOBBY_ROOM_ID}` : '',
    memberId: roomEnabled ? profile?.userId ?? '' : '',
    env: PUBLIC_NETWORK_ENV,
    durableEndpointPrefix: '/api/realtime/lobby/',
    durableRouteId: 'peerly-lobby-v1',
    onError: message => {
      if (connectedPeersRef.current === 0) setLobbyError(message)
    },
  })

  // The Worker derives this capability with a deployment secret after OIDC/device verification.
  useEffect(() => {
    if (!profile?.email) {
      myRendezvousIdRef.current = ''
      return
    }
    void lookupRendezvousId(profile.email).then(rendezvousId => {
      myRendezvousIdRef.current = rendezvousId ?? ''
    })
  }, [profile?.email])

  useEffect(() => {
    if (!room || !roomEnabled) {
      sendersRef.current = null
      return
    }

    const presence = presenceIndexRef.current

    const verifyAttestedPeer = async (value: {
      attestation: OidcDeviceAttestation
      deviceKeyId: string
      fromUserId: string
      fromEmail?: string
    }) => {
      const provider = getIdentityProvider(value.attestation.providerId)
      if (!provider) return null
      const binding = await verifyOidcDeviceBinding(
        value.attestation,
        {
          providerId: provider.id,
          deviceKeyId: value.deviceKeyId,
          userId: value.fromUserId,
        },
        {
          expectedAudience: provider.clientId,
          issuers: provider.issuers,
          fetchJwks: provider.fetchJwks ?? defaultJwksFetcher(provider.jwksUrl),
          jwksCacheKey: provider.id,
          emailVerifiedClaim: provider.emailVerifiedClaim,
        }
      )
      if (!binding) return null
      if (value.fromEmail && normalizeEmail(binding.claims.email) !== normalizeEmail(value.fromEmail)) {
        return null
      }
      return binding
    }

    const privateActions = createPrivateLobbyActions(room)
    const lobbyIdentity = createLobbyIdentityClient()
    let disposed = false
    const presenceAction = room.makeAction<SignedControl<PresencePayload & { invitationKey: string; certificate: string }>>('pres')
    const inviteAction = privateActions.makeAction<FriendInvitePayload>('finv')
    const inviteRespAction = privateActions.makeAction<FriendInviteResponsePayload>('finvr')
    const dmRingAction = privateActions.makeAction<DmRingPayload>('dmring')
    const workspaceInviteAction = privateActions.makeAction<WorkspaceInvitePayload>('winv')

    const announcePresence = (to?: string) => {
      const me = profileRef.current
      const id = identityRef.current
      if (!me || !id) return
      void (async () => {
        const certificate = await lobbyIdentity.issue()
        if (disposed || !certificate || certificate.userId !== me.userId ||
          certificate.deviceKeyId !== await id.publicKeyId()) return
        myRendezvousIdRef.current = certificate.rendezvousId
        const message = await signControl(id, PRESENCE_SCHEME, 'presence', me.userId, {
          userId: me.userId, name: me.name, rendezvousId: certificate.rendezvousId,
          invitationKey: await privateActions.publicKey(), certificate: certificate.certificate,
        })
        if (!disposed) await presenceAction.send(message, to ? { target: to } : undefined)
      })().catch(() => {})
    }

    const recordPresence = (peerId: string, parsed: PresencePayload) => {
      const me = profileRef.current
      if (me && parsed.userId === me.userId) return
      if (!parsed.rendezvousId) return
      presence.record(peerId, {
        userId: parsed.userId,
        name: parsed.name,
        rendezvousId: parsed.rendezvousId,
      })
      setPresenceVersion(v => v + 1)
    }

    const dropPeer = (peerId: string) => {
      if (!presence.get(peerId)) return
      presence.drop(peerId)
      privateActions.forgetPeer(peerId)
      setPresenceVersion(v => v + 1)
    }

    const prunePresence = () => {
      if (presence.prune()) setPresenceVersion(v => v + 1)
    }

    const deliverPendingInvites = () => {
      const now = Date.now()
      setOutgoing(prev => {
        let changed = false
        const next = prev.map(item => {
          const peerIds = item.toRendezvousId
            ? presence.peerIdsForRendezvousId(item.toRendezvousId)
            : []
          if (peerIds.length === 0) return item
          if (item.lastSentAt && now - item.lastSentAt < INVITE_RETRY_MS) return item
          for (const peerId of peerIds) void inviteAction.send(item.payload, { target: peerId })
          changed = true
          return { ...item, lastSentAt: now }
        })
        if (changed) saveOutgoingInvites(next)
        return changed ? next : prev
      })
      setOutgoingWorkspace(prev => {
        let changed = false
        const next = prev.map(item => {
          const peerIds = presence.peerIdsForRendezvousId(item.toRendezvousId)
          if (peerIds.length === 0) return item
          if (item.lastSentAt && now - item.lastSentAt < INVITE_RETRY_MS) return item
          for (const peerId of peerIds) {
            void workspaceInviteAction.send(item.payload, { target: peerId })
          }
          changed = true
          return { ...item, lastSentAt: now }
        })
        if (changed) saveOutgoingWorkspaceInvites(next)
        return changed ? next : prev
      })
    }

    sendersRef.current = {
      invite: (msg, to) => void inviteAction.send(msg, { target: to }),
      inviteResp: (msg, to) => void inviteRespAction.send(msg, { target: to }),
      dmRing: (msg, to) => void dmRingAction.send(msg, { target: to }),
      workspaceInvite: (msg, to) => void workspaceInviteAction.send(msg, { target: to }),
    }

    const refreshCounts = () => {
      const peers = Object.keys(room.getPeers()).length
      connectedPeersRef.current = peers
      setOnlineCount(peers + 1)
      if (peers > 0) setLobbyError(null)
    }

    presenceAction.onMessage = (raw, { peerId }) => {
      void (async () => {
        const message = await verifySignedControl<PresencePayload & { invitationKey?: string; certificate?: string }>(
          raw,
          PRESENCE_SCHEME,
          'presence'
        )
        // Old clients must upgrade; accepting token-bearing presence would
        // preserve the privacy leak and bypass the new identity boundary.
        if (!message || message.attestation) return
        const parsed = parsePresencePayload(message.payload)
        if (!parsed || parsed.userId !== message.userId) return
        const binding = await lobbyIdentity.verify(message.payload.certificate)
        if (disposed || !binding || binding.userId !== message.userId ||
          binding.deviceKeyId !== message.deviceKeyId || binding.rendezvousId !== parsed.rendezvousId) return
        if (!(await privateActions.rememberVerifiedPeer(peerId, message.deviceKeyId, message.payload.invitationKey))) return
        recordPresence(peerId, parsed)
        // New verified peer might match a pending invite.
        deliverPendingInvites()
      })()
    }

    dmRingAction.onMessage = (msg, { peerId }) => {
      const parsed = parseDmRingPayload(msg)
      if (!parsed) return
      const me = profileRef.current
      if (!me || parsed.toUserId !== me.userId) return
      if (parsed.fromUserId === me.userId) return
      // Only accept rings from people we already friended (mutual intent).
      const friends = loadFriends()
      if (!isFriend(friends, parsed.fromUserId)) return
      if (presence.get(peerId)?.userId !== parsed.fromUserId) return
      // The recorded device, or one it granted — otherwise a friend's second
      // device could never reach us.
      if (!ringAuthorizedBy(parsed, dmDeviceKeyForFriend(friends, parsed.fromUserId))) return
      const secret = dmSecretForFriend(friends, parsed.fromUserId)
      if (!secret) return
      void verifyDmRing(parsed).then(valid => {
        if (valid) onDmRingRef.current?.(parsed)
      })
    }

    inviteAction.onMessage = (msg, { peerId }) => {
      void (async () => {
        const parsed = parseFriendInvitePayload(msg)
        if (!parsed) return
        if (!(await verifyFriendInvite(parsed))) return
        if (!(await verifyAttestedPeer(parsed))) return
        const me = profileRef.current
        if (!me || parsed.toRendezvousId !== myRendezvousIdRef.current) return
        if (parsed.fromUserId === me.userId) return
        // Already friends — auto-ack so their outgoing queue clears.
        if (isFriend(loadFriends(), parsed.fromUserId)) {
          const id = identityRef.current
          const proof = attestationRef.current
          if (id && proof) {
            try {
              await addFriend(loadFriends(), id, {
                ownerUserId: me.userId,
                subjectUserId: parsed.fromUserId,
                subjectName: parsed.fromName,
                subjectEmail: parsed.fromEmail,
                dmSecret: parsed.dmSecret,
                subjectDeviceKeyId: parsed.deviceKeyId,
              })
              const resp = await createFriendInviteResponse(id, {
                inviteId: parsed.inviteId,
                accept: true,
                fromUserId: me.userId,
                fromName: me.name,
                fromEmail: me.email,
                toUserId: parsed.fromUserId,
                dmSecret: parsed.dmSecret,
                attestation: proof,
              })
              void inviteRespAction.send(resp, { target: peerId })
            } catch {
              // ignore
            }
          }
          return
        }
        const incomingInvite: IncomingFriendInvite = {
          inviteId: parsed.inviteId,
          fromUserId: parsed.fromUserId,
          fromName: parsed.fromName,
          payload: parsed,
          receivedAt: Date.now(),
        }
        const isNew = !loadIncomingInvites().some(item => item.inviteId === parsed.inviteId)
        setIncoming(prev => upsertIncomingInvite(prev, incomingInvite))
        if (isNew) onFriendInviteRef.current?.(incomingInvite)
      })()
    }

    inviteRespAction.onMessage = (msg, { peerId }) => {
      void (async () => {
        const parsed = parseFriendInviteResponsePayload(msg)
        if (!parsed) return
        if (!(await verifyFriendInviteResponse(parsed))) return
        const verified = await verifyAttestedPeer(parsed)
        if (!verified) return
        const me = profileRef.current
        const id = identityRef.current
        if (!me || !id) return
        if (parsed.toUserId !== me.userId) return

        // Capture typed target email before removing the pending row.
        const out = loadOutgoingInvites().find(o => o.inviteId === parsed.inviteId)
        if (!out || presence.get(peerId)?.userId !== parsed.fromUserId) return
        if (normalizeEmail(verified.claims.email) !== normalizeEmail(out.toEmail)) return
        setOutgoing(prev => removeOutgoingInvite(prev, parsed.inviteId))

        if (!parsed.accept) return
        if (parsed.dmSecret !== out.payload.dmSecret) return

        const email = normalizeEmail(parsed.fromEmail ?? out?.toEmail ?? '')
        if (!email || !isPlausibleEmail(email)) return
        if (isFriend(loadFriends(), parsed.fromUserId)) {
          await addFriend(loadFriends(), id, {
            ownerUserId: me.userId,
            subjectUserId: parsed.fromUserId,
            subjectName: parsed.fromName || email,
            subjectEmail: email,
            dmSecret: parsed.dmSecret,
            subjectDeviceKeyId: parsed.deviceKeyId,
          })
          onFriendsChangedRef.current?.()
          return
        }
        await addFriend(loadFriends(), id, {
          ownerUserId: me.userId,
          subjectUserId: parsed.fromUserId,
          subjectName: parsed.fromName || email,
          subjectEmail: email,
          dmSecret: parsed.dmSecret,
          subjectDeviceKeyId: parsed.deviceKeyId,
        })
        onFriendsChangedRef.current?.()
      })()
    }

    workspaceInviteAction.onMessage = raw => {
      void (async () => {
        const parsed = parseWorkspaceInvitePayload(raw)
        if (!parsed || !(await verifyWorkspaceInvite(parsed))) return
        const me = profileRef.current
        if (!me || parsed.toRendezvousId !== myRendezvousIdRef.current) return
        if (parsed.fromUserId === me.userId) return
        if (!workspaceInviteAllowsEmail(parsed, me.email)) return
        if (isWorkspaceInviteDismissed(parsed.inviteId)) return

        const entry: IncomingWorkspaceInvite = {
          inviteId: parsed.inviteId,
          fromUserId: parsed.fromUserId,
          fromName: parsed.fromName,
          payload: parsed,
          receivedAt: Date.now(),
        }
        const previous = loadIncomingWorkspaceInvites().find(
          invite => invite.payload.invite.workspaceId === parsed.invite.workspaceId
        )
        const isNew = !previous ||
          previous.payload.invite.allowList.signedAt < parsed.invite.allowList.signedAt
        setIncomingWorkspace(current => upsertIncomingWorkspaceInvite(current, entry))
        if (isNew) onWorkspaceInviteRef.current?.(entry)
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

    // Credentials may still be resolving on first join — announce once ready.
    void lookupRendezvousId(profileRef.current?.email ?? '').then(rendezvousId => {
      myRendezvousIdRef.current = rendezvousId ?? ''
      announcePresence()
    })
    refreshCounts()

    const presenceTimer = setInterval(() => {
      prunePresence()
      announcePresence()
      deliverPendingInvites()
    }, PRESENCE_INTERVAL_MS)

    return () => {
      disposed = true
      clearInterval(presenceTimer)
      presenceAction.onMessage = null
      inviteAction.onMessage = null
      inviteRespAction.onMessage = null
      dmRingAction.onMessage = null
      workspaceInviteAction.onMessage = null
      room.onPeerJoin = null
      room.onPeerLeave = null
      sendersRef.current = null
      presence.clear()
      connectedPeersRef.current = 0
      setOnlineCount(0)
    }
  }, [room, roomEnabled, profileRef, identityRef, attestationRef, onFriendsChangedRef, onDmRingRef, onFriendInviteRef, onWorkspaceInviteRef])

  const inviteByEmail = useCallback(
    async (toEmail: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      const me = profileRef.current
      const id = identityRef.current
      const proof = attestationRef.current
      if (!me || !id || !proof) return { ok: false, error: 'Sign in again before inviting' }
      if (!isPlausibleEmail(toEmail)) return { ok: false, error: 'Enter a valid email' }
      const normalized = normalizeEmail(toEmail)
      if (normalized === normalizeEmail(me.email)) {
        return { ok: false, error: 'That is your own email' }
      }

      // Already friends with someone who has this email?
      const friends = loadFriends()
      for (const f of friends.own.values()) {
        if (normalizeEmail(f.subjectEmail ?? '') === normalized) {
          if (dmSecretForFriend(friends, f.subjectUserId)) {
            return { ok: false, error: 'Already friends' }
          }
        }
      }

      const inviteId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `inv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

      try {
        const toRendezvousId = await lookupRendezvousId(normalized)
        if (!toRendezvousId) {
          return { ok: false, error: 'Private friend discovery is temporarily unavailable' }
        }
        const payload = await createFriendInvite(id, {
          inviteId,
          fromUserId: me.userId,
          fromName: me.name,
          fromEmail: me.email,
          toRendezvousId,
          attestation: proof,
        })
        const entry: OutgoingFriendInvite = {
          inviteId,
          toEmail: normalized,
          toRendezvousId,
          payload,
          createdAt: Date.now(),
          lastSentAt: 0,
        }
        setOutgoing(prev => upsertOutgoingInvite(prev, entry))

        const peerIds = presenceIndexRef.current.peerIdsForRendezvousId(toRendezvousId)
        if (peerIds.length && sendersRef.current) {
          for (const peerId of peerIds) sendersRef.current.invite(payload, peerId)
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
    [profileRef, identityRef, attestationRef]
  )

  const acceptInvite = useCallback(
    async (inviteId: string): Promise<boolean> => {
      const me = profileRef.current
      const id = identityRef.current
      const proof = attestationRef.current
      if (!me || !id || !proof) return false
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
          dmSecret: entry.payload.dmSecret,
          attestation: proof,
        })
        const peerIds = presenceIndexRef.current.peerIdsForUserId(entry.fromUserId)
        if (sendersRef.current) {
          for (const peerId of peerIds) sendersRef.current.inviteResp(resp, peerId)
        }

        if (!isFriend(loadFriends(), entry.fromUserId)) {
          await addFriend(loadFriends(), id, {
            ownerUserId: me.userId,
            subjectUserId: entry.fromUserId,
            subjectName: entry.fromName,
            subjectEmail: entry.payload.fromEmail,
            dmSecret: entry.payload.dmSecret,
            subjectDeviceKeyId: entry.payload.deviceKeyId,
          })
        }
        setIncoming(prev => removeIncomingInvite(prev, inviteId))
        onFriendsChangedRef.current?.()
        return true
      } catch {
        return false
      }
    },
    [profileRef, identityRef, attestationRef, onFriendsChangedRef]
  )

  const declineInvite = useCallback(
    async (inviteId: string): Promise<boolean> => {
      const me = profileRef.current
      const id = identityRef.current
      const proof = attestationRef.current
      if (!me || !id || !proof) return false
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
          attestation: proof,
        })
        const peerIds = presenceIndexRef.current.peerIdsForUserId(entry.fromUserId)
        if (sendersRef.current) {
          for (const peerId of peerIds) sendersRef.current.inviteResp(resp, peerId)
        }
        setIncoming(prev => removeIncomingInvite(prev, inviteId))
        return true
      } catch {
        return false
      }
    },
    [profileRef, identityRef, attestationRef]
  )

  const cancelOutgoing = useCallback((inviteId: string) => {
    setOutgoing(prev => removeOutgoingInvite(prev, inviteId))
  }, [])

  const inviteToWorkspace = useCallback(
    async (emails: string[], invite: WorkspaceInvite): Promise<void> => {
      const me = profileRef.current
      const id = identityRef.current
      if (!me || !id) throw new Error('Sign in again before inviting')

      const targets = [...new Set(emails.map(normalizeEmail))].filter(
        email => isPlausibleEmail(email) && email !== normalizeEmail(me.email)
      )
      for (const toEmail of targets) {
        const toRendezvousId = await lookupRendezvousId(toEmail)
        // The signed allow-list and copyable link remain authoritative. A
        // missing rendezvous capability only means live notification delivery
        // is unavailable for this address right now.
        if (!toRendezvousId) continue
        const inviteId = crypto.randomUUID()
        const payload = await createWorkspaceInvite(id, {
          inviteId,
          fromUserId: me.userId,
          fromName: me.name,
          toRendezvousId,
          invite,
        })
        const entry: OutgoingWorkspaceInvite = {
          inviteId,
          toEmail,
          toRendezvousId,
          payload,
          createdAt: Date.now(),
          lastSentAt: 0,
        }
        setOutgoingWorkspace(current => upsertOutgoingWorkspaceInvite(current, entry))

        const peerIds = presenceIndexRef.current.peerIdsForRendezvousId(toRendezvousId)
        const senders = sendersRef.current
        if (senders && peerIds.length > 0) {
          for (const peerId of peerIds) senders.workspaceInvite(payload, peerId)
          setOutgoingWorkspace(current => {
            const next = current.map(value =>
              value.inviteId === inviteId ? { ...value, lastSentAt: Date.now() } : value
            )
            saveOutgoingWorkspaceInvites(next)
            return next
          })
        }
      }
    },
    [profileRef, identityRef]
  )

  const dismissWorkspaceInvite = useCallback((inviteId: string) => {
    setIncomingWorkspace(current => dismissIncomingWorkspaceInvite(current, inviteId))
  }, [])

  /** True when this durable userId announced presence on the lobby recently. */
  const isUserOnline = useCallback(
    (userId: string | undefined) => {
      void presenceVersion
      return presenceIndexRef.current.isUserOnline(userId)
    },
    [presenceVersion]
  )

  /**
   * Ping a friend over the lobby to open (or re-open) the global DM room.
   * Returns false when they are not currently present on the mesh.
   */
  const ringDm = useCallback(
    (toUserId: string, reason: DmRingReason, preview?: string): boolean => {
      const me = profileRef.current
      const senders = sendersRef.current
      if (!me || !senders || !toUserId || toUserId === me.userId) return false
      if (!isFriend(loadFriends(), toUserId)) return false
      const peerIds = presenceIndexRef.current.peerIdsForUserId(toUserId)
      if (peerIds.length === 0) return false
      const identity = identityRef.current
      if (!identity) return false
      void (async () => {
        // The recipient only trusts the device that recorded the friendship.
        // Ringing from any other one needs the grant that authorises it.
        const entry = listFriends(loadFriends()).find(f => f.subjectUserId === toUserId)
        const currentDeviceKeyId = await identity.publicKeyId()
        // Their record of us is the device that signed our own entry for them —
        // both are written in the same exchange — so that is the grant issuer
        // they will check against.
        const deviceGrant = entry && entry.deviceKeyId !== currentDeviceKeyId
          ? findDeviceGrant(me.userId, entry.deviceKeyId, currentDeviceKeyId)
          : undefined
        const payload = await signDmRing(identity, {
          toUserId,
          fromUserId: me.userId,
          fromName: me.name,
          reason,
          preview: preview?.trim().slice(0, 120) || undefined,
          ...(deviceGrant ? { deviceGrant } : {}),
        })
        for (const peerId of peerIds) senders.dmRing(payload, peerId)
      })()
      return true
    },
    [profileRef, identityRef]
  )

  return {
    onlineCount,
    lobbyError,
    outgoing,
    incoming,
    outgoingWorkspace,
    incomingWorkspace,
    inviteByEmail,
    inviteToWorkspace,
    acceptInvite,
    declineInvite,
    cancelOutgoing,
    dismissWorkspaceInvite,
    isUserOnline,
    ringDm,
  }
}
