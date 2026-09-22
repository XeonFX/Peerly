import { useCallback, useEffect, useMemo, useRef } from 'react'
import { createMessageOutbox, type OutboxStorage, type OutboxEntry } from './messageOutbox.js'
import { useConversationState } from './reactConversationState.js'
function useLatest<T>(value: T) { const ref = useRef(value); ref.current = value; return ref }

export function useMessageOutbox<T extends { id: string }>(storage: OutboxStorage, scope: string | null, enabled: boolean,
  deliver: (payload: T) => Promise<void>) {
  const outbox = useMemo(() => createMessageOutbox<T>(storage), [storage])
  const [entries, setEntries] = useConversationState<OutboxEntry<T>[]>(scope, () => [])
  const [error, setError] = useConversationState<string | null>(scope, () => null)
  const scopeRef = useLatest(scope), enabledRef = useLatest(enabled), deliverRef = useLatest(deliver)
  const mounted = useRef(false)
  const refresh = useCallback(async () => {
    if (!scope) { setEntries([]); return }
    const next = await outbox.list(scope)
    if (mounted.current && scopeRef.current === scope) setEntries(next)
  }, [outbox, scope, scopeRef, setEntries])
  const retry = useCallback(async () => {
    if (!scope || !enabledRef.current) return
    try {
      await outbox.flush(scope, deliverRef.current,
        () => mounted.current && scopeRef.current === scope && enabledRef.current,
        () => { void refresh().catch(() => {}) })
      if (mounted.current && scopeRef.current === scope) setError(null)
    } catch {
      if (mounted.current && scopeRef.current === scope) setError('Could not read or update pending messages. Keep this tab open and free browser storage.')
    }
  }, [outbox, scope, scopeRef, enabledRef, deliverRef, refresh, setError])
  useEffect(() => {
    mounted.current = true
    setEntries([])
    void refresh().catch(() => setError('Pending messages could not be loaded. Free browser storage and retry.'))
    void retry()
    const online = () => { void retry() }
    window.addEventListener('online', online)
    const timer = window.setInterval(online, 15_000)
    return () => { mounted.current = false; window.removeEventListener('online', online); window.clearInterval(timer) }
  }, [scope, enabled, refresh, retry, setEntries, setError])
  const enqueue = useCallback(async (payload: T) => {
    if (!scope) throw new Error('Sign in before sending a message.')
    await outbox.enqueue(scope, payload)
    await refresh().catch(() => { setError('Message saved, but pending delivery status could not be refreshed.') })
    void retry()
  }, [scope, outbox, refresh, retry, setError])
  const cancel = useCallback(async (id: string) => {
    if (!scope) return
    await outbox.remove(scope, id)
    await refresh()
  }, [outbox, scope, refresh])
  return { cancel, entries: entries.filter(entry => entry.scope === scope), enqueue, retry, error }
}
