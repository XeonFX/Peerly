import type { PeerHandshake } from '@trystero-p2p/core'
import { useEffect, useMemo, useRef } from 'react'
import type { SignedAllowList } from '../collab/allowList'
import { WorkspaceAuthManager } from '../collab/workspaceAuth'
import { loadIdToken, loadIdentityProvider, type Session } from '../session'

export function useWorkspaceAuth(
  session: Session | null,
  onAllowListUpdated?: (list: SignedAllowList) => void
): { manager: WorkspaceAuthManager | null; peerHandshake: PeerHandshake | undefined } {
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

  const peerHandshake = useMemo(() => {
    if (!manager) return undefined
    return manager.buildPeerHandshake({
      onAllowListUpdated: list => onAllowListUpdatedRef.current?.(list),
    })
  }, [manager])

  return { manager, peerHandshake }
}