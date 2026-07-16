import { useCallback, useEffect, useState } from 'react'
import {
  identityExpiryPhase,
  msUntilPhaseChange,
  type IdentityExpiryPhase,
} from '../collab/identityExpiry'
import { idTokenExpiryMs, loadIdToken } from '../session'

/**
 * Tracks the signed-in token's lifetime and re-evaluates exactly at the two
 * moments the answer can change (warning boundary, expiry) — no polling.
 * Call `refresh()` after a re-authentication stores a new token.
 */
export function useIdentityExpiry(): {
  phase: IdentityExpiryPhase
  expiresAtMs: number | null
  refresh: () => void
} {
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(() => {
    const token = loadIdToken()
    return token ? idTokenExpiryMs(token) : null
  })
  const [phase, setPhase] = useState<IdentityExpiryPhase>(() =>
    identityExpiryPhase(expiresAtMs, Date.now())
  )

  const refresh = useCallback(() => {
    const token = loadIdToken()
    setExpiresAtMs(token ? idTokenExpiryMs(token) : null)
  }, [])

  useEffect(() => {
    setPhase(identityExpiryPhase(expiresAtMs, Date.now()))
    const delay = msUntilPhaseChange(expiresAtMs, Date.now())
    if (delay === null) return
    const timer = window.setTimeout(
      () => setPhase(identityExpiryPhase(expiresAtMs, Date.now())),
      delay
    )
    return () => window.clearTimeout(timer)
    // phase in deps: after the first boundary fires we schedule the next one.
  }, [expiresAtMs, phase])

  return { phase, expiresAtMs, refresh }
}
