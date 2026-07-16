import { useCallback, useEffect, useState } from 'react'
import { probeP2pCapability } from '../collab/p2pCapability'
import type { P2pCapability } from '../types'

const CHECKING: P2pCapability = {
  status: 'checking',
  detail: 'Testing whether this browser allows WebRTC data channels…',
}

export function useP2pCapability() {
  const [capability, setCapability] = useState<P2pCapability>(CHECKING)
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => {
    setCapability(CHECKING)
    setAttempt(value => value + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    void probeP2pCapability().then(result => {
      if (!cancelled) setCapability(result)
    })
    return () => {
      cancelled = true
    }
  }, [attempt])

  return { capability, retry }
}
