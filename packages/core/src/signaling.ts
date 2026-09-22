import type { Env } from './env.js'

export type SignalingStrategy = 'durable-objects' | 'nostr' | 'ws-relay' | 'supabase'

/**
 * Resolution order: explicit VITE_SIGNALING, then Supabase if it's configured,
 * then public Nostr relays.
 *
 * Nostr is the fallback rather than ws-relay because ws-relay only works if
 * someone is running the local relay process. Dev servers and E2E set
 * VITE_SIGNALING=ws-relay explicitly, so the fallback is really "a build with
 * no configuration" — which previously produced an app that pointed at
 * ws://<host>:8080 and could never connect. Nostr needs no server and no
 * signup, so an unconfigured build just works.
 */
export function resolveSignalingStrategy(env: Env): SignalingStrategy {
  const mode = env.VITE_SIGNALING
  if (mode === 'durable-objects') return 'durable-objects'
  if (mode === 'nostr') return 'nostr'
  if (mode === 'supabase') return 'supabase'
  if (mode === 'ws-relay') return 'ws-relay'
  if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) {
    return 'supabase'
  }
  return 'nostr'
}

export function signalingLabel(strategy: SignalingStrategy): string {
  if (strategy === 'durable-objects') return 'Cloudflare'
  if (strategy === 'ws-relay') return 'Relay'
  if (strategy === 'supabase') return 'Supabase'
  return 'Nostr'
}
