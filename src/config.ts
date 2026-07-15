export const APP_NAME = 'Peerly'

/**
 * Build identity, injected by vite.config.ts. Version alone does not move on
 * every push, so the commit is what actually answers "is the deployed app
 * running my latest code?".
 */
export const APP_VERSION = __APP_VERSION__
export const APP_COMMIT = __APP_COMMIT__

/** e.g. "v0.1.0 · a1b2c3d" — falls back gracefully when the commit is unknown. */
export function appBuildLabel(): string {
  return APP_COMMIT && APP_COMMIT !== 'unknown'
    ? `v${APP_VERSION} · ${APP_COMMIT}`
    : `v${APP_VERSION}`
}

export const APP_ID = 'peerly-collab-v1'

export const DEFAULT_USER_COLOR = '#36c5f0'

export { GENERAL_CHANNEL } from './collab/channelStore'

export const PEER_COLORS = [
  '#e01e5a',
  '#36c5f0',
  '#2eb67d',
  '#ecb22e',
  '#9b59b6',
  '#e67e22',
  '#1abc9c',
  '#3498db',
]

export function getPeerColor(peerId: string): string {
  let hash = 0
  for (let i = 0; i < peerId.length; i++) {
    hash = peerId.charCodeAt(i) + ((hash << 5) - hash)
  }
  return PEER_COLORS[Math.abs(hash) % PEER_COLORS.length]
}

export function normalizeWorkspaceId(workspace: string): string {
  return workspace.trim().toLowerCase().replace(/\s+/g, '-')
}

/** One P2P room per workspace; messages are scoped by channelId. */
export function buildRoomId(workspaceId: string): string {
  return workspaceId.trim()
}

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
export async function resolveRelayPort(): Promise<string> {
  const envPort = import.meta.env.VITE_RELAY_PORT
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

export async function resolveRelayUrls(): Promise<string[]> {
  const port = await resolveRelayPort()
  return buildRelayUrls(port)
}

import type { SignalingStrategy } from './collab/signaling'

/**
 * Curated public Nostr relays used for signaling.
 *
 * Trystero ships ~47 default relays and normally connects to just 5 of them
 * (chosen deterministically from the app id). Passing its full list through
 * `relayConfig.urls` — as this app used to — defeats that and opens a socket to
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
  'wss://nostr.oxtr.dev',
]
// Two relays are deliberately absent, for different reasons:
//
// - relay.damus.io accepts a one-off ephemeral event but rate-limits this
//   traffic pattern in normal use ("rate-limited: you are noting too much"), so
//   it logs failures without carrying signaling.
// - relay.mostr.pub stopped accepting connections entirely (it was in this list
//   and produced a stream of "WebSocket connection failed" in the console).
//
// Losing one relay is harmless — peers only need one working relay in common —
// but a dead entry is pure console noise, so keep this list to relays actually
// verified against the ephemeral events Trystero signals with. `npm run
// check:relays` re-checks the list; a one-shot probe is not enough evidence,
// since that is exactly how mostr.pub got in here.

/** Nostr relay URLs (wss://…). Override via VITE_NOSTR_RELAYS comma-separated env. */
export function getNostrRelayConfig(): { urls: string[] } {
  const raw = import.meta.env.VITE_NOSTR_RELAYS
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
export function getTurnConfig(): TurnServer[] | undefined {
  const raw = import.meta.env.VITE_TURN_URLS
  if (!raw) return undefined

  const urls = raw
    .split(',')
    .map(url => url.trim())
    .filter(Boolean)
  if (urls.length === 0) return undefined

  return [
    {
      urls,
      username: import.meta.env.VITE_TURN_USERNAME || undefined,
      credential: import.meta.env.VITE_TURN_CREDENTIAL || undefined,
    },
  ]
}

export function getSupabaseRoomConfig():
  | { appId: string; relayConfig: { supabaseKey: string } }
  | null {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return { appId: url, relayConfig: { supabaseKey: key } }
}

export function getRoomAppId(strategy: SignalingStrategy): string {
  if (strategy === 'supabase') {
    return getSupabaseRoomConfig()?.appId ?? APP_ID
  }
  return APP_ID
}