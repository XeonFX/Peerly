import {
  coordinationMemberId,
  coordinationScope,
  createRelayCoordinator,
  openCoordinationData,
  sealCoordinationData,
} from '@peerly/core'
import { useEffect, useState } from 'react'
import type { Peer, UserProfile } from '../../types'
import { sanitizePeerProfile } from '../../utils/profileSanitize'
import { PUBLIC_NETWORK_ENV } from '../../config'

type PresenceData = UserProfile & { userId: string }

/** ICE-independent visibility; messaging and actions still require verified P2P. */
export function useRelayWorkspacePresence(options: {
  enabled: boolean
  workspaceId: string
  workspaceSecret?: string
  selfUserId?: string
  profile: UserProfile
}) {
  const { enabled, workspaceId, workspaceSecret, selfUserId, profile } = options
  const [peers, setPeers] = useState<Peer[]>([])
  useEffect(() => {
    if (!enabled || !workspaceSecret || !selfUserId) {
      setPeers([])
      return
    }
    let cancelled = false
    let activeScope = ''
    let activeMemberId = ''
    const coordinator = createRelayCoordinator(PUBLIC_NETWORK_ENV)
    const unsubscribe = coordinator.subscribe(event => {
      if (event.type !== 'presence.snapshot' || event.scope !== activeScope) return
      void (async () => {
        const byUser = new Map<string, Peer>()
        for (const member of event.members) {
          if (member.memberId === activeMemberId) continue
          const data = await openCoordinationData<PresenceData>(
            workspaceSecret,
            'workspace-presence',
            member.data
          )
          if (!data || typeof data.userId !== 'string' || !data.userId || data.userId === selfUserId) continue
          const clean = sanitizePeerProfile(data, { name: 'Workspace member', color: '#ababad' })
          byUser.set(data.userId, {
            id: `relay:${member.memberId}`,
            userId: data.userId,
            presenceOnly: true,
            name: clean.name,
            color: clean.color,
          })
        }
        if (!cancelled) setPeers([...byUser.values()])
      })()
    })

    void (async () => {
      const scope = await coordinationScope(`workspace:${workspaceId}`, workspaceSecret)
      const memberId = await coordinationMemberId(workspaceSecret, selfUserId)
      const data = await sealCoordinationData(workspaceSecret, 'workspace-presence', {
        userId: selfUserId,
        name: profile.name,
        color: profile.color,
      } satisfies PresenceData)
      if (cancelled) return
      activeScope = scope
      activeMemberId = memberId
      coordinator.setPresence(scope, memberId, data)
    })()

    return () => {
      cancelled = true
      unsubscribe()
      if (activeScope) coordinator.clearPresence(activeScope)
      coordinator.close()
      setPeers([])
    }
  }, [enabled, profile.name, profile.color, selfUserId, workspaceId, workspaceSecret])

  return peers
}
