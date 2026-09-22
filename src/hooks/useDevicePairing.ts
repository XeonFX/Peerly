/**
 * This app's device pairing.
 *
 * The protocol lives in `@peerly/core`. What is app-owned is the two schemes:
 * one signed into every hello, one namespacing the room derived from the
 * pairing secret. Both keep the products' pairings apart.
 */
import { useDevicePairing as useSharedPairing, type PairRole } from '@peerly/core/react'
import { useMemo } from 'react'
import type { DeviceIdentity } from '../collab/deviceIdentity'
import {
  rememberDevice,
  saveDeviceGrant,
  signDeviceGrant,
  verifyDeviceGrant,
} from '../collab/deviceAuthorization'
import {
  createDeviceSyncSnapshot,
  ensureAccountSyncSecret,
  importDeviceSyncSnapshot,
} from '../collab/deviceSync'
import { APP_ID, APP_STORAGE_SCOPE, PUBLIC_NETWORK_ENV } from '../config'

export type { PairRole }

const HELLO_SCHEME = 'peerly-device-pair-hello-v1'
const ROOM_SCHEME = 'peerly-device-pair-v1'

export function useDevicePairing(options: {
  identity: DeviceIdentity
  userId: string
  secret: string | null
  role: PairRole | null
}) {
  // Stable identities: the hook restarts the exchange when these change.
  const grants = useMemo(
    () => ({
      sign: signDeviceGrant,
      save: saveDeviceGrant,
      verify: verifyDeviceGrant,
      remember: rememberDevice,
    }),
    []
  )
  const sync = useMemo(
    () => ({
      ensureSecret: ensureAccountSyncSecret,
      snapshot: createDeviceSyncSnapshot,
      import: importDeviceSyncSnapshot,
    }),
    []
  )

  return useSharedPairing({
    appId: APP_ID,
    env: PUBLIC_NETWORK_ENV,
    identity: options.identity,
    userId: options.userId,
    secret: options.secret,
    role: options.role,
    helloScheme: HELLO_SCHEME,
    roomScheme: ROOM_SCHEME,
    devicesChangedEvent: `${APP_STORAGE_SCOPE}-devices-changed`,
    grants,
    sync,
  })
}
