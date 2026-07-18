import { createWsRelayServer } from '@trystero-p2p/ws-relay/server'

// Production signaling relay shared by Peerly and HeyHubs.
//
// This is the deployed counterpart to the dev-only relay.mjs. It runs on the
// shared VPS (codefusion-vps) as a systemd service behind nginx (which
// terminates TLS on relay.peerly.cc / relay.heyhubs.app), listening only on
// localhost. Unlike a public Nostr relay, access is restricted to the two apps:
// every WebSocket upgrade must present the per-app token in a `?token=` query
// param, matched against the Host header. Apps point at it with
// VITE_SIGNALING=ws-relay + VITE_RELAY_HOST/VITE_RELAY_TOKEN (see @peerly/core
// relays.ts, added in 1.2.1).
//
// Deploy: copy to /opt/relay/relay-server.mjs on the VPS, `npm install`, run
// under the peerly-heyhubs-relay systemd unit with PEERLY_RELAY_TOKEN /
// HEYHUBS_RELAY_TOKEN / RELAY_PORT in the environment.

// Maps Host header -> required auth token. Populated from env so each app's
// token can be rotated independently without touching this file.
const tokensByHost = {
  'relay.peerly.cc': process.env.PEERLY_RELAY_TOKEN,
  'relay.heyhubs.app': process.env.HEYHUBS_RELAY_TOKEN,
}

for (const [host, token] of Object.entries(tokensByHost)) {
  if (!token) throw new Error(`missing token env for ${host}`)
}

const port = Number(process.env.RELAY_PORT) || 8090

const verifyClient = (info, cb) => {
  const host = (info.req.headers.host || '').split(':')[0]
  const expected = tokensByHost[host]
  if (!expected) return cb(false, 404, 'unknown host')

  const url = new URL(info.req.url, `http://${host}`)
  const token = url.searchParams.get('token')
  if (token !== expected) return cb(false, 401, 'unauthorized')

  cb(true)
}

const relay = await createWsRelayServer({ port, verifyClient })
await relay.ready

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
    await relay.close()
    process.exit(0)
  })
}
