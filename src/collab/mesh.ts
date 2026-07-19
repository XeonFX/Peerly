/**
 * Peerly discovery mesh — production hosts and lobby ids are app-owned;
 * isolation math lives in @peerly/core.
 */

import { createMeshIsolation, sanitizeMeshHost } from '@peerly/core'

const isolation = createMeshIsolation({
  productionHosts: ['peerly.cc', 'www.peerly.cc'],
  prodAppId: 'peerly-lobby-v1',
  prodLobbyRoomId: 'peerly-lobby-v1',
})

export const PROD_MESH_ID = isolation.prodMeshId
export { sanitizeMeshHost }

export function isProductionHost(hostname: string): boolean {
  return isolation.isProductionHost(hostname)
}

export function meshId(hostname?: string): string {
  return isolation.meshId(hostname)
}

export function lobbyAppIdForMesh(mesh: string): string {
  return isolation.appIdForMesh(mesh)
}

export function lobbyRoomIdForMesh(mesh: string): string {
  return isolation.lobbyRoomIdForMesh(mesh)
}

/** Resolved once per page load — the mesh this tab participates in. */
export const MESH_ID = meshId()
export const LOBBY_APP_ID = lobbyAppIdForMesh(MESH_ID)
export const LOBBY_ROOM_ID = lobbyRoomIdForMesh(MESH_ID)
