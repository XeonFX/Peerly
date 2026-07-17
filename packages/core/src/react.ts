import type { PeerHandshake } from '@trystero-p2p/core'
import { useEffect, useRef, useState } from 'react'

/** Keeps a ref synced with the latest value — avoids stale closures in long-lived subscriptions. */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}
import type { Env } from './env.js'
import { classifyJoinError, joinRoomByCode, type Room } from './joinRoom.js'
import { getSupabaseRoomConfig, resolveRelayUrls } from './relays.js'
import { resolveSignalingStrategy } from './signaling.js'

export type RoomErrorKind =
  | 'password-mismatch'
  | 'needs-turn'
  | 'relay-failed'
  | 'supabase-config'
  | 'generic'

const DEFAULT_ERROR_TEXT: Record<RoomErrorKind, (raw: string) => string> = {
  'password-mismatch': () =>
    'A peer tried to join with a different room code. If you cannot connect, check that your code matches exactly.',
  'needs-turn': () =>
    'Found the other peer but could not open a direct connection — one of you is on a network that blocks peer-to-peer (strict NAT or firewall). A TURN server is needed; see VITE_TURN_URLS.',
  'relay-failed': raw => `Connection failed: ${raw}. Ensure the local relay is running.`,
  'supabase-config': () =>
    'Supabase signaling is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  generic: raw => `Connection failed: ${raw}. Check your network or try again.`,
}

export type UseRoomOptions = {
  appId: string
  /** Room to join; an empty string means "no room yet" and joins nothing. */
  roomId: string
  /** Room password; for invite-only rooms this is the room code itself. */
  password?: string
  /** Build-time environment (`import.meta.env`). */
  env: Env
  onError?: (message: string) => void
  onPeerHandshake?: PeerHandshake
  /** Override user-facing error wording per kind; falls back to English defaults. */
  errorText?: Partial<Record<RoomErrorKind, (raw: string) => string>>
}

/**
 * Join a room for the lifetime of the component. Handles the teardown/rejoin
 * race: `leave()` is async, and the Nostr strategy shares batched relay
 * subscriptions across rooms — a leave that lands *after* the next join has
 * subscribed tears that subscription back down, leaving an open socket that
 * never sends a REQ, and the room silently never finds peers. Any rapid
 * remount hits this: StrictMode in dev, and switching rooms in production.
 */
export function useRoom(options: UseRoomOptions): { room: Room | null } {
  const { appId, roomId, password = '', env, onError, onPeerHandshake, errorText } = options
  const strategy = resolveSignalingStrategy(env)
  const [room, setRoom] = useState<Room | null>(null)
  const [relayUrls, setRelayUrls] = useState<string[] | null>(() =>
    strategy === 'ws-relay' ? null : []
  )
  const instanceRef = useRef<Room | null>(null)
  /** Resolves when the previous room has fully left; see setup() below. */
  const teardownRef = useRef<Promise<void>>(Promise.resolve())
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const errorTextRef = useRef(errorText)
  errorTextRef.current = errorText
  const envRef = useRef(env)
  envRef.current = env

  const report = (kind: RoomErrorKind, raw: string) => {
    const format = errorTextRef.current?.[kind] ?? DEFAULT_ERROR_TEXT[kind]
    onErrorRef.current?.(format(raw))
  }
  const reportRef = useRef(report)
  reportRef.current = report

  /**
   * Self-healing rejoin. A session can wedge so that every ICE attempt to a
   * peer fails after the SDP exchange — seen after browser restarts, where a
   * session-restored tab starts signaling before the network/WebRTC stack is
   * actually ready. The failure then repeats within that join, while a manual
   * refresh (a clean join) fixes it immediately. So when SDP-exchange failures
   * repeat and we are connected to nobody, do what the refresh does: leave and
   * join again. Bounded attempts with backoff; only after they are exhausted
   * does the user see the TURN advice, which is then likely to be true.
   */
  const [rejoinNonce, setRejoinNonce] = useState(0)
  const recoveryRef = useRef({ failures: 0, attempts: 0, timer: 0 })

  useEffect(() => {
    if (strategy !== 'ws-relay') return

    let cancelled = false
    resolveRelayUrls(envRef.current).then(urls => {
      if (!cancelled) setRelayUrls(urls)
    })
    return () => {
      cancelled = true
    }
  }, [strategy])

  // Only ws-relay re-joins when relay URLs resolve; other strategies ignore them.
  const resolvedRelayUrls = strategy === 'ws-relay' ? relayUrls : null

  useEffect(() => {
    // No room id yet means "not joined", not "join the '' room": hooks must be
    // called unconditionally, so callers whose room is not decided yet pass an
    // empty id. Joining anyway would put every such caller into one shared,
    // unprotected room per app id.
    if (!roomId) return
    if (strategy === 'ws-relay' && (resolvedRelayUrls === null || resolvedRelayUrls.length === 0)) {
      return
    }
    if (strategy === 'supabase' && !getSupabaseRoomConfig(envRef.current)) {
      reportRef.current('supabase-config', '')
      return
    }

    let cancelled = false

    const setup = async () => {
      // Wait for any previous room to finish leaving before joining again.
      await teardownRef.current
      if (cancelled) return

      const joined = await joinRoomByCode({
        strategy,
        appId,
        roomId,
        password,
        env: envRef.current,
        relayUrls: resolvedRelayUrls ?? undefined,
        onPeerHandshake,
        onJoinError: (details: { error?: unknown }) => {
          console.error('[Trystero] Connection error:', details)
          const msg = String(details.error ?? 'Connection failed')
          const kind = classifyJoinError(msg)
          if (kind === 'password-mismatch') {
            // Already talking to someone? Then it's the other peer's password
            // that's wrong, and this is none of our business.
            const connectedPeers = Object.keys(instanceRef.current?.getPeers() ?? {}).length
            if (connectedPeers === 0) reportRef.current('password-mismatch', msg)
          } else if (kind === 'needs-turn') {
            const connectedPeers = Object.keys(instanceRef.current?.getPeers() ?? {}).length
            const recovery = recoveryRef.current
            if (connectedPeers === 0 && recovery.attempts < 2) {
              // Nobody reachable and repeated SDP failures: this join may be
              // wedged — rejoin instead of telling the user to buy a TURN
              // server. Threshold 2 skips one-off blips; backoff 5s then 15s.
              recovery.failures++
              if (recovery.failures >= 2 && recovery.timer === 0) {
                recovery.failures = 0
                recovery.attempts++
                recovery.timer = window.setTimeout(() => {
                  recovery.timer = 0
                  setRejoinNonce(nonce => nonce + 1)
                }, recovery.attempts === 1 ? 5_000 : 15_000)
              }
              return
            }
            // Signaling worked and the direct connection still failed: one side
            // is behind a NAT/firewall that needs a relay. Trystero's own text
            // tells the *developer* to configure TURN, no help to an end user.
            reportRef.current('needs-turn', msg)
          } else if (strategy === 'ws-relay') {
            reportRef.current('relay-failed', msg)
          } else {
            reportRef.current('generic', msg)
          }
        },
      })

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
  }, [appId, roomId, password, strategy, resolvedRelayUrls, onPeerHandshake, rejoinNonce])

  // A new room is a fresh start for recovery accounting; a pending rejoin
  // timer must not fire into a room it no longer belongs to.
  useEffect(() => {
    const recovery = recoveryRef.current
    recovery.failures = 0
    recovery.attempts = 0
    return () => {
      if (recovery.timer) {
        window.clearTimeout(recovery.timer)
        recovery.timer = 0
      }
    }
  }, [appId, roomId])

  return { room }
}

export type { Room }
