import type { PeerHandshake } from '@trystero-p2p/core'
import { useEffect, useRef, useState } from 'react'
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
  }, [appId, roomId, password, strategy, resolvedRelayUrls, onPeerHandshake])

  return { room }
}

export type { Room }
