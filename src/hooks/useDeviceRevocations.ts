import { useEffect } from 'react'
import { revokeRealtimeDevice, type DeviceSigner } from '@peerly/core'
import { PUBLIC_NETWORK_ENV } from '../config'
import { loadIdentityUserId } from '../session'
import { deviceRevocationQueue, REVOCATIONS_CHANGED } from '../collab/deviceRevocationQueue'

/** App-wide: revocation resumes even when the devices screen is closed. */
export function useDeviceRevocations(identity: DeviceSigner, userId?: string) {
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const current = () => !cancelled && loadIdentityUserId() === userId
    const retry = () => {
      void (async () => {
        const issuer = await identity.publicKeyId()
        if (!current()) return
        await deviceRevocationQueue.flush(userId, issuer,
          deviceKeyId => revokeRealtimeDevice(PUBLIC_NETWORK_ENV, deviceKeyId), current)
      })().catch(() => { /* The persisted pending row offers retry until ACK. */ })
    }
    retry()
    window.addEventListener('online', retry)
    window.addEventListener(REVOCATIONS_CHANGED, retry)
    const timer = window.setInterval(retry, 30_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('online', retry)
      window.removeEventListener(REVOCATIONS_CHANGED, retry)
    }
  }, [identity, userId])
}
