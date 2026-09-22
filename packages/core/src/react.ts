import { useConversationState } from './reactConversationState.js'
import { selfId, type PeerHandshake } from '@trystero-p2p/core'
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { firstSafeLink } from './safeLinks.js'
import { searchReactionCategories } from './reactions.js'
import {
  credentialNeedsRenewal,
  credentialRenewalDelay,
  credentialRetryDelay,
  DEFAULT_CREDENTIAL_RENEW_BEFORE_MS,
  DEFAULT_CREDENTIAL_RETRY_MS,
} from './credentialRenewal.js'
import {
  loadClockFormat,
  loadDateFormat,
  saveClockFormat,
  saveDateFormat,
  type ClockFormat,
  type DateFormat,
} from './format.js'
import { ensureDurableObjectsSession } from './realtime/runtime.js'

type ClockFormatContextValue = {
  clockFormat: ClockFormat
  dateFormat: DateFormat
  setClockFormat: (clockFormat: ClockFormat) => void
  setDateFormat: (dateFormat: DateFormat) => void
}

const ClockFormatContext = createContext<ClockFormatContextValue | null>(null)

export type ClockFormatProviderProps = {
  appId: string
  children: ReactNode
  storage?: Storage
}

/** App-scoped, device-local clock preference shared by all chat surfaces. */
export function ClockFormatProvider({
  appId,
  children,
  storage,
}: ClockFormatProviderProps) {
  const [clockFormat, setClockFormatState] = useState<ClockFormat>(() =>
    loadClockFormat(appId, storage)
  )
  const [dateFormat, setDateFormatState] = useState<DateFormat>(() =>
    loadDateFormat(appId, storage)
  )
  const value = useMemo<ClockFormatContextValue>(
    () => ({
      clockFormat,
      dateFormat,
      setClockFormat: next => {
        saveClockFormat(appId, next, storage)
        setClockFormatState(next)
      },
      setDateFormat: next => {
        saveDateFormat(appId, next, storage)
        setDateFormatState(next)
      },
    }),
    [appId, clockFormat, dateFormat, storage]
  )

  return createElement(ClockFormatContext.Provider, { value }, children)
}

export function useClockFormat(): ClockFormatContextValue {
  const value = useContext(ClockFormatContext)
  if (!value) {
    throw new Error('useClockFormat must be used inside <ClockFormatProvider>')
  }
  return value
}

/** Keeps a ref synced with the latest value — avoids stale closures in long-lived subscriptions. */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

export type MessageActionPanel = 'reactions' | 'more' | null
export type MessageActionPanelPosition = {
  left: number
  top: number
  visible: boolean
}

export type MessageActionMenuOptions = {
  text: string
  onReact(emoji: string): void
  onOpenChange?(open: boolean): void
  panelGap?: number
  viewportMargin?: number
}

/**
 * Shared, headless controller for message actions.
 *
 * Products keep their own visual language and icon component, while panel
 * placement, outside-click/Escape handling, reaction search, Copy-link
 * discovery, and open-state behavior have one implementation.
 */
