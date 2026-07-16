import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildDmChannelId,
  createDmChannel,
  ensureDmChannel,
  getDmPeerId,
  mergeDmChannel,
  removeDmChannel,
  routeDmChannel,
} from './dmStore'

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

beforeEach(() => {
  vi.stubGlobal('localStorage', createStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('dmStore', () => {
  it('builds stable dm ids regardless of order', () => {
    expect(buildDmChannelId('alice', 'bob')).toBe(buildDmChannelId('bob', 'alice'))
    expect(getDmPeerId(buildDmChannelId('alice', 'bob'), 'alice')).toBe('bob')
  })

  it('does not treat a dm between two other peers as ours', () => {
    const foreign = buildDmChannelId('alice', 'bob')
    expect(getDmPeerId(foreign, 'mallory')).toBeNull()
    expect(routeDmChannel(foreign, 'mallory')).toEqual({ kind: 'foreign-dm' })
  })

  it('routes channels, our dms, and foreign dms distinctly', () => {
    expect(routeDmChannel('general', 'alice')).toEqual({ kind: 'channel' })
    expect(routeDmChannel(buildDmChannelId('alice', 'bob'), 'alice')).toEqual({
      kind: 'dm',
      peerId: 'bob',
    })
    expect(routeDmChannel(buildDmChannelId('alice', 'bob'), 'carol')).toEqual({
      kind: 'foreign-dm',
    })
  })

  it('creates and merges dm channels', () => {
    const peer = { id: 'bob', name: 'Bob', color: '#fff' }
    const channel = createDmChannel(peer, 'alice')
    expect(channel.kind).toBe('dm')

    expect(mergeDmChannel('team', channel)).toBe(true)
    expect(mergeDmChannel('team', channel)).toBe(false)
    expect(ensureDmChannel('team', peer, 'alice').id).toBe(channel.id)
    expect(removeDmChannel('team', channel.id)).toBe(true)
    expect(removeDmChannel('team', channel.id)).toBe(false)
  })
})
