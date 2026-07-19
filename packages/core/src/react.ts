import type { PeerHandshake } from '@trystero-p2p/core'
import { useCallback, useEffect, useRef, useState } from 'react'

/** Keeps a ref synced with the latest value — avoids stale closures in long-lived subscriptions. */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}
import type { Env } from './env.js'
import {
  classifyJoinError,
  isRecoverableJoinError,
  joinRoomByCode,
  type Room,
} from './joinRoom.js'
import { getSupabaseRoomConfig, resolveRelayUrls } from './relays.js'
import { resolveSignalingStrategy } from './signaling.js'
import {
  createRoomMedia,
  type RoomMediaController,
  type RoomMediaDeviceIds,
  type RoomMediaState,
} from './roomMedia.js'
import { probeP2pCapability, type P2pCapability } from './p2pCapability.js'

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
    'Found the other peer but could not open a direct connection — one of you is on a network that blocks peer-to-peer (strict NAT or firewall). Check TURN reachability (UDP/TCP, external-ip, credentials).',
  'relay-failed': raw => `Connection failed: ${raw}. Ensure the local relay is running.`,
  'supabase-config': () =>
    'Supabase signaling is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  generic: raw => `Connection failed: ${raw}. Check your network or try again.`,
}

/** Max automatic leave+rejoin cycles per room before surfacing the error. */
const MAX_RECOVERY_ATTEMPTS = 3
/** Ignore duplicate failure reports within this window (refresh thrash). */
const RECOVERY_DEBOUNCE_MS = 2_000
/** Backoff schedule for recovery attempts (ms). */
const RECOVERY_BACKOFF_MS = [3_000, 8_000, 15_000] as const

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
   * Self-healing rejoin for wedged PeerConnections (handshake timeout, Chrome
   * RTP extmap collision, post-SDP ICE that never completes after a refresh).
   *
   * Important: do NOT rejoin on every single failure — that races the other
   * peer's ICE and produces "User-Initiated Abort / Close called" storms.
   * Debounce, require a second failure (except sdp-collision which is fatal to
   * the current PC), cap attempts, and backoff.
   */
  const [rejoinNonce, setRejoinNonce] = useState(0)
  const recoveryRef = useRef({
    failures: 0,
    attempts: 0,
    timer: 0,
    lastFailureAt: 0,
  })

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

    const scheduleRecovery = (kind: string) => {
      const recovery = recoveryRef.current
      const now = Date.now()
      if (now - recovery.lastFailureAt < RECOVERY_DEBOUNCE_MS) return
      recovery.lastFailureAt = now

      const connectedPeers = Object.keys(instanceRef.current?.getPeers() ?? {}).length
      if (connectedPeers > 0) return
      if (recovery.attempts >= MAX_RECOVERY_ATTEMPTS || recovery.timer !== 0) return

      // sdp-collision: PC is already broken — rejoin after one report.
      // needs-turn / handshake-timeout: wait for a second signal (blip filter).
      recovery.failures++
      const need = kind === 'sdp-collision' ? 1 : 2
      if (recovery.failures < need) return

      recovery.failures = 0
      const attemptIndex = recovery.attempts
      recovery.attempts++
      const delay =
        RECOVERY_BACKOFF_MS[Math.min(attemptIndex, RECOVERY_BACKOFF_MS.length - 1)] ?? 15_000
      recovery.timer = window.setTimeout(() => {
        recovery.timer = 0
        setRejoinNonce(nonce => nonce + 1)
      }, delay)
    }

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
            const connectedPeers = Object.keys(instanceRef.current?.getPeers() ?? {}).length
            if (connectedPeers === 0) reportRef.current('password-mismatch', msg)
            return
          }
          if (isRecoverableJoinError(kind)) {
            scheduleRecovery(kind)
            // Only surface TURN advice after recovery budget is exhausted.
            const recovery = recoveryRef.current
            if (recovery.attempts >= MAX_RECOVERY_ATTEMPTS && kind === 'needs-turn') {
              reportRef.current('needs-turn', msg)
            }
            return
          }
          if (strategy === 'ws-relay') {
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
      // A successful join clears blip counters but keeps attempt budget for the room.
      recoveryRef.current.failures = 0
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
    recovery.lastFailureAt = 0
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

const IDLE_MEDIA: RoomMediaState = {
  localStream: null,
  micOn: false,
  micMuted: false,
  cameraOn: false,
  peerStreams: {},
  mediaError: null,
  selectedAudioInput: '',
  selectedVideoInput: '',
}

/**
 * React face of createRoomMedia (progressive media: in the room silently by
 * default, opt into mic, upgrade to camera). Returns stable handler
 * references so consumers can wire room.onPeerStream / onPeerLeave and their
 * own "peer ended media" action inside their existing effects.
 *
 * `initialDevices` seeds preferred mic/camera deviceIds (e.g. from localStorage).
 */
export function useRoomMedia(
  room: Room | null,
  initialDevices?: RoomMediaDeviceIds
): RoomMediaState & {
  enableMic: () => Promise<void>
  disableMic: () => void
  setMicMuted: (muted: boolean) => void
  enableCamera: () => Promise<void>
  disableCamera: () => Promise<void>
  switchAudioInput: (deviceId: string) => Promise<void>
  switchVideoInput: (deviceId: string) => Promise<void>
  stopMedia: () => void
  handlePeerStream: (stream: MediaStream, peerId: string) => void
  handlePeerLeave: (peerId: string) => void
  handlePeerMediaEnd: (peerId: string) => void
} {
  const [state, setState] = useState<RoomMediaState>(() => ({
    ...IDLE_MEDIA,
    selectedAudioInput: initialDevices?.audioId?.trim() ?? '',
    selectedVideoInput: initialDevices?.videoId?.trim() ?? '',
  }))
  const controllerRef = useRef<RoomMediaController | null>(null)
  // Only seed devices on room join — not when localStorage changes mid-session.
  const initialDevicesRef = useRef(initialDevices)
  if (!room) initialDevicesRef.current = initialDevices

  useEffect(() => {
    if (!room) {
      setState(IDLE_MEDIA)
      return
    }
    const controller = createRoomMedia(room, setState, initialDevicesRef.current)
    controllerRef.current = controller
    return () => {
      controllerRef.current = null
      controller.dispose()
      setState(IDLE_MEDIA)
    }
  }, [room])

  const call = useRef({
    enableMic: async () => controllerRef.current?.enableMic(),
    disableMic: () => controllerRef.current?.disableMic(),
    setMicMuted: (muted: boolean) => controllerRef.current?.setMicMuted(muted),
    enableCamera: async () => controllerRef.current?.enableCamera(),
    disableCamera: async () => controllerRef.current?.disableCamera(),
    switchAudioInput: async (deviceId: string) => controllerRef.current?.switchAudioInput(deviceId),
    switchVideoInput: async (deviceId: string) => controllerRef.current?.switchVideoInput(deviceId),
    stopMedia: () => controllerRef.current?.stopMedia(),
    handlePeerStream: (stream: MediaStream, peerId: string) =>
      controllerRef.current?.handlePeerStream(stream, peerId),
    handlePeerLeave: (peerId: string) => controllerRef.current?.handlePeerLeave(peerId),
    handlePeerMediaEnd: (peerId: string) => controllerRef.current?.handlePeerMediaEnd(peerId),
  }).current

  return { ...state, ...call }
}

const CHECKING_CAPABILITY: P2pCapability = {
  status: 'checking',
  detail: 'Testing whether this browser allows WebRTC data channels…',
}

/**
 * Browser WebRTC self-test (same probe both apps use). Retry bumps attempt
 * so the effect re-runs.
 */
export function useP2pCapability() {
  const [capability, setCapability] = useState<P2pCapability>(CHECKING_CAPABILITY)
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => {
    setCapability(CHECKING_CAPABILITY)
    setAttempt(value => value + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    void probeP2pCapability().then(result => {
      if (!cancelled) setCapability(result)
    })
    return () => {
      cancelled = true
    }
  }, [attempt])

  return { capability, retry }
}
