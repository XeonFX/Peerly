/**
 * Discovery mesh identity for Peerly's public lobby.
 *
 * Trystero rooms are global by (appId, roomId). If every environment used the
 * same pair, a localhost tab would join the production lobby and exchange
 * friend invites / presence with peerly.cc. Isolation lives in the room
 * namespace itself.
 *
 * Production keeps stable ids so peers keep finding each other. Every other
 * host (localhost, preview deploys) gets its own mesh derived from hostname.
 */

const PRODUCTION_HOSTS = new Set(['peerly.cc', 'www.peerly.cc'])

/** Canonical production mesh — do not rename (breaks the live network). */
export const PROD_MESH_ID = 'prod'
const PROD_LOBBY_APP_ID = 'peerly-lobby-v1'
const PROD_LOBBY_ROOM_ID = 'peerly-lobby-v1'

/** Sanitize a hostname into a stable mesh suffix. */
export function sanitizeMeshHost(hostname: string): string {
  const cleaned = hostname.trim().toLowerCase().replace(/[^a-z0-9.-]+/g, '-')
  return cleaned.replace(/^-+|-+$/g, '') || 'local'
}

export function isProductionHost(hostname: string): boolean {
  return PRODUCTION_HOSTS.has(hostname.trim().toLowerCase())
}

/**
 * Mesh id for this deployment. Pass `hostname` in tests; browsers use
 * `location.hostname`.
 */
export function meshId(hostname?: string): string {
  const host =
    hostname ??
    (typeof location !== 'undefined' && location.hostname ? location.hostname : 'local')
  if (isProductionHost(host)) return PROD_MESH_ID
  return `dev-${sanitizeMeshHost(host)}`
}

export function lobbyAppIdForMesh(mesh: string): string {
  return mesh === PROD_MESH_ID ? PROD_LOBBY_APP_ID : `peerly-lobby-v1-${mesh}`
}

export function lobbyRoomIdForMesh(mesh: string): string {
  return mesh === PROD_MESH_ID ? PROD_LOBBY_ROOM_ID : `peerly-lobby-v1-${mesh}`
}

/** Resolved once per page load — the mesh this tab participates in. */
export const MESH_ID = meshId()
export const LOBBY_APP_ID = lobbyAppIdForMesh(MESH_ID)
export const LOBBY_ROOM_ID = lobbyRoomIdForMesh(MESH_ID)
