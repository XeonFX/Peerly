/**
 * This app's approved-device sync.
 *
 * The protocol lives in `@peerly/core`. What is app-owned is the two schemes:
 * one signed into every hello, one namespacing the room derived from the sync
 * secret. Both keep the products' device meshes apart, and neither may change
 * without cutting existing devices off from each other.
 */
import { useApprovedDeviceSync as useSharedDeviceSync } from '@peerly/core/react'
import { useMemo } from 'react'
import type { DeviceIdentity } from '../collab/deviceIdentity'
import { loadDeviceGrants, rememberDevice } from '../collab/deviceAuthorization'
import {
  createDeviceSyncSnapshot,
  importDeviceSyncSnapshot,
  loadAccountSyncSecret,
} from '../collab/deviceSync'
import { APP_ID, APP_STORAGE_SCOPE, PUBLIC_NETWORK_ENV } from '../config'

const HELLO_SCHEME = 'peerly-approved-device-sync-v1'
const ROOM_SCHEME = 'peerly-account-sync-v1'

export function useApprovedDeviceSync(
  identity: DeviceIdentity,
  userId: string | undefined
): number {
  // Stable identities: the hook re-runs its whole session when these change.
  const grants = useMemo(() => ({ load: loadDeviceGrants, remember: rememberDevice }), [])
  const sync = useMemo(
    () => ({
      loadSecret: loadAccountSyncSecret,
      snapshot: createDeviceSyncSnapshot,
      import: importDeviceSyncSnapshot,
    }),
    []
  )

  return useSharedDeviceSync({
    appId: APP_ID,
    env: PUBLIC_NETWORK_ENV,
    identity,
    userId,
    helloScheme: HELLO_SCHEME,
    roomScheme: ROOM_SCHEME,
    devicesChangedEvent: `${APP_STORAGE_SCOPE}-devices-changed`,
    grants,
    sync,
  })
}
