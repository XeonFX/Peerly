import {
  getNostrRelayConfig as coreNostrConfig,
  getSupabaseRoomConfig as coreSupabaseConfig,
  getTurnConfig as coreTurnConfig,
  resolveRelayPort as corePort,
  resolveRelayUrls as coreUrls,
  type TurnServer as CoreTurnServer,
} from '@peerly/core'

export const APP_NAME = 'Peerly'

/**
 * Build identity, injected by vite.config.ts. Version alone does not move on
 * every push, so the commit is what actually answers "is the deployed app
 * running my latest code?".
 */
export const APP_VERSION = __APP_VERSION__
export const APP_COMMIT = __APP_COMMIT__

/** e.g. "v0.2.0 · a1b2c3d" — falls back gracefully when the commit is unknown. */
export function appBuildLabel(): string {
  return APP_COMMIT && APP_COMMIT !== 'unknown'
    ? `v${APP_VERSION} · ${APP_COMMIT}`
    : `v${APP_VERSION}`
}

export const APP_ID = 'peerly-collab-v1'

export const DEFAULT_USER_COLOR = '#36c5f0'

export { GENERAL_CHANNEL } from './collab/channelStore'

/** Fallback tile colour for workspace avatars (brand emerald). */
export const WORKSPACE_COLOR = '#2eb67d'

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

/** Used when VITE_SIGNALING=ws-relay (E2E / local relay). */
export async function resolveRelayPort(): Promise<string> {
  return corePort(import.meta.env)
}

export async function resolveRelayUrls(): Promise<string[]> {
  return coreUrls(import.meta.env)
}

import type { SignalingStrategy } from './collab/signaling'

// The relay list, TURN, and Supabase config logic moved to @peerly/core
// (packages/core/src/relays.ts) so other apps can share them; these wrappers bind
// them to this app's build-time env. `npm run check:relays` now reads the
// list out of the package source.
export { buildRelayUrls, DEFAULT_NOSTR_RELAYS, type TurnServer } from '@peerly/core'

/** Nostr relay URLs (wss://…). Override via VITE_NOSTR_RELAYS comma-separated env. */
export function getNostrRelayConfig(): { urls: string[] } {
  return coreNostrConfig(import.meta.env)
}

export function getTurnConfig(): CoreTurnServer[] | undefined {
  return coreTurnConfig(import.meta.env)
}

export function getSupabaseRoomConfig():
  | { appId: string; relayConfig: { supabaseKey: string } }
  | null {
  return coreSupabaseConfig(import.meta.env)
}

export function getRoomAppId(strategy: SignalingStrategy): string {
  if (strategy === 'supabase') {
    return getSupabaseRoomConfig()?.appId ?? APP_ID
  }
  return APP_ID
}
