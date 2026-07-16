import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Peer, UserProfile } from '../../types'
import { sanitizePeerProfile } from '../../utils/profileSanitize'

const DEFAULT_PEER_COLOR = '#ababad'

export function usePeerProfiles(profile: UserProfile) {
  const [peers, setPeers] = useState<Record<string, Peer>>({})
  const profileRef = useRef(profile)
  profileRef.current = profile

  const profileActionRef = useRef<{
    send: (data: UserProfile, options?: { target?: string }) => Promise<void>
  } | null>(null)

  const reset = useCallback(() => {
    setPeers({})
  }, [])

  const upsertPeer = useCallback(
    (peerId: string, peerProfile?: Partial<UserProfile>, userId?: string) => {
      setPeers(prev => {
        const previous = prev[peerId]
        const defaultName = previous?.name ?? `Peer ${peerId.slice(0, 6)}`
        const defaultColor = previous?.color ?? DEFAULT_PEER_COLOR

        // Everything here crosses the wire from an untrusted peer — except
        // `userId`, which the caller resolves from the peer's verified
        // handshake and which is deliberately not part of the profile payload.
        const clean = peerProfile
          ? sanitizePeerProfile(peerProfile, { name: defaultName, color: defaultColor })
          : { name: defaultName, color: defaultColor, avatar: undefined }

        return {
          ...prev,
          [peerId]: {
            id: peerId,
            userId: userId ?? previous?.userId,
            name: clean.name,
            color: clean.color,
            avatar: clean.avatar || previous?.avatar,
          },
        }
      })
    },
    []
  )

  const removePeer = useCallback((peerId: string) => {
    setPeers(prev => {
      const next = { ...prev }
      delete next[peerId]
      return next
    })
  }, [])

  const broadcastProfile = useCallback((target?: string) => {
    if (!profileActionRef.current) return
    profileActionRef.current.send(profileRef.current, target ? { target } : undefined)
  }, [])

  const bindProfileAction = useCallback(
    (action: { send: (data: UserProfile, options?: { target?: string }) => Promise<void> }) => {
      profileActionRef.current = action
    },
    []
  )

  const unbindProfileAction = useCallback(() => {
    profileActionRef.current = null
  }, [])

  useEffect(() => {
    broadcastProfile()
  }, [profile, broadcastProfile])

  const peerList = useMemo(() => Object.values(peers), [peers])

  return {
    peers: peerList,
    upsertPeer,
    removePeer,
    broadcastProfile,
    bindProfileAction,
    unbindProfileAction,
    reset,
  }
}