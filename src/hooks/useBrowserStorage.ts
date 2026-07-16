import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  estimateBrowserStorage,
  STORAGE_CHANGED_EVENT,
  storagePressure,
  type BrowserStorageEstimate,
} from '../utils/browserStorage'

const MIN_REFRESH_MS = 15_000
const ACTIVE_TRANSFER_REFRESH_MS = 60_000

export function useBrowserStorage(activeTransfers = false) {
  const [estimate, setEstimate] = useState<BrowserStorageEstimate>({
    supported: typeof navigator !== 'undefined' && Boolean(navigator.storage?.estimate),
    measuredAt: 0,
  })
  const [requestingPersistence, setRequestingPersistence] = useState(false)
  const lastRefreshRef = useRef(0)

  const refresh = useCallback(async (force = false) => {
    const now = Date.now()
    if (!force && now - lastRefreshRef.current < MIN_REFRESH_MS) return
    lastRefreshRef.current = now
    setEstimate(await estimateBrowserStorage())
  }, [])

  useEffect(() => {
    void refresh(true)
    const onFocus = () => void refresh()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const onStorageChanged = () => void refresh(true)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener(STORAGE_CHANGED_EVENT, onStorageChanged)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener(STORAGE_CHANGED_EVENT, onStorageChanged)
    }
  }, [refresh])

  useEffect(() => {
    if (!activeTransfers) return
    const timer = window.setInterval(() => void refresh(), ACTIVE_TRANSFER_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [activeTransfers, refresh])

  const requestPersistence = useCallback(async () => {
    if (!navigator.storage?.persist) return false
    setRequestingPersistence(true)
    try {
      const granted = await navigator.storage.persist()
      await refresh(true)
      return granted
    } finally {
      setRequestingPersistence(false)
    }
  }, [refresh])

  return useMemo(
    () => ({
      estimate,
      pressure: storagePressure(estimate.usageBytes, estimate.quotaBytes),
      refresh,
      requestPersistence,
      requestingPersistence,
    }),
    [estimate, refresh, requestPersistence, requestingPersistence]
  )
}
