import {
  createTopicStrategy,
  type BaseRoomConfig,
  type StrategyMessage,
} from '@trystero-p2p/core'
import { encodeCommand, decodeFrame } from './protocol.js'
import { getDurableObjectsTransport } from './runtime.js'
import type { ScopeKind } from './types.js'

type DurableObjectsRoomConfig = BaseRoomConfig & {
  appId: string
  durableObjects: {
    app: string
    kind: ScopeKind
    capability: string
    routeId?: string
  }
}

type TopicHandler = (topic: string, message: StrategyMessage) => void | Promise<void>

class ScopeSocket {
  readonly handlers = new Map<string, Set<TopicHandler>>()
  readonly ready: Promise<ScopeSocket>
  private socket: WebSocket | null = null
  private readonly config: DurableObjectsRoomConfig['durableObjects']

  constructor(config: DurableObjectsRoomConfig['durableObjects']) {
    this.config = config
    this.ready = this.open()
  }

  private async open(): Promise<ScopeSocket> {
    const transport = getDurableObjectsTransport(this.config.app)
    await transport.connect()
    const routeId = this.config.routeId ?? (
      await transport.requestScope(this.config.kind, this.config.capability)
    ).routeId
    if (!routeId) throw new Error('Durable Objects scope authorization failed')

    const url = new URL(`/api/realtime/signal/${encodeURIComponent(routeId)}`, location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url)
    this.socket = socket
    socket.addEventListener('message', event => {
      const frame = decodeFrame(String(event.data))
      if (frame?.type !== 'signal' || !frame.payload || typeof frame.payload !== 'object') return
      const payload = frame.payload as { topic?: unknown; message?: unknown }
      if (typeof payload.topic !== 'string') return
      if (typeof payload.message !== 'string' &&
          (!payload.message || typeof payload.message !== 'object' || Array.isArray(payload.message))) return
      for (const handler of this.handlers.get(payload.topic) ?? []) {
        void handler(payload.topic, payload.message as StrategyMessage)
      }
    })
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true })
      socket.addEventListener('error', () => reject(new Error('Durable Objects signal socket failed')), { once: true })
      socket.addEventListener('close', () => reject(new Error('Durable Objects signal socket closed')), { once: true })
    })
    return this
  }

  send(topic: string, message: StrategyMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    this.socket.send(encodeCommand('signal', { topic, message }).text)
  }

  close(): void {
    this.handlers.clear()
    this.socket?.close(1000, 'room left')
    this.socket = null
  }
}

export const joinDurableObjectsRoom = createTopicStrategy<ScopeSocket, DurableObjectsRoomConfig>({
  init: config => new ScopeSocket(config.durableObjects).ready,
  subscribeTopic: (scope, topic, onMessage) => {
    const handlers = scope.handlers.get(topic) ?? new Set<TopicHandler>()
    handlers.add(onMessage)
    scope.handlers.set(topic, handlers)
    return () => {
      handlers.delete(onMessage)
      if (handlers.size === 0) scope.handlers.delete(topic)
    }
  },
  publishTopic: (scope, topic, message) => scope.send(topic, message),
  unpublishTopic: scope => scope.close(),
})

export type { DurableObjectsRoomConfig }
