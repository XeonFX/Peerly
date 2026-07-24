import { base64UrlToBytes, bytesToBase64Url } from './base64url.js'
import type { Env } from './env.js'
import { requireAppId } from './env.js'
import { resolveRelayUrls } from './relays.js'
import { getDurableObjectsTransport } from './realtime/runtime.js'

const COORDINATION_TOPIC = '__relay_coord_v1__'
const REFRESH_MS = 10_000
const SOCKET_POLL_MS = 1_000
/**
 * Durable Objects backend polls, split because the two things cost very
 * different amounts and change at very different rates.
 *
 * Interest counts are an edge-cached HTTP GET (one Worker request, served from
 * the colo cache), and they are what a user watches while deciding whether
 * anyone shares their interest — so they poll fast.
 *
 * The room directory is a `directory.list` command over the control socket,
 * which bills a cross-object request on the directory shard *per tab, per
 * poll*. Public rooms come and go on a scale of minutes. At 10s a single
 * always-open tab spends ~8,600 Durable Object requests a day on room
 * listings alone — roughly a tenth of the entire free daily allowance for one
 * idle browser tab.
 *
 * Both are additionally gated on document visibility (see startRefreshTimer):
 * the architecture plan requires client polling to be "demand-driven and
 * visibility-gated", and a background tab polling a lobby nobody is looking at
 * is the single easiest way to exhaust the free plan.
 */
const DO_STATS_REFRESH_MS = 10_000
const DO_ROOMS_REFRESH_MS = 30_000

type Command = { v: 1; type: 'coord'; action: string; [key: string]: unknown }

export type RelayPresenceMember = {
  connectionId: string
  memberId: string
  data: string
}

export type RelayChannelMember = {
  connectionId: string
  memberId: string
}

export type RelayCoordinationEvent =
  | { type: 'status'; available: boolean; connectionId?: string }
  | { type: 'presence.snapshot'; scope: string; members: RelayPresenceMember[] }
  | { type: 'seek.stats'; pool: string; total: number; tags: Record<string, number> }
  | {
      type: 'seek.proposal'
      pool: string
      matchId: string
    }
  | {
      type: 'seek.match'
      pool: string
      matchId: string
      roomCode: string
      initiator: boolean
      partner: { memberId: string; data: string }
    }
  | {
      type: 'room.snapshot'
      directory: string
      rooms: Array<{ roomId: string; data: string }>
      cursor?: number
      nextCursor?: number
      total?: number
    }
  | { type: 'channel.snapshot'; channel: string; members: RelayChannelMember[] }
  | {
      type: 'channel.message'
      channel: string
      event: string
      messageId: string
      senderConnectionId: string
      senderMemberId: string
      data: string
    }
  | { type: 'error'; code: string }

export type RelayCoordinator = {
  setPresence(scope: string, memberId: string, data: string): void
  clearPresence(scope: string): void
  watchSeek(pool: string): void
  unwatchSeek(pool: string): void
  setSeek(pool: string, memberId: string, tags: string[], data: string, excluded?: string[]): void
  clearSeek(pool: string): void
  /** Acknowledge a v2 match proposal; the relay commits only after both peers ack. */
  acknowledgeSeekMatch(pool: string, matchId: string): void
  watchRooms(directory: string, page?: { cursor?: number; limit?: number }): void
  unwatchRooms(directory: string): void
  setRoom(directory: string, roomId: string, data: string): void
  clearRoom(directory: string): void
  watchChannel(channel: string, memberId: string): void
  unwatchChannel(channel: string): void
  publishChannel(
    channel: string,
    event: string,
    messageId: string,
    data: string,
    targetConnectionId?: string
  ): void
  subscribe(listener: (event: RelayCoordinationEvent) => void): () => void
  close(): void
}

type RelaySocketMap = Record<string, WebSocket>

/**
 * Uses Trystero's already-open signaling socket for ephemeral coordination.
 * Older relays safely ignore these messages; `status.available` becomes true
 * only after the extended relay explicitly acknowledges the protocol.
 */
