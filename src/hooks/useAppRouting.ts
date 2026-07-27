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

export function useAppRouting(inWorkspace: boolean, signedIn: boolean, ready: boolean) {
  const [route, setRoute] = useState<AppRoute>(() => resolveInitialRoute(inWorkspace, signedIn))

  const addressBar = useBrowserHistory({
    seedPath: () => urlForRoute(route, hasInviteHash()),
    onPopState: () => {
      const parsed = routeFromLocation(window.location)
      const signedInHome: AppRoute = signedIn ? { screen: 'home' } : { screen: 'login' }
      if (!parsed) {
        setRoute(inWorkspace ? defaultWorkspaceRoute() : signedInHome)
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
    if (inWorkspace && route.screen === 'picker') {
      navigate(defaultWorkspaceRoute(), { replace: true })
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
  }, [ready, inWorkspace, signedIn, route, navigate])

  const enterWorkspace = useCallback(() => {
    navigate(defaultWorkspaceRoute(), { replace: true })
  }, [navigate])

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
      navigate(next)
    },
    [navigate]
  )

  const pickerTab = route.screen === 'picker' ? route.tab : 'create'
  const workspaceRoute = route.screen === 'workspace' ? route : defaultWorkspaceRoute()

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
