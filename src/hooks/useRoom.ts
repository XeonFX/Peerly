import type { PeerHandshake } from '@trystero-p2p/core'
import type { Room } from '@peerly/core'
import { useRoom as useCodeRoom } from '@peerly/core/react'

// The join/teardown machinery moved to @peerly/core (react.ts) — including the
// leave/rejoin race handling and Trystero error classification. This wrapper
// binds it to this app's env and keeps Peerly's workspace-specific wording:
// the package can't know the password is a "workspace password" or that the
// other peer is a "teammate".
const ERROR_TEXT = {
  'password-mismatch': () =>
    'A peer tried to join with a different workspace password. If you cannot connect, check that your password matches exactly.',
  'needs-turn': () =>
    'Found your teammate but could not open a direct connection — one of you is on a network that blocks peer-to-peer (strict NAT or firewall). A TURN server is needed; see VITE_TURN_URLS in the README.',
  'relay-failed': (raw: string) =>
    `Connection failed: ${raw}. Ensure the local relay is running (npm run dev:relay).`,
  'supabase-config': () =>
    'Supabase signaling is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  generic: (raw: string) => `Connection failed: ${raw}. Check your network or try again.`,
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