export function useMessageActionMenu(options: MessageActionMenuOptions) {
  const {
    text,
    onReact,
    onOpenChange,
    panelGap = 6,
    viewportMargin = 8,
  } = options
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panel, setPanel] = useState<MessageActionPanel>(null)
  const [position, setPosition] = useState<MessageActionPanelPosition>({
    left: 0,
    top: 0,
    visible: false,
  })
  const [search, setSearch] = useState('')
  const categories = useMemo(() => searchReactionCategories(search), [search])
  const firstUrl = useMemo(() => firstSafeLink(text), [text])
  const openChangeRef = useLatest(onOpenChange)

  useEffect(() => {
    openChangeRef.current?.(panel !== null)
  }, [openChangeRef, panel])

  useEffect(() => {
    if (!panel) return
    const close = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setPanel(null)
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanel(null)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [panel])

  useLayoutEffect(() => {
    if (!panel) return
    const place = () => {
      const anchor = rootRef.current?.getBoundingClientRect()
      const floating = panelRef.current
      if (!anchor || !floating) return
      const left = Math.min(
        window.innerWidth - floating.offsetWidth - viewportMargin,
        Math.max(viewportMargin, anchor.right - floating.offsetWidth)
      )
      const roomBelow = window.innerHeight - anchor.bottom - viewportMargin
      const top = roomBelow >= floating.offsetHeight + panelGap
        ? anchor.bottom + panelGap
        : Math.max(viewportMargin, anchor.top - floating.offsetHeight - panelGap)
      setPosition({ left, top, visible: true })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [panel, panelGap, viewportMargin])

  const chooseReaction = useCallback((emoji: string) => {
    onReact(emoji)
    setPanel(null)
    setSearch('')
  }, [onReact])

  const closePanel = useCallback(() => setPanel(null), [])
  const togglePanel = useCallback((next: Exclude<MessageActionPanel, null>) => {
    setPosition(current => ({ ...current, visible: false }))
    setPanel(current => current === next ? null : next)
  }, [])

  return {
    rootRef,
    panelRef,
    panel,
    position,
    search,
    setSearch,
    categories,
    firstUrl,
    chooseReaction,
    closePanel,
    togglePanel,
  }
}

export type CredentialRenewalOptions<T> = {
  enabled: boolean
  /** Verified credential expiry in epoch milliseconds; null means missing. */
  expiresAt: number | null
  renew(): Promise<T | null>
  onRenewed(value: T): void
  onExpired?(): void
  /** Keep retrying after a missing/expired credential. */
  retryWhenMissing?: boolean
  renewBeforeMs?: number
  retryMs?: number
}

/**
 * App-agnostic credential lifecycle: proactive renewal, bounded retry, tab
 * wake-up handling, and expiry notification. Credential acquisition and
 * storage remain consumer-owned.
 */
export function useCredentialRenewal<T>(
  options: CredentialRenewalOptions<T>
): number {
  const renewRef = useLatest(options.renew)
  const onRenewedRef = useLatest(options.onRenewed)
  const onExpiredRef = useLatest(options.onExpired)
  const [renewalVersion, setRenewalVersion] = useState(0)
  const {
    enabled,
    expiresAt,
    retryWhenMissing = false,
    renewBeforeMs = DEFAULT_CREDENTIAL_RENEW_BEFORE_MS,
    retryMs = DEFAULT_CREDENTIAL_RETRY_MS,
  } = options

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    let running = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const policy = { renewBeforeMs, retryMs }

    const schedule = (delay: number): void => {
      clearTimeout(timer)
      timer = setTimeout(run, delay)
    }

    const handleUnavailable = (): void => {
      if (cancelled) return
      if (expiresAt === null && !retryWhenMissing) return
      const retryDelay = credentialRetryDelay(expiresAt, Date.now(), policy)
      if (retryDelay !== null) {
        schedule(retryDelay)
        return
      }
      onExpiredRef.current?.()
      if (retryWhenMissing) schedule(retryMs)
    }

    const run = (): void => {
      if (running || cancelled) return
      running = true
      void renewRef.current()
        .then(value => {
          if (cancelled) return
          if (value === null) {
            handleUnavailable()
            return
          }
          onRenewedRef.current(value)
          setRenewalVersion(version => version + 1)
        })
        .catch(handleUnavailable)
        .finally(() => {
          running = false
        })
    }

    schedule(credentialRenewalDelay(expiresAt, Date.now(), policy))

    const onVisible = (): void => {
      if (
        document.visibilityState === 'visible'
        && credentialNeedsRenewal(expiresAt, Date.now(), policy)
      ) run()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [
    enabled,
    expiresAt,
    onExpiredRef,
    onRenewedRef,
    renewBeforeMs,
    renewRef,
    retryMs,
    retryWhenMissing,
  ])

  return renewalVersion
}

export type BrowserHistoryOptions = {
  /** Path for whatever is on screen right now, written once on first paint. */
  seedPath(): string
  /**
   * The address bar changed without the app asking. Back/forward, or a
   * fragment-only navigation — pasting a link that differs from the current
   * one only after the `#` does not reload the document and never fires
   * `popstate`, so a listener on that alone silently ignores it.
   */
  onLocationChange(): void
}

export type BrowserHistory = {
  /** Adds a history entry, so Back returns to where the user was. */
  push(path: string): void
  /** Rewrites the current entry, leaving nothing to go Back to. */
  replace(path: string): void
}

/**
 * The address-bar half of routing: seed the URL on first paint so a refresh
 * keeps the deep link, write it on navigation, and report back/forward.
 *
 * Takes paths rather than routes on purpose. The two apps route entirely
 * different things — screens of a workspace, and rooms of a lobby — and only
 * this plumbing was ever the same; rendering a route as a path, hashes and
 * all, stays with the app that understands it.
 */
export function useBrowserHistory(options: BrowserHistoryOptions): BrowserHistory {
  const seedPathRef = useLatest(options.seedPath)
  const onChangeRef = useLatest(options.onLocationChange)
  const seededRef = useRef(false)

  useEffect(() => {
    // Replace, not push: the entry being seeded is the one already showing,
    // so pushing would put a duplicate behind the user's Back button.
    if (seededRef.current) return
    seededRef.current = true
    history.replaceState(null, '', seedPathRef.current())
  }, [seedPathRef])

  useEffect(() => {
    const handler = () => onChangeRef.current()
    window.addEventListener('popstate', handler)
    window.addEventListener('hashchange', handler)
    return () => {
      window.removeEventListener('popstate', handler)
      window.removeEventListener('hashchange', handler)
    }
  }, [onChangeRef])

  return useMemo(
    () => ({
      push: path => history.pushState(null, '', path),
      replace: path => history.replaceState(null, '', path),
    }),
    []
  )
}

const DIALOG_FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Focus trap, Escape close, scroll lock, and focus restoration for modals. */
export function useAccessibleDialog(open: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useLatest(onClose)
  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Make every sibling outside the dialog's ancestor chain unavailable to
    // assistive technology and pointer/keyboard interaction. Setting only the
    // body child would also inert a dialog rendered inside #root, so walk up
    // the tree and inert siblings at each level instead.
    const inerted: Array<{ element: HTMLElement; inert: boolean; ariaHidden: string | null }> = []
    let active: HTMLElement = dialog
    while (active.parentElement && active.parentElement !== document.body) {
      const parent = active.parentElement
      for (const sibling of parent.children) {
        if (!(sibling instanceof HTMLElement) || sibling === active) continue
        inerted.push({
          element: sibling,
          inert: sibling.inert,
          ariaHidden: sibling.getAttribute('aria-hidden'),
        })
        sibling.inert = true
        sibling.setAttribute('aria-hidden', 'true')
      }
      active = parent
    }

    const focusable = () => [...dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE)]
      .filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
    ;(focusable()[0] ?? dialog).focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = items[0]
      const last = items.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      for (const { element, inert, ariaHidden } of inerted) {
        element.inert = inert
        if (ariaHidden === null) element.removeAttribute('aria-hidden')
        else element.setAttribute('aria-hidden', ariaHidden)
      }
      previousFocus?.focus()
    }
  }, [open, onCloseRef])
  return dialogRef
}
import { requireAppId, type Env } from './env.js'
import {
  classifyJoinError,
  isRecoverableJoinError,
  joinRoomByCode,
  type Room,
} from './joinRoom.js'
import { getIceServers, getSupabaseRoomConfig, resolveRelayUrls } from './relays.js'
import { resolveSignalingStrategy } from './signaling.js'
import {
  createRoomMedia,
  type RoomMediaController,
  type RoomMediaDeviceIds,
  type RoomMediaState,
} from './roomMedia.js'
import { probeP2pCapability, type P2pCapability } from './p2pCapability.js'
import { probeTurnCapability, type TurnCapability } from './turnCapability.js'
import { createSpeakingDetector, type SpeakingDetector } from './speaking.js'
import { createRelayCoordinator } from './coordination.js'
import { createRelayChannel, type RelayChannelRoom } from './relayChannel.js'
import {
  openDurableChannel,
  type DurableChannelAuthorization,
} from './durableChannel.js'

