import type { PeerHandshake } from '@trystero-p2p/core'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { SignedAllowList } from '../collab/allowList'
import { loadKeyBindings, rememberKeyBinding } from '../collab/keyBindings'
import type { DeviceKeyId } from '../collab/deviceIdentity'
import type { SignedFields } from '../collab/messageSigning'
import type { SignedReactionFields } from '../collab/reactionSigning'
import { deriveUserId } from '../collab/userId'
import { WorkspaceAuthManager } from '../collab/workspaceAuth'
import { loadIdToken, loadIdentityProvider, type Session } from '../session'

export type VerifiedPeerContact = {
  peerId: string
  userId: string
  email: string
  name: string
  deviceKeyId: DeviceKeyId
}

export function useWorkspaceAuth(
  session: Session | null,
  onAllowListUpdated?: (list: SignedAllowList) => void,
  onPeerContactVerified?: (contact: VerifiedPeerContact) => void
): {
  manager: WorkspaceAuthManager | null
  peerHandshake: PeerHandshake | undefined
  /**
   * Durable user id verified during `peerId`'s handshake, or undefined while
   * the hash is still computing or for peers that never handshook. This is the
   * only source messages may take a sender's user id from — anything a payload
   * claims about identity is attacker-controlled.
   */
  resolvePeerUserId: (peerId: string) => string | undefined
  /** Verified email/name from handshake — only source safe for invite/friends. */
  resolvePeerContact: (peerId: string) => Omit<VerifiedPeerContact, 'peerId' | 'deviceKeyId'> | undefined
  /** Sign message bytes with this device's key, or undefined pre-auth. */
  signMessage?: (fields: Omit<SignedFields, 'senderDeviceKeyId'>) => Promise<{ senderDeviceKeyId: string; signature: string }>
  signReaction?: (fields: Omit<SignedReactionFields, 'actorDeviceKeyId'>) => Promise<{ actorDeviceKeyId: string; signature: string }>
  /** userId a device key was bound to in a live handshake — history's trust root. */
  getBoundUserId: (deviceKeyId: DeviceKeyId) => string | undefined
} {
  const onAllowListUpdatedRef = useRef(onAllowListUpdated)
  onAllowListUpdatedRef.current = onAllowListUpdated
  const onPeerContactVerifiedRef = useRef(onPeerContactVerified)
  onPeerContactVerifiedRef.current = onPeerContactVerified

  const sessionRef = useRef(session)
  sessionRef.current = session

  const workspaceId = session?.workspaceId
  const creatorKeyId = session?.creatorKeyId
  const identityProvider = session?.identityProvider

  const manager = useMemo(() => {
    const current = sessionRef.current
    if (!workspaceId || !creatorKeyId || !current?.allowList) return null
    const instance = new WorkspaceAuthManager({
      workspaceId,
      creatorKeyId,
      allowList: current.allowList,
    })
    instance.setIdToken(loadIdToken(), loadIdentityProvider() ?? identityProvider)
    return instance
  }, [workspaceId, creatorKeyId, identityProvider])

  useEffect(() => {
    manager?.setAllowList(session?.allowList ?? manager.getAllowList())
  }, [manager, session?.allowList])

  const peerUserIdsRef = useRef(new Map<string, string>())
  const peerContactsRef = useRef(
    new Map<string, Omit<VerifiedPeerContact, 'peerId' | 'deviceKeyId'>>()
  )
  const keyBindingsRef = useRef<Record<string, string>>({})

  useEffect(() => {
    // New manager = new workspace (or re-auth): stale peer ids must not carry
    // identities verified under the previous one. Key bindings reload from the
    // per-workspace store instead of leaking across workspaces.
    peerUserIdsRef.current = new Map()
    peerContactsRef.current = new Map()
    keyBindingsRef.current = workspaceId ? loadKeyBindings(workspaceId) : {}
  }, [manager, workspaceId])

  // Bind our own key to our own durable id, so our messages relayed back to a
  // fresh device of ours keep their identity claim.
  const identityUserId = session?.identityUserId
  useEffect(() => {
    if (!manager || !workspaceId || !identityUserId) return
    void manager.deviceKeyId().then(deviceKeyId => {
      rememberKeyBinding(workspaceId, deviceKeyId, identityUserId)
      keyBindingsRef.current[deviceKeyId] = identityUserId
    })
  }, [manager, workspaceId, identityUserId])

  const peerHandshake = useMemo(() => {
    if (!manager) return undefined
    return manager.buildPeerHandshake({
      onPeerVerified: (peerId, claims, deviceKeyId) => {
        void deriveUserId(claims.iss, claims.sub).then(userId => {
          peerUserIdsRef.current.set(peerId, userId)
          const contact = {
            userId,
            email: claims.email,
            name: typeof claims.name === 'string' && claims.name ? claims.name : claims.email,
          }
          peerContactsRef.current.set(peerId, contact)
          // The one moment key, token, and possession-proof were all verified
          // together — the only place a key↔user binding may be learned.
          const boundWorkspaceId = sessionRef.current?.workspaceId
          if (boundWorkspaceId) {
            rememberKeyBinding(boundWorkspaceId, deviceKeyId, userId)
            keyBindingsRef.current[deviceKeyId] = userId
          }
          onPeerContactVerifiedRef.current?.({
            peerId,
            deviceKeyId,
            ...contact,
          })
        })
      },
      onAllowListUpdated: list => onAllowListUpdatedRef.current?.(list),
    })
  }, [manager])

  const resolvePeerUserId = useCallback(
    (peerId: string) => peerUserIdsRef.current.get(peerId),
    []
  )

  const resolvePeerContact = useCallback(
    (peerId: string) => peerContactsRef.current.get(peerId),
    []
  )

  const getBoundUserId = useCallback(
    (deviceKeyId: DeviceKeyId) => keyBindingsRef.current[deviceKeyId],
    []
  )

  const signMessage = useMemo(() => {
    if (!manager) return undefined
    return (fields: Omit<SignedFields, 'senderDeviceKeyId'>) => manager.signMessage(fields)
  }, [manager])

  const signReaction = useMemo(() => {
    if (!manager) return undefined
    return (fields: Omit<SignedReactionFields, 'actorDeviceKeyId'>) => manager.signReaction(fields)
  }, [manager])

  return {
    manager,
    peerHandshake,
    resolvePeerUserId,
    resolvePeerContact,
    signMessage,
    signReaction,
    getBoundUserId,
  }
}
