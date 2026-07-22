import WebSocket, { WebSocketServer } from 'ws'

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const validTopic = value => typeof value === 'string' && value.length > 0 && value.length <= 256
const defaultClientKey = (_socket, request) =>
  request?.peerlyClientKey || request?.peerlySubject || request?.socket?.remoteAddress || 'unknown'

/** A resource-bounded Trystero-compatible WebSocket signaling relay. */
export function createBoundedRelayServer(options = {}) {
  const {
    host = '127.0.0.1',
    port = 8080,
    verifyClient,
    clientKey = defaultClientKey,
    maxPayload = 256 * 1024,
    maxConnections = 5_000,
    maxConnectionsPerClient = 8,
    maxTopicsPerSocket = 64,
    maxTopics = 10_000,
    maxSubscribersPerTopic = 2_000,
    maxMessagesPerMinute = 600,
    maxMessagesPerClientPerMinute = 1_200,
    maxBufferedBytes = 1024 * 1024,
  } = options
  const topics = new Map()
  const socketTopics = new WeakMap()
  const socketClients = new WeakMap()
  const socketRates = new WeakMap()
  const activeByClient = new Map()
  const clientRates = new Map()
  const metrics = {
    connectionsTotal: 0,
    rejectedTotal: 0,
    connectionLimitedTotal: 0,
    rateLimitedTotal: 0,
    messagesTotal: 0,
    publishedTotal: 0,
    droppedTotal: 0,
    bytesInTotal: 0,
    bytesOutTotal: 0,
  }
  let ready = false
  const wss = new WebSocketServer({
    host,
    port,
    maxPayload,
    perMessageDeflate: false,
    verifyClient: verifyClient
      ? (info, done) => verifyClient(info, (accepted, code, reason) => {
          if (!accepted) metrics.rejectedTotal += 1
          done(accepted, code, reason)
        })
      : undefined,
  })

  const readyPromise = new Promise((resolve, reject) => {
    wss.once('listening', () => {
      ready = true
      resolve()
    })
    wss.once('error', reject)
  })

  const unsubscribe = (socket, topic) => {
    socketTopics.get(socket)?.delete(topic)
    const subscribers = topics.get(topic)
    subscribers?.delete(socket)
    if (subscribers?.size === 0) topics.delete(topic)
  }
  const cleanup = socket => {
    for (const topic of socketTopics.get(socket) ?? []) unsubscribe(socket, topic)
    socketTopics.delete(socket)
    socketRates.delete(socket)
    const key = socketClients.get(socket)
    if (key !== undefined) {
      const active = (activeByClient.get(key) ?? 1) - 1
      if (active > 0) activeByClient.set(key, active)
      else activeByClient.delete(key)
      socketClients.delete(socket)
    }
  }
  const allowed = socket => {
    const timestamp = Date.now()
    let socketRate = socketRates.get(socket)
    if (!socketRate || timestamp - socketRate.startedAt >= 60_000) {
      socketRate = { startedAt: timestamp, count: 0 }
      socketRates.set(socket, socketRate)
    }
    socketRate.count += 1

    const key = socketClients.get(socket) ?? 'unknown'
    let clientRate = clientRates.get(key)
    if (!clientRate || timestamp - clientRate.startedAt >= 60_000) {
      clientRate = { startedAt: timestamp, lastSeenAt: timestamp, count: 0 }
      clientRates.set(key, clientRate)
    }
    clientRate.lastSeenAt = timestamp
    clientRate.count += 1

    const accepted = socketRate.count <= maxMessagesPerMinute &&
      clientRate.count <= maxMessagesPerClientPerMinute
    if (!accepted) metrics.rateLimitedTotal += 1
    return accepted
  }
  const send = (socket, value) => {
    if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > maxBufferedBytes) {
      metrics.droppedTotal += 1
      return
    }
    socket.send(value)
    metrics.bytesOutTotal += Buffer.byteLength(value)
  }

  wss.on('connection', (socket, request) => {
    metrics.connectionsTotal += 1
    const key = String(clientKey(socket, request) || 'unknown').slice(0, 512)
    const activeForClient = activeByClient.get(key) ?? 0
    if (wss.clients.size > maxConnections || activeForClient >= maxConnectionsPerClient) {
      metrics.rejectedTotal += 1
      metrics.connectionLimitedTotal += 1
      socket.close(wss.clients.size > maxConnections ? 1013 : 1008, 'connection limit')
      return
    }

    activeByClient.set(key, activeForClient + 1)
    socketClients.set(socket, key)
    socket.peerlyClientKey = key
    socketTopics.set(socket, new Set())
    let cleaned = false
    const cleanOnce = () => {
      if (cleaned) return
      cleaned = true
      cleanup(socket)
    }
    socket.on('message', raw => {
      metrics.messagesTotal += 1
      metrics.bytesInTotal += raw.length ?? 0
      if (!allowed(socket)) {
        metrics.droppedTotal += 1
        return
      }
      try {
        const message = JSON.parse(raw.toString('utf8'))
        // Coordination commands are consumed by the separate bounded
        // extension on the same socket and are not relay pub/sub messages.
        if (!isRecord(message) || !validTopic(message.topic)) return
        if (message.type === 'subscribe') {
          const mine = socketTopics.get(socket)
          if (mine.has(message.topic)) return
          if (mine.size >= maxTopicsPerSocket) return
          let subscribers = topics.get(message.topic)
          if (!subscribers) {
            if (topics.size >= maxTopics) return
            subscribers = new Set()
            topics.set(message.topic, subscribers)
          }
          if (subscribers.size >= maxSubscribersPerTopic) return
          subscribers.add(socket)
          mine.add(message.topic)
          return
        }
        if (message.type === 'unsubscribe') {
          unsubscribe(socket, message.topic)
          return
        }
        if (message.type !== 'publish' || !('payload' in message)) return
        const serialized = JSON.stringify({ topic: message.topic, payload: message.payload })
        if (Buffer.byteLength(serialized) > maxPayload) return
        metrics.publishedTotal += 1
        for (const subscriber of topics.get(message.topic) ?? []) send(subscriber, serialized)
      } catch {
        metrics.droppedTotal += 1
      }
    })
    socket.once('close', cleanOnce)
    socket.once('error', cleanOnce)
  })

  const pruneRates = setInterval(() => {
    const cutoff = Date.now() - 2 * 60_000
    for (const [key, rate] of clientRates) {
      if (!activeByClient.has(key) && rate.lastSeenAt < cutoff) clientRates.delete(key)
    }
  }, 60_000)
  pruneRates.unref()

  return {
    wss,
    ready: readyPromise,
    isReady: () => ready,
    metrics: () => ({
      ...metrics,
      activeConnections: wss.clients.size,
      activeClients: activeByClient.size,
      activeTopics: topics.size,
      activeSubscriptions: [...topics.values()].reduce((total, value) => total + value.size, 0),
    }),
    close: () => new Promise((resolve, reject) => {
      ready = false
      clearInterval(pruneRates)
      for (const socket of wss.clients) socket.close(1001, 'server shutdown')
      wss.close(error => error ? reject(error) : resolve())
    }),
  }
}
