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
  | { type: 'error'; code: string }

type PendingMessage = {
  value: unknown
  meta: { peerId: string; userId?: string; deviceKeyId?: string }
}

const MAX_BUFFERED_PER_ACTION = 1_000

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
  const authorization = await options.authorize()
  const socket = (options.webSocketFactory ?? (url => new WebSocket(url)))(
    webSocketUrl(options.endpointPrefix, authorization.routeId)
  )
  const actions = new Map<string, RelayChannelAction<unknown>>()
  const pending = new Map<string, PendingMessage[]>()
  let peers: RelayChannelPeers = {}
  let ownConnectionId = ''
  let ownUserId = ''
  let closed = false

  const room: RelayChannelRoom = {
    makeAction<T>(event: string): RelayChannelAction<T> {
      const existing = actions.get(event)
      if (existing) return existing as RelayChannelAction<T>
      const action: RelayChannelAction<T> = {
        onMessage: null,
        async send(value, sendOptions) {
          if (closed || socket.readyState !== WebSocket.OPEN) {
            throw new Error('durable-channel-not-open')
          }
          const data = contentKey ? await encryptData(value, contentKey) : value
          socket.send(JSON.stringify({
            type: 'event',
            event,
            messageId: crypto.randomUUID(),
            data,
            ...(sendOptions?.target ? { target: sendOptions.target } : {}),
          }))
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
      socket.close(1000, 'left')
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

  const ready = new Promise<void>((resolve, reject) => {
    let inbound = Promise.resolve()
    const enqueue = (wire: EventWire) => {
      inbound = inbound.then(() => deliver(wire)).catch(() => undefined)
    }
    const timeout = window.setTimeout(
      () => reject(new Error('durable-channel-timeout')),
      options.connectTimeoutMs ?? 10_000
    )
    const settle = (callback: () => void) => {
      window.clearTimeout(timeout)
      callback()
    }
    socket.addEventListener('error', () => settle(() => reject(new Error('durable-channel-failed'))), {
      once: true,
    })
    socket.addEventListener('close', () => {
      if (!ownConnectionId) settle(() => reject(new Error('durable-channel-closed')))
    }, { once: true })
    socket.addEventListener('message', event => {
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
        void inbound.then(() => settle(resolve))
      } else if (wire.type === 'members') {
        refreshMembers(wire.members)
      } else if (wire.type === 'event') {
        enqueue(wire)
      }
    })
  })

  try {
    await ready
    return room
  } catch (error) {
    closed = true
    socket.close()
    throw error
  }
}
