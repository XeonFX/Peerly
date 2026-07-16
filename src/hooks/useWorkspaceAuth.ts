import type { PeerHandshake } from '@trystero-p2p/core'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { SignedAllowList } from '../collab/allowList'
import { deriveUserId } from '../collab/userId'
import { WorkspaceAuthManager } from '../collab/workspaceAuth'
import { loadIdToken, loadIdentityProvider, type Session } from '../session'

export function useWorkspaceAuth(
  session: Session | null,
  onAllowListUpdated?: (list: SignedAllowList) => void
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
} {
  const onAllowListUpdatedRef = useRef(onAllowListUpdated)
  onAllowListUpdatedRef.current = onAllowListUpdated

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

  useEffect(() => {
    // New manager = new workspace (or re-auth): stale peer ids must not carry
    // identities verified under the previous one.
    peerUserIdsRef.current = new Map()
  }, [manager])

  const peerHandshake = useMemo(() => {
    if (!manager) return undefined
    return manager.buildPeerHandshake({
      onPeerVerified: (peerId, claims) => {
        void deriveUserId(claims.iss, claims.sub).then(userId => {
          peerUserIdsRef.current.set(peerId, userId)
        })
      },
      onAllowListUpdated: list => onAllowListUpdatedRef.current?.(list),
    })
  }, [manager])

  const resolvePeerUserId = useCallback(
    (peerId: string) => peerUserIdsRef.current.get(peerId),
    []
  )

  return { manager, peerHandshake, resolvePeerUserId }
}