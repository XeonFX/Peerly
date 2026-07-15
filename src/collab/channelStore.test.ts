import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addWorkspaceChannel,
  GENERAL_CHANNEL,
  getCustomChannels,
  loadWorkspaceChannels,
  MAX_CHANNEL_NAME_LENGTH,
  MAX_CUSTOM_CHANNELS,
  mergeWorkspaceChannel,
  slugifyChannelName,
} from './channelStore'

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

describe('channelStore hostile input', () => {
  it('rejects channel ids that are not slugs', () => {
    // Ids become localStorage key suffixes, so free-form text is not acceptable.
    for (const id of ['../../etc', 'a b', 'Upper', '', 'x'.repeat(200), 'peerly-history-x__y']) {
      expect(mergeWorkspaceChannel('team', { id, name: 'n', description: '', kind: 'channel' })).toBe(false)
    }
    expect(mergeWorkspaceChannel('team', { id: 'design-2', name: 'n', description: '', kind: 'channel' })).toBe(true)
  })

  it('truncates hostile channel names instead of storing them whole', () => {
    mergeWorkspaceChannel('team', { id: 'spam', name: 'x'.repeat(10_000), description: '', kind: 'channel' })
    const stored = getCustomChannels('team').find(c => c.id === 'spam')
    expect(stored?.name).toHaveLength(MAX_CHANNEL_NAME_LENGTH)
  })

  it('caps how many channels a peer can add', () => {
    for (let i = 0; i < MAX_CUSTOM_CHANNELS + 10; i++) {
      mergeWorkspaceChannel('team', { id: `c-${i}`, name: `c${i}`, description: '', kind: 'channel' })
    }
    expect(getCustomChannels('team').length).toBe(MAX_CUSTOM_CHANNELS)
  })
})

describe('channelStore', () => {
  it('starts with general only', () => {
    expect(loadWorkspaceChannels('My Team')).toEqual([GENERAL_CHANNEL])
  })

  it('adds custom channels per workspace', () => {
    const channel = addWorkspaceChannel('my-team', 'Random Chat')
    expect(channel?.id).toBe('random-chat')
    expect(channel?.kind).toBe('channel')
    expect(loadWorkspaceChannels('my-team').map(c => c.id)).toEqual(['general', 'random-chat'])
  })

  it('slugifies channel names', () => {
    expect(slugifyChannelName('Engineering Team')).toBe('engineering-team')
  })

  it('merges remote channels without duplicates', () => {
    expect(
      mergeWorkspaceChannel('team-a', {
        id: 'design',
        name: 'Design',
        description: '',
        kind: 'channel',
      })
    ).toBe(true)
    expect(getCustomChannels('team-a').map(channel => channel.id)).toEqual(['design'])
    expect(
      mergeWorkspaceChannel('team-a', {
        id: 'design',
        name: 'Design',
        description: '',
        kind: 'channel',
      })
    ).toBe(false)
    expect(
      mergeWorkspaceChannel('team-a', {
        id: GENERAL_CHANNEL.id,
        name: 'general',
        description: '',
        kind: 'channel',
      })
    ).toBe(false)
  })
})