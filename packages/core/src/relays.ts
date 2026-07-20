import type { Env } from './env.js'

function relayHost(): string {
  return typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1'
}

/**
 * Plain ws:// from an https:// page is blocked as mixed content, so match the
 * page's scheme. localhost stays ws:// — it has no certificate and browsers
 * treat it as a secure context anyway.
 */
function relayScheme(): 'ws' | 'wss' {
  return typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws'
}

/**
 * `VITE_RELAY_HOST` points at a relay that isn't the app's own origin (e.g. a
 * shared production relay) — it always requires wss and skips the same-machine
 * `127.0.0.1` fallback, since that fallback only makes sense when the relay
 * runs alongside the dev server. `VITE_RELAY_TOKEN`, if set, is appended as a
 * query param for relays that gate connections on it.
 */
export function buildRelayUrls(port: string, env: Env = {}): string[] {
  const host = env.VITE_RELAY_HOST || relayHost()
  const scheme = env.VITE_RELAY_HOST ? 'wss' : relayScheme()
  const query = env.VITE_RELAY_TOKEN ? `?token=${encodeURIComponent(env.VITE_RELAY_TOKEN)}` : ''
  const urls = [`${scheme}://${host}:${port}${query}`]
  if (!env.VITE_RELAY_HOST && scheme === 'ws') urls.push(`ws://127.0.0.1:${port}${query}`)
  return urls
}

/** Used when VITE_SIGNALING=ws-relay (E2E / local relay). */
export async function resolveRelayPort(env: Env): Promise<string> {
  const envPort = env.VITE_RELAY_PORT
  if (envPort) return String(envPort)

  try {
    const res = await fetch('/relay-port')
    if (res.ok) {
      const data = (await res.json()) as { port?: string | number }
      if (data.port) return String(data.port)
    }
  } catch {
    // dev server endpoint unavailable
  }

  return '8080'
}

export async function resolveRelayUrls(env: Env): Promise<string[]> {
  const port = await resolveRelayPort(env)
  return buildRelayUrls(port, env)
}

/**
 * Curated public Nostr relays used for signaling.
 *
 * Trystero ships ~47 default relays and normally connects to just 5 of them
 * (chosen deterministically from the app id). Passing its full list through
 * `relayConfig.urls` — as Peerly used to — defeats that and opens a socket to
 * every relay: measured at 26+ live sockets per peer, for no benefit. Peers only
 * need one working relay in common to exchange offers.
 *
 * Each of these was verified to accept and forward the ephemeral events
 * (kind 2xxxx) Trystero signals with; several popular relays silently don't.
 * Public relays come and go — override with VITE_NOSTR_RELAYS if these rot.
 */
export const DEFAULT_NOSTR_RELAYS = [
  'wss://relay.primal.net',
  'wss://purplerelay.com',
  'wss://relay.snort.social',
  'wss://nostr.sathoarder.com',
  'wss://soloco.nl',
]
// Relays deliberately absent, for different reasons:
//
// - nos.lol and relay.wellorder.net rotted in place (2026-07-17, second
//   sweep): wellorder now answers every publish "blocked: spam not
//   permitted"; nos.lol still passes one-shot probes but demands 28-bit
//   proof-of-work once a chatty lobby publishes at a steady rate — the
//   conditional-throttle class that a single probe cannot catch (see damus
//   below). Replacements nostr.sathoarder.com and soloco.nl probed 3x at
//   ~1.1s each.
// - nostr.mom and offchain.pub were in this list and rotted in place
//   (2026-07-17): both keep the socket open, so they look connected, then
//   reject every publish — mom now demands 28-bit proof-of-work, offchain
//   gates on a web-of-trust. That failure mode is invisible to a socket
//   count; only the echo probe (check:relays / probeNostrRelays) catches it.
// - relay.damus.io and nostr.oxtr.dev accept one-off ephemeral events (they
//   pass check:relays) but rate-limit this traffic pattern in normal use —
//   oxtr throttled a single quiet client. A relay like that logs failures
//   without carrying signaling, and every connected relay receives every
//   publish, so keep the pool at five vetted hosts rather than growing it:
//   more relays means more fan-out, which is what trips the limits.
// - relay.snort.social was skipped in 2026-07-16 probing as slow and
//   throttle-prone; re-probed 3x on 2026-07-17 at a consistent ~1.1s and
//   promoted. relay.wellorder.net likewise passed 3x (~1.9s). Candidates
//   gated by NIP-05 (einundzwanzig, nostrplebs) or erroring (bitcoiner,
//   nostr.band) stay out.
// - relay.mostr.pub stopped accepting connections entirely (it was in this list
//   and produced a stream of "WebSocket connection failed" in the console).
//
// Losing one relay is harmless — peers only need one working relay in common —
// but a dead entry is pure console noise, so keep this list to relays actually
// verified against the ephemeral events Trystero signals with. Peerly's
// `npm run check:relays` re-checks the list; a one-shot probe is not enough
// evidence, since that is exactly how mostr.pub got in here.

