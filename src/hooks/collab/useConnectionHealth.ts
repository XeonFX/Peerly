import { useCallback, useEffect, useRef, useState } from 'react'
import type { joinRoom } from '@trystero-p2p/nostr'
import {
  ALONE_WARNING_MS,
  ALONE_WARNING_NOTICE,
  CONNECTION_POLL_MS,
  RELAY_OFFLINE_ERROR,
} from '../../collab/constants'
import { getConnectedRelayUrls, isRelayOnline } from '../../collab/relayHealth'
import { scheduleSessionRelayProbe } from '../../collab/relayDiagnostics'
import type { ConnectionStatus } from '../../types'
import { useP2pCapability } from '../useP2pCapability'

type Room = ReturnType<typeof joinRoom>

export function useConnectionHealth(room: Room | null) {
  const p2p = useP2pCapability()
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null)
  const [relayOnline, setRelayOnline] = useState(false)
  const [relayUrls, setRelayUrls] = useState<string[]>([])
  const [rtcPeerCount, setRtcPeerCount] = useState(0)
  const connectionErrorRef = useRef(connectionError)
  connectionErrorRef.current = connectionError

  const setError = (message: string) => {
    setConnectionNotice(null)
    setConnectionStatus('error')
    setConnectionError(message)
  }

  const markConnected = () => {
    setConnectionStatus('connected')
    setConnectionError(null)
    setConnectionNotice(null)
  }

  const reset = useCallback(() => {
    setConnectionStatus('connecting')
    setConnectionError(null)
    setConnectionNotice(null)
    setRelayOnline(false)
    setRtcPeerCount(0)
    setRelayUrls([])
  }, [])

  useEffect(() => {
    if (!room) return
    scheduleSessionRelayProbe()

    const tick = () => {
      const urls = getConnectedRelayUrls()
      setRelayUrls(urls)
      const online = isRelayOnline()
      setRelayOnline(online)

      if (!online) {
        setError(RELAY_OFFLINE_ERROR)
        return
      }

      const count = Object.keys(room.getPeers()).length
      setRtcPeerCount(count)

      if (count > 0) {
        markConnected()
        return
      }

      const currentError = connectionErrorRef.current
      if (currentError === RELAY_OFFLINE_ERROR) {
        setConnectionError(null)
      }

      setConnectionStatus(prev => (prev === 'error' && currentError !== RELAY_OFFLINE_ERROR ? prev : 'ready'))
    }

    tick()
    const id = window.setInterval(tick, CONNECTION_POLL_MS)
    return () => window.clearInterval(id)
  }, [room])

  useEffect(() => {
    if (!room || connectionStatus !== 'ready' || connectionError) return

    const id = window.setTimeout(() => {
      if (Object.keys(room.getPeers()).length === 0) {
        setConnectionNotice(ALONE_WARNING_NOTICE)
      }
    }, ALONE_WARNING_MS)

    return () => window.clearTimeout(id)
  }, [room, connectionStatus, connectionError])

  return {
    connectionStatus,
    connectionError,
    connectionNotice,
    relayOnline,
    relayUrls,
    rtcPeerCount,
    p2pCapability: p2p.capability,
    retryP2pCapability: p2p.retry,
    setConnectionStatus,
    setConnectionError,
    setRtcPeerCount,
    setError,
    markConnected,
    reset,
    isReady: room !== null && relayOnline,
  }
}
