// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { defaultWorkspaceRoute, hasInviteHash, pathForRoute, pathWithHash, resolveInitialRoute, routeFromPath } from './routing'

describe('routing', () => {
  it('round-trips picker routes', () => {
    expect(routeFromPath(pathForRoute({ screen: 'picker', tab: 'create' }))).toEqual({
      screen: 'picker',
      tab: 'create',
    })
    expect(routeFromPath(pathForRoute({ screen: 'picker', tab: 'join' }))).toEqual({
      screen: 'picker',
      tab: 'join',
    })
  })

  it('round-trips workspace routes', () => {
    const channel = {
      screen: 'workspace' as const,
      workspaceRouteId: '0123456789abcdef0123456789abcdef',
      view: 'channel' as const,
      channelId: 'general',
      showFiles: true,
    }
    expect(routeFromPath(pathForRoute(channel))).toEqual(channel)
    expect(routeFromPath(pathForRoute(defaultWorkspaceRoute()))?.screen).toBe('workspace')
  })

  it('keeps legacy workspace URLs while adding the public workspace identity to new URLs', () => {
    const routeId = '0123456789abcdef0123456789abcdef'
    expect(pathForRoute(defaultWorkspaceRoute(routeId))).toBe(`/workspace/${routeId}/channel/general`)
    expect(routeFromPath('/workspace/channel/general')).toEqual(defaultWorkspaceRoute())
    expect(routeFromPath('/workspace/My%20Workspace/settings')).toEqual({
      screen: 'workspace',
      workspaceRouteId: 'My Workspace',
      view: 'settings',
    })
  })

  it('gives same-named workspaces distinct URLs through their route identities', () => {
    const first = pathForRoute(defaultWorkspaceRoute('0123456789abcdef0123456789abcdef'))
    const second = pathForRoute(defaultWorkspaceRoute('fedcba9876543210fedcba9876543210'))
    expect(first).not.toBe(second)
  })

  it('redirects the legacy workspace profile route to the global profile', () => {
    expect(routeFromPath('/workspace/profile')).toEqual({ screen: 'account' })
    window.history.replaceState(null, '', '/profile')
    expect(resolveInitialRoute(true, true)).toEqual({ screen: 'account' })
  })

  it('maps root and /login to the logged-out landing view', () => {
    expect(routeFromPath('/')).toEqual({ screen: 'login' })
    expect(routeFromPath('/login')).toEqual({ screen: 'login' })
  })

  it('round-trips signed-in global routes', () => {
    expect(routeFromPath(pathForRoute({ screen: 'home' }))).toEqual({ screen: 'home' })
    expect(routeFromPath(pathForRoute({ screen: 'account' }))).toEqual({ screen: 'account' })
    expect(routeFromPath(pathForRoute({ screen: 'storage' }))).toEqual({ screen: 'storage' })
  })

  it('protects create while preserving invite-based sign in', () => {
    window.history.replaceState(null, '', '/create')
    expect(resolveInitialRoute(false, false)).toEqual({ screen: 'login' })
    expect(resolveInitialRoute(false, true)).toEqual({ screen: 'picker', tab: 'create' })
    window.history.replaceState(null, '', '/join#invite=abc')
    expect(resolveInitialRoute(false, false)).toEqual({ screen: 'picker', tab: 'join' })
  })

  it('round-trips a device pairing link', () => {
    const pairSecret = '0123456789abcdef0123456789abcdef'
    const route = { screen: 'devices' as const, pairSecret }
    expect(pathForRoute(route)).toBe(`/devices#pair=${pairSecret}`)
    expect(routeFromPath(pathForRoute(route))).toEqual(route)
  })

  it('round-trips the sync activity route', () => {
    expect(routeFromPath(pathForRoute({ screen: 'sync' }))).toEqual({ screen: 'sync' })
  })

  it('detects invite hashes', () => {
    expect(hasInviteHash('#invite=abc')).toBe(true)
    expect(hasInviteHash('invite=abc')).toBe(true)
    expect(hasInviteHash('#other=1')).toBe(false)
    expect(hasInviteHash('')).toBe(false)
  })

  it('appends the current hash when preserving invite links', () => {
    expect(pathWithHash('/join', '#invite=abc')).toBe('/join#invite=abc')
    expect(pathWithHash('/create', '')).toBe('/create')
  })
})