/** Nostr relay URLs (wss://…). Override via VITE_NOSTR_RELAYS comma-separated env. */
export function getNostrRelayConfig(env: Env): { urls: string[] } {
  const raw = env.VITE_NOSTR_RELAYS
  if (raw) {
    const urls = raw
      .split(',')
      .map(url => url.trim())
      .filter(Boolean)
    if (urls.length > 0) return { urls }
  }
  return { urls: DEFAULT_NOSTR_RELAYS }
}

export type TurnServer = {
  urls: string[]
  username?: string
  credential?: string
}

/**
 * A single TURN endpoint is easy to configure but brittle in the real world:
 * UDP is fastest, TCP survives UDP-blocking networks, and TLS/443 is the path
 * most likely to pass a restrictive proxy/firewall. Expand conventional TURN
 * ports into a compact transport ladder. Conventional aliases collapse to
 * three canonical URLs so browsers do not probe duplicate endpoints or trip
 * Firefox's five-server warning once the fallback STUN URL is included.
 */
export function expandTurnUrls(urls: readonly string[]): string[] {
  const expanded = new Set<string>()
  for (const raw of urls) {
    const value = raw.trim()
    if (!value) continue
    const match = /^(turns?):([^/?#:]+|\[[^\]]+\])(?::(\d+))?(?:\?transport=(udp|tcp))?$/i.exec(value)
    if (!match) {
      expanded.add(value)
      continue
    }
    const [, scheme, host] = match
    // Only infer the standard transport ladder from conventional endpoints.
    // Custom ports remain exactly as configured.
    const port = match[3] ?? (scheme.toLowerCase() === 'turns' ? '5349' : '3478')
    if (port !== '3478' && port !== '5349' && port !== '443') {
      expanded.add(value)
      continue
    }
    expanded.add(`turn:${host}:3478?transport=udp`)
    expanded.add(`turn:${host}:3478?transport=tcp`)
    expanded.add(`turns:${host}:443?transport=tcp`)
  }
  return [...expanded]
}

/**
 * TURN relays traffic when a direct peer connection can't be established —
 * symmetric NAT, CGNAT, strict corporate firewalls. Signaling succeeds in those
 * cases and the connection then fails after the SDP exchange, which looks like
 * "it just doesn't work" to the user.
 *
 * There is no default here on purpose: TURN relays real bandwidth, so it has to
 * be infrastructure you chose. Traffic through TURN stays end-to-end encrypted.
 */
export function getTurnConfig(env: Env): TurnServer[] | undefined {
  const raw = env.VITE_TURN_URLS
  if (!raw) return undefined

  const urls = expandTurnUrls(raw
    .split(',')
    .map(url => url.trim())
    .filter(Boolean))
  if (urls.length === 0) return undefined

  return [
    {
      urls,
      username: env.VITE_TURN_USERNAME || undefined,
      credential: env.VITE_TURN_CREDENTIAL || undefined,
    },
  ]
}

/**
 * One reliable public STUN server kept alongside our own TURN. A TURN server
 * answers STUN too, so this is really just a fallback for discovering the
 * reflexive address if our server is unreachable — one is plenty.
 */
const FALLBACK_STUN_URL = 'stun:stun.l.google.com:19302'

/**
 * The full ICE server list to hand Trystero via `rtcConfig.iceServers`.
 *
 * Trystero otherwise ships four default STUN servers and appends `turnConfig`,
 * which lands us at five servers — Firefox warns at five-plus and each extra
 * server adds a gathering round-trip that slows connection setup. When we have
 * our own TURN (which also serves STUN), we don't need four public STUN servers
 * on top, so we replace the whole list with a lean STUN + TURN pair.
 *
 * Returns `undefined` when no TURN is configured, so Trystero keeps its own
 * defaults rather than being left with a single public STUN.
 */
export function getIceServers(env: Env): TurnServer[] | undefined {
  const turn = getTurnConfig(env)
  if (!turn) return undefined
  return [{ urls: [FALLBACK_STUN_URL] }, ...turn]
}

export function getSupabaseRoomConfig(env: Env):
  | { appId: string; relayConfig: { supabaseKey: string } }
  | null {
  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return { appId: url, relayConfig: { supabaseKey: key } }
}
