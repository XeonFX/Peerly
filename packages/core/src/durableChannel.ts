import type {
  RelayChannelAction,
  RelayChannelPeers,
  RelayChannelRoom,
} from './relayChannel.js'

export type DurableChannelAuthorization = {
  routeId: string
  expiresAt?: number
}

export type DurableChannelOptions = {
  authorize(): Promise<DurableChannelAuthorization>
  /** Path prefix ending in `/`; the opaque route id is URL-encoded and appended. */
  endpointPrefix: string
  connectTimeoutMs?: number
  webSocketFactory?: (url: string) => WebSocket
  /** Optional high-entropy room capability used for end-to-end AES-GCM. */
  encryptionSecret?: string
}

type MemberWire = {
  connectionId: string
  userId: string
  deviceKeyId: string
}

type EventWire = {
  type: 'event'
  event: string
  data: unknown
  senderUserId: string
  senderDeviceKeyId?: string
}

type ServerWire =
  | {
      type: 'snapshot'
      connectionId: string
      members: MemberWire[]
      events?: EventWire[]
    }
  | { type: 'members'; members: MemberWire[] }
  | EventWire
  | { type: 'ack'; messageId: string }
  | { type: 'error'; code: string; messageId?: string }

type PendingMessage = {
  value: unknown
  meta: { peerId: string; userId?: string; deviceKeyId?: string }
}

// A channel-state replay can include up to 1,000 legacy encrypted snapshots
// plus 1,000 current entities; metadata must not be truncated before binding.
const MAX_BUFFERED_PER_ACTION = 2_000
const MAX_PENDING_OUTBOUND = 1_000
const OUTBOUND_ACK_TIMEOUT_MS = 30_000
const RECONNECT_BASE_MS = 250
const RECONNECT_CAP_MS = 10_000

type EncryptedData = {
  v: 1
  iv: string
  ciphertext: string
}

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

const base64UrlToBytes = (value: string): Uint8Array<ArrayBuffer> => {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`peerly-durable-channel-v1\n${secret}`)
  )
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encryptData(value: unknown, key: CryptoKey): Promise<EncryptedData> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(value))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return {
    v: 1,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  }
}

async function decryptData(value: unknown, key: CryptoKey): Promise<unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    (value as Partial<EncryptedData>).v !== 1 ||
    typeof (value as Partial<EncryptedData>).iv !== 'string' ||
    typeof (value as Partial<EncryptedData>).ciphertext !== 'string'
  ) throw new Error('invalid-encrypted-channel-data')
  const encrypted = value as EncryptedData
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(encrypted.iv) },
    key,
    base64UrlToBytes(encrypted.ciphertext)
  )
  return JSON.parse(new TextDecoder().decode(plaintext))
}

function webSocketUrl(endpointPrefix: string, routeId: string): string {
  const base = new URL(endpointPrefix, window.location.href)
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  if (!base.pathname.endsWith('/')) base.pathname += '/'
  base.pathname += encodeURIComponent(routeId)
  return base.toString()
}

/**
 * Opens an authenticated, server-forwarded channel that mirrors the small
 * action API used by Trystero rooms. Durable Object storage/authorization is
 * consumer-owned; this adapter is intentionally unaware of product schemas.
 */
