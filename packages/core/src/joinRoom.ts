import type { PeerHandshake } from '@trystero-p2p/core'
import type { joinRoom as joinNostrRoom } from '@trystero-p2p/nostr'
import type { Env } from './env.js'
import type { SignalingStrategy } from './signaling.js'
import { getNostrRelayConfig, getSupabaseRoomConfig, getTurnConfig } from './relays.js'

export type Room = ReturnType<typeof joinNostrRoom>

/**
 * Trystero raises this when a peer's session description won't decrypt with our
 * key — i.e. their room code/password differs from ours. This is our own local
 * decryption failing, so a peer cannot forge it into acceptance; the access
 * decision has already been made by the crypto before we see this.
 *
 * Two things it deliberately does NOT say:
 *  - *Whose* password is wrong. We only know the two disagree. Telling a correct
 *    member "your password is wrong" because an outsider probed the room would
 *    be false, and would hand anyone a way to nag every member with the banner.
 *  - Which side finds out. Only the peer decrypting the offer raises this, and
 *    Trystero picks that role by peer id, so it is effectively a coin flip.
 */
const PASSWORD_MISMATCH_PATTERN = /incorrect room password/i

/** Trystero found the peer and exchanged SDP, but no media path could be opened. */
const SDP_EXCHANGE_FAILURE_PATTERN = /after exchanging SDP/i

export type JoinErrorKind = 'password-mismatch' | 'needs-turn' | 'unknown'

/**
 * Classify a Trystero onJoinError message so apps can word their own notices
 * without re-deriving the (deliberately vague) error strings Trystero emits.
 */
export function classifyJoinError(message: string): JoinErrorKind {
  if (PASSWORD_MISMATCH_PATTERN.test(message)) return 'password-mismatch'
  if (SDP_EXCHANGE_FAILURE_PATTERN.test(message)) return 'needs-turn'
  return 'unknown'
}

export type JoinRoomOptions = {
  strategy: SignalingStrategy
  appId: string
  roomId: string
  /**
   * Trystero derives the session-description encryption key from this. Peers
   * whose passwords differ cannot decrypt each other's SDPs and never connect,
   * so this — not an in-band exchange — is what enforces room access. For
   * invite-only rooms pass the high-entropy room code itself; empty means
   * "unprotected": fall back to the appId/roomId-derived key.
   */
  password?: string
  /** Build-time environment (`import.meta.env`) for relay/TURN/Supabase config. */
  env?: Env
  /** ws-relay only: resolved relay URLs (see resolveRelayUrls). */
  relayUrls?: string[]
  onPeerHandshake?: PeerHandshake
  onJoinError?: (details: { error?: unknown }) => void
}

/**
 * Join a Trystero room on the chosen signaling strategy. Strategy modules are
 * imported dynamically so an app only bundles the transport it actually uses;
 * @trystero-p2p/supabase and @trystero-p2p/ws-relay are optional peer deps.
 */
export async function joinRoomByCode(options: JoinRoomOptions): Promise<Room> {
  const { strategy, appId, roomId, password, relayUrls, onPeerHandshake, onJoinError } = options
  const env = options.env ?? {}

  const turnConfig = getTurnConfig(env)

  const baseConfig = {
    ...(password ? { password } : {}),
    // Passed via `turnConfig` rather than `rtcConfig.iceServers` so Trystero's
    // default STUN servers are kept; iceServers would replace them.
    ...(turnConfig ? { turnConfig } : {}),
    rtcConfig: {
      iceCandidatePoolSize: 10,
    },
  }

  const callbacks = {
    ...(onPeerHandshake ? { onPeerHandshake } : {}),
    ...(onJoinError ? { onJoinError } : {}),
  }

  if (strategy === 'ws-relay') {
    if (!relayUrls || relayUrls.length === 0) {
      throw new Error('ws-relay strategy requires relayUrls (see resolveRelayUrls)')
    }
    const { joinRoom } = await import('@trystero-p2p/ws-relay')
    return joinRoom(
      {
        ...baseConfig,
        appId,
        relayConfig: { urls: relayUrls },
      },
      roomId,
      callbacks
    )
  }

  if (strategy === 'supabase') {
    const supabaseConfig = getSupabaseRoomConfig(env)
    if (!supabaseConfig) {
      throw new Error(
        'Supabase signaling is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
      )
    }
    const { joinRoom } = await import('@trystero-p2p/supabase')
    return joinRoom(
      {
        ...baseConfig,
        ...supabaseConfig,
      },
      roomId,
      callbacks
    )
  }

  const { joinRoom } = await import('@trystero-p2p/nostr')
  return joinRoom(
    {
      ...baseConfig,
      appId,
      relayConfig: getNostrRelayConfig(env),
    },
    roomId,
    callbacks
  )
}
