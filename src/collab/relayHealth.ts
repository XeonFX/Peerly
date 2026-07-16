import { createRelayHealth } from '@peerly/core'
import { getSignalingStrategy } from './signaling'

// Moved to @peerly/core as a strategy-parameterized factory; this module binds
// it to the app's build-time strategy once, preserving the old call sites.
const health = createRelayHealth(getSignalingStrategy())

export function getConnectedRelayUrls(): string[] {
  return health.getConnectedRelayUrls()
}

export function isRelayOnline(): boolean {
  return health.isRelayOnline()
}
