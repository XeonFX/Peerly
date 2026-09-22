import { useCallback, useRef, useState, type SetStateAction } from 'react'

/** A render can never read another conversation's state. Async callbacks retain
 * the generation that created them, including across A → B → A navigation. */
export function useConversationState<T>(scope: unknown, initial: () => T) {
  const generation = useRef<{ scope: unknown; id: number; initial: T } | null>(null)
  if (!generation.current || generation.current.scope !== scope) {
    generation.current = { scope, id: (generation.current?.id ?? -1) + 1, initial: initial() }
  }
  const id = generation.current.id
  const empty = generation.current.initial
  const [state, update] = useState({ id, value: empty })
  const isCurrent = useCallback(() => generation.current?.id === id, [id])
  const setValue = useCallback((next: SetStateAction<T>) => {
    if (!isCurrent()) return
    update(previous => {
      if (!isCurrent()) return previous
      const value = previous.id === id ? previous.value : empty
      return { id, value: typeof next === 'function' ? (next as (previous: T) => T)(value) : next }
    })
  }, [id, empty, isCurrent])
  return [state.id === id ? state.value : empty, setValue, isCurrent] as const
}
