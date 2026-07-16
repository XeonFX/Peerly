import { useCallback, useMemo, useRef } from 'react'

type SendableAction<T> = {
  send: (data: T, options?: { target?: string }) => Promise<void>
}

export function useRoomAction<T>() {
  const actionRef = useRef<SendableAction<T> | null>(null)

  const bind = useCallback((action: SendableAction<T>) => {
    actionRef.current = action
  }, [])

  const unbind = useCallback(() => {
    actionRef.current = null
  }, [])

  const send = useCallback(
    async (data: T, options?: { target?: string }) => {
      if (!actionRef.current) return
      await actionRef.current.send(data, options)
    },
    []
  )

  return useMemo(() => ({ bind, unbind, send }), [bind, unbind, send])
}