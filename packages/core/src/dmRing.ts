import { encodeCanonicalLines } from './canonical.js'
import { verifyWithDeviceKeyId, type DeviceKeyId } from './deviceIdentity.js'
import type { DeviceSigner } from './textChatSigning.js'

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
  reason: DmRingReason
  /** Short text preview when reason is message. */
  preview?: string
  deviceKeyId: string
  sig: string
}

export function dmRingBytes(scheme: string, ring: Omit<DmRingPayload, 'sig'>): Uint8Array {
  return encodeCanonicalLines([
    scheme,
    ring.toUserId,
    ring.fromUserId,
    ring.fromName,
    ring.reason,
    ring.preview ?? '',
    ring.deviceKeyId,
  ])
}

export async function signDmRing(
  signer: DeviceSigner,
  scheme: string,
  fields: Omit<DmRingPayload, 'deviceKeyId' | 'sig'>
): Promise<DmRingPayload> {
  const deviceKeyId = await signer.publicKeyId()
  const body = { ...fields, deviceKeyId }
  return { ...body, sig: await signer.sign(dmRingBytes(scheme, body)) }
}

export async function verifyDmRing(scheme: string, ring: DmRingPayload): Promise<boolean> {
  return verifyWithDeviceKeyId(
    ring.deviceKeyId as DeviceKeyId,
    dmRingBytes(scheme, ring),
    ring.sig
  )
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
  if (msg.reason !== 'open' && msg.reason !== 'message') return null
  if (typeof msg.deviceKeyId !== 'string' || !msg.deviceKeyId || msg.deviceKeyId.length > 512) return null
  if (typeof msg.sig !== 'string' || !msg.sig || msg.sig.length > 512) return null
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
    reason: msg.reason,
    preview,
    deviceKeyId: msg.deviceKeyId,
    sig: msg.sig,
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
