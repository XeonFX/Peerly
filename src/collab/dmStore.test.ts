import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildDmChannelId,
  createDmChannel,
  ensureDmChannel,
  getDmPeerId,
  mayExchangeChannel,
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

  describe('who may exchange a channel\'s content', () => {
    // Alice, Bob and Carol are all admitted to the workspace; Alice and Bob have a DM.
    const dm = buildDmChannelId('alice', 'bob')

    it('a DM goes only to its other participant, never to a third member who derived its id', () => {
      expect(mayExchangeChannel(dm, 'alice', 'bob')).toBe(true)
      expect(mayExchangeChannel(dm, 'bob', 'alice')).toBe(true)
      expect(mayExchangeChannel(dm, 'alice', 'carol')).toBe(false)
      expect(mayExchangeChannel(dm, 'bob', 'carol')).toBe(false)
    })

    it('a DM this device is not in goes to nobody, its participants included', () => {
      const theirs = buildDmChannelId('bob', 'carol')
      expect(mayExchangeChannel(theirs, 'alice', 'bob')).toBe(false)
      expect(mayExchangeChannel(theirs, 'alice', 'carol')).toBe(false)
    })

    it('a malformed DM id goes to nobody', () => {
      for (const id of ['dm-', 'dm-alice', 'dm-alice::', 'dm-::bob', 'dm-alice:bob'])
        expect(mayExchangeChannel(id, 'alice', 'bob'), id).toBe(false)
    })

    it('for any three distinct peers, a DM is exchanged only between its two participants', () => {
      // Ids that differ by case, prefix or a lookalike `dm-` start, so a loose comparison would let one stand in for another.
      const ids = ['alice', 'bob', 'Bob', 'bo', 'bobby', 'dm-x', '0', 'A'.repeat(20)]
      for (const a of ids) for (const b of ids) for (const c of ids) {
        if (a === b || b === c || a === c) continue
        const dm = buildDmChannelId(a, b)
        expect(mayExchangeChannel(dm, a, b), `${dm} ${a}→${b}`).toBe(true)
        expect(mayExchangeChannel(dm, a, c), `${dm} ${a}→${c}`).toBe(false)
        expect(mayExchangeChannel(dm, c, a), `${dm} ${c}→${a}`).toBe(false)
      }
    })

    it('an ordinary channel goes to any member', () => {
      expect(mayExchangeChannel('general', 'alice', 'carol')).toBe(true)
      expect(mayExchangeChannel('random', 'bob', 'alice')).toBe(true)
    })
  })
})
