import type { PeerHandshake } from '@trystero-p2p/core'
import type { Room } from '@peerly/core'
import { useRoom as useCodeRoom } from '@peerly/core/react'
import { OLDER_PEER_REASON, STALE_TAB_REASON, UNKNOWN_SIBLING_REASON } from '@peerly/core'
import { IDENTITY_DENIED_PREFIX } from '../collab/identityHandshake'
import { PUBLIC_NETWORK_ENV } from '../config'

/**
 * Private rooms recover promptly from a wedged initial WebRTC attempt. TURN
 * allocation should finish well inside this window; longer waits turn one
 * failed offer into the user-visible minute-long connection delay.
 */
const PRIVATE_HANDSHAKE_TIMEOUT_MS = 12_000

// The join/teardown machinery moved to @peerly/core (react.ts) — including the
// leave/rejoin race handling and Trystero error classification. This wrapper
// binds it to this app's env and keeps Peerly's workspace-specific wording:
// the package can't know the password is a "workspace password" or that the
// other peer is a "teammate".
/**
 * A denied handshake is the trust model working, not a network problem — "check your network" (or "is the local relay
 * running?", which is how the ws-relay strategy reports every join error) would send the user debugging the wrong thing.
 */
function identityDeniedText(raw: string): string | null {
  if (!raw.includes(IDENTITY_DENIED_PREFIX)) return null
  if (raw.includes('Token expired')) {
    const claimed = /peer claims to be ([^)]+)\)/.exec(raw)?.[1]
    return `A peer${claimed ? ` (${claimed})` : ''} could not join: their sign-in has expired. They need to sign in again on that device — your own connection is fine.`
  }
  if (raw.includes(OLDER_PEER_REASON)) {
    return 'A peer runs an older version of Peerly and was not admitted. Reloading Peerly on that device lets it connect.'
  }
  if (raw.includes(STALE_TAB_REASON)) {
    return 'A tab presented an expired tab session and was not admitted. An open tab renews its session on its own when it reconnects; if this keeps happening, check that the device clocks are correct.'
  }
  if (raw.includes(UNKNOWN_SIBLING_REASON)) {
    return 'A connection presented this browser\'s own key, but no open tab of this browser vouched for it, so it was not admitted. Your tabs are not affected.'
  }
  return `A peer was not admitted: ${raw.slice(raw.indexOf(IDENTITY_DENIED_PREFIX) + IDENTITY_DENIED_PREFIX.length + 2)}`
}

const ERROR_TEXT = {
  'password-mismatch': () =>
    'A peer tried to join with a different workspace password. If you cannot connect, check that your password matches exactly.',
  'ice-failed': () =>
    'Found your teammate, but the connection was interrupted. Waiting for them to reconnect.',
  'needs-turn': () =>
    'Found your teammate but could not open a direct connection — one of you is on a network that blocks peer-to-peer (strict NAT or firewall). A TURN server is needed; see VITE_TURN_URLS in the README.',
  'relay-failed': (raw: string) =>
    identityDeniedText(raw) ??
    `Connection failed: ${raw}. Ensure the local relay is running (npm run dev:relay).`,
  'supabase-config': () =>
    'Supabase signaling is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  generic: (raw: string) =>
    identityDeniedText(raw) ?? `Connection failed: ${raw}. Check your network or try again.`,
}

export function useRoom(
  appId: string,
  roomId: string,
  password: string,
  onError?: (message: string) => void,
  onPeerHandshake?: PeerHandshake
): { room: Room | null } {
  return useCodeRoom({
    appId,
    roomId,
    password,
    env: PUBLIC_NETWORK_ENV,
    onError,
    onPeerHandshake,
    handshakeTimeoutMs: PRIVATE_HANDSHAKE_TIMEOUT_MS,
    recoverIceFailures: true,
    errorText: ERROR_TEXT,
  })
}
