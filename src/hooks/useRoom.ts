import type { PeerHandshake } from '@trystero-p2p/core'
import type { Room } from '@peerly/core'
import { useRoom as useCodeRoom } from '@peerly/core/react'
import { IDENTITY_DENIED_PREFIX } from '../collab/identityHandshake'

// The join/teardown machinery moved to @peerly/core (react.ts) — including the
// leave/rejoin race handling and Trystero error classification. This wrapper
// binds it to this app's env and keeps Peerly's workspace-specific wording:
// the package can't know the password is a "workspace password" or that the
// other peer is a "teammate".
const ERROR_TEXT = {
  'password-mismatch': () =>
    'A peer tried to join with a different workspace password. If you cannot connect, check that your password matches exactly.',
  'ice-failed': () =>
    'Found your teammate, but the connection was interrupted. Waiting for them to reconnect.',
  'needs-turn': () =>
    'Found your teammate but could not open a direct connection — one of you is on a network that blocks peer-to-peer (strict NAT or firewall). A TURN server is needed; see VITE_TURN_URLS in the README.',
  'relay-failed': (raw: string) =>
    `Connection failed: ${raw}. Ensure the local relay is running (npm run dev:relay).`,
  'supabase-config': () =>
    'Supabase signaling is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  generic: (raw: string) => {
    // A denied handshake is the trust model working, not a network problem —
    // "check your network" would send the user debugging the wrong thing.
    if (raw.includes(IDENTITY_DENIED_PREFIX)) {
      if (raw.includes('Token expired')) {
        const claimed = /peer claims to be ([^)]+)\)/.exec(raw)?.[1]
        return `A peer${claimed ? ` (${claimed})` : ''} could not join: their sign-in has expired. They need to sign in again on that device — your own connection is fine.`
      }
      return `A peer was not admitted: ${raw.slice(raw.indexOf(IDENTITY_DENIED_PREFIX) + IDENTITY_DENIED_PREFIX.length + 2)}`
    }
    return `Connection failed: ${raw}. Check your network or try again.`
  },
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
    env: import.meta.env,
    onError,
    onPeerHandshake,
    errorText: ERROR_TEXT,
  })
}
