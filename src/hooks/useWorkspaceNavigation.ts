import { useCallback } from 'react'
import { enterStoredWorkspace } from '../collab/enterWorkspace'
import type { StoredWorkspace } from '../collab/workspaceStore'
import {
  clearActiveWorkspace,
  clearIdCredentials,
  hydrateSessionAvatar,
  loadSignedInIdentity,
  saveSession,
  type Session,
} from '../session'
import type { AppRoute } from '../routing'

/**
 * Moving between workspaces, and out of them.
 *
 * These four belong together because each one changes the session and the
 * route in the same breath, and getting only one of the two right is how you
 * end up rendering a workspace that is no longer open. Keeping them in one
 * place makes that pairing visible instead of spread through a component.
 */
export type WorkspaceNavigation = {
  /** Merge a patch into the live session and persist it. */
  updateSession(patch: Partial<Session>): void
  /** Close the active workspace, stay signed in, land on the home/DM view. */
  goHome(): void
  /** Switch to another remembered workspace in place — no sign-out round trip. */
  switchWorkspace(workspace: StoredWorkspace): Promise<void>
  createWorkspace(): void
  signOut(): void
}

export type WorkspaceNavigationDeps = {
  currentWorkspaceId: string | undefined
  setSession: React.Dispatch<React.SetStateAction<Session | null>>
  /** Bumped on sign-out so components reading identity storage re-render. */
  onIdentityChanged(): void
  navigate(route: AppRoute, options?: { replace?: boolean }): void
  enterWorkspace(): void
  leaveToPicker(): void
}

export function useWorkspaceNavigation(deps: WorkspaceNavigationDeps): WorkspaceNavigation {
  const {
    currentWorkspaceId, setSession, onIdentityChanged, navigate, enterWorkspace, leaveToPicker,
  } = deps

  const updateSession = useCallback((patch: Partial<Session>) => {
    setSession(previous => {
      if (!previous) return previous
      const next = { ...previous, ...patch }
      saveSession(next)
      return next
    })
  }, [setSession])

  const goHome = useCallback(() => {
    clearActiveWorkspace()
    setSession(null)
    leaveToPicker()
  }, [setSession, leaveToPicker])

  const switchWorkspace = useCallback(async (workspace: StoredWorkspace) => {
    if (workspace.workspaceId === currentWorkspaceId) {
      enterWorkspace()
      return
    }
    // Token expired (ReauthBanner territory) — send them home to
    // re-authenticate rather than persist a workspace we cannot hand a live
    // token to.
    const identity = loadSignedInIdentity()
    if (!identity) {
      goHome()
      return
    }
    try {
      setSession(await hydrateSessionAvatar(await enterStoredWorkspace(workspace, identity)))
      enterWorkspace()
    } catch {
      // Invalid signature, or no longer on the allow-list — bounce home to
      // re-pick rather than sit on a workspace this identity cannot open.
      goHome()
    }
  }, [currentWorkspaceId, setSession, enterWorkspace, goHome])

  const createWorkspace = useCallback(() => {
    clearActiveWorkspace()
    setSession(null)
    navigate({ screen: 'picker', tab: 'create' })
  }, [setSession, navigate])

  const signOut = useCallback(() => {
    clearActiveWorkspace()
    clearIdCredentials()
    setSession(null)
    onIdentityChanged()
    navigate({ screen: 'login' }, { replace: true })
  }, [setSession, onIdentityChanged, navigate])

  return { updateSession, goHome, switchWorkspace, createWorkspace, signOut }
}
