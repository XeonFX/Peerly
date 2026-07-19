import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadGlobalDmHistory,
  saveGlobalDmHistory,
  upsertGlobalDmMessage,
  type GlobalDmMessage,
} from './globalDmHistory'

function createStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key)
    },
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
  }
}

const msg = (id: string, ts: number, text = 'hi'): GlobalDmMessage => ({
  id,
  ts,
  text,
  name: 'Ada',
  deviceKeyId: 'P-256:x:y',
  sig: 'sig',
  authorUserId: 'ada',
})

beforeEach(() => {
  vi.stubGlobal('localStorage', createStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('globalDmHistory', () => {
  it('persists and reloads', () => {
    saveGlobalDmHistory('abc', [msg('1', 1)])
    expect(loadGlobalDmHistory('abc')).toHaveLength(1)
    expect(loadGlobalDmHistory('abc')[0]?.text).toBe('hi')
  })

  it('upserts by id preferring newer edits', () => {
    let list = [msg('1', 1, 'a')]
    list = upsertGlobalDmMessage(list, { ...msg('1', 1, 'b'), editedAt: 2 })
    expect(list).toHaveLength(1)
    expect(list[0]?.text).toBe('b')
    list = upsertGlobalDmMessage(list, { ...msg('1', 1, 'old'), editedAt: 1 })
    expect(list[0]?.text).toBe('b')
  })
})
