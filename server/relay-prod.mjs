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
// under the peerly-heyhubs-relay systemd unit with RELAY_TOKENS / RELAY_PORT in
// the environment.

// Which hosts are served, and the token each requires, come entirely from the
// environment so no deployment topology is baked into source. RELAY_TOKENS is a
// comma-separated list of `host=token` pairs, e.g.
//   RELAY_TOKENS="relay.example.com=s3cret,relay.other.app=hunter2"
function parseTokens(raw) {
  const map = new Map()
  for (const entry of (raw || '').split(',')) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) throw new Error(`RELAY_TOKENS entry is not host=token: "${trimmed}"`)
    const host = trimmed.slice(0, eq).trim()
    const token = trimmed.slice(eq + 1).trim()
    if (!host || !token) throw new Error(`RELAY_TOKENS entry has empty host or token: "${trimmed}"`)
    map.set(host, token)
  }
  if (map.size === 0) throw new Error('RELAY_TOKENS is empty — set host=token pairs')
  return map
}

const tokensByHost = parseTokens(process.env.RELAY_TOKENS)

const port = Number(process.env.RELAY_PORT) || 8090

const verifyClient = (info, cb) => {
  const host = (info.req.headers.host || '').split(':')[0]
  const expected = tokensByHost.get(host)
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