export type UseDurableChannelOptions = {
  enabled: boolean
  authorize(): Promise<DurableChannelAuthorization>
  endpointPrefix: string
  onError?: (message: string) => void
  connectTimeoutMs?: number
  encryptionSecret?: string
  /** Reconnect when the app's authorization policy revision changes. */
  authorizationKey?: string
}

/** React lifecycle wrapper around the reusable Durable Object action channel. */
export function useDurableChannel(
  options: UseDurableChannelOptions
): { room: RelayChannelRoom | null } {
  const {
    enabled,
    authorize,
    endpointPrefix,
    onError,
    connectTimeoutMs,
    encryptionSecret,
    authorizationKey,
  } = options
  const authorizeRef = useLatest(authorize)
  const onErrorRef = useLatest(onError)
  const roomScope = useMemo(() => ({ enabled, authorizationKey, connectTimeoutMs, encryptionSecret, endpointPrefix }), [enabled, authorizationKey, connectTimeoutMs, encryptionSecret, endpointPrefix])
  const [room, setRoom] = useConversationState<RelayChannelRoom | null>(roomScope, () => null)

  useEffect(() => {
    if (!enabled) {
      setRoom(null)
      return
    }
    let cancelled = false
    let opened: RelayChannelRoom | null = null
    let retryTimer: number | null = null
    let retryAttempt = 0
    const open = () => {
      void openDurableChannel({
        authorize: () => authorizeRef.current(),
        endpointPrefix,
        ...(connectTimeoutMs === undefined ? {} : { connectTimeoutMs }),
        ...(encryptionSecret === undefined ? {} : { encryptionSecret }),
      }).then(channel => {
        if (cancelled) {
          channel.leave()
          return
        }
        opened = channel
        retryAttempt = 0
        setRoom(channel)
      }).catch(error => {
        if (cancelled) return
        onErrorRef.current?.(
          error instanceof Error ? error.message : 'durable-channel-failed'
        )
        const delay = Math.min(10_000, 500 * 2 ** retryAttempt)
        retryAttempt += 1
        retryTimer = window.setTimeout(open, delay)
      })
    }
    open()
    return () => {
      cancelled = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      opened?.leave()
      setRoom(null)
    }
  }, [authorizeRef, authorizationKey, connectTimeoutMs, enabled, encryptionSecret, endpointPrefix, onErrorRef, setRoom])

  return { room }
}

