import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlobUrlRegistry } from './blobUrls'

let counter = 0
const revoked: string[] = []

beforeEach(() => {
  counter = 0
  revoked.length = 0
  vi.stubGlobal('URL', {
    createObjectURL: () => `blob:fake/${++counter}`,
    revokeObjectURL: (url: string) => revoked.push(url),
  })
})

const blob = () => ({ size: 3, type: 'image/png' }) as Blob

describe('BlobUrlRegistry', () => {
  it('returns the same url for an id instead of revoking and recreating', () => {
    const registry = new BlobUrlRegistry()

    const first = registry.create('file-1', blob())
    const second = registry.create('file-1', blob())

    // Recreating would hand back a new url and revoke `first` — which messages
    // already on screen are still pointing at. Their <img> keeps rendering the
    // decoded bitmap, so it looks fine until clicked: ERR_FILE_NOT_FOUND.
    expect(second).toBe(first)
    expect(revoked).toEqual([])
  })

  it('survives a repeated history sync over an already-rendered file', () => {
    const registry = new BlobUrlRegistry()
    const url = registry.create('file-1', blob())

    // History sync re-runs entriesToMessages over files already on screen.
    for (let i = 0; i < 5; i++) registry.create('file-1', blob())

    expect(registry.get('file-1')).toBe(url)
    expect(revoked).toEqual([])
  })

  it('still revokes explicitly and on revokeAll', () => {
    const registry = new BlobUrlRegistry()
    const a = registry.create('a', blob())
    const b = registry.create('b', blob())

    registry.revoke('a')
    expect(revoked).toEqual([a])
    expect(registry.get('a')).toBeUndefined()

    registry.revokeAll()
    expect(revoked).toEqual([a, b])
    expect(registry.get('b')).toBeUndefined()
  })

  it('creates a fresh url after an id was revoked', () => {
    const registry = new BlobUrlRegistry()
    const first = registry.create('a', blob())
    registry.revoke('a')
    const second = registry.create('a', blob())

    expect(second).not.toBe(first)
  })
})
