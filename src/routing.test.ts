import { describe, expect, it } from 'vitest'
import { defaultWorkspaceRoute, pathForRoute, routeFromPath } from './routing'

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
      view: 'channel' as const,
      channelId: 'general',
      showFiles: true,
    }
    expect(routeFromPath(pathForRoute(channel))).toEqual(channel)
    expect(routeFromPath(pathForRoute({ screen: 'workspace', view: 'profile' }))).toEqual({
      screen: 'workspace',
      view: 'profile',
    })
    expect(routeFromPath(pathForRoute(defaultWorkspaceRoute()))?.screen).toBe('workspace')
  })

  it('maps root to create tab', () => {
    expect(routeFromPath('/')).toEqual({ screen: 'picker', tab: 'create' })
  })
})