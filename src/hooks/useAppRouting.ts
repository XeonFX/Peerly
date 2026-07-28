import { useCallback, useEffect, useState } from 'react'
import { useBrowserHistory } from '@peerly/core/react'
import {
  defaultWorkspaceRoute,
  hasInviteHash,
  pathForRoute,
  pathWithHash,
  resolveInitialRoute,
  routeFromLocation,
  type AppRoute,
  type PickerRoute,
  type WorkspaceRoute,
} from '../routing'

/** Where a route lives in the address bar. An invite hash is carried over on
 *  request: it is how a fresh visitor's invite survives the first navigation. */
function urlForRoute(route: AppRoute, preserveHash = false): string {
  return preserveHash ? pathWithHash(pathForRoute(route)) : pathForRoute(route)
}

export function useAppRouting(workspaceName: string | undefined, signedIn: boolean, ready: boolean) {
  const inWorkspace = Boolean(workspaceName)
  const [route, setRoute] = useState<AppRoute>(() => resolveInitialRoute(inWorkspace, signedIn))

  const addressBar = useBrowserHistory({
    seedPath: () => urlForRoute(route, hasInviteHash()),
    onLocationChange: () => {
      // A pasted invite link changes only the fragment, so the document never
      // reloads and the route below would not otherwise notice it.
      if (hasInviteHash()) {
        setRoute({ screen: 'picker', tab: 'join' })
        return
      }
      const parsed = routeFromLocation(window.location)
      const signedInHome: AppRoute = signedIn ? { screen: 'home' } : { screen: 'login' }
      if (!parsed) {
        setRoute(inWorkspace ? defaultWorkspaceRoute(workspaceName) : signedInHome)
        return
      }
      // A workspace URL is only reachable once one is actually open; going
      // Back into one we have left would render an empty workspace.
      if (ready && !inWorkspace && parsed.screen === 'workspace') {
        setRoute(signedInHome)
        addressBar.replace(urlForRoute(signedInHome))
        return
      }
      setRoute(parsed)
    },
  })

  const navigate = useCallback(
    (next: AppRoute, options?: { replace?: boolean; preserveHash?: boolean }) => {
      setRoute(next)
      const path = urlForRoute(next, options?.preserveHash)
      if (options?.replace) addressBar.replace(path)
      else addressBar.push(path)
    },
    [addressBar]
  )

  useEffect(() => {
    if (!ready) return
    // Old bookmarks intentionally remain valid, but once the active workspace
    // is known, upgrade them to the descriptive (non-secret) workspace URL.
    // This also keeps the address bar accurate after a workspace rename.
    if (inWorkspace && route.screen === 'workspace' && route.workspaceName !== workspaceName) {
      navigate({ ...route, workspaceName }, { replace: true })
      return
    }
    if (inWorkspace && route.screen === 'picker') {
      navigate(defaultWorkspaceRoute(workspaceName), { replace: true })
      return
    }
    if (!inWorkspace && route.screen === 'workspace') {
      navigate(signedIn ? { screen: 'home' } : { screen: 'login' }, { replace: true })
      return
    }
    if (signedIn && route.screen === 'login') {
      navigate({ screen: 'home' }, { replace: true })
      return
    }
    if (!signedIn && (route.screen === 'home' || route.screen === 'account' || route.screen === 'storage')) {
      navigate({ screen: 'login' }, { replace: true })
      return
    }
    if (!signedIn && route.screen === 'picker' && route.tab === 'create') {
      navigate({ screen: 'login' }, { replace: true })
    }
  }, [ready, inWorkspace, workspaceName, signedIn, route, navigate])

  const enterWorkspace = useCallback((nextWorkspaceName = workspaceName) => {
    navigate(defaultWorkspaceRoute(nextWorkspaceName), { replace: true })
  }, [navigate, workspaceName])

  const leaveToPicker = useCallback(() => {
    navigate({ screen: 'home' }, { replace: true })
  }, [navigate])

  const setPickerTab = useCallback(
    (tab: PickerRoute['tab']) => {
      navigate({ screen: 'picker', tab }, { preserveHash: true })
    },
    [navigate]
  )

  const setWorkspaceRoute = useCallback(
    (next: WorkspaceRoute) => {
      navigate({ ...next, workspaceName: next.workspaceName ?? workspaceName })
    },
    [navigate, workspaceName]
  )

  const pickerTab = route.screen === 'picker' ? route.tab : 'create'
  const workspaceRoute = route.screen === 'workspace' ? route : defaultWorkspaceRoute(workspaceName)

  return {
    route,
    pickerTab,
    workspaceRoute,
    navigate,
    enterWorkspace,
    leaveToPicker,
    setPickerTab,
    setWorkspaceRoute,
  }
}
