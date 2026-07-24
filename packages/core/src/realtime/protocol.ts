import type { RealtimeFrame } from './types.js'

let counter = 0
/** Unique per-command id: timestamp + monotonic counter, no crypto needed for this. */
export function nextCommandId(): string {
  counter = (counter + 1) % 1_000_000
  return `${Date.now().toString(36)}-${counter.toString(36)}`
}

export function encodeCommand(type: string, payload?: unknown, scope?: string): { id: string; text: string } {
  const id = nextCommandId()
  const frame: RealtimeFrame = { v: 1, id, type, sentAt: Date.now(), ...(scope ? { scope } : {}), ...(payload !== undefined ? { payload } : {}) }
  return { id, text: JSON.stringify(frame) }
}

export function decodeFrame(raw: string): RealtimeFrame | null {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && parsed.v === 1 && typeof parsed.type === 'string') return parsed as RealtimeFrame
    return null
  } catch {
    return null
  }
}