export type UseRelayChannelOptions = {
  /** Stable P2P namespace owned by the host application. */
  appId: string
  /** Empty means do not connect. */
  channel: string
  /** Opaque application member id; never used as an authorization claim. */
  memberId: string
  env: Env
  onError?: (message: string) => void
  /** Time without a coordinator acknowledgement before surfacing an error. */
  connectTimeoutMs?: number
  /** Authenticated non-persistent DO route for public lobby deployments. */
  durableEndpointPrefix?: string
  durableRouteId?: string
}

/**
 * Server-forwarded public lobby transport. It intentionally mirrors the small
 * Room surface used by both apps while avoiding a WebRTC connection to every
 * signed-in stranger.
 */
export function useRelayChannel(
  options: UseRelayChannelOptions
): { room: RelayChannelRoom | null } {
  const {
    appId,
    channel,
    memberId,
    env,
    onError,
    connectTimeoutMs = 10_000,
    durableEndpointPrefix,
    durableRouteId,
  } = options
  const durableObjects = resolveSignalingStrategy(env) === 'durable-objects'
  const durableForwarder = durableObjects &&
    Boolean(durableEndpointPrefix && durableRouteId)
  const durableAuthAppId = durableForwarder ? requireAppId(env) : ''
  const { room: durableP2pRoom } = useRoom({
    appId,
    roomId: durableObjects && !durableForwarder ? channel : '',
    password: channel,
    env,
    onError,
  })
  const authorizeDurableLobby = useCallback(
    async () => {
      await ensureDurableObjectsSession(durableAuthAppId)
      return { routeId: durableRouteId ?? '' }
    },
    [durableAuthAppId, durableRouteId]
  )
  const { room: durableForwardedRoom } = useDurableChannel({
    enabled: durableForwarder && Boolean(channel && memberId),
    authorize: authorizeDurableLobby,
    endpointPrefix: durableEndpointPrefix ?? '/api/realtime/lobby/',
    connectTimeoutMs,
    authorizationKey: durableRouteId,
    onError,
  })
  const [room, setRoom] = useState<RelayChannelRoom | null>(null)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const envRef = useRef(env)
  envRef.current = env

  useEffect(() => {
    if (durableObjects) {
      setRoom(null)
      return
    }
    if (!channel || !memberId) {
      setRoom(null)
      return
    }
    const coordinator = createRelayCoordinator(envRef.current)
    const relayRoom = createRelayChannel(coordinator, channel, memberId)
    let available = false
    const unsubscribe = coordinator.subscribe(event => {
      if (event.type === 'status') available = event.available
    })
    const timeout = window.setTimeout(() => {
      if (!available) onErrorRef.current?.('The public relay is not responding. Retrying…')
    }, connectTimeoutMs)
    setRoom(relayRoom)
    return () => {
      window.clearTimeout(timeout)
      unsubscribe()
      relayRoom.leave()
      coordinator.close()
      setRoom(null)
    }
  }, [channel, memberId, connectTimeoutMs, durableObjects, setRoom])

  return {
    room: durableObjects
      ? durableForwarder
        ? durableForwardedRoom
        : durableP2pRoom as unknown as RelayChannelRoom | null
      : room,
  }
}

