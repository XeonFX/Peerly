/**
 * Sending over a peer connection that may have just gone away.
 *
 * A peer refreshing or closing a tab makes an in-flight send reject, and
 * there is no ordering that avoids it — the send is already on its way when
 * the channel closes. Those rejections are noise. Everything else is a real
 * transport problem and has to stay visible.
 */
const EXPECTED_DISCONNECT_PATTERNS = [
  /RTCDataChannel/i,
  /readyState is not ['"]?open/i,
  /data channel.*(?:closed|closing|not open)/i,
  /peer.*(?:disconnected|left|closed)/i,
  /no (?:active )?peer/i,
  /no peer with id/i,
  /room.*(?:left|closed)/i,
] as const

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : String(error)
}

/** Normal disconnect races, expected while a peer refreshes or leaves. */
export function isExpectedActionSendError(error: unknown): boolean {
  const message = errorMessage(error)
  return EXPECTED_DISCONNECT_PATTERNS.some(pattern => pattern.test(message))
}

/**
 * Runs a send, reporting only failures that are not an ordinary disconnect.
 * Returns whether it got through.
 */
export async function sendActionSafely(
  send: () => Promise<unknown>,
  label: string,
  report: (message: string, error: unknown) => void = console.warn
): Promise<boolean> {
  try {
    await send()
    return true
  } catch (error) {
    if (!isExpectedActionSendError(error)) report(`${label} failed`, error)
    return false
  }
}

/** Fire-and-forget variant, for sends whose result nothing waits on. */
export function sendActionInBackground(send: () => Promise<unknown>, label: string): void {
  void sendActionSafely(send, label)
}
