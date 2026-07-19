/**
 * Discovery mesh isolation for serverless Trystero apps.
 *
 * Rooms are global by (appId, roomId). Localhost/preview must not join the
 * production mesh. Apps pass production hosts and stable production ids;
 * everything else gets a hostname-derived mesh suffix.
 */

export type MeshIsolationConfig = {
  /** Hostnames that use the production mesh (e.g. peerly.cc). */
  productionHosts: readonly string[]
  /** Stable production mesh id (default `prod`). Do not rename live networks. */
  prodMeshId?: string
  /** Production app id (Trystero appId). */
  prodAppId: string
  /** Production lobby room id. */
  prodLobbyRoomId: string
  /**
   * Template for non-prod app ids. `{mesh}` is replaced with the mesh id.
   * Default: `${prodAppId}-{mesh}` style via `appIdTemplate`.
   */
  appIdForMesh?: (mesh: string, prodMeshId: string, prodAppId: string) => string
  lobbyRoomIdForMesh?: (mesh: string, prodMeshId: string, prodLobbyRoomId: string) => string
}

/** Sanitize a hostname into a stable mesh suffix (room ids are free-form). */
export function sanitizeMeshHost(hostname: string): string {
  const cleaned = hostname.trim().toLowerCase().replace(/[^a-z0-9.-]+/g, '-')
  return cleaned.replace(/^-+|-+$/g, '') || 'local'
}

export function isProductionHost(
  hostname: string,
  productionHosts: ReadonlySet<string> | readonly string[]
): boolean {
  const host = hostname.trim().toLowerCase()
  if (productionHosts instanceof Set) return productionHosts.has(host)
  for (const entry of productionHosts) {
    if (entry.trim().toLowerCase() === host) return true
  }
  return false
}

/**
 * Mesh id for this deployment. Pass `hostname` in tests; browsers default to
 * `location.hostname` or `local`.
 */
export function meshId(
  productionHosts: ReadonlySet<string> | readonly string[],
  hostname?: string,
  prodMeshId = 'prod'
): string {
  const host =
    hostname ??
    (typeof location !== 'undefined' && location.hostname ? location.hostname : 'local')
  if (isProductionHost(host, productionHosts)) return prodMeshId
  return `dev-${sanitizeMeshHost(host)}`
}

export type MeshIsolation = {
  prodMeshId: string
  meshId: (hostname?: string) => string
  appIdForMesh: (mesh: string) => string
  lobbyRoomIdForMesh: (mesh: string) => string
  isProductionHost: (hostname: string) => boolean
  /** Resolve once for the current page (prod or dev-localhost etc.). */
  resolve: (hostname?: string) => {
    meshId: string
    appId: string
    lobbyRoomId: string
  }
}

/** Build mesh helpers with app-owned production ids. */
export function createMeshIsolation(config: MeshIsolationConfig): MeshIsolation {
  const prodMeshId = config.prodMeshId ?? 'prod'
  const hosts =
    config.productionHosts instanceof Set
      ? config.productionHosts
      : new Set(config.productionHosts.map(h => h.trim().toLowerCase()))

  const appIdForMesh =
    config.appIdForMesh ??
    ((mesh, prodId, prodApp) => (mesh === prodId ? prodApp : `${prodApp}-${mesh}`))

  const lobbyRoomIdForMesh =
    config.lobbyRoomIdForMesh ??
    ((mesh, prodId, prodLobby) => (mesh === prodId ? prodLobby : `${prodLobby}-${mesh}`))

  return {
    prodMeshId,
    isProductionHost: hostname => isProductionHost(hostname, hosts),
    meshId: hostname => meshId(hosts, hostname, prodMeshId),
    appIdForMesh: mesh => appIdForMesh(mesh, prodMeshId, config.prodAppId),
    lobbyRoomIdForMesh: mesh =>
      lobbyRoomIdForMesh(mesh, prodMeshId, config.prodLobbyRoomId),
    resolve: hostname => {
      const id = meshId(hosts, hostname, prodMeshId)
      return {
        meshId: id,
        appId: appIdForMesh(id, prodMeshId, config.prodAppId),
        lobbyRoomId: lobbyRoomIdForMesh(id, prodMeshId, config.prodLobbyRoomId),
      }
    },
  }
}
