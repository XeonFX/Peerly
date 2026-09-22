const WORKSPACE_ROUTE_ID_BYTES = 16
const WORKSPACE_ROUTE_ID_DOMAIN = 'peerly-workspace-route-v1'

export const WORKSPACE_ROUTE_ID_PATTERN = /^[a-f0-9]{32}$/

export function isWorkspaceRouteId(value: unknown): value is string {
  return typeof value === 'string' && WORKSPACE_ROUTE_ID_PATTERN.test(value)
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Public navigation identity for a new workspace.
 *
 * This is deliberately separate from `workspaceId`: that value is also the
 * room password and must stay out of request paths, logs, history and
 * referrers. Route IDs identify a workspace but grant no access to it.
 */
export function generateWorkspaceRouteId(): string {
  const bytes = new Uint8Array(WORKSPACE_ROUTE_ID_BYTES)
  crypto.getRandomValues(bytes)
  return hex(bytes)
}

/**
 * Stable migration for workspaces created before public route IDs existed.
 *
 * SHA-256 keeps the 128-bit room secret computationally hidden while ensuring
 * every member derives the same public ID from an old invite. New workspaces
 * use an independent random ID and do not need this fallback.
 */
export async function deriveWorkspaceRouteId(workspaceId: string): Promise<string> {
  const input = new TextEncoder().encode(`${WORKSPACE_ROUTE_ID_DOMAIN}\n${workspaceId}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input))
  return hex(digest.slice(0, WORKSPACE_ROUTE_ID_BYTES))
}

export async function ensureWorkspaceRouteId(access: {
  workspaceId: string
  workspaceRouteId?: string
}): Promise<string> {
  return isWorkspaceRouteId(access.workspaceRouteId)
    ? access.workspaceRouteId
    : deriveWorkspaceRouteId(access.workspaceId)
}
