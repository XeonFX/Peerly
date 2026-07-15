import { describe, expect, it } from 'vitest'
import { BlobUrlRegistry } from '../utils/blobUrls'
import { FileCache } from './fileCache'
import { entriesToMessages, fileIdsFromEntries } from './channelHydration'
import type { HistoryEntry } from '../protocol/types'

describe('channelHydration', () => {
  it('collects file ids from history entries', () => {
    const ids = fileIdsFromEntries([
      {
        id: '1',
        text: 'hi',
        senderId: 'a',
        senderName: 'A',
        senderColor: '#fff',
        timestamp: 1,
        channelId: 'general',
        type: 'text',
      },
      {
        id: 'f1',
        text: 'file',
        senderId: 'a',
        senderName: 'A',
        senderColor: '#fff',
        timestamp: 2,
        channelId: 'general',
        type: 'file',
        fileMeta: { id: 'f1', name: 'a.txt', mimeType: 'text/plain', size: 1 },
      },
    ])

    expect(ids).toEqual(['f1'])
  })

  it('builds blob urls from in-memory cache after restore', async () => {
    const cache = new FileCache(async () => {})
    const registry = new BlobUrlRegistry()
    const pngBytes = new Uint8Array([137, 80, 78, 71]).buffer
    const meta = {
      id: 'img-1',
      name: 'photo.png',
      mimeType: 'image/png',
      size: 4,
      senderId: 'a',
      senderName: 'A',
      senderColor: '#fff',
      timestamp: 2,
      channelId: 'general',
    }
    await cache.set(meta, pngBytes, { persist: false })

    const entries: HistoryEntry[] = [
      {
        id: 'img-1',
        text: 'Shared photo.png',
        senderId: 'a',
        senderName: 'A',
        senderColor: '#fff',
        timestamp: 2,
        channelId: 'general',
        type: 'file',
        fileMeta: { id: 'img-1', name: 'photo.png', mimeType: 'image/png', size: 4 },
      },
    ]

    const messages = await entriesToMessages(entries, cache, registry)
    expect(messages).toHaveLength(1)
    expect(messages[0].type).toBe('file')
    expect(messages[0].file?.url).toMatch(/^blob:/)
    expect(messages[0].file?.name).toBe('photo.png')
  })
})