export function createRelayCoordinator(
  env: Env,
  options?: {
    getSockets?: () => RelaySocketMap
    createSocket?: (url: string) => WebSocket
    reconnectMs?: number
  }
): RelayCoordinator {
  if (env.VITE_SIGNALING === 'durable-objects') {
    return createDurableObjectsCoordinator(env)
  }
  const listeners = new Set<(event: RelayCoordinationEvent) => void>()
  const desired = new Map<string, Command>()
  let urls: string[] = []
  let getSockets = options?.getSockets
  let socket: WebSocket | null = null
  let ownedSocket: WebSocket | null = null
  let ownedConnecting = false
  let reconnectTimer: ReturnType<typeof globalThis.setTimeout> | undefined
  let reconnectAttempt = 0
  let ownedUrl = ''
  const endpointFailures = new Map<string, { count: number; retryAt: number }>()
  let available = false
  let connectionId: string | undefined
  let closed = false

  const emit = (event: RelayCoordinationEvent) => listeners.forEach(listener => listener(event))
  const send = (command: Command) => {
    if (!available || socket?.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify(command))
  }
  const remember = (key: string, command: Command) => {
    desired.set(key, command)
    send(command)
  }
  const forget = (key: string, command: Command) => {
    desired.delete(key)
    send(command)
  }
  const flush = () => desired.forEach(send)

  const accepts = (message: Record<string, unknown>) => {
    if (message.type === 'presence.snapshot') return desired.has(`presence:${message.scope}`)
    if (message.type === 'seek.stats' || message.type === 'seek.proposal' || message.type === 'seek.match') {
      return desired.has(`seek-watch:${message.pool}`) || desired.has(`seek:${message.pool}`)
    }
    if (message.type === 'room.snapshot') return desired.has(`room-watch:${message.directory}`)
    if (message.type === 'channel.snapshot' || message.type === 'channel.message') {
      return desired.has(`channel-watch:${message.channel}`)
    }
    return message.type === 'error'
  }

  const onMessage = (event: MessageEvent) => {
    try {
      const envelope = JSON.parse(String(event.data)) as { topic?: unknown; payload?: unknown }
      if (envelope.topic !== COORDINATION_TOPIC || !envelope.payload || typeof envelope.payload !== 'object') return
      const message = envelope.payload as Record<string, unknown>
      if (message.v !== 1 || typeof message.type !== 'string') return
      if (message.type === 'ready') {
        reconnectAttempt = 0
        if (ownedUrl) endpointFailures.delete(new URL(ownedUrl).host)
        connectionId = typeof message.connectionId === 'string' ? message.connectionId : undefined
        if (!available) {
          available = true
          emit({ type: 'status', available: true, connectionId })
        }
        flush()
        return
      }
      if (accepts(message)) emit(message as RelayCoordinationEvent)
    } catch {
      // Trystero traffic and malformed relay extensions are unrelated.
    }
  }

  const detach = () => {
    if (socket) socket.removeEventListener('message', onMessage)
    socket = null
    connectionId = undefined
    if (available) {
      available = false
      emit({ type: 'status', available: false })
    }
  }

  const sendHello = (target: WebSocket) => {
    target.send(JSON.stringify({
      v: 1,
      type: 'coord',
      action: 'hello',
      capabilities: ['seek-ack'],
    }))
  }

  const attach = (next: WebSocket) => {
    if (next === socket) return
    detach()
    socket = next
    socket.addEventListener('message', onMessage)
    sendHello(socket)
  }

  const pollSocket = () => {
    if (closed || !getSockets) return
    const sockets = getSockets()
    const next = urls.map(url => sockets[url]).find(candidate => candidate?.readyState === WebSocket.OPEN)
    if (!next) {
      if (socket) detach()
      return
    }
    attach(next)
  }

  const scheduleOwnedReconnect = () => {
    if (closed || reconnectTimer !== undefined) return
    const base = options?.reconnectMs ?? 1_000
    const delay = Math.min(30_000, base * 2 ** Math.min(reconnectAttempt, 5))
    reconnectAttempt += 1
    reconnectTimer = globalThis.setTimeout(() => {
      reconnectTimer = undefined
      void connectOwnedSocket()
    }, delay)
  }

  const connectOwnedSocket = async () => {
    if (closed || getSockets || ownedSocket || ownedConnecting) return
    ownedConnecting = true
    try {
      // Resolve again on every reconnect so an expired relay ticket is replaced.
      urls = await resolveRelayUrls(env)
      if (closed || urls.length === 0) return
      const timestamp = Date.now()
      const ranked = urls
        .map((url, offset) => ({
          url,
          offset,
          failure: endpointFailures.get(new URL(url).host),
        }))
        .sort((left, right) => {
          const leftCooling = (left.failure?.retryAt ?? 0) > timestamp
          const rightCooling = (right.failure?.retryAt ?? 0) > timestamp
          if (leftCooling !== rightCooling) return leftCooling ? 1 : -1
          return (left.failure?.count ?? 0) - (right.failure?.count ?? 0) || left.offset - right.offset
        })
      const url = ranked[0].url
      const next = options?.createSocket ? options.createSocket(url) : new WebSocket(url)
      ownedSocket = next
      ownedUrl = url
      next.addEventListener('open', () => {
        if (closed || ownedSocket !== next) return
        attach(next)
      })
      next.addEventListener('close', () => {
        const host = new URL(url).host
        const prior = endpointFailures.get(host)?.count ?? 0
        const count = prior + 1
        endpointFailures.set(host, {
          count,
          retryAt: Date.now() + Math.min(60_000, (options?.reconnectMs ?? 1_000) * 2 ** Math.min(count, 6)),
        })
        if (ownedSocket === next) ownedSocket = null
        if (socket === next) detach()
        scheduleOwnedReconnect()
      })
      next.addEventListener('error', () => {
        try {
          next.close()
        } catch {
          // The close handler owns reconnect scheduling.
        }
      })
    } catch {
      scheduleOwnedReconnect()
    } finally {
      ownedConnecting = false
    }
  }

  void (async () => {
    if (getSockets) {
      urls = await resolveRelayUrls(env)
      pollSocket()
    } else {
      void connectOwnedSocket()
    }
  })()

  const socketPoll = globalThis.setInterval(pollSocket, SOCKET_POLL_MS)
  // Only TTL-backed state needs a heartbeat. Watch commands are socket-scoped
  // and replayed by `flush()` after reconnect; repeating them generated full
  // directory snapshots and inflated command/fanout volume every ten seconds.
  const refresh = globalThis.setInterval(() => {
    desired.forEach(command => {
      if (
        command.action === 'presence.set' ||
        command.action === 'seek.set' ||
        command.action === 'room.set'
      ) send(command)
    })
  }, REFRESH_MS)

  return {
    setPresence: (scope, memberId, data) => remember(`presence:${scope}`, {
      v: 1, type: 'coord', action: 'presence.set', scope, memberId, data,
    }),
    clearPresence: scope => forget(`presence:${scope}`, {
      v: 1, type: 'coord', action: 'presence.clear', scope,
    }),
    watchSeek: pool => remember(`seek-watch:${pool}`, {
      v: 1, type: 'coord', action: 'seek.watch', pool,
    }),
    unwatchSeek: pool => forget(`seek-watch:${pool}`, {
      v: 1, type: 'coord', action: 'seek.unwatch', pool,
    }),
    setSeek: (pool, memberId, tags, data, excluded = []) => remember(`seek:${pool}`, {
      v: 1, type: 'coord', action: 'seek.set', pool, memberId, tags, data, excluded,
    }),
    clearSeek: pool => forget(`seek:${pool}`, {
      v: 1, type: 'coord', action: 'seek.clear', pool,
    }),
    acknowledgeSeekMatch: (pool, matchId) => send({
      v: 1, type: 'coord', action: 'seek.ack', pool, matchId,
    }),
    watchRooms: (directory, page) => remember(`room-watch:${directory}`, {
      v: 1,
      type: 'coord',
      action: 'room.watch',
      directory,
      ...(page?.cursor !== undefined ? { cursor: page.cursor } : {}),
      ...(page?.limit !== undefined ? { limit: page.limit } : {}),
    }),
    unwatchRooms: directory => forget(`room-watch:${directory}`, {
      v: 1, type: 'coord', action: 'room.unwatch', directory,
    }),
    setRoom: (directory, roomId, data) => remember(`room:${directory}`, {
      v: 1, type: 'coord', action: 'room.set', directory, roomId, data,
    }),
    clearRoom: directory => forget(`room:${directory}`, {
      v: 1, type: 'coord', action: 'room.clear', directory,
    }),
    watchChannel: (channel, memberId) => remember(`channel-watch:${channel}`, {
      v: 1, type: 'coord', action: 'channel.watch', channel, memberId,
    }),
    unwatchChannel: channel => forget(`channel-watch:${channel}`, {
      v: 1, type: 'coord', action: 'channel.unwatch', channel,
    }),
    publishChannel: (channel, event, messageId, data, targetConnectionId) => send({
      v: 1,
      type: 'coord',
      action: 'channel.publish',
      channel,
      event,
      messageId,
      data,
      ...(targetConnectionId ? { targetConnectionId } : {}),
    }),
    subscribe(listener) {
      listeners.add(listener)
      listener({ type: 'status', available, connectionId })
      return () => listeners.delete(listener)
    },
    close() {
      closed = true
      // Best-effort explicit withdrawal; close cleanup on the relay is the
      // authoritative fallback if navigation races these sends.
      for (const command of desired.values()) {
        const clearAction = command.action === 'presence.set' ? 'presence.clear'
          : command.action === 'seek.set' ? 'seek.clear'
            : command.action === 'room.set' ? 'room.clear'
              : command.action === 'channel.watch' ? 'channel.unwatch'
              : null
        if (clearAction) send({ ...command, action: clearAction })
      }
      desired.clear()
      globalThis.clearInterval(socketPoll)
      globalThis.clearInterval(refresh)
      if (reconnectTimer !== undefined) globalThis.clearTimeout(reconnectTimer)
      reconnectTimer = undefined
      const owned = ownedSocket
      ownedSocket = null
      ownedUrl = ''
      detach()
      if (owned && owned.readyState !== WebSocket.CLOSED) {
        try {
          owned.close(1000, 'coordinator closed')
        } catch {
          // Already closed.
        }
      }
      listeners.clear()
    },
  }
}

