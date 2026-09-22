import { encodeCanonicalLines } from './canonical.js'
import { verifyWithDeviceKeyId, type DeviceKeyId } from './deviceIdentity.js'
import { grantAuthorizes, type DeviceAuthorization, type DeviceGrant } from './deviceAuthorization.js'
import type { DeviceSigner } from './textChatSigning.js'

/**
 * Lobby-level DM ring protocol. The DM itself lives in a private room (see
 * dmRoomCode); the ring only tells a friend "open this room" over a shared
 * presence lobby.
 *
 * A ring is signed, and the recipient only honours one from the device their
 * friend was recorded under. That breaks the moment the friend picks up a
 * second device, so a ring sent from anywhere other than the recorded device
 * carries the grant that authorises it — the same device-pairing proof used
 * for chat messages. One app did this and the other did not, which meant
 * rings from a friend's second device were dropped in silence.
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
  /** Present only when sending from a device other than the recorded one. */
  deviceGrant?: DeviceGrant
}

export type DmRingConfig = {
  /** Signed into every ring. Distinct per app. */
  readonly scheme: string
  /** Checks the grant a non-primary device attaches to its ring. */
  readonly grants: Pick<DeviceAuthorization, 'verify'>
}

export type DmRing = {
  /** Canonical signing input. Exposed so tests can forge and tamper. */
  bytes(ring: Omit<DmRingPayload, 'sig'>): Uint8Array
  sign(
    signer: DeviceSigner,
    fields: Omit<DmRingPayload, 'deviceKeyId' | 'sig'>
  ): Promise<DmRingPayload>
  /** Signature and, when attached, the grant that backs the sending device. */
  verify(ring: DmRingPayload): Promise<boolean>
  /**
   * Whether the signing device may ring on this sender's behalf: either it is
   * the device the recipient recorded, or that device granted it. Call after
   * `verify` — this trusts the grant's contents.
   */
  authorizedBy(ring: DmRingPayload, recordedDeviceKeyId: string | undefined): boolean
}

/** The grant fields, appended so a ring cannot be replayed with a different
 *  grant swapped in. Empty when no grant is attached, which keeps the input
 *  byte-identical to a ring sent from the recorded device. */
function grantLines(grant: DeviceGrant | undefined): string[] {
  return grant
    ? [grant.issuerDeviceKeyId, grant.subjectDeviceKeyId, grant.pairingId, grant.sig]
    : []
}

/** @deprecated Use createDmRing. Retains the grant-free 1.x wire format. */
export function dmRingBytes(scheme: string, ring: Omit<DmRingPayload, 'sig'>): Uint8Array {
  return encodeCanonicalLines([
    scheme, ring.toUserId, ring.fromUserId, ring.fromName, ring.reason,
    ring.preview ?? '', ring.deviceKeyId,
  ])
}

/** @deprecated Use createDmRing to support authorized secondary devices. */
export async function signDmRing(
  signer: DeviceSigner,
  scheme: string,
  fields: Omit<DmRingPayload, 'deviceKeyId' | 'sig'>
): Promise<DmRingPayload> {
  if (fields.deviceGrant !== undefined) throw new Error('Use createDmRing to sign device grants')
  const body = { ...fields, deviceKeyId: await signer.publicKeyId() }
  return { ...body, sig: await signer.sign(dmRingBytes(scheme, body)) }
}

/** @deprecated Signature-only legacy API; callers must still authorize the sender. */
export async function verifyDmRing(scheme: string, ring: DmRingPayload): Promise<boolean> {
  // The legacy signature does not cover a grant. Never return success for an
  // attached grant that a caller might then trust without verifying it.
  if (ring.deviceGrant !== undefined) return false
  return verifyWithDeviceKeyId(ring.deviceKeyId as DeviceKeyId, dmRingBytes(scheme, ring), ring.sig)
}

export function createDmRing(config: DmRingConfig): DmRing {
  function bytes(ring: Omit<DmRingPayload, 'sig'>): Uint8Array {
    return encodeCanonicalLines([
      config.scheme,
      ring.toUserId,
      ring.fromUserId,
      ring.fromName,
      ring.reason,
      ring.preview ?? '',
      ring.deviceKeyId,
      ...grantLines(ring.deviceGrant),
    ])
  }

  return {
    bytes,

    async sign(signer, fields) {
      const deviceKeyId = await signer.publicKeyId()
      const body = { ...fields, deviceKeyId }
      return { ...body, sig: await signer.sign(bytes(body)) }
    },

    async verify(ring) {
      if (ring.deviceGrant) {
        if (!(await config.grants.verify(ring.deviceGrant))) return false
        // The grant must be about this sender, and about the very device that
        // signed this ring — otherwise any valid grant would do.
        if (ring.deviceGrant.userId !== ring.fromUserId) return false
        if (ring.deviceGrant.subjectDeviceKeyId !== ring.deviceKeyId) return false
      }
      return verifyWithDeviceKeyId(ring.deviceKeyId as DeviceKeyId, bytes(ring), ring.sig)
    },

    authorizedBy(ring, recordedDeviceKeyId) {
      if (!recordedDeviceKeyId) return false
      if (ring.deviceKeyId === recordedDeviceKeyId) return true
      return grantAuthorizes(
        ring.deviceGrant,
        ring.fromUserId,
        recordedDeviceKeyId,
        ring.deviceKeyId
      )
    },
  }
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
  // Compared after trimming: otherwise a padded id is a self-ring that slips
  // through, and both fields are trimmed on the way out anyway.
  if (msg.toUserId.trim() === msg.fromUserId.trim()) return null
  if (msg.reason !== 'open' && msg.reason !== 'message') return null
  if (typeof msg.deviceKeyId !== 'string' || !msg.deviceKeyId || msg.deviceKeyId.length > 512) return null
  if (typeof msg.sig !== 'string' || !msg.sig || msg.sig.length > 512) return null
  return {
    toUserId: msg.toUserId.trim(),
    fromUserId: msg.fromUserId.trim(),
    fromName:
      typeof msg.fromName === 'string' && msg.fromName.trim()
        ? msg.fromName.trim().slice(0, 80)
        : msg.fromUserId.trim().slice(0, 12),
    reason: msg.reason,
    deviceKeyId: msg.deviceKeyId,
    sig: msg.sig,
    // Carried through unchecked: the grant is validated where it is verified,
    // not here, and dropping it silently is what broke second devices.
    ...(msg.deviceGrant && typeof msg.deviceGrant === 'object' && !Array.isArray(msg.deviceGrant)
      ? { deviceGrant: msg.deviceGrant as DeviceGrant }
      : {}),
    ...(typeof msg.preview === 'string' && msg.preview.trim()
      ? { preview: msg.preview.trim().slice(0, 120) }
      : {}),
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
