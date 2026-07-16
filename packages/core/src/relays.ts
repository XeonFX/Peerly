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

export function buildRelayUrls(port: string): string[] {
  const host = relayHost()
  const scheme = relayScheme()
  const urls = [`${scheme}://${host}:${port}`]
  if (scheme === 'ws') urls.push(`ws://127.0.0.1:${port}`)
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
  return buildRelayUrls(port)
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
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://purplerelay.com',
  'wss://nostr.mom',
  'wss://offchain.pub',
]
// Relays deliberately absent, for different reasons:
//
// - relay.damus.io and nostr.oxtr.dev accept one-off ephemeral events (they
//   pass check:relays) but rate-limit this traffic pattern in normal use —
//   oxtr throttled a single quiet client. A relay like that logs failures
//   without carrying signaling, and every connected relay receives every
//   publish, so keep the pool at five vetted hosts rather than growing it:
//   more relays means more fan-out, which is what trips the limits.
// - Of ten public candidates probed 3x on 2026-07-16, only offchain.pub
//   (healthy, ~1.7s) and relay.snort.social (slow, throttle-prone) were
//   usable; the rest were dead or gated (NIP-05 required). Public relay
//   capacity is donated and thinning.
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
 * TURN relays traffic when a direct peer connection can't be established —
 * symmetric NAT, CGNAT, strict corporate firewalls. Signaling succeeds in those
 * cases and the connection then fails after the SDP exchange, which looks like
 * "it just doesn't work" to the user.
 *
 * Trystero always includes its default STUN servers and concatenates `turnConfig`
 * onto them, so setting this doesn't lose STUN. There is no default here on
 * purpose: TURN relays real bandwidth, so it has to be infrastructure you chose.
 * Traffic through TURN stays end-to-end encrypted.
 */
export function getTurnConfig(env: Env): TurnServer[] | undefined {
  const raw = env.VITE_TURN_URLS
  if (!raw) return undefined

  const urls = raw
    .split(',')
    .map(url => url.trim())
    .filter(Boolean)
  if (urls.length === 0) return undefined

  return [
    {
      urls,
      username: env.VITE_TURN_USERNAME || undefined,
      credential: env.VITE_TURN_CREDENTIAL || undefined,
    },
  ]
}

export function getSupabaseRoomConfig(env: Env):
  | { appId: string; relayConfig: { supabaseKey: string } }
  | null {
  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return { appId: url, relayConfig: { supabaseKey: key } }
}
