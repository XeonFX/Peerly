import { base64UrlToBytes, bytesToBase64Url } from './base64url.js'
import type { Env } from './env.js'
import { resolveRelayUrls } from './relays.js'

const COORDINATION_TOPIC = '__relay_coord_v1__'
const REFRESH_MS = 10_000
const SOCKET_POLL_MS = 1_000

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
  | { type: 'room.snapshot'; directory: string; rooms: Array<{ roomId: string; data: string }> }
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
  watchRooms(directory: string): void
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
  options?: { getSockets?: () => RelaySocketMap }
): RelayCoordinator {
  const listeners = new Set<(event: RelayCoordinationEvent) => void>()
  const desired = new Map<string, Command>()
  let urls: string[] = []
  let getSockets = options?.getSockets
  let socket: WebSocket | null = null
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

  const pollSocket = () => {
    if (closed || !getSockets) return
    const sockets = getSockets()
    const next = urls.map(url => sockets[url]).find(candidate => candidate?.readyState === WebSocket.OPEN)
    if (next === socket) return
    detach()
    if (!next) return
    socket = next
    socket.addEventListener('message', onMessage)
    socket.send(JSON.stringify({
      v: 1,
      type: 'coord',
      action: 'hello',
      capabilities: ['seek-ack'],
    }))
  }

  void (async () => {
    urls = await resolveRelayUrls(env)
    if (!getSockets) {
      const relay = await import('@trystero-p2p/ws-relay')
      getSockets = relay.getRelaySockets as () => RelaySocketMap
    }
    pollSocket()
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
    watchRooms: directory => remember(`room-watch:${directory}`, {
      v: 1, type: 'coord', action: 'room.watch', directory,
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
      detach()
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
