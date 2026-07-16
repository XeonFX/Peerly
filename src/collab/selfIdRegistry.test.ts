import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSelfIds, rememberSelfId } from './selfIdRegistry'

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

describe('selfIdRegistry', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage())
  })

  it('remembers and returns ids in insertion order', () => {
    rememberSelfId('ws1', 'a')
    rememberSelfId('ws1', 'b')
    expect(loadSelfIds('ws1')).toEqual(['a', 'b'])
  })

  it('re-registering an id moves it to the end without duplicating', () => {
    rememberSelfId('ws1', 'a')
    rememberSelfId('ws1', 'b')
    rememberSelfId('ws1', 'a')
    expect(loadSelfIds('ws1')).toEqual(['b', 'a'])
  })

  it('keeps workspaces isolated', () => {
    rememberSelfId('ws1', 'a')
    rememberSelfId('ws2', 'b')
    expect(loadSelfIds('ws1')).toEqual(['a'])
    expect(loadSelfIds('ws2')).toEqual(['b'])
  })

  it('caps the registry at 50 ids, dropping the oldest', () => {
    for (let i = 0; i < 55; i++) rememberSelfId('ws1', `id-${i}`)
    const ids = loadSelfIds('ws1')
    expect(ids).toHaveLength(50)
    expect(ids[0]).toBe('id-5')
    expect(ids[49]).toBe('id-54')
  })

  it('tolerates garbage in storage', () => {
    localStorage.setItem('peerly-self-ids:ws1', 'not json')
    expect(loadSelfIds('ws1')).toEqual([])
    localStorage.setItem('peerly-self-ids:ws1', JSON.stringify({ not: 'an array' }))
    expect(loadSelfIds('ws1')).toEqual([])
    localStorage.setItem('peerly-self-ids:ws1', JSON.stringify(['ok', 42, null]))
    expect(loadSelfIds('ws1')).toEqual(['ok'])
  })
})
