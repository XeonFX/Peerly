/**
 * This app's device grants.
 *
 * The mechanism lives in `@peerly/core`. What stays here is the scheme — it is
 * signed into every grant, so it is both what keeps the two products' grants
 * from cross-verifying and what must never change: a new scheme would
 * invalidate every pairing our users already hold.
 */
import { createDeviceAuthorization, type DeviceSigner } from '@peerly/core'
import { APP_STORAGE_SCOPE } from '../config'
import type { ApprovedDevice, DeviceGrant } from '@peerly/core'

export type { ApprovedDevice, DeviceGrant }
export { deviceFingerprint, grantAuthorizes } from '@peerly/core'

/** Frozen: signed into every grant issued since the feature shipped. */
const DEVICE_GRANT_SCHEME = 'peerly-device-grant-v1'

const grants = createDeviceAuthorization({
  scheme: DEVICE_GRANT_SCHEME,
  grantsKey: `${APP_STORAGE_SCOPE}-device-grants-v1`,
  metaKey: `${APP_STORAGE_SCOPE}-device-meta-v1`,
  changedEvent: `${APP_STORAGE_SCOPE}-devices-changed`,
  metaChangedEvent: `${APP_STORAGE_SCOPE}-device-meta-changed`,
})

export const deviceGrantBytes = grants.bytes
export const verifyDeviceGrant = grants.verify
export const loadDeviceGrants = grants.load
export const saveDeviceGrant = grants.save
export const findDeviceGrant = grants.find
export const findAuthorizingDeviceGrant = grants.findAuthorizing
export const listApprovedDevices = grants.listApproved
export const revokeDevice = grants.revoke
export const rememberDevice = grants.remember

export async function signDeviceGrant(
  signer: DeviceSigner,
  fields: Pick<DeviceGrant, 'userId' | 'subjectDeviceKeyId' | 'pairingId'>
): Promise<DeviceGrant> {
  return grants.sign(signer, fields)
}
