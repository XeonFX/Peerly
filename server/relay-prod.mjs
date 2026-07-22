import { createServer } from 'node:http'
import { createBoundedRelayServer } from '../packages/core/server/boundedRelay.mjs'
import { attachCoordinationServer } from './coordination.mjs'
import { parseRelayTicketSecrets, verifyRelayTicket } from './relayTicket.mjs'

// Production signaling relay for Peerly and authorized consumer apps.
//
// Runs behind TLS-terminating nginx and listens only on loopback. Every
// WebSocket upgrade must present a short-lived, audience-bound `?ticket=`
// minted by the app worker after OIDC + live-device verification. Static
// browser query tokens are deliberately unsupported.
//
// Deploy with RELAY_TICKET_SECRETS="relay.example.com=secret" and RELAY_PORT.

const ticketSecretsByHost = parseRelayTicketSecrets(process.env.RELAY_TICKET_SECRETS)

const port = Number(process.env.RELAY_PORT) || 8090

const verifyClient = (info, cb) => {
  const host = (info.req.headers.host || '').split(':')[0].toLowerCase()
  if (!ticketSecretsByHost.has(host)) return cb(false, 404, 'unknown host')

  const url = new URL(info.req.url, `http://${host}`)
  const ticket = url.searchParams.get('ticket') ?? ''
  const payload = verifyRelayTicket(ticket, host, ticketSecretsByHost)
  if (!payload) return cb(false, 401, 'unauthorized')

  // Used by the bounded relay and coordinator for quotas that survive
  // reconnects. The subject is an opaque digest minted by the Worker.
  info.req.peerlySubject = payload.sub
  info.req.peerlyClientKey = `${host}:${payload.sub}`
  cb(true)
}

const relay = createBoundedRelayServer({
  host: '127.0.0.1',
  port,
  verifyClient,
  clientKey: (_socket, request) => request.peerlyClientKey,
  maxConnections: Number(process.env.RELAY_MAX_CONNECTIONS) || 5_000,
  maxConnectionsPerClient: Number(process.env.RELAY_MAX_CONNECTIONS_PER_CLIENT) || 8,
  maxMessagesPerClientPerMinute: Number(process.env.RELAY_MAX_MESSAGES_PER_CLIENT_MINUTE) || 1_200,
  maxPayload: 256 * 1024,
})
await relay.ready
const coordination = attachCoordinationServer(relay.wss)

const healthPort = Number(process.env.RELAY_HEALTH_PORT) || 8091
const health = createServer((request, response) => {
  if (request.url === '/healthz' || request.url === '/readyz') {
    const ok = relay.isReady()
    response.writeHead(ok ? 200 : 503, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    })
    response.end(JSON.stringify({ ok }))
    return
  }
  if (request.url === '/metrics') {
    const metrics = {
      relay: relay.metrics(),
      coordinator: coordination.metrics(),
    }
    response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4', 'cache-control': 'no-store' })
    response.end(Object.entries(metrics)
      .flatMap(([component, values]) => Object.entries(values)
        .map(([key, value]) => `peerly_${component}_${key} ${value}`))
      .join('\n') + '\n')
    return
  }
  response.writeHead(404).end()
})
health.listen(healthPort, '127.0.0.1')

// ws never detects a half-open TCP connection on its own: a peer whose tab
// crashed, slept, or dropped off wifi leaves a socket that stays "open" server
// side forever. The relay keeps forwarding that dead peer's last-advertised
// presence, so live peers keep trying to reach a corpse and log "could not
// connect to peer X" indefinitely (and the online-user count stays inflated).
// A ping/pong sweep evicts them — terminate() fires 'close', which the
// library's own handler uses to drop the socket's topic subscriptions.
const HEARTBEAT_MS = 30_000
const wss = relay.wss

wss.on('connection', socket => {
  socket.isAlive = true
  socket.on('pong', () => {
    socket.isAlive = true
  })
})

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) {
      socket.terminate()
      continue
    }
    socket.isAlive = false
    socket.ping()
  }
}, HEARTBEAT_MS)
heartbeat.unref()

console.log(`relay listening on 127.0.0.1:${port}`)

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    clearInterval(heartbeat)
    coordination.close()
    await new Promise(resolve => health.close(resolve))
    await relay.close()
    process.exit(0)
  })
}
