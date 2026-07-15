export type SignalingStrategy = 'nostr' | 'ws-relay' | 'supabase'

/**
 * Resolution order: explicit VITE_SIGNALING, then Supabase if it's configured,
 * then public Nostr relays.
 *
 * Nostr is the fallback rather than ws-relay because ws-relay only works if
 * someone is running the local relay process. `npm run dev` and the E2E server
 * both set VITE_SIGNALING=ws-relay explicitly, so the fallback is really "a
 * build with no configuration" — which previously produced an app that pointed
 * at ws://<host>:8080 and could never connect. Nostr needs no server and no
 * signup, so an unconfigured build now just works.
 */
export function getSignalingStrategy(): SignalingStrategy {
  const mode = import.meta.env.VITE_SIGNALING
  if (mode === 'nostr') return 'nostr'
  if (mode === 'supabase') return 'supabase'
  if (mode === 'ws-relay') return 'ws-relay'
  if (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY) {
    return 'supabase'
  }
  return 'nostr'
}

export function getSignalingLabel(): string {
  const strategy = getSignalingStrategy()
  if (strategy === 'ws-relay') return 'Relay'
  if (strategy === 'supabase') return 'Supabase'
  return 'Nostr'
}