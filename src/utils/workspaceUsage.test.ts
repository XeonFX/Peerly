import { beforeEach, describe, expect, it, vi } from 'vitest'

const fileStoreMock = {
  ids: [] as string[],
  deleted: [] as string[],
}

vi.mock('./fileStore', () => ({
  listFileBlobIds: async () => fileStoreMock.ids,
  deleteFileBlobs: async (ids: string[]) => {
    fileStoreMock.deleted.push(...ids)
  },
}))

import {
  clearWorkspaceData,
  clearWorkspaceFiles,
  estimateWorkspaceUsage,
  formatUsage,
} from './workspaceUsage'

function createStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: key => void store.delete(key),
    clear: () => store.clear(),
    key: index => [...store.keys()][index] ?? null,
    get length() {
      return store.size
    },
  }
}

function fileMessage(fileId: string, size: number) {
  return { id: fileId, type: 'file', file: { id: fileId, size } }
}

describe('workspaceUsage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage())
    fileStoreMock.ids = []
    fileStoreMock.deleted = []
  })

  it('sums localStorage bytes and cached file sizes per workspace', async () => {
    localStorage.setItem('peerly-history-ws1__general', JSON.stringify([fileMessage('f1', 1000)]))
    localStorage.setItem('peerly-read-ws1', '{}')
    localStorage.setItem('peerly-history-ws2__general', JSON.stringify([fileMessage('f2', 5000)]))
    fileStoreMock.ids = ['f1', 'f2']

    const usage = await estimateWorkspaceUsage('ws1')

    expect(usage.filesBytes).toBe(1000)
    expect(usage.fileCount).toBe(1)
    expect(usage.messagesBytes).toBeGreaterThan(0)
    expect(usage.totalBytes).toBe(usage.messagesBytes + usage.filesBytes)
    expect(usage.sharedFilesBytes).toBe(1000)
    expect(usage.sharedFileCount).toBe(1)
    expect(usage.reclaimableBytes).toBe(1000)
  })

  it('does not count files whose blobs were never cached or already evicted', async () => {
    localStorage.setItem('peerly-history-ws1__general', JSON.stringify([fileMessage('f1', 1000)]))
    fileStoreMock.ids = []

    const usage = await estimateWorkspaceUsage('ws1')
    expect(usage.filesBytes).toBe(0)
    expect(usage.fileCount).toBe(0)
  })

  it('clears history and read state but keeps workspace access', async () => {
    localStorage.setItem('peerly-history-ws1__general', '[]')
    localStorage.setItem('peerly-read-ws1', '{}')
    localStorage.setItem('peerly-workspaces', '[{"workspaceId":"ws1"}]')

    await clearWorkspaceData('ws1')

    expect(localStorage.getItem('peerly-history-ws1__general')).toBeNull()
    expect(localStorage.getItem('peerly-read-ws1')).toBeNull()
    expect(localStorage.getItem('peerly-workspaces')).not.toBeNull()
  })

  it('frees cached files without deleting history', async () => {
    const key = 'peerly-history-ws1__general'
    localStorage.setItem(key, JSON.stringify([fileMessage('f1', 1000)]))
    fileStoreMock.ids = ['f1']

    const reclaimed = await clearWorkspaceFiles('ws1')

    expect(reclaimed).toBe(1000)
    expect(fileStoreMock.deleted).toEqual(['f1'])
    expect(localStorage.getItem(key)).not.toBeNull()
  })

  it('deletes only blobs no other workspace references', async () => {
    localStorage.setItem(
      'peerly-history-ws1__general',
      JSON.stringify([fileMessage('shared', 10), fileMessage('mine-only', 20)])
    )
    localStorage.setItem('peerly-history-ws2__general', JSON.stringify([fileMessage('shared', 10)]))
    fileStoreMock.ids = ['shared', 'mine-only']

    const usage = await estimateWorkspaceUsage('ws1')
    expect(usage.reclaimableBytes).toBe(20)
    await clearWorkspaceData('ws1')

    expect(fileStoreMock.deleted).toEqual(['mine-only'])
  })

  it('formats sizes for humans', () => {
    expect(formatUsage(0)).toBe('0 B')
    expect(formatUsage(1536)).toBe('1.5 KB')
    expect(formatUsage(2.5 * 1024 * 1024)).toBe('2.5 MB')
  })
})