export type RoomErrorKind =
  | 'password-mismatch'
  | 'ice-failed'
  | 'needs-turn'
  | 'relay-failed'
  | 'supabase-config'
  | 'generic'

export type SafeJoinErrorLog = {
  error: string
  appId: string
  peerId?: string
  kind: ReturnType<typeof classifyJoinError>
}

/**
 * Keep room capabilities/passwords out of browser logs.
 *
 * Trystero includes `roomId` in its diagnostic object. In Peerly workspaces
 * that value is also the room password, so forwarding the object verbatim
 * leaks access material into screenshots and copied support logs.
 */
export function safeJoinErrorLog(
  details: { error?: unknown; appId?: string; peerId?: string },
  fallbackAppId: string
): SafeJoinErrorLog {
  const error = String(details.error ?? 'Connection failed')
  return {
    error,
    appId: details.appId ?? fallbackAppId,
    ...(details.peerId ? { peerId: details.peerId } : {}),
    kind: classifyJoinError(error),
  }
}

const DEFAULT_ERROR_TEXT: Record<RoomErrorKind, (raw: string) => string> = {
  'password-mismatch': () =>
    'A peer tried to join with a different room code. If you cannot connect, check that your code matches exactly.',
  'ice-failed': () =>
    'Found the other peer, but the connection was interrupted. Waiting for them to reconnect.',
  'needs-turn': () =>
    'Found the other peer but could not open a direct connection — one of you is on a network that blocks peer-to-peer (strict NAT or firewall). Check TURN reachability (UDP/TCP, external-ip, credentials).',
  'relay-failed': raw => `Connection failed: ${raw}. Ensure the local relay is running.`,
  'supabase-config': () =>
    'Supabase signaling is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  generic: raw => `Connection failed: ${raw}. Check your network or try again.`,
}

/**
 * TURN advice is only actionable when this build has no TURN configuration.
 * A generic post-SDP failure with TURN configured is commonly refresh/network
 * churn and must not claim that the TURN service is missing or unreachable.
 */
export function roomErrorKindForJoinError(
  kind: ReturnType<typeof classifyJoinError>,
  turnConfigured: boolean
): RoomErrorKind {
  if (kind === 'password-mismatch') return 'password-mismatch'
  if (kind === 'needs-turn') return 'needs-turn'
  if (kind === 'ice-failed') return turnConfigured ? 'ice-failed' : 'needs-turn'
  return 'generic'
}

/** Max automatic leave+rejoin cycles per room before surfacing the error. */
const MAX_RECOVERY_ATTEMPTS = 3
/** Ignore duplicate failure reports within this window (refresh thrash). */
const RECOVERY_DEBOUNCE_MS = 2_000
/** Backoff schedule for recovery attempts (ms). */
const RECOVERY_BACKOFF_MS = [1_000, 3_000, 8_000] as const
/**
 * Give the lexicographically elected follower enough time to observe the
 * leader's leave/rejoin before it rebuilds its own room. If that succeeds, the
 * follower cancels its timer when the new data channel appears.
 */
const RECOVERY_FOLLOWER_DELAY_MS = 4_000

