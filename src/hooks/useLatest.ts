import { useRef } from 'react'

/** Keeps a ref synced with the latest value — avoids stale closures in long-lived subscriptions. */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}