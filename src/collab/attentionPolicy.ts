/**
 * Whether to raise an OS notification.
 *
 * Interrupting someone is the kind of decision worth being able to test
 * without a browser, so the rule is here and the `new Notification(...)` call
 * stays at the call site.
 *
 * All four conditions are refusals, and the order does not matter — what
 * matters is that a visible tab never raises one. The in-app banner has
 * already told them; a second alert for something they are looking at is the
 * behaviour that makes people turn notifications off entirely.
 */
export type AttentionContext = {
  /** `document.visibilityState`, or whatever stands for it. */
  visibility: string
  /** The user's own preference. */
  enabled: boolean
  /** Whether the Notification API exists in this browser at all. */
  supported: boolean
  /** `Notification.permission`. */
  permission: string
}

export function shouldRaiseNotification(context: AttentionContext): boolean {
  if (context.visibility === 'visible') return false
  if (!context.enabled) return false
  if (!context.supported) return false
  return context.permission === 'granted'
}
