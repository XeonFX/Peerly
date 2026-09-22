import { useCallback, useEffect, useRef } from 'react'
import { useConversationState } from './reactConversationState.js'

export const HISTORY_STORAGE_ERROR = 'History is not saved on this device. Keep this tab open, free browser storage and retry.'
/** Shared persistence status and retry for synchronous local history stores.
 * Only failed writes are retried on the timer; successful unchanged snapshots
 * are never rewritten merely because a tab is open. */
export function useHistoryPersistence<T>(scope: unknown, enabled: boolean, value: T, save: (value: T) => boolean) {
  const [error, setError, isCurrent] = useConversationState<string | null>(scope, () => null)
  const latest = useRef({ value, save, enabled, error })
  latest.current = { value, save, enabled, error }
  const retry = useCallback(() => {
    if (!isCurrent() || !latest.current.enabled) return
    try { setError(latest.current.save(latest.current.value) ? null : HISTORY_STORAGE_ERROR) }
    catch { setError(HISTORY_STORAGE_ERROR) }
  }, [isCurrent, setError])
  useEffect(() => { retry() }, [retry, value, enabled])
  useEffect(() => {
    if (!enabled) return
    const retryFailed = () => { if (latest.current.error) retry() }
    const timer = window.setInterval(retryFailed, 15_000)
    window.addEventListener('online', retryFailed)
    return () => { window.clearInterval(timer); window.removeEventListener('online', retryFailed) }
  }, [retry, enabled])
  return { error, retry }
}
