import type { PeerHandshake } from '@trystero-p2p/core'
import { joinRoom as joinNostrRoom } from '@trystero-p2p/nostr'
import { joinRoom as joinSupabaseRoom } from '@trystero-p2p/supabase'
import { useEffect, useRef, useState } from 'react'
import {
  getNostrRelayConfig,
  getRoomAppId,
  getSupabaseRoomConfig,
  getTurnConfig,
  resolveRelayUrls,
} from '../config'
import { getSignalingStrategy } from '../collab/signaling'

type Room = ReturnType<typeof joinNostrRoom>

/**
 * Trystero raises this when a peer's session description won't decrypt with our
 * key — i.e. their workspace password differs from ours. This is our own local
 * decryption failing, so a peer cannot forge it into acceptance; the access
 * decision has already been made by the crypto before we see this.
 *
 * Two things it deliberately does NOT say:
 *  - *Whose* password is wrong. We only know the two disagree. Telling a correct
 *    member "your password is wrong" because an outsider probed the room would
 *    be false, and would hand anyone a way to nag every member with the banner.
 *  - Which side finds out. Only the peer decrypting the offer raises this, and
 *    Trystero picks that role by peer id, so it is effectively a coin flip.
 *    The alone-notice is the backstop for the side that hears nothing.
 */
const PASSWORD_MISMATCH_PATTERN = /incorrect room password/i

const PASSWORD_MISMATCH_NOTICE =
  'A peer tried to join with a different workspace password. If you cannot connect, check that your password matches exactly.'

/** Trystero found the peer and exchanged SDP, but no media path could be opened. */
const SDP_EXCHANGE_FAILURE_PATTERN = /after exchanging SDP/i

const NEEDS_TURN_ERROR =
  'Found your teammate but could not open a direct connection — one of you is on a network that blocks peer-to-peer (strict NAT or firewall). A TURN server is needed; see VITE_TURN_URLS in the README.'

export function useRoom(
  appId: string,
  roomId: string,
  password: string,
  onError?: (message: string) => void,
  onPeerHandshake?: PeerHandshake
): { room: Room | null } {
  const strategy = getSignalingStrategy()
  const [room, setRoom] = useState<Room | null>(null)
  const [relayUrls, setRelayUrls] = useState<string[] | null>(() =>
    strategy === 'ws-relay' ? null : []
  )
  const instanceRef = useRef<Room | null>(null)
  /** Resolves when the previous room has fully left; see setup() below. */
  const teardownRef = useRef<Promise<void>>(Promise.resolve())
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    if (strategy !== 'ws-relay') return

    let cancelled = false
    resolveRelayUrls().then(urls => {
      if (!cancelled) setRelayUrls(urls)
    })
    return () => {
      cancelled = true
    }
  }, [strategy])

  // Only ws-relay re-joins when relay URLs resolve; other strategies ignore them.
  const resolvedRelayUrls = strategy === 'ws-relay' ? relayUrls : null

  useEffect(() => {
    if (strategy === 'ws-relay' && (relayUrls === null || relayUrls.length === 0)) return
    if (strategy === 'supabase' && !getSupabaseRoomConfig()) {
      onErrorRef.current?.(
        'Supabase signaling is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
      )
      return
    }

    let cancelled = false

    const setup = async () => {
      // Wait for any previous room to finish leaving before joining again.
      // `leave()` is async, and the Nostr strategy shares batched relay
      // subscriptions across rooms: a leave that lands *after* the next join has
      // subscribed tears that subscription back down, leaving an open socket
      // that never sends a REQ — the room silently never finds peers. Any rapid
      // remount hits this: StrictMode in dev, and switching workspace or
      // password in production.
      await teardownRef.current
      if (cancelled) return

      const supabaseConfig = getSupabaseRoomConfig()

      const turnConfig = getTurnConfig()

      const baseConfig = {
        // Trystero derives the session-description encryption key from this. Peers
        // whose passwords differ cannot decrypt each other's SDPs and never connect,
        // so this — not an in-band exchange — is what enforces workspace access.
        // Empty means "unprotected": fall back to the appId/roomId-derived key.
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
        onJoinError: (details: { error?: unknown }) => {
          console.error('[Trystero] Connection error:', details)
          const msg = String(details.error ?? 'Connection failed')
          if (PASSWORD_MISMATCH_PATTERN.test(msg)) {
            // Already talking to someone? Then it's the other peer's password
            // that's wrong, and this is none of our business.
            const connectedPeers = Object.keys(instanceRef.current?.getPeers() ?? {}).length
            if (connectedPeers === 0) onErrorRef.current?.(PASSWORD_MISMATCH_NOTICE)
          } else if (SDP_EXCHANGE_FAILURE_PATTERN.test(msg)) {
            // Signaling worked and the direct connection still failed: one side is
            // behind a NAT/firewall that needs a relay. Trystero's own text tells
            // the *developer* to configure TURN, which is no help to an end user.
            onErrorRef.current?.(NEEDS_TURN_ERROR)
          } else if (strategy === 'ws-relay') {
            onErrorRef.current?.(
              `Connection failed: ${msg}. Ensure the local relay is running (npm run dev:relay).`
            )
          } else {
            onErrorRef.current?.(`Connection failed: ${msg}. Check your network or try again.`)
          }
        },
      }

      if (cancelled) return

      let joined: Room

      if (strategy === 'ws-relay') {
        const { joinRoom } = await import('@trystero-p2p/ws-relay')
        joined = joinRoom(
          {
            ...baseConfig,
            appId,
            relayConfig: { urls: relayUrls! },
          },
          roomId,
          callbacks
        )
      } else if (strategy === 'supabase' && supabaseConfig) {
        joined = joinSupabaseRoom(
          {
            ...baseConfig,
            ...supabaseConfig,
          },
          roomId,
          callbacks
        )
      } else {
        joined = joinNostrRoom(
          {
            ...baseConfig,
            appId: getRoomAppId('nostr'),
            relayConfig: getNostrRelayConfig(),
          },
          roomId,
          callbacks
        )
      }

      if (cancelled) {
        void joined.leave()
        return
      }

      instanceRef.current = joined
      setRoom(joined)
    }

    void setup()

    return () => {
      cancelled = true
      const active = instanceRef.current
      instanceRef.current = null
      if (active) {
        // Record the teardown so the next join can await it rather than race it.
        teardownRef.current = Promise.resolve(active.leave()).catch(() => {})
      }
      setRoom(null)
    }
  }, [appId, roomId, password, strategy, resolvedRelayUrls, onPeerHandshake])

  return { room }
}