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

  const manager = useMemo(() => {
    if (!session) return null
    const instance = new WorkspaceAuthManager({
      workspaceId: session.workspaceId,
      creatorKeyId: session.creatorKeyId,
      allowList: session.allowList,
    })
    instance.setIdToken(loadIdToken(), loadIdentityProvider() ?? session.identityProvider)
    return instance
  }, [session?.workspaceId, session?.creatorKeyId, session?.allowList.signedAt])

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