import { describe, expect, it } from 'vitest'
import { createMeshIsolation, meshId, sanitizeMeshHost } from './meshIsolation.js'

describe('meshIsolation', () => {
  const isolation = createMeshIsolation({
    productionHosts: ['example.app', 'www.example.app'],
    prodAppId: 'example-v1',
    prodLobbyRoomId: 'example-lobby-v1',
  })

  it('keeps production on stable ids', () => {
    expect(isolation.isProductionHost('example.app')).toBe(true)
    expect(isolation.meshId('example.app')).toBe('prod')
    expect(isolation.appIdForMesh('prod')).toBe('example-v1')
    expect(isolation.lobbyRoomIdForMesh('prod')).toBe('example-lobby-v1')
  })

  it('isolates localhost from production', () => {
    const local = isolation.meshId('localhost')
    expect(local).toBe('dev-localhost')
    expect(isolation.lobbyRoomIdForMesh(local)).toBe('example-lobby-v1-dev-localhost')
    expect(isolation.lobbyRoomIdForMesh(local)).not.toBe(isolation.lobbyRoomIdForMesh('prod'))
  })

  it('sanitizes odd hostnames', () => {
    expect(sanitizeMeshHost('Foo_Bar.example')).toBe('foo-bar.example')
    expect(meshId(['x.test'], 'Foo_Bar.example')).toBe('dev-foo-bar.example')
  })

  it('resolve returns a consistent triple', () => {
    const r = isolation.resolve('localhost')
    expect(r.appId).toBe(isolation.appIdForMesh(r.meshId))
    expect(r.lobbyRoomId).toBe(isolation.lobbyRoomIdForMesh(r.meshId))
  })
})
