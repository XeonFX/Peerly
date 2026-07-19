import { GENERAL_CHANNEL } from './collab/channelStore'

export type PickerRoute = {
  screen: 'picker'
  tab: 'create' | 'join'
}

export type WorkspaceRoute =
  | { screen: 'workspace'; view: 'channel'; channelId: string; showFiles: boolean }
  | { screen: 'workspace'; view: 'profile' }
  | { screen: 'workspace'; view: 'settings' }

/** Public legal pages, reachable regardless of session/workspace state. */
export type LegalRoute = { screen: 'legal'; doc: 'privacy' | 'terms' }

export type AppRoute = PickerRoute | WorkspaceRoute | LegalRoute

const PARSE_BASE = 'http://peerly.local'

export function defaultWorkspaceRoute(): WorkspaceRoute {
  return {
    screen: 'workspace',
    view: 'channel',
    channelId: GENERAL_CHANNEL.id,
    showFiles: false,
  }
}

export function pathForRoute(route: AppRoute): string {
  if (route.screen === 'legal') {
    return `/${route.doc}`
  }
  if (route.screen === 'picker') {
    return route.tab === 'create' ? '/create' : '/join'
  }

  switch (route.view) {
    case 'channel': {
      const base = `/workspace/channel/${encodeURIComponent(route.channelId)}`
      return route.showFiles ? `${base}?files=1` : base
    }
    case 'profile':
      return '/workspace/profile'
    case 'settings':
      return '/workspace/settings'
  }
}

function parsePathRoute(pathname: string, search: string): AppRoute | null {
  const path = pathname.replace(/\/+$/, '') || '/'

  if (path === '/privacy') {
    return { screen: 'legal', doc: 'privacy' }
  }
  if (path === '/terms') {
    return { screen: 'legal', doc: 'terms' }
  }
  if (path === '/' || path === '/create') {
    return { screen: 'picker', tab: 'create' }
  }
  if (path === '/join') {
    return { screen: 'picker', tab: 'join' }
  }
  if (path === '/workspace') {
    return defaultWorkspaceRoute()
  }

  const channelMatch = /^\/workspace\/channel\/([^/]+)$/.exec(path)
  if (channelMatch) {
    const params = new URLSearchParams(search)
    return {
      screen: 'workspace',
      view: 'channel',
      channelId: decodeURIComponent(channelMatch[1]),
      showFiles: params.get('files') === '1',
    }
  }

  if (path === '/workspace/profile') {
    return { screen: 'workspace', view: 'profile' }
  }
  if (path === '/workspace/settings') {
    return { screen: 'workspace', view: 'settings' }
  }

  return null
}

export function routeFromPath(pathAndQuery: string): AppRoute | null {
  try {
    const url = new URL(pathAndQuery, PARSE_BASE)
    return parsePathRoute(url.pathname, url.search)
  } catch {
    return null
  }
}

export function routeFromLocation(loc: Location | { pathname: string; search: string; hash?: string }): AppRoute | null {
  return parsePathRoute(loc.pathname, loc.search)
}

/** Preserve invite fragments (#invite=…) when updating picker paths. */
export function pathWithHash(path: string, hash = typeof window !== 'undefined' ? window.location.hash : ''): string {
  return hash ? `${path}${hash}` : path
}

/** True when the location hash carries an invite payload (#invite=…). */
export function hasInviteHash(hash = typeof window !== 'undefined' ? window.location.hash : ''): boolean {
  return /^#?invite=/.test(hash)
}

export function resolveInitialRoute(hasWorkspaceSession: boolean): AppRoute {
  const fromUrl = typeof window !== 'undefined' ? routeFromLocation(window.location) : null
  const inviteInHash = typeof window !== 'undefined' && hasInviteHash(window.location.hash)
  if (fromUrl?.screen === 'legal') {
    return fromUrl
  }
  if (fromUrl?.screen === 'workspace') {
    return fromUrl
  }
  if (hasWorkspaceSession) {
    return defaultWorkspaceRoute()
  }
  if (inviteInHash) {
    return { screen: 'picker', tab: 'join' }
  }
  if (fromUrl?.screen === 'picker') return fromUrl
  return { screen: 'picker', tab: 'create' }
}