function createDurableObjectsCoordinator(env: Env): RelayCoordinator {
  const app = requireAppId(env)
  const transport = getDurableObjectsTransport(app)
  const listeners = new Set<(event: RelayCoordinationEvent) => void>()
  let available = false
  let closed = false
  /**
   * The pool this client is *watching* (availability counts, match delivery)
   * — deliberately separate from the seek it currently has outstanding.
   * Folding the two into one field meant `clearSeek()` (cancel, or accepting
   * a match) also stopped the stats poll and made the `match.commit` handler
   * drop the very event the cancelled-looking seek was waiting for.
   */
  let watchedPool = ''
  let activeSeek: { pool: string; seekId: string } | null = null
  let watchedDirectory = ''
  let hostedRoom: { directory: string; roomId: string; revision: number } | null = null
  let statsTimer: ReturnType<typeof globalThis.setInterval> | undefined
  let roomsTimer: ReturnType<typeof globalThis.setInterval> | undefined
  let onVisibility: (() => void) | null = null
  // Strictly-increasing revision for directory writes. Date.now() alone can
  // repeat (two re-announces in the same millisecond) or invert under async
  // reordering, both of which the shard rejects with a monotonic-revision
  // conflict. Advancing past the last value we issued keeps every write newer.
  let lastRevision = 0
  const nextRevision = () => (lastRevision = Math.max(Date.now(), lastRevision + 1))

  const emit = (event: RelayCoordinationEvent) => {
    if (!closed) listeners.forEach(listener => listener(event))
  }

  const refreshRooms = async () => {
    if (!watchedDirectory || closed) return
    try {
      const page = await transport.listRooms()
      emit({
        type: 'room.snapshot',
        directory: watchedDirectory,
        rooms: page.entries.map(item => ({
          roomId: item.roomId,
          data: typeof item.entry.data === 'string'
            ? item.entry.data
            : JSON.stringify(item.entry),
        })),
        total: page.entries.length,
      })
    } catch {
      emit({ type: 'error', code: 'directory-unavailable' })
    }
  }

  const refreshStats = async () => {
    if (!watchedPool || closed) return
    try {
      // The Worker caches this per colo; `no-store` only stops the *browser*
      // from re-serving its own copy, which otherwise doubled the window in
      // which a new seeker's interest was invisible to everybody else.
      const response = await fetch('/api/stats/snapshot', { cache: 'no-store' })
      if (!response.ok) return
      const snapshot = await response.json() as {
        online?: unknown
        interests?: Array<{ tag?: unknown; count?: unknown }>
      }
      const tags: Record<string, number> = {}
      for (const item of snapshot.interests ?? []) {
        if (typeof item.tag === 'string' && typeof item.count === 'number') tags[item.tag] = item.count
      }
      emit({
        type: 'seek.stats',
        pool: watchedPool,
        total: typeof snapshot.online === 'number' ? snapshot.online : 0,
        tags,
      })
    } catch {
      // Statistics are advisory; matching correctness does not depend on them.
    }
  }

  const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'

  const startRefreshTimer = () => {
    statsTimer ??= globalThis.setInterval(() => {
      if (visible()) void refreshStats()
    }, DO_STATS_REFRESH_MS)
    roomsTimer ??= globalThis.setInterval(() => {
      if (visible()) void refreshRooms()
    }, DO_ROOMS_REFRESH_MS)
    if (onVisibility || typeof document === 'undefined') return
    // Coming back to the tab should show current state immediately, not up to
    // a full poll interval of staleness — that catch-up is what makes it
    // acceptable to stop polling entirely while hidden.
    onVisibility = () => {
      if (!visible() || closed) return
      void refreshStats()
      void refreshRooms()
    }
    document.addEventListener('visibilitychange', onVisibility)
  }

  const stopRefreshTimers = () => {
    if (statsTimer) globalThis.clearInterval(statsTimer)
    if (roomsTimer) globalThis.clearInterval(roomsTimer)
    statsTimer = undefined
    roomsTimer = undefined
    if (onVisibility && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility)
    }
    onVisibility = null
  }

  transport.events.addEventListener('state', event => {
    available = (event as CustomEvent<string>).detail === 'ready'
    emit({ type: 'status', available })
  })
  transport.events.addEventListener('match.commit', event => {
    const pool = activeSeek?.pool || watchedPool
    if (!pool) return
    // The gateway has already torn down its seek row to commit this match, so
    // this client's outstanding seek is spent whether or not it hears back.
    activeSeek = null
    const detail = (event as CustomEvent<{
      matchId: string
      initiator?: boolean
      peer: { opaqueUserId: string; memberId?: string }
    }>).detail
    emit({
      type: 'seek.match',
      pool,
      matchId: detail.matchId,
      roomCode: detail.matchId.replaceAll('-', ''),
      initiator: detail.initiator === true,
      // App-space id when the server has one (so the app's own blocklist and
      // recent-partner cooldown speak the same language as its exclusions);
      // the opaque id only as a fallback for a seek started before this field
      // existed.
      partner: { memberId: detail.peer.memberId || detail.peer.opaqueUserId, data: '{}' },
    })
  })

  void transport.connect().then(() => {
    available = true
    emit({ type: 'status', available: true })
  }).catch(() => emit({ type: 'status', available: false }))

  return {
    setPresence() {},
    clearPresence() {},
    watchSeek(pool) {
      watchedPool = pool
      void refreshStats()
      startRefreshTimer()
    },
    unwatchSeek(pool) {
      if (watchedPool === pool) watchedPool = ''
      if (activeSeek?.pool === pool) activeSeek = null
    },
    setSeek(pool, memberId, tags, _data, excluded = []) {
      const seekId = crypto.randomUUID()
      activeSeek = { pool, seekId }
      // `memberId` is forwarded, not dropped: it is the id the *other* side's
      // exclusion list names us by, so without it nobody's blocklist (or
      // recent-partner cooldown) can exclude anyone.
      void transport.startSeek({ seekId, memberId, interests: tags.slice(0, 5), exclusions: excluded })
    },
    clearSeek(pool) {
      const seek = activeSeek
      if (!seek || seek.pool !== pool) return
      activeSeek = null
      if (seek.seekId) void transport.cancelSeek(seek.seekId)
    },
    acknowledgeSeekMatch() {},
    watchRooms(directory) {
      watchedDirectory = directory
      void refreshRooms()
      startRefreshTimer()
    },
    unwatchRooms(directory) {
      if (watchedDirectory === directory) watchedDirectory = ''
    },
    setRoom(directory, roomId, data) {
      const revision = nextRevision()
      hostedRoom = { directory, roomId, revision }
      // A conflict means a newer revision already won (e.g. a re-announce
      // racing the periodic heartbeat) — the listing is already current, so
      // swallow it rather than let it surface as an unhandled rejection.
      void transport.publishRoom(roomId, revision, { data }).then(refreshRooms).catch(() => {})
    },
    clearRoom(directory) {
      const room = hostedRoom
      if (!room || room.directory !== directory) return
      hostedRoom = null
      void transport.deleteRoom(room.roomId, nextRevision()).then(refreshRooms).catch(() => {})
    },
    watchChannel() {},
    unwatchChannel() {},
    publishChannel() {},
    subscribe(listener) {
      listeners.add(listener)
      listener({ type: 'status', available })
      return () => listeners.delete(listener)
    },
    close() {
      closed = true
      stopRefreshTimers()
      if (activeSeek?.seekId) void transport.cancelSeek(activeSeek.seekId)
      listeners.clear()
    },
  }
}

async function coordinationKey(secret: string, purpose: string): Promise<CryptoKey> {
  const bytes = new TextEncoder().encode(`peerly-relay-coordination-v1\n${purpose}\n${secret}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function coordinationScope(purpose: string, secret: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`peerly-relay-scope-v1\n${purpose}\n${secret}`)
  )
  return bytesToBase64Url(new Uint8Array(digest))
}

export async function coordinationMemberId(secret: string, userId: string): Promise<string> {
  return coordinationScope(`member:${userId}`, secret)
}

export async function sealCoordinationData(
  secret: string,
  purpose: string,
  value: unknown
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(value))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await coordinationKey(secret, purpose),
    plaintext
  ))
  const wire = new Uint8Array(iv.length + ciphertext.length)
  wire.set(iv)
  wire.set(ciphertext, iv.length)
  return bytesToBase64Url(wire)
}

export async function openCoordinationData<T>(
  secret: string,
  purpose: string,
  wire: string
): Promise<T | null> {
  try {
    const bytes = base64UrlToBytes(wire)
    if (bytes.length <= 28 || bytes.length > 8_192) return null
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12) },
      await coordinationKey(secret, purpose),
      bytes.slice(12)
    )
    return JSON.parse(new TextDecoder().decode(plaintext)) as T
  } catch {
    return null
  }
}
