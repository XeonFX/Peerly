/**
 * This app's DM ring.
 *
 * The protocol lives in `@peerly/core`; only the scheme is app-owned, and it
 * is what stops a ring minted in the other product from verifying here.
 */
import { createDmRing } from '@peerly/core'
import { verifyDeviceGrant } from './deviceAuthorization'

export {
  decideDmRingToast,
  DM_RING_TOAST_COOLDOWN_MS,
  isValidDmRoomCode,
  parseDmRingPayload,
  type DmRingPayload,
  type DmRingReason,
  type DmRingToastDecision,
} from '@peerly/core'

/** Frozen: signed into every ring. */
export const DM_RING_SCHEME = 'peerly-dm-ring-v2'

const ring = createDmRing({
  scheme: DM_RING_SCHEME,
  grants: { verify: verifyDeviceGrant },
})

export const dmRingBytes = ring.bytes
export const signDmRing = ring.sign
export const verifyDmRing = ring.verify
export const ringAuthorizedBy = ring.authorizedBy
