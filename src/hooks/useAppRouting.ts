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

export function useAppRouting(inWorkspace: boolean, ready: boolean) {
  const [route, setRoute] = useState<AppRoute>(() => resolveInitialRoute(inWorkspace))
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
        setRoute(inWorkspace ? defaultWorkspaceRoute() : { screen: 'picker', tab: 'create' })
        return
      }
      if (ready && !inWorkspace && parsed.screen === 'workspace') {
        setRoute({ screen: 'picker', tab: 'create' })
        syncUrl({ screen: 'picker', tab: 'create' }, true)
        return
      }
      setRoute(parsed)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [inWorkspace, ready, syncUrl])

  useEffect(() => {
    if (!ready) return
    if (inWorkspace && route.screen === 'picker') {
      navigate(defaultWorkspaceRoute(), { replace: true })
      return
    }
    if (!inWorkspace && route.screen === 'workspace') {
      navigate({ screen: 'picker', tab: 'create' }, { replace: true })
    }
  }, [ready, inWorkspace, route.screen, navigate])

  const enterWorkspace = useCallback(() => {
    navigate(defaultWorkspaceRoute(), { replace: true })
  }, [navigate])

  const leaveToPicker = useCallback(() => {
    navigate({ screen: 'picker', tab: 'create' }, { replace: true })
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