import { useSyncExternalStore } from 'react'
import {
  getRelayDiagnostics,
  recheckRelays,
  relayDiagnosticsApplicable,
  subscribeRelayDiagnostics,
} from '../collab/relayDiagnostics'

export function useRelayDiagnostics() {
  const diagnostics = useSyncExternalStore(subscribeRelayDiagnostics, getRelayDiagnostics)
  return {
    ...diagnostics,
    applicable: relayDiagnosticsApplicable(),
    recheck: () => void recheckRelays(),
  }
}
