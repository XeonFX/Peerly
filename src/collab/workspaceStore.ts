import { isEmailAllowed, newerAllowList } from './allowList'
import type { WorkspaceAccess } from './inviteLink'
import {
  ensureWorkspaceRouteId,
  isWorkspaceRouteId,
} from './workspaceRouteId'

/**
 * A workspace this browser has joined, kept so the user can switch between them
 * instead of needing the invite link every time.
 *
 * `workspaceId` is the workspace secret (it doubles as the Trystero room
 * password), so this list is exactly as sensitive as the invite links that
 * produced it. It lives in localStorage, same as the active session already did
 * — a workspace you have joined is a workspace this browser can rejoin.
 */
export type StoredWorkspace = WorkspaceAccess & {
  /** Used to select the recent workspace; it does not reorder the workspace rail. */
  lastOpenedAt: number
  /** Local workspace icon — not part of the signed invite payload. */
  workspaceAvatarId?: string
}

const STORAGE_KEY = 'peerly-workspaces'

function isStoredWorkspace(value: unknown): value is StoredWorkspace {
  if (!value || typeof value !== 'object') return false
  const w = value as Record<string, unknown>
  const list = w.allowList as Record<string, unknown> | undefined
  return (
    typeof w.workspaceId === 'string' &&
    !!w.workspaceId &&
    (w.workspaceRouteId === undefined || isWorkspaceRouteId(w.workspaceRouteId)) &&
    typeof w.workspaceName === 'string' &&
    typeof w.creatorKeyId === 'string' &&
    typeof w.lastOpenedAt === 'number' &&
    !!list &&
    typeof list === 'object' &&
    Array.isArray(list.emails) &&
    list.emails.every(email => typeof email === 'string') &&
    typeof list.signedAt === 'number' &&
    typeof list.signature === 'string' &&
    (w.workspaceAvatarId === undefined || typeof w.workspaceAvatarId === 'string')
  )
}

/** Snapshot the open workspace for the remembered-workspaces list. */
export function snapshotWorkspace(
  workspace: WorkspaceAccess & { workspaceAvatarId?: string }
): Omit<StoredWorkspace, 'lastOpenedAt'> {
  return {
    workspaceId: workspace.workspaceId,
    workspaceRouteId: workspace.workspaceRouteId,
    workspaceName: workspace.workspaceName,
    creatorKeyId: workspace.creatorKeyId,
    allowList: workspace.allowList,
    workspaceAvatarId: workspace.workspaceAvatarId,
  }
}

export function loadWorkspaces(): StoredWorkspace[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Drop anything malformed rather than letting it reach the join flow.
    return parsed.filter(isStoredWorkspace)
  } catch {
    return []
  }
}

/** Add stable public route IDs to remembered workspaces from older releases. */
export async function migrateWorkspaceRouteIds(): Promise<void> {
  const workspaces = loadWorkspaces()
  const missing = workspaces.filter(workspace => !workspace.workspaceRouteId)
  if (missing.length === 0) return
  const routeIds = new Map(
    await Promise.all(missing.map(async workspace => [
      workspace.workspaceId,
      await ensureWorkspaceRouteId(workspace),
    ] as const))
  )
  save(workspaces.map(workspace => ({
    ...workspace,
    workspaceRouteId:
      workspace.workspaceRouteId ?? routeIds.get(workspace.workspaceId),
  })))
}

/** Announced after any change, so screens showing this list can re-read it. */
export const WORKSPACES_CHANGED_EVENT = 'peerly-workspaces-changed'

function save(workspaces: StoredWorkspace[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaces))
  } catch {
    // Quota exceeded — the active session still works, only the picker suffers.
  }
  // The rail reads this list during render and nothing re-renders on a
  // localStorage write, so forgetting a workspace left it on screen until
  // some unrelated state change happened to repaint.
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(WORKSPACES_CHANGED_EVENT))
}

/**
 * Record (or refresh) a workspace after joining it.
 *
 * When we already know this workspace, keep whichever allow-list is newer:
 * members get added over time, and an entry that pinned the list from the day
 * you joined would keep offering a stale one. `newerAllowList` only compares —
 * callers must have verified the signature against `creatorKeyId` first, which
 * is why this takes an already-verified list rather than verifying here.
 */
export function rememberWorkspace(workspace: Omit<StoredWorkspace, 'lastOpenedAt'>): void {
  const existing = loadWorkspaces()
  const previous = existing.find(w => w.workspaceId === workspace.workspaceId)

  const next: StoredWorkspace = {
    ...workspace,
    workspaceRouteId: workspace.workspaceRouteId ?? previous?.workspaceRouteId,
    allowList: previous ? newerAllowList(previous.allowList, workspace.allowList) : workspace.allowList,
    workspaceAvatarId: workspace.workspaceAvatarId ?? previous?.workspaceAvatarId,
    lastOpenedAt: Date.now(),
  }

  if (!previous) {
    save([...existing, next])
    return
  }
  // Replace in place so merely opening a workspace never makes the rail jump.
  save(existing.map(item => (item.workspaceId === workspace.workspaceId ? next : item)))
}

export function mostRecentlyOpenedWorkspace(workspaces: readonly StoredWorkspace[]): StoredWorkspace | undefined {
  return workspaces.reduce<StoredWorkspace | undefined>(
    (latest, workspace) => !latest || workspace.lastOpenedAt > latest.lastOpenedAt ? workspace : latest,
    undefined
  )
}

export function forgetWorkspace(workspaceId: string): void {
  save(loadWorkspaces().filter(w => w.workspaceId !== workspaceId))
}

/**
 * Workspaces to offer the signed-in user.
 *
 * This is a UX filter, not a security boundary: anything in localStorage is
 * readable by anyone using this browser profile regardless. It exists so that
 * signing in as someone else does not present a list of workspaces they cannot
 * actually enter — clicking one would only fail at the peer handshake, which
 * reads as a broken app. Access is still decided by the handshake, every time.
 */
export function workspacesForEmail(email: string): StoredWorkspace[] {
  return loadWorkspaces().filter(w => isEmailAllowed(w.allowList, email))
}
