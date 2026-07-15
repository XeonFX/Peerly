import { describe, expect, it } from 'vitest'
import { FileCache } from './fileCache'
import type { FileMetaPayload } from '../protocol/types'

function meta(id: string, size: number, channelId = 'general'): FileMetaPayload {
  return {
    id,
    name: `${id}.bin`,
    mimeType: 'application/octet-stream',
    size,
    senderId: 'peer',
    senderName: 'Peer',
    senderColor: '#fff',
    timestamp: Number(id),
    channelId,
  }
}

describe('FileCache memory budget', () => {
  it('evicts old buffers past the budget but keeps the newest resident', async () => {
    const cache = new FileCache(async () => {}, async () => null, 10)

    await cache.set(meta('1', 8), new ArrayBuffer(8))
    await cache.set(meta('2', 8), new ArrayBuffer(8))

    // Both still known, but the first buffer was evicted to stay under budget.
    expect(cache.has('1')).toBe(true)
    expect(cache.get('1')).toBeUndefined()
    expect(cache.get('2')).toBeDefined()
  })

  it('reloads an evicted buffer from the persistent store', async () => {
    const cache = new FileCache(
      async () => {},
      async id =>
        id === '1' ? { mimeType: 'application/octet-stream', buffer: new ArrayBuffer(8) } : null,
      10
    )

    await cache.set(meta('1', 8), new ArrayBuffer(8))
    await cache.set(meta('2', 8), new ArrayBuffer(8))

    const reloaded = await cache.load('1')
    expect(reloaded?.buffer.byteLength).toBe(8)
    expect(reloaded?.meta.name).toBe('1.bin')
  })

  it('does not report unknown files as loadable', async () => {
    const cache = new FileCache(async () => {}, async () => null)
    expect(await cache.load('nope')).toBeUndefined()
  })
})

describe('FileCache', () => {
  it('stores and filters files by channel', async () => {
    const cache = new FileCache(async () => {})
    const buffer = new Uint8Array([1, 2, 3]).buffer

    await cache.set(
      {
        id: '1',
        name: 'a.txt',
        mimeType: 'text/plain',
        size: 3,
        senderId: 'peer',
        senderName: 'Peer',
        senderColor: '#fff',
        timestamp: 1,
        channelId: 'general',
      },
      buffer
    )

    await cache.set(
      {
        id: '2',
        name: 'b.txt',
        mimeType: 'text/plain',
        size: 3,
        senderId: 'peer',
        senderName: 'Peer',
        senderColor: '#fff',
        timestamp: 2,
        channelId: 'random',
      },
      buffer
    )

    expect(cache.forChannel('general')).toHaveLength(1)
    expect(cache.all()).toHaveLength(2)
    expect(cache.has('1')).toBe(true)

    cache.clear()
    expect(cache.all()).toHaveLength(0)
  })
})