export async function openDurableChannel(
  options: DurableChannelOptions
): Promise<RelayChannelRoom> {
  const contentKey = options.encryptionSecret
    ? await encryptionKey(options.encryptionSecret)
    : null
  const webSocketFactory = options.webSocketFactory ?? (url => new WebSocket(url))
  const actions = new Map<string, RelayChannelAction<unknown>>()
  const pending = new Map<string, PendingMessage[]>()
  const outbound = new Map<string, {
    frame: string
    resolve: () => void
    reject: (error: Error) => void
    timeout: number
  }>()
  let peers: RelayChannelPeers = {}
  let ownConnectionId = ''
  let ownUserId = ''
  let closed = false
  let socket: WebSocket | null = null
  let reconnectTimer: number | null = null
  let reconnectAttempt = 0
  let connecting: Promise<void> | null = null
  const closeCurrentSocket = () => {
    if (socket) socket.close()
  }

  const room: RelayChannelRoom = {
    makeAction<T>(event: string): RelayChannelAction<T> {
      const existing = actions.get(event)
      if (existing) return existing as RelayChannelAction<T>
      const action: RelayChannelAction<T> = {
        onMessage: null,
        async send(value, sendOptions) {
          if (closed) {
            throw new Error('durable-channel-not-open')
          }
          const data = contentKey ? await encryptData(value, contentKey) : value
          if (outbound.size >= MAX_PENDING_OUTBOUND) {
            throw new Error('durable-channel-queue-full')
          }
          const messageId = sendOptions?.messageId ?? crypto.randomUUID()
          if (!messageId || messageId.length > 80 || outbound.has(messageId)) throw new Error('invalid-or-pending-message-id')
          const state = sendOptions?.state
          if (state && !options.encryptionSecret) throw new Error('state-requires-encryption')
          const stateKey = state ? bytesToBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256',
            new TextEncoder().encode(`peerly-channel-state-v1\n${options.encryptionSecret}\n${event}\n${state.key}`)))) : undefined
          const frame = JSON.stringify({
            type: 'event',
            event,
            messageId,
            data,
            ...(state ? { state: { key: stateKey, revision: state.revision, deleted: state.deleted === true } } : {}),
            ...(sendOptions?.target ? { target: sendOptions.target } : {}),
          })
          await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(() => {
              outbound.delete(messageId)
              reject(new Error('durable-channel-ack-timeout'))
            }, OUTBOUND_ACK_TIMEOUT_MS)
            outbound.set(messageId, { frame, resolve, reject, timeout })
            if (socket?.readyState === WebSocket.OPEN) socket.send(frame)
            else scheduleReconnect()
          })
        },
      }
      actions.set(event, action as RelayChannelAction<unknown>)
      const queued = pending.get(event)
      if (queued) {
        pending.delete(event)
        queueMicrotask(() => {
          for (const item of queued) action.onMessage?.(item.value as T, item.meta)
        })
      }
      return action
    },
    getPeers: () => peers,
    onPeerJoin: null,
    onPeerLeave: null,
    leave() {
      if (closed) return
      closed = true
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
      reconnectTimer = null
      socket?.close(1000, 'left')
      socket = null
      for (const item of outbound.values()) {
        window.clearTimeout(item.timeout)
        item.reject(new Error('durable-channel-closed'))
      }
      outbound.clear()
      for (const peerId of Object.keys(peers)) room.onPeerLeave?.(peerId)
      peers = {}
      actions.clear()
      pending.clear()
    },
  }

  const refreshMembers = (members: MemberWire[]) => {
    const next: RelayChannelPeers = {}
    for (const member of members) {
      if (member.connectionId === ownConnectionId || member.userId === ownUserId) continue
      // Multiple tabs/devices for one account are one participant. Targeting
      // that peer id intentionally reaches every live connection for the user.
      next[member.userId] = {
        memberId: member.userId,
        userId: member.userId,
        deviceKeyId: member.deviceKeyId,
      }
    }
    const previousIds = new Set(Object.keys(peers))
    peers = next
    for (const peerId of Object.keys(next)) {
      if (!previousIds.delete(peerId)) room.onPeerJoin?.(peerId)
    }
    for (const peerId of previousIds) room.onPeerLeave?.(peerId)
  }

  const deliver = async (wire: EventWire) => {
    const meta = {
      peerId: wire.senderUserId,
      userId: wire.senderUserId,
      ...(wire.senderDeviceKeyId ? { deviceKeyId: wire.senderDeviceKeyId } : {}),
    }
    let value: unknown
    try {
      value = contentKey ? await decryptData(wire.data, contentKey) : wire.data
    } catch {
      return
    }
    const action = actions.get(wire.event)
    if (action?.onMessage) {
      action.onMessage(value, meta)
      return
    }
    const queued = pending.get(wire.event) ?? []
    if (queued.length < MAX_BUFFERED_PER_ACTION) queued.push({ value, meta })
    pending.set(wire.event, queued)
  }

  const clearPeers = () => {
    const previous = Object.keys(peers)
    peers = {}
    ownConnectionId = ''
    ownUserId = ''
    for (const peerId of previous) room.onPeerLeave?.(peerId)
  }

  const scheduleReconnect = () => {
    if (closed || reconnectTimer !== null) return
    if (connecting) {
      const activeConnection = connecting
      const retryAfterSettlement = () => {
        if (!closed && !socket) scheduleReconnect()
      }
      void activeConnection.then(retryAfterSettlement, retryAfterSettlement)
      return
    }
    const delay = Math.min(
      RECONNECT_CAP_MS,
      RECONNECT_BASE_MS * 2 ** reconnectAttempt
    )
    reconnectAttempt += 1
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      void connect().catch(() => scheduleReconnect())
    }, delay)
  }

  const connect = async (): Promise<void> => {
    if (closed) throw new Error('durable-channel-closed')
    if (connecting) return connecting
    connecting = (async () => {
      const authorization = await options.authorize()
      if (closed) throw new Error('durable-channel-closed')
      const candidate = webSocketFactory(
        webSocketUrl(options.endpointPrefix, authorization.routeId)
      )
      socket = candidate
      await new Promise<void>((resolve, reject) => {
        let settled = false
        let inbound = Promise.resolve()
        const enqueue = (wire: EventWire) => {
          inbound = inbound.then(() => deliver(wire)).catch(() => undefined)
        }
        const timeout = window.setTimeout(() => {
          if (settled) return
          settled = true
          reject(new Error('durable-channel-timeout'))
          candidate.close()
        }, options.connectTimeoutMs ?? 10_000)
        const settle = (callback: () => void) => {
          if (settled) return
          settled = true
          window.clearTimeout(timeout)
          callback()
        }
        candidate.addEventListener('error', () => {
          if (!settled) settle(() => reject(new Error('durable-channel-failed')))
        })
        candidate.addEventListener('close', () => {
          if (socket === candidate) {
            socket = null
            clearPeers()
            if (!closed) scheduleReconnect()
          }
          if (!settled) {
            settle(() => reject(new Error('durable-channel-closed')))
          }
        })
        candidate.addEventListener('message', event => {
          let wire: ServerWire
          try {
            wire = JSON.parse(String(event.data)) as ServerWire
          } catch {
            return
          }
          if (wire.type === 'snapshot') {
            ownConnectionId = wire.connectionId
            ownUserId = wire.members.find(
              member => member.connectionId === ownConnectionId
            )?.userId ?? ''
            refreshMembers(wire.members)
            for (const historical of wire.events ?? []) enqueue(historical)
            void inbound.then(() => {
              if (socket !== candidate || closed) return
              reconnectAttempt = 0
              for (const item of outbound.values()) candidate.send(item.frame)
              settle(resolve)
            })
          } else if (wire.type === 'members') {
            refreshMembers(wire.members)
          } else if (wire.type === 'event') {
            enqueue(wire)
          } else if (wire.type === 'ack') {
            const item = outbound.get(wire.messageId)
            if (!item) return
            outbound.delete(wire.messageId)
            window.clearTimeout(item.timeout)
            item.resolve()
          } else if (wire.type === 'error' && wire.messageId) {
            const item = outbound.get(wire.messageId)
            if (!item) return
            outbound.delete(wire.messageId)
            window.clearTimeout(item.timeout)
            item.reject(new Error(wire.code))
          }
        })
      })
    })().finally(() => {
      connecting = null
    })
    return connecting
  }

  try {
    await connect()
    return room
  } catch (error) {
    closed = true
    closeCurrentSocket()
    socket = null
    throw error
  }
}
