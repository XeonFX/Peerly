import { useCallback, useEffect, useRef, useState } from 'react'
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

export function useAppRouting(inWorkspace: boolean, signedIn: boolean, ready: boolean) {
  const [route, setRoute] = useState<AppRoute>(() => resolveInitialRoute(inWorkspace, signedIn))
  const urlSeededRef = useRef(false)

  const syncUrl = useCallback((next: AppRoute, replace = false, preserveHash = false) => {
    const path = preserveHash ? pathWithHash(pathForRoute(next)) : pathForRoute(next)
    if (replace) {
      history.replaceState(null, '', path)
    } else {
      history.pushState(null, '', path)
    }
  }, [])

  const navigate = useCallback(
    (next: AppRoute, options?: { replace?: boolean; preserveHash?: boolean }) => {
      setRoute(next)
      syncUrl(next, options?.replace, options?.preserveHash)
    },
    [syncUrl]
  )

  useEffect(() => {
    if (urlSeededRef.current) return
    urlSeededRef.current = true
    syncUrl(route, true, hasInviteHash())
  }, [route, syncUrl])

  useEffect(() => {
    const onPopState = () => {
      const parsed = routeFromLocation(window.location)
      if (!parsed) {
        setRoute(inWorkspace ? defaultWorkspaceRoute() : signedIn ? { screen: 'home' } : { screen: 'login' })
        return
      }
      if (ready && !inWorkspace && parsed.screen === 'workspace') {
        const fallback: AppRoute = signedIn ? { screen: 'home' } : { screen: 'login' }
        setRoute(fallback)
        syncUrl(fallback, true)
        return
      }
      setRoute(parsed)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [inWorkspace, signedIn, ready, syncUrl])

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