export function privateRoomRecoveryDelayMs(
  attemptIndex: number,
  localPeerId: string,
  remotePeerId?: string
): number {
  const base =
    RECOVERY_BACKOFF_MS[
      Math.min(Math.max(0, attemptIndex), RECOVERY_BACKOFF_MS.length - 1)
    ] ?? 15_000
  if (!remotePeerId || localPeerId < remotePeerId) return base
  return base + RECOVERY_FOLLOWER_DELAY_MS
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
  /**
   * Time to wait for a newly signaled data channel before treating a private
   * connection as stalled. Leave undefined for the conservative core default.
   */
  handshakeTimeoutMs?: number
  /**
   * Rebuild a private room after post-SDP ICE failure. Keep false for public
   * lobbies: one unreachable stranger must not restart everybody's room.
   */
  recoverIceFailures?: boolean
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
  const {
    appId,
    roomId,
    password = '',
    env,
    onError,
    onPeerHandshake,
    handshakeTimeoutMs,
    recoverIceFailures = false,
    errorText,
  } = options
  const strategy = resolveSignalingStrategy(env)
  const roomScope = useMemo(() => ({ appId, roomId, password, strategy }), [appId, roomId, password, strategy])
  const [room, setRoom] = useConversationState<Room | null>(roomScope, () => null)
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
   * Important: recovery is private-room opt-in for ICE failures, is skipped
   * while any healthy peer exists, is debounced, capped and backed off. Those
   * guards prevent one unreachable participant from restarting a healthy room.
   */
  const [rejoinNonce, setRejoinNonce] = useState(0)
  const recoveryRef = useRef({
    attempts: 0,
    timer: 0,
    lastFailureAt: 0,
  })
  const loggedJoinErrorsRef = useRef(new Map<string, number>())
  const turnDiagnosticRoomRef = useRef('')

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

    const scheduleRecovery = (remotePeerId?: string) => {
      const recovery = recoveryRef.current
      const now = Date.now()
      if (now - recovery.lastFailureAt < RECOVERY_DEBOUNCE_MS) return
      recovery.lastFailureAt = now

      const connectedPeers = Object.keys(instanceRef.current?.getPeers() ?? {}).length
      if (connectedPeers > 0) return
      if (recovery.timer !== 0) return
      // Stop after the bounded recovery budget. The old one-minute cooldown
      // reset the budget forever, so an unreachable peer kept every browser in
      // the room rebuilding PeerConnections and TURN allocations indefinitely.
      if (recovery.attempts >= MAX_RECOVERY_ATTEMPTS) return

      const attemptIndex = recovery.attempts
      recovery.attempts++
      const delay = privateRoomRecoveryDelayMs(attemptIndex, selfId, remotePeerId)
      recovery.timer = window.setTimeout(() => {
        recovery.timer = 0
        // The elected leader may already have repaired the connection while
        // this follower was waiting. Rejoining now would tear down the healthy
        // replacement and recreate the simultaneous-refresh race.
        if (Object.keys(instanceRef.current?.getPeers() ?? {}).length > 0) {
          recovery.attempts = 0
          recovery.lastFailureAt = 0
          return
        }
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
        handshakeTimeoutMs,
        onPeerHandshake,
        onJoinError: (details: { error?: unknown; appId?: string; peerId?: string }) => {
          const msg = String(details.error ?? 'Connection failed')
          const kind = classifyJoinError(msg)
          const logKey = `${appId}\n${roomId}\n${details.peerId ?? ''}\n${kind}`
          const lastLogged = loggedJoinErrorsRef.current.get(logKey) ?? 0
          if (Date.now() - lastLogged >= 60_000) {
            loggedJoinErrorsRef.current.set(logKey, Date.now())
            const safeDetails = safeJoinErrorLog(details, appId)
            if (kind === 'unknown') console.error('[Trystero] Connection issue:', safeDetails)
            else console.warn('[Trystero] Connection issue:', safeDetails)
          }
          if (kind === 'password-mismatch') {
            const connectedPeers = Object.keys(instanceRef.current?.getPeers() ?? {}).length
            if (connectedPeers === 0) reportRef.current('password-mismatch', msg)
            return
          }
          if (isRecoverableJoinError(kind) || (kind === 'ice-failed' && recoverIceFailures)) {
            scheduleRecovery(details.peerId)
            if (kind !== 'ice-failed') return
          }
          if (kind === 'ice-failed') {
            // Recovery is scheduled above for private rooms. Still report and
            // probe the first failure so the UI and support logs explain why.
            // Public rooms only take this reporting path.
            // One local relay-only allocation separates "our network cannot
            // reach TURN" from "TURN works here; inspect candidate delivery or
            // the remote peer". It runs out of band and once per room, so it
            // neither delays reconnection nor creates an allocation storm.
            if (turnDiagnosticRoomRef.current !== `${appId}\n${roomId}`) {
              turnDiagnosticRoomRef.current = `${appId}\n${roomId}`
              void probeTurnCapability(envRef.current).then(result => {
                console.warn('[Trystero] TURN diagnostic:', {
                  appId,
                  ...(details.peerId ? { peerId: details.peerId } : {}),
                  status: result.status,
                  transports: result.transports,
                  detail: result.detail,
                })
              })
            }
            reportRef.current(
              roomErrorKindForJoinError(kind, Boolean(getIceServers(envRef.current))),
              msg
            )
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
  }, [appId, roomId, password, strategy, resolvedRelayUrls, onPeerHandshake, handshakeTimeoutMs, recoverIceFailures, rejoinNonce, setRoom])

  // A new room is a fresh start for recovery accounting; a pending rejoin
  // timer must not fire into a room it no longer belongs to.
  useEffect(() => {
    const recovery = recoveryRef.current
    loggedJoinErrorsRef.current.clear()
    turnDiagnosticRoomRef.current = ''
    recovery.attempts = 0
    recovery.lastFailureAt = 0
    return () => {
      if (recovery.timer) {
        window.clearTimeout(recovery.timer)
        recovery.timer = 0
      }
    }
  }, [appId, roomId])

  // A live data channel proves the current network path works. Start future
  // recovery from a fresh budget instead of permanently remembering unrelated
  // failures from strangers that were encountered earlier in a public lobby.
  useEffect(() => {
    if (!room) return
    const resetAfterSuccess = () => {
      if (Object.keys(room.getPeers()).length === 0) return
      if (recoveryRef.current.timer) {
        window.clearTimeout(recoveryRef.current.timer)
        recoveryRef.current.timer = 0
      }
      recoveryRef.current.attempts = 0
      recoveryRef.current.lastFailureAt = 0
    }
    resetAfterSuccess()
    const timer = window.setInterval(resetAfterSuccess, 1_000)
    return () => window.clearInterval(timer)
  }, [room])

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

const CHECKING_TURN: TurnCapability = {
  status: 'checking',
  detail: 'Checking TURN relay allocation…',
  transports: [],
}

export function useTurnCapability(env: Env) {
  const [capability, setCapability] = useState<TurnCapability>(CHECKING_TURN)
  const [attempt, setAttempt] = useState(0)
  const envRef = useRef(env)
  envRef.current = env

  const retry = useCallback(() => {
    setCapability(CHECKING_TURN)
    setAttempt(value => value + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    void probeTurnCapability(envRef.current).then(result => {
      if (!cancelled) setCapability(result)
    })
    return () => {
      cancelled = true
    }
  }, [attempt])

  return { capability, retry }
}

/**
 * Track which of several live streams are currently speaking. Keyed by an
 * app-chosen id (peerId, or 'self' for the local stream).
 */
export function useSpeakingStreams(
  streams: Record<string, MediaStream | null | undefined>
): Record<string, boolean> {
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({})
  const detectorsRef = useRef(
    new Map<string, { stream: MediaStream; detector: SpeakingDetector }>()
  )

  useEffect(() => {
    const detectors = detectorsRef.current
    const wanted = new Set<string>()

    for (const [id, stream] of Object.entries(streams)) {
      if (!stream) continue
      wanted.add(id)
      const existing = detectors.get(id)
      if (existing && existing.stream === stream) continue
      existing?.detector.stop()
      const detector = createSpeakingDetector(stream, isSpeaking => {
        setSpeaking(prev => (prev[id] === isSpeaking ? prev : { ...prev, [id]: isSpeaking }))
      })
      detectors.set(id, { stream, detector })
    }

    for (const [id, entry] of detectors) {
      if (wanted.has(id)) continue
      entry.detector.stop()
      detectors.delete(id)
      setSpeaking(prev => {
        if (!(id in prev)) return prev
        const { [id]: _gone, ...rest } = prev
        return rest
      })
    }
  }, [streams])

  useEffect(
    () => () => {
      for (const entry of detectorsRef.current.values()) entry.detector.stop()
      detectorsRef.current.clear()
    },
    []
  )

  return speaking
}

export {
  useApprovedDeviceSync,
  type ApprovedDeviceSyncConfig,
  type SyncHello,
} from './reactDeviceSync.js'

export {
  useDevicePairing,
  type DevicePairing,
  type DevicePairingConfig,
  type PairHello,
  type PairRole,
} from './reactDevicePairing.js'

export { useMessageOutbox } from './reactMessageOutbox.js'
export { useConversationState } from './reactConversationState.js'

export { useHistoryPersistence } from './reactHistoryPersistence.js'
