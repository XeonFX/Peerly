/**
 * Lobby-level DM ring protocol. The DM itself lives in a private Trystero room
 * (see dmRoomCode); the ring only tells a friend "open this room" over a shared
 * presence lobby. Wire shape is app-shared; schemes for room codes stay app-owned.
 */

export type DmRingReason = 'open' | 'message'

export type DmRingPayload = {
  toUserId: string
  fromUserId: string
  fromName: string
  /** Deterministic DM room code (32 hex). */
  code: string
  reason: DmRingReason
  /** Short text preview when reason is message. */
  preview?: string
}

const CODE_RE = /^[0-9a-f]{32}$/i

export function isValidDmRoomCode(code: string): boolean {
  return CODE_RE.test(code)
}

/** Validate and normalize an untrusted wire payload; null if unusable. */
export function parseDmRingPayload(raw: unknown): DmRingPayload | null {
  if (typeof raw !== 'object' || raw === null) return null
  const msg = raw as Partial<DmRingPayload>
  if (typeof msg.toUserId !== 'string' || !msg.toUserId.trim()) return null
  if (typeof msg.fromUserId !== 'string' || !msg.fromUserId.trim()) return null
  if (msg.toUserId === msg.fromUserId) return null
  if (typeof msg.code !== 'string' || !isValidDmRoomCode(msg.code)) return null
  if (msg.reason !== 'open' && msg.reason !== 'message') return null
  const fromName =
    typeof msg.fromName === 'string' && msg.fromName.trim()
      ? msg.fromName.trim().slice(0, 80)
      : msg.fromUserId.slice(0, 12)
  const preview =
    typeof msg.preview === 'string' && msg.preview.trim()
      ? msg.preview.trim().slice(0, 120)
      : undefined
  return {
    toUserId: msg.toUserId.trim(),
    fromUserId: msg.fromUserId.trim(),
    fromName,
    code: msg.code.toLowerCase(),
    reason: msg.reason,
    preview,
  }
}

/**
 * The caller often re-rings every few seconds until the friend joins, so one
 * "open chat" produces a stream of identical ring payloads. Showing a toast
 * per payload floods the recipient. Pure decision for one toast per DM:
 *
 * - toast still visible → 'skip' for open-rings, 'replace' for message-rings
 * - toast gone → open-rings wait out the cooldown; message-rings always show
 */
export type DmRingToastDecision = 'show' | 'replace' | 'skip'

/** How long after a dismissed/expired ring toast the same DM may toast again. */
export const DM_RING_TOAST_COOLDOWN_MS = 60_000

export function decideDmRingToast(
  reason: DmRingReason,
  entry: { toastVisible: boolean; shownAt: number } | undefined,
  nowMs: number,
  cooldownMs: number = DM_RING_TOAST_COOLDOWN_MS
): DmRingToastDecision {
  if (!entry) return 'show'
  if (entry.toastVisible) return reason === 'message' ? 'replace' : 'skip'
  if (reason === 'message') return 'show'
  return nowMs - entry.shownAt < cooldownMs ? 'skip' : 'show'
}
