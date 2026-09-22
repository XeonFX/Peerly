import { useCallback, useMemo, useRef } from 'react'

type SendableAction<T> = {
  send: (data: T, options?: { target?: string }) => Promise<void>
}

type PendingAction<T> = {
  data: T
  options?: { target?: string }
  resolve: () => void
  reject: (error: unknown) => void
}

const MAX_PENDING_ACTIONS = 100

export function useRoomAction<T>(options?: { queueWhenUnbound?: boolean }) {
  const queueWhenUnbound = options?.queueWhenUnbound === true
  const actionRef = useRef<SendableAction<T> | null>(null)
  const pendingRef = useRef<PendingAction<T>[]>([])

  const bind = useCallback((action: SendableAction<T>) => {
    actionRef.current = action
    const pending = pendingRef.current.splice(0, pendingRef.current.length)
    // Preserve the order in which the UI accepted messages. Each durable send
    // resolves only after the server ack, so parallel flushing could let a
    // later message commit before an earlier one during reconnect.
    void (async () => {
      for (const item of pending) {
        try {
          await action.send(item.data, item.options)
          item.resolve()
        } catch (error) {
          item.reject(error)
        }
      }
    })()
  }, [])

  const unbind = useCallback(() => {
    actionRef.current = null
  }, [])

  const clearPending = useCallback(() => {
    const pending = pendingRef.current.splice(0, pendingRef.current.length)
    for (const item of pending) item.reject(new Error('room-action-scope-changed'))
  }, [])

  const send = useCallback(
    async (data: T, options?: { target?: string }) => {
      if (!actionRef.current) {
        if (!queueWhenUnbound) return
        return new Promise<void>((resolve, reject) => {
          if (pendingRef.current.length >= MAX_PENDING_ACTIONS) {
            pendingRef.current.shift()?.reject(new Error('room-action-queue-full'))
          }
          pendingRef.current.push({
            data,
            ...(options === undefined ? {} : { options }),
            resolve,
            reject,
          })
        })
      }
      await actionRef.current.send(data, options)
    },
    [queueWhenUnbound]
  )

  return useMemo(
    () => ({ bind, unbind, clearPending, send }),
    [bind, unbind, clearPending, send]
  )
}
