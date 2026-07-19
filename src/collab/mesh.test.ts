import { describe, expect, it } from 'vitest'
import {
  isProductionHost,
  lobbyAppIdForMesh,
  lobbyRoomIdForMesh,
  meshId,
  PROD_MESH_ID,
  sanitizeMeshHost,
} from './mesh'

describe('mesh', () => {
  it('keeps production on stable lobby ids', () => {
    expect(isProductionHost('peerly.cc')).toBe(true)
    expect(meshId('peerly.cc')).toBe(PROD_MESH_ID)
    expect(lobbyAppIdForMesh(PROD_MESH_ID)).toBe('peerly-lobby-v1')
    expect(lobbyRoomIdForMesh(PROD_MESH_ID)).toBe('peerly-lobby-v1')
  })

  it('isolates localhost from production', () => {
    const local = meshId('localhost')
    expect(local).toBe('dev-localhost')
    expect(lobbyRoomIdForMesh(local)).toBe('peerly-lobby-v1-dev-localhost')
    expect(lobbyRoomIdForMesh(local)).not.toBe(lobbyRoomIdForMesh(PROD_MESH_ID))
  })

  it('sanitizes odd hostnames', () => {
    expect(sanitizeMeshHost('Foo_Bar.example')).toBe('foo-bar.example')
  })
})
