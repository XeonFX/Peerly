import { GENERAL_CHANNEL } from './collab/channelStore'

export type PickerRoute = {
  screen: 'picker'
  tab: 'create' | 'join'
}

export type LoginRoute = { screen: 'login' }
/**
 * The friends list, optionally with a conversation open.
 *
 * The open DM belongs in the URL: it was component state before, so a refresh
 * dropped the user back to the list and lost the conversation they were in.
 */
export type HomeRoute = { screen: 'home'; dmUserId?: string }
export type AccountRoute = { screen: 'account' }
export type StorageRoute = { screen: 'storage' }

export type WorkspaceRoute =
  | { screen: 'workspace'; view: 'channel'; channelId: string; showFiles: boolean }
  | { screen: 'workspace'; view: 'profile' }
  | { screen: 'workspace'; view: 'settings' }

/** Public legal pages, reachable regardless of session/workspace state. */
export type LegalRoute = { screen: 'legal'; doc: 'privacy' | 'terms' }
export type DevicesRoute = { screen: 'devices'; pairSecret?: string }
export type SyncRoute = { screen: 'sync' }

export type AppRoute =
  | LoginRoute
  | HomeRoute
  | AccountRoute
  | StorageRoute
  | PickerRoute
  | WorkspaceRoute
  | LegalRoute
  | DevicesRoute
  | SyncRoute

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
  if (route.screen === 'login') return '/login'
  if (route.screen === 'home') return route.dmUserId ? `/friends/${encodeURIComponent(route.dmUserId)}` : '/friends'
  if (route.screen === 'account') return '/profile'
  if (route.screen === 'storage') return '/storage'
  if (route.screen === 'picker') {
    return route.tab === 'create' ? '/create' : '/join'
  }
  if (route.screen === 'devices') {
    return route.pairSecret ? `/devices#pair=${encodeURIComponent(route.pairSecret)}` : '/devices'
  }
  if (route.screen === 'sync') return '/sync'

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

function parsePathRoute(pathname: string, search: string, hash = ''): AppRoute | null {
  const path = pathname.replace(/\/+$/, '') || '/'

  if (path === '/privacy') {
    return { screen: 'legal', doc: 'privacy' }
  }
  if (path === '/terms') {
    return { screen: 'legal', doc: 'terms' }
  }
  if (path === '/' || path === '/login') {
    return { screen: 'login' }
  }
  // `/home` is the old spelling, kept so existing links and bookmarks work.
  if (path === '/home' || path === '/friends') return { screen: 'home' }
  const dm = /^\/friends\/([A-Za-z0-9_-]{1,128})$/.exec(path)
  if (dm) return { screen: 'home', dmUserId: dm[1] }
  if (path === '/profile') return { screen: 'account' }
  if (path === '/storage') return { screen: 'storage' }
  if (path === '/create') {
    return { screen: 'picker', tab: 'create' }
  }
  if (path === '/join') {
    return { screen: 'picker', tab: 'join' }
  }
  if (path === '/devices') {
    const match = /^#?pair=([0-9a-f]{32})$/i.exec(hash)
    return { screen: 'devices', pairSecret: match?.[1]?.toLowerCase() }
  }
  if (path === '/sync') return { screen: 'sync' }
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
    return parsePathRoute(url.pathname, url.search, url.hash)
  } catch {
    return null
  }
}

export function routeFromLocation(loc: Location | { pathname: string; search: string; hash?: string }): AppRoute | null {
  return parsePathRoute(loc.pathname, loc.search, loc.hash)
}

/** Preserve invite fragments (#invite=…) when updating picker paths. */
export function pathWithHash(path: string, hash = typeof window !== 'undefined' ? window.location.hash : ''): string {
  return hash ? `${path}${hash}` : path
}

/** True when the location hash carries an invite payload (#invite=…). */
export function hasInviteHash(hash = typeof window !== 'undefined' ? window.location.hash : ''): boolean {
  return /^#?invite=/.test(hash)
}

export function resolveInitialRoute(hasWorkspaceSession: boolean, hasSignedInIdentity = false): AppRoute {
  const fromUrl = typeof window !== 'undefined' ? routeFromLocation(window.location) : null
  const inviteInHash = typeof window !== 'undefined' && hasInviteHash(window.location.hash)
  if (fromUrl?.screen === 'legal') {
    return fromUrl
  }
  if (fromUrl?.screen === 'workspace') {
    return fromUrl
  }
  if (fromUrl?.screen === 'devices' || fromUrl?.screen === 'sync') return fromUrl
  if (hasWorkspaceSession) {
    return defaultWorkspaceRoute()
  }
  if (inviteInHash) {
    return { screen: 'picker', tab: 'join' }
  }
  if (fromUrl?.screen === 'login') {
    return hasSignedInIdentity ? { screen: 'home' } : fromUrl
  }
  if (fromUrl?.screen === 'home' || fromUrl?.screen === 'account' || fromUrl?.screen === 'storage') {
    return hasSignedInIdentity ? fromUrl : { screen: 'login' }
  }
  if (fromUrl?.screen === 'picker') {
    return fromUrl.tab === 'join' || hasSignedInIdentity ? fromUrl : { screen: 'login' }
  }
  return hasSignedInIdentity ? { screen: 'home' } : { screen: 'login' }